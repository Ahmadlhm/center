using System.Net;
using System.Net.Mail;
using System.Threading.Channels;
using Center.Domain;
using Center.Infrastructure;

namespace Center.Features;

public sealed class PasswordMail(IConfiguration settings, ILogger<PasswordMail> logger) : BackgroundService
{
    private readonly Channel<(string Email, string Link)> queue = Channel.CreateBounded<(string, string)>(100);
    public bool Available => !string.IsNullOrWhiteSpace(settings["CENTER_SMTP_HOST"]) && !string.IsNullOrWhiteSpace(settings["CENTER_SMTP_FROM"]);
    public void Enqueue(string email, string link)
    {
        if (!queue.Writer.TryWrite((email, link))) logger.LogWarning("Password reset mail queue is full.");
    }
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var message in queue.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                using var smtp = new SmtpClient(settings["CENTER_SMTP_HOST"]!, settings.GetValue("CENTER_SMTP_PORT", 587))
                {
                    EnableSsl = !(settings.GetValue<bool>("CENTER_DEMO") && settings.GetValue<bool>("CENTER_SMTP_LOCAL_PLAINTEXT"))
                };
                var username = settings["CENTER_SMTP_USER"];
                if (!string.IsNullOrEmpty(username)) smtp.Credentials = new NetworkCredential(username, settings["CENTER_SMTP_PASSWORD"]);
                using var email = new MailMessage(settings["CENTER_SMTP_FROM"]!, message.Email,
                    "إعادة تعيين كلمة مرور منصة المراكز القرآنية",
                    $"استخدم هذا الرابط خلال ٣٠ دقيقة لإعادة تعيين كلمة مرورك:\n{message.Link}\nإذا لم تطلب التغيير يمكنك تجاهل الرسالة.");
                using var deadline = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                deadline.CancelAfter(TimeSpan.FromSeconds(20));
                await smtp.SendMailAsync(email, deadline.Token);
            }
            catch (Exception e) when (!stoppingToken.IsCancellationRequested)
            {
                logger.LogWarning("Password reset mail delivery failed: {ErrorType}", e.GetType().Name);
            }
        }
    }
}

public static class Passwords
{
    public record Provisioned(string Email, string? TemporaryPassword, string? Token);
    public static Provisioned Issue(IdentityData data, string name, string email, Guid center, string[] roles, Guid[] units)
    {
        var existing = data.Accounts.Find(x => x.Email == email);
        if (existing != null)
        {
            Rules.Require(existing.Active, "هذا الحساب غير نشط.");
            return new(email, null, Identity.AddInvite(data, name, email, center, roles, units));
        }
        var password = Temporary();
        var account = new Account(Guid.NewGuid(), name, email, Identity.Password(password), MustChangePassword: true, TemporaryUntil: DateTimeOffset.UtcNow.AddDays(3));
        data.Accounts.Add(account);
        data.Memberships.Add(new(account.Id, center, roles, units));
        data.Invites.RemoveAll(x => x.Center == center && x.Email == email);
        return new(email, password, null);
    }
    public static Provisioned Reissue(IdentityData data, Guid center, Guid id)
    {
        var account = Rules.Found(data.Accounts.Find(x => x.Id == id && x.Active));
        Rules.Require(!account.Platform && data.Memberships.Any(x => x.Account == id && x.Center == center && x.Active), "الحساب خارج المركز.", 403);
        var password = Temporary();
        data.Accounts.Upsert(x => x.Id == id, account with { Password = Identity.Password(password), MustChangePassword = true, TemporaryUntil = DateTimeOffset.UtcNow.AddDays(3) });
        Revoke(data, id);
        return new(account.Email, password, null);
    }
    private static string Temporary() => Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(18));
    private static void Revoke(IdentityData data, Guid id)
    {
        data.Sessions.RemoveAll(x => x.Account == id);
        data.PasswordResets.RemoveAll(x => x.Account == id);
        data.Challenges.RemoveAll(x => x.Account == id);
    }
    public static void Map(RouteGroupBuilder g)
    {
        g.MapPost("/password/change", async (Change input, HttpContext http, State store, IConfiguration config) =>
        {
            var (account, _) = await Identity.Current(store, http);
            var current = Identity.Hash(Identity.SessionToken(http));
            var next = Identity.Token();
            await store.Change<IdentityData, bool>(Module.Identity, Guid.Empty, data =>
            {
                var active = Rules.Found(data.Accounts.Find(x => x.Id == account.Id && x.Active));
                var session = data.Sessions.Find(x => x.Account == active.Id && x.Hash == current && x.Expires > DateTimeOffset.UtcNow);
                Rules.Require(session != null && Identity.CheckPassword(active, input.CurrentPassword), "كلمة المرور الحالية غير صحيحة.", 403);
                Rules.Require(!active.Platform || !store.RequireMfa || active.MustChangePassword ||
                    session!.Authenticator == PlatformAuthenticator.Verified, "أكمل التحقق عبر التطبيق قبل تغيير كلمة المرور.", 403);
                Rules.Require(!Identity.CheckPassword(active, input.Password), "اختر كلمة مرور جديدة تختلف عن الحالية.");
                data.Accounts.Upsert(x => x.Id == active.Id, active with { Password = Identity.Password(input.Password), MustChangePassword = false, TemporaryUntil = null });
                Revoke(data, active.Id);
                var duration = session!.Authenticator == PlatformAuthenticator.Pending ? 10 : 720;
                data.Sessions.Add(session with { Hash = Identity.Hash(next), Expires = DateTimeOffset.UtcNow.AddMinutes(duration) });
                return true;
            });
            Identity.WriteCookie(http, config, next);
            return Results.NoContent();
        }).RequireRateLimiting("public");
        g.MapPost("/password/forgot", async (Forgot input, State store, IConfiguration config, PasswordMail mail) =>
        {
            if (!mail.Available) return Results.NoContent();
            var email = Rules.OriginalEmail(input.Email);
            var token = Identity.Token();
            var delivery = await store.Change<IdentityData, bool>(Module.Identity, Guid.Empty, data =>
            {
                var account = data.Accounts.Find(x => x.Email == email && x.Active);
                if (account == null) return false;
                var now = DateTimeOffset.UtcNow;
                data.PasswordResets.RemoveAll(x => x.Expires <= now);
                if (data.PasswordResets.Any(x => x.Account == account.Id && x.Expires > now.AddMinutes(28))) return false;
                data.PasswordResets.RemoveAll(x => x.Account == account.Id);
                data.PasswordResets.Add(new(account.Id, Identity.Hash(token), now.AddMinutes(30)));
                return true;
            });
            if (delivery) mail.Enqueue(email, new Uri(new Uri(config["CENTER_ORIGIN"] ?? "http://localhost:5173"), "/#reset/" + token).AbsoluteUri);
            return Results.NoContent();
        }).RequireRateLimiting("public");
        g.MapPost("/password/reset", async (Reset input, State store) =>
        {
            Rules.Require(input.Token.Length == 64, "رابط الاستعادة غير صالح أو منتهٍ.");
            await store.Change<IdentityData, bool>(Module.Identity, Guid.Empty, data =>
            {
                var request = data.PasswordResets.Find(x => x.Hash == Identity.Hash(input.Token) && x.Expires > DateTimeOffset.UtcNow);
                Rules.Require(request != null, "رابط الاستعادة غير صالح أو منتهٍ.");
                var account = Rules.Found(data.Accounts.Find(x => x.Id == request!.Account && x.Active));
                data.Accounts.Upsert(x => x.Id == account.Id, account with { Password = Identity.Password(input.Password), MustChangePassword = false, TemporaryUntil = null });
                Revoke(data, account.Id);
                return true;
            });
            return Results.NoContent();
        }).RequireRateLimiting("public");
    }
    public record Change(string CurrentPassword, string Password);
    public record Forgot(string Email);
    public record Reset(string Token, string Password);
}

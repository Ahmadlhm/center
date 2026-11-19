using System.Security.Claims;
using Center.Domain;
using Center.Infrastructure;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;

namespace Center.Features;

public sealed class GoogleSignIn(IConfiguration config, Uri origin)
{
    private const string Scheme = "center-google";
    private const string Callback = "/api/auth/google/callback";
    private readonly string? clientId = config["CENTER_GOOGLE_CLIENT_ID"]?.Trim();
    private readonly string? clientSecret = config["CENTER_GOOGLE_CLIENT_SECRET"]?.Trim();
    private readonly string? googleEmail = config["CENTER_GOOGLE_ADMIN_EMAIL"]?.Trim();
    private readonly string? platformEmail = (config["CENTER_GOOGLE_PLATFORM_EMAIL"]?.Trim() is { Length: > 0 } target
        ? target : config["CENTER_PLATFORM_EMAIL"]?.Trim());
    private readonly string? expectedSubject = config["CENTER_GOOGLE_ADMIN_SUBJECT"]?.Trim();

    public bool Enabled => (origin.Scheme == "https" || origin.IsLoopback) &&
        !string.IsNullOrWhiteSpace(clientId) && !string.IsNullOrWhiteSpace(clientSecret) &&
        !string.IsNullOrWhiteSpace(googleEmail) && !string.IsNullOrWhiteSpace(platformEmail);

    public bool IsTarget(Account account) => Enabled && account is { Platform: true, Active: true } &&
        string.Equals(account.Email, platformEmail, StringComparison.OrdinalIgnoreCase);

    public void Register(IServiceCollection services)
    {
        if (!Enabled) return;
        services.AddAuthentication()
            .AddCookie(Scheme + "-ticket")
            .AddOpenIdConnect(Scheme, options =>
            {
                options.Authority = "https://accounts.google.com";
                options.ClientId = clientId;
                options.ClientSecret = clientSecret;
                options.CallbackPath = Callback;
                options.SignInScheme = Scheme + "-ticket";
                options.ResponseType = OpenIdConnectResponseType.Code;
                options.ResponseMode = OpenIdConnectResponseMode.Query;
                options.UsePkce = true;
                options.MapInboundClaims = false;
                options.GetClaimsFromUserInfoEndpoint = false;
                options.BackchannelTimeout = TimeSpan.FromSeconds(15);
                options.RemoteAuthenticationTimeout = TimeSpan.FromMinutes(5);
                options.Scope.Clear();
                options.Scope.Add("openid");
                options.Scope.Add("email");
                options.CorrelationCookie.SameSite = SameSiteMode.Lax;
                options.NonceCookie.SameSite = SameSiteMode.Lax;
                options.TokenValidationParameters.ValidIssuers = ["https://accounts.google.com", "accounts.google.com"];
                options.TokenValidationParameters.ValidateIssuerSigningKey = true;
                options.Events.OnRedirectToIdentityProvider = context =>
                {
                    context.ProtocolMessage.RedirectUri = new Uri(origin, Callback).AbsoluteUri;
                    context.ProtocolMessage.Prompt = "select_account";
                    return Task.CompletedTask;
                };
                options.Events.OnRemoteFailure = context =>
                {
                    Return(context.HttpContext, false);
                    context.HandleResponse();
                    return Task.CompletedTask;
                };
                options.Events.OnTicketReceived = async context =>
                {
                    await Complete(context.HttpContext, context.Principal);
                    context.HandleResponse();
                };
            });
    }

    public static void Map(RouteGroupBuilder group) =>
        group.MapGet("/google/start", (HttpContext http, GoogleSignIn google) =>
        {
            Rules.Require(google.Enabled, "تسجيل الدخول عبر Google غير مفعّل.", 404);
            http.Response.Headers["Referrer-Policy"] = "no-referrer";
            return Results.Challenge(new AuthenticationProperties { RedirectUri = "/" }, [Scheme]);
        }).RequireRateLimiting("public");

    private async Task Complete(HttpContext http, ClaimsPrincipal? principal)
    {
        var email = principal?.FindFirstValue("email");
        var subject = principal?.FindFirstValue("sub");
        var hostedDomain = principal?.FindFirstValue("hd");
        var verified = bool.TryParse(principal?.FindFirstValue("email_verified"), out var confirmed) && confirmed;
        var pinned = !string.IsNullOrEmpty(expectedSubject);
        if (!verified || email is null || subject is not { Length: > 0 and <= 255 } ||
            !string.Equals(email, googleEmail, StringComparison.OrdinalIgnoreCase) ||
            (pinned ? subject != expectedSubject : !email.EndsWith("@gmail.com", StringComparison.OrdinalIgnoreCase) && string.IsNullOrWhiteSpace(hostedDomain)))
        {
            Return(http, false);
            return;
        }

        var store = http.RequestServices.GetRequiredService<State>();
        var token = Identity.Token();
        var current = Identity.Hash(Identity.SessionToken(http));
        var signedIn = await store.Change<IdentityData, bool>(Module.Identity, Guid.Empty, data =>
        {
            var account = data.Accounts.Find(IsTarget);
            if (account is null || (account.GoogleSubject is not null && account.GoogleSubject != subject) ||
                data.Accounts.Any(x => x.Id != account.Id && x.GoogleSubject == subject))
                return false;
            if (account.GoogleSubject is null)
            {
                data.Accounts.Upsert(x => x.Id == account.Id, account with
                {
                    GoogleSubject = subject,
                    TemporaryUntil = account.MustChangePassword ? DateTimeOffset.UtcNow : account.TemporaryUntil
                });
                data.Sessions.RemoveAll(x => x.Account == account.Id);
            }
            var now = DateTimeOffset.UtcNow;
            data.Sessions.RemoveAll(x => x.Hash == current || x.Expires <= now);
            data.Sessions.Add(new(Identity.Hash(token), account.Id, now.AddHours(12), Verified: true, Google: true));
            data.Audit.Log(new(account.Id, account.Name, true, Guid.Empty, [], []), "auth.google", account.Id);
            return true;
        });
        if (signedIn) Identity.WriteCookie(http, config, token);
        Return(http, signedIn);
    }

    private static void Return(HttpContext http, bool signedIn)
    {
        http.Response.Headers["Referrer-Policy"] = "no-referrer";
        http.Response.Redirect(signedIn ? "/" : "/#google-error");
    }
}

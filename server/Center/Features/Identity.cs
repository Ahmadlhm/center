using System.Security.Cryptography;
using System.Text;
using Center.Domain;
using Center.Infrastructure;
using Microsoft.AspNetCore.Identity;

namespace Center.Features;

public static class Identity
{
    public static readonly Guid DemoCenter = Guid.Parse("e751f402-dbd9-449f-9d01-40b525f06c29");
    public static readonly Guid DemoAdmin = Guid.Parse("a62ab256-e646-4458-b21e-14132a0492dd");
    public static readonly Guid DemoTeacher = Guid.Parse("79ba9bb4-6618-49b5-ae9e-bdc87e2eda0c");
    public static readonly Guid DemoSecondTeacher = Guid.Parse("d5ce01f6-87dd-4723-a634-81dd3a805a6d");
    private static readonly PasswordHasher<string> Hasher = new();
    public static string Token() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    public static string Password(string value)
    {
        Rules.Require(value.Length is >= 12 and <= 128, "استخدم كلمة مرور من ١٢ إلى ١٢٨ حرفًا.");
        return Hasher.HashPassword("", value);
    }
    public static async Task Initialize(State store, IConfiguration config)
    {
        if (!store.Local(Module.Identity)) return;
        var demo = config.GetValue<bool>("CENTER_DEMO");
        var email = config["CENTER_PLATFORM_EMAIL"];
        var password = config["CENTER_PLATFORM_PASSWORD"];
        await store.Change<IdentityData, bool>(Module.Identity, Guid.Empty, data =>
        {
            if (!data.Accounts.Any(x => x.Platform))
            {
                if (demo) data.Accounts.Add(new(Guid.NewGuid(), "إدارة المنصة", "platform@demo.local", Password("Demo-Platform-2026!"), true));
                else if (!string.IsNullOrWhiteSpace(email) && !string.IsNullOrEmpty(password))
                    data.Accounts.Add(new(Guid.NewGuid(), "إدارة المنصة", Rules.OriginalEmail(email), Password(password), true));
            }
            if (demo && !data.Centers.Any(x => x.Id == DemoCenter))
            {
                data.Centers.Add(new(DemoCenter, "مركز نداء الخير القرآني", "Asia/Amman"));
                data.Accounts.Add(new(DemoAdmin, "أحمد الخطيب", "admin@demo.local", Password("Demo-Admin-2026!")));
                data.Accounts.Add(new(DemoTeacher, "محمد العلي", "teacher@demo.local", Password("Demo-Teacher-2026!")));
                data.Accounts.Add(new(DemoSecondTeacher, "عمر الحسن", "omar@demo.local", Password("Demo-Omar-2026!")));
                data.Memberships.Add(new(DemoAdmin, DemoCenter, ["admin"], []));
                data.Memberships.Add(new(DemoTeacher, DemoCenter, ["teacher"], []));
                data.Memberships.Add(new(DemoSecondTeacher, DemoCenter, ["teacher"], []));
            }
            return true;
        });
    }
    public static string SessionToken(HttpContext context) => context.Request.Cookies["center_session"] ?? "";
    public static async Task<(Account Account, IdentityData Data)> Current(State store, HttpContext context)
    {
        return await Current(store, SessionToken(context));
    }
    private static async Task<(Account Account, IdentityData Data)> Current(State store, string token)
    {
        Rules.Require(token.Length == 64, "سجّل الدخول أولًا.", 401);
        var data = await store.Read<IdentityData>(Module.Identity, Guid.Empty);
        var session = data.Sessions.Find(x => x.Hash == Hash(token) && x.Expires > DateTimeOffset.UtcNow);
        var account = session is null ? null : data.Accounts.Find(x => x.Id == session.Account && x.Active);
        Rules.Require(account is not null, "انتهت الجلسة. سجّل الدخول من جديد.", 401);
        return (account!, data);
    }
    public static async Task<(Actor Actor, CenterInfo Center)> Context(State store, HttpContext context, Guid center)
    {
        var request = new Lookup(center, SessionToken(context));
        var result = store.Local(Module.Identity) ? await Resolve(store, request) :
            await store.Send<CenterAccess>(Module.Identity, "/internal/access", request);
        return (result.Actor, result.Center);
    }
    private static async Task<CenterAccess> Resolve(State store, Lookup input)
    {
        var (account, data) = await Current(store, input.Token);
        var membership = data.Memberships.Find(x => x.Account == account.Id && x.Center == input.Center && x.Active);
        var info = data.Centers.Find(x => x.Id == input.Center && x.Active);
        Rules.Require(membership is not null && info is not null, "ليس لديك صلاحية في هذا المركز.", 403);
        RequireStepUp(store, account, data, input.Token);
        return new(new(account.Id, account.Name, account.Platform, input.Center, membership!.Roles, membership.Units), info!);
    }
    public static bool RequiresMfa(State store, Account account, IdentityData data) =>
        store.RequireMfa && (account.Platform || data.Memberships.Any(x => x.Account == account.Id && x.Active && x.Roles.Contains("admin")
            && data.Centers.Any(c => c.Id == x.Center && c.Active)));
    public static bool IsVerified(IdentityData data, string token) =>
        data.Sessions.Any(x => x.Hash == Hash(token) && x.Expires > DateTimeOffset.UtcNow && x.Verified);
    private static void RequireStepUp(State store, Account account, IdentityData data, string token) =>
        Rules.Require(!RequiresMfa(store, account, data) || IsVerified(data, token), "أكمل التحقق بمفتاح المرور.", 403);
    public record Lookup(Guid Center, string Token);
    public record CenterAccess(Actor Actor, CenterInfo Center);
    public static async Task<Actor> PlatformActor(State store, HttpContext context)
    {
        var (account, data) = await Current(store, context);
        RequireStepUp(store, account, data, SessionToken(context));
        Rules.Require(account.Platform, "هذه العملية متاحة لإدارة المنصة.", 403);
        return new(account.Id, account.Name, true, Guid.Empty, [], []);
    }
    public static async Task<CenterInfo[]> ActiveCenters(State store) =>
        (await store.Read<IdentityData>(Module.Identity, Guid.Empty)).Centers.Where(c => c.Active).ToArray();
    public static void Map(WebApplication app)
    {
        app.MapPost("/internal/active-centers", (State store) => ActiveCenters(store));
        app.MapPost("/internal/access", (Lookup input, State store) => Resolve(store, input));
        app.MapPost("/internal/staff", (StaffLookup input, State store) => Staff(store, input.Center));
        var g = app.MapGroup("/api/auth");
        g.MapGet("/info", (IConfiguration config) => new { demo = config.GetValue<bool>("CENTER_DEMO") });
        g.MapPost("/login", async (Login input, HttpContext context, State store, IConfiguration config) =>
        {
            var email = Rules.OriginalEmail(input.Email);
            var token = Token();
            await store.Change<IdentityData, bool>(Module.Identity, Guid.Empty, data =>
            {
                var a = data.Accounts.Find(x => x.Active && x.Email == email);
                Rules.Require(a != null && input.Password.Length <= 128 && Hasher.VerifyHashedPassword("", a.Password, input.Password) != PasswordVerificationResult.Failed,
                    "البريد أو كلمة المرور غير صحيحة.", 401);
                data.Sessions.RemoveAll(x => x.Expires <= DateTimeOffset.UtcNow);
                data.Sessions.Add(new(Hash(token), a!.Id, DateTimeOffset.UtcNow.AddHours(12)));
                return true;
            });
            context.Response.Cookies.Append("center_session", token, new CookieOptions
            {
                HttpOnly = true, Secure = !config.GetValue<bool>("CENTER_ALLOW_HTTP"), SameSite = SameSiteMode.Strict, Path = "/", MaxAge = TimeSpan.FromHours(12)
            });
            return Results.Ok(new { ok = true });
        }).RequireRateLimiting("public");
        g.MapGet("/me", async (HttpContext context, State store) =>
        {
            var (account, data) = await Current(store, context);
            return new
            {
                account.Id, account.Name, account.Email, account.Platform,
                requiresMfa = RequiresMfa(store, account, data) && !IsVerified(data, SessionToken(context)),
                hasPasskey = data.Credentials.Any(x => x.Account == account.Id),
                centers = from m in data.Memberships
                          join c in data.Centers on m.Center equals c.Id
                          where m.Account == account.Id && m.Active && c.Active
                          select new { c.Id, c.Name, c.TimeZone, c.Logo, m.Roles, m.Units }
            };
        });
        g.MapPost("/logout", async (HttpContext context, State store) =>
        {
            var hash = Hash(SessionToken(context));
            await store.Change<IdentityData, bool>(Module.Identity, Guid.Empty, data => data.Sessions.RemoveAll(x => x.Hash == hash) > 0);
            context.Response.Cookies.Delete("center_session");
            return Results.Ok(new { ok = true });
        });
        g.MapPost("/requests", async (Apply input, State store) =>
        {
            var name = Rules.Required(input.Name);
            var contact = Rules.Required(input.Contact);
            var email = Rules.OriginalEmail(input.Email);
            return await store.Change<IdentityData, Request>(Module.Identity, Guid.Empty, data =>
            {
                var existing = data.Requests.Find(x => x.Email == email && x.Name == name && x.State == "pending");
                if (existing != null) return existing;
                var record = new Request(Guid.NewGuid(), name, contact, email, "pending", DateTimeOffset.UtcNow);
                data.Requests.Add(record);
                return record;
            });
        }).RequireRateLimiting("public");
        g.MapGet("/requests", async (HttpContext context, State store) =>
        {
            await PlatformActor(store, context);
            var data = await store.Read<IdentityData>(Module.Identity, Guid.Empty);
            return new { requests = data.Requests.OrderByDescending(x => x.Created), centers = data.Centers };
        });
        g.MapPost("/requests/{id:guid}/decision", async (Guid id, Decision input, HttpContext context, State store) =>
        {
            var actor = await PlatformActor(store, context);
            return await store.Change<IdentityData, object>(Module.Identity, Guid.Empty, data =>
            {
                var request = Rules.Found(data.Requests.Find(x => x.Id == id));
                if (request.State != "pending") return new { request };
                var reason = input.Approve ? null : Rules.Required(input.Reason, 500);
                var center = input.Approve ? new CenterInfo(Guid.NewGuid(), request.Name, "Asia/Amman") : null;
                var token = center is null ? null : AddInvite(data, request.Contact, request.Email, center.Id, ["admin"], []);
                if (center is not null) data.Centers.Add(center);
                request = request with { State = input.Approve ? "approved" : "rejected", Center = center?.Id, Reason = reason };
                data.Requests.Upsert(x => x.Id == id, request);
                data.Audit.Log(actor, "request." + request.State, id, reason);
                return new { request, token };
            });
        });
        g.MapPut("/centers/{center:guid}/active", async (Guid center, Active input, HttpContext context, State store) =>
        {
            var actor = await PlatformActor(store, context);
            return await store.Change<IdentityData, CenterInfo>(Module.Identity, Guid.Empty, data =>
            {
                var result = Rules.Found(data.Centers.Find(x => x.Id == center)) with { Active = input.Value };
                data.Centers.Upsert(x => x.Id == center, result);
                data.Audit.Log(actor, "center.active", center, input.Value.ToString());
                return result;
            });
        });
        g.MapPost("/activate", async (Activation input, State store) =>
        {
            Rules.Require(input.Token.Length == 64, "رابط التفعيل غير صالح.");
            return await store.Change<IdentityData, object>(Module.Identity, Guid.Empty, data =>
            {
                var invite = Rules.Found(data.Invites.Find(x => x.Hash == Hash(input.Token) && x.Expires > DateTimeOffset.UtcNow));
                Rules.Require(data.Centers.Any(x => x.Id == invite.Center && x.Active), "هذا المركز غير مفعّل.", 403);
                var account = data.Accounts.Find(x => x.Email == invite.Email);
                if (account is null)
                {
                    account = new(Guid.NewGuid(), invite.Name, invite.Email, Password(input.Password));
                    data.Accounts.Add(account);
                }
                else
                {
                    Rules.Require(Hasher.VerifyHashedPassword("", account.Password, input.Password) != PasswordVerificationResult.Failed,
                        "أدخل كلمة مرور حسابك الحالي.", 401);
                }
                data.Memberships.Upsert(x => x.Account == account.Id && x.Center == invite.Center,
                    new(account.Id, invite.Center, invite.Roles, invite.Units));
                data.Invites.Remove(invite);
                return new { email = account.Email };
            });
        }).RequireRateLimiting("public");

        var c = app.MapGroup("/api/centers/{center:guid}/identity");
        c.MapGet("/staff", async (Guid center, State store, HttpContext context) =>
        {
            await Context(store, context, center);
            return await Staff(store, center);
        });
        c.MapPost("/staff/invite", async (Guid center, StaffInvite input, State store, HttpContext context) =>
        {
            var (actor, _) = await Context(store, context, center);
            actor.Admin();
            ValidateRoles(input.Roles);
            var people = await store.Read<PeopleData>(Module.People, center);
            Rules.Require(input.Units.All(id => people.Units.Any(u => u.Id == id && u.Active)), "اختر وحدات المركز الصحيحة.");
            return await store.Change<IdentityData, object>(Module.Identity, Guid.Empty, data =>
            {
                var email = Rules.OriginalEmail(input.Email);
                Rules.Require(!data.Memberships.Any(m => m.Center == center && m.Active && data.Accounts.Any(a => a.Id == m.Account && a.Email == email)), "الموظف مسجّل في المركز.");
                var token = AddInvite(data, Rules.Required(input.Name), email, center, input.Roles, input.Units);
                data.Audit.Log(actor, "staff.invite", center);
                return new { token };
            });
        });
        c.MapPut("/staff/{id:guid}", async (Guid center, Guid id, StaffEdit input, State store, HttpContext context) =>
        {
            var (actor, _) = await Context(store, context, center);
            actor.Admin();
            ValidateRoles(input.Roles);
            Rules.Require(id != actor.Id, "يتولى مدير آخر تعديل عضويتك.");
            var people = await store.Read<PeopleData>(Module.People, center);
            Rules.Require(input.Units.All(id => people.Units.Any(u => u.Id == id && u.Active)), "اختر وحدات المركز الصحيحة.");
            return await store.Change<IdentityData, Membership>(Module.Identity, Guid.Empty, data =>
            {
                var entry = Rules.Found(data.Memberships.Find(x => x.Account == id && x.Center == center));
                var updated = entry with { Roles = input.Roles, Units = input.Units, Active = input.Active };
                data.Memberships.Upsert(x => x == entry, updated);
                data.Audit.Log(actor, "staff.update", id);
                return updated;
            });
        });
        c.MapPut("/profile", async (Guid center, CenterEdit input, State store, HttpContext context) =>
        {
            var (actor, info) = await Context(store, context, center);
            actor.Admin();
            var zone = Rules.Required(input.TimeZone);
            TimeZoneInfo.FindSystemTimeZoneById(zone);
            return await store.Change<IdentityData, CenterInfo>(Module.Identity, Guid.Empty, data =>
            {
                var updated = info with { Name = Rules.Required(input.Name), TimeZone = zone, Logo = input.Logo is null ? info.Logo : ValidateLogo(input.Logo) };
                data.Centers.Upsert(x => x.Id == center, updated);
                data.Audit.Log(actor, "center.profile", center);
                return updated;
            });
        });
    }
    private static string? ValidateLogo(string value)
    {
        if (value.Length == 0) return null;
        var parts = value.Split(',', 2);
        Rules.Require(parts.Length == 2 && parts[0] is "data:image/png;base64" or "data:image/jpeg;base64" && parts[1].Length <= 400_000,
            "ارفع شعار PNG أو JPEG بحجم لا يتجاوز ٣٠٠ كيلوبايت.");
        var bytes = Convert.FromBase64String(parts[1]);
        Rules.Require(parts[0] == "data:image/png;base64"
            ? bytes.AsSpan().StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 })
            : bytes.AsSpan().StartsWith(new byte[] { 255, 216, 255 }), "ملف الشعار غير صالح.");
        return value;
    }
    private static string AddInvite(IdentityData data, string name, string email, Guid center, string[] roles, Guid[] units)
    {
        var token = Token();
        data.Invites.RemoveAll(x => x.Center == center && x.Email == email);
        data.Invites.Add(new(Hash(token), name, email, center, roles, units, DateTimeOffset.UtcNow.AddDays(3)));
        return token;
    }
    private static void ValidateRoles(string[] roles) => Rules.Require(roles.Length > 0 && roles.All(x => x is "teacher" or "manager" or "admin"), "اختر صلاحية صحيحة.");
    public static async Task<StaffView[]> Staff(State store, Guid center)
    {
        if (!store.Local(Module.Identity)) return await store.Send<StaffView[]>(Module.Identity, "/internal/staff", new StaffLookup(center));
        var data = await store.Read<IdentityData>(Module.Identity, Guid.Empty);
        return (from m in data.Memberships
                join a in data.Accounts on m.Account equals a.Id
                where m.Center == center
                select new StaffView(a.Id, a.Name, m.Roles, m.Units, a.Active && m.Active)).ToArray();
    }
    public record StaffLookup(Guid Center);
    public record StaffView(Guid Id, string Name, string[] Roles, Guid[] Units, bool Active);
    public record Login(string Email, string Password);
    public record Apply(string Name, string Contact, string Email);
    public record Decision(bool Approve, string? Reason);
    public record Active(bool Value);
    public record Activation(string Token, string Password);
    public record StaffInvite(string Name, string Email, string[] Roles, Guid[] Units);
    public record StaffEdit(string[] Roles, Guid[] Units, bool Active);
    public record CenterEdit(string Name, string TimeZone, string? Logo);
}

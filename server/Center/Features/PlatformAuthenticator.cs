using System.Security.Cryptography;
using Center.Domain;
using Center.Infrastructure;
using Microsoft.AspNetCore.DataProtection;
using OtpNet;
using QRCoder;

namespace Center.Features;

public static class PlatformAuthenticator
{
    public const string Pending = "pending";
    public const string Verified = "verified";
    private const string Issuer = "Quran Centers";
    private const string Purpose = "quran-center.platform-authenticator.v1";
    private const int MaxAttempts = 5;

    public static void Map(RouteGroupBuilder group)
    {
        var routes = group.MapGroup("/mfa/totp").RequireRateLimiting("public");
        routes.MapPost("/setup", async (HttpContext http, State store, IDataProtectionProvider protection) =>
        {
            var (account, _) = await Identity.Current(store, http);
            var hash = Identity.Hash(Identity.SessionToken(http));
            var protector = protection.CreateProtector(Purpose, account.Id.ToString("N"));
            var key = await store.Change<IdentityData, string>(Module.Identity, Guid.Empty, data =>
            {
                var (current, session) = PendingSession(data, account.Id, hash, store);
                Rules.Require(current.Authenticator is null, "سبق إعداد تطبيق التحقق لهذا الحساب.", 409);
                if (session.PendingAuthenticatorKey is { } pending) return protector.Unprotect(pending);
                var seed = Base32Encoding.ToString(RandomNumberGenerator.GetBytes(20));
                data.Sessions.Upsert(x => x.Hash == hash, session with { PendingAuthenticatorKey = protector.Protect(seed) });
                return seed;
            });
            var uri = $"otpauth://totp/{Uri.EscapeDataString(Issuer)}:{Uri.EscapeDataString(account.Email)}?secret={key}&issuer={Uri.EscapeDataString(Issuer)}";
            using var qr = QRCodeGenerator.GenerateQrCode(uri, QRCodeGenerator.ECCLevel.M);
            using var image = new PngByteQRCode(qr);
            return new { key, qr = "data:image/png;base64," + Convert.ToBase64String(image.GetGraphic(5)) };
        });

        routes.MapPost("/verify", async (CodeInput input, HttpContext http, State store, IConfiguration config, IDataProtectionProvider protection) =>
        {
            var (account, _) = await Identity.Current(store, http);
            var hash = Identity.Hash(Identity.SessionToken(http));
            var next = Identity.Token();
            var protector = protection.CreateProtector(Purpose, account.Id.ToString("N"));
            var code = (input.Code ?? "").Trim().Replace("-", "").ToUpperInvariant();
            Rules.Require((code.Length == 6 && code.All(char.IsAsciiDigit)) || (code.Length == 20 && code.All(char.IsAsciiHexDigit)),
                "أدخل رمز التطبيق من ستة أرقام أو أحد رموز الاسترداد.");
            var result = await store.Change<IdentityData, Verification>(Module.Identity, Guid.Empty, data =>
            {
                var (current, session) = PendingSession(data, account.Id, hash, store);
                var now = DateTimeOffset.UtcNow;
                var failures = current.AuthenticatorFailures is { } previous && previous.Until > now
                    ? previous : new AuthenticatorAttempts(now.AddMinutes(5), 0);
                if (failures.Count >= MaxAttempts) return new(429, []);

                var device = current.Authenticator;
                var protectedKey = device?.ProtectedKey ?? session.PendingAuthenticatorKey;
                Rules.Require(protectedKey is not null, "ابدأ إعداد تطبيق التحقق أولًا.", 409);

                var recovery = Array.Empty<string>();
                var recoveryHash = code.Length == 20 ? RecoveryHash(code) : null;
                if (device is not null && recoveryHash is not null && device.RecoveryHashes.Contains(recoveryHash))
                {
                    device = device with { RecoveryHashes = device.RecoveryHashes.Where(x => x != recoveryHash).ToArray() };
                }
                else if (code.Length == 6 &&
                    new Totp(Base32Encoding.ToBytes(protector.Unprotect(protectedKey!)))
                        .VerifyTotp(now.UtcDateTime, code, out var step, new VerificationWindow(previous: 1, future: 1)) &&
                    (device is null || step > device.LastStep))
                {
                    if (device is null)
                    {
                        recovery = Enumerable.Range(0, 8).Select(_ => Convert.ToHexString(RandomNumberGenerator.GetBytes(10))).ToArray();
                        device = new(protectedKey!, step, recovery.Select(RecoveryHash).ToArray());
                    }
                    else device = device with { LastStep = step };
                }
                else
                {
                    data.Accounts.Upsert(x => x.Id == current.Id, current with { AuthenticatorFailures = failures with { Count = failures.Count + 1 } });
                    return new(400, []);
                }

                data.Accounts.Upsert(x => x.Id == current.Id, current with { Authenticator = device, AuthenticatorFailures = null });
                data.Sessions.RemoveAll(x => x.Hash == hash);
                data.Sessions.Add(new(Identity.Hash(next), current.Id, now.AddHours(12), Authenticator: Verified));
                data.Audit.Log(new Actor(current.Id, current.Name, true, Guid.Empty, [], []),
                    recovery.Length > 0 ? "auth.totp.setup" : recoveryHash is not null ? "auth.totp.recovery" : "auth.totp", current.Id);
                return new(200, recovery);
            });
            Rules.Require(result.Status != 429, "محاولات كثيرة. انتظر خمس دقائق ثم حاول مجددًا.", 429);
            Rules.Require(result.Status == 200, "الرمز غير صالح أو سبق استخدامه.");
            Identity.WriteCookie(http, config, next);
            return new { result.RecoveryCodes };
        });
    }

    private static (Account Account, Session Session) PendingSession(IdentityData data, Guid id, string hash, State store)
    {
        var account = data.Accounts.Find(x => x.Id == id && x.Active);
        Rules.Require(account is { Platform: true } && store.RequireMfa, "التحقق عبر التطبيق متاح لحساب مدير المنصة.", 403);
        Rules.Require(!account!.MustChangePassword, "غيّر كلمة المرور المؤقتة أولًا.", 403);
        var session = data.Sessions.Find(x => x.Hash == hash && x.Account == id && x.Authenticator == Pending && x.Expires > DateTimeOffset.UtcNow);
        Rules.Require(session is not null, "سجّل الدخول من جديد لتبدأ التحقق.", 403);
        return (account, session!);
    }

    private static string RecoveryHash(string code) => Identity.Hash("platform-authenticator-recovery:" + code);
    public record CodeInput(string? Code);
    private record Verification(int Status, string[] RecoveryCodes);
}

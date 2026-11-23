using Microsoft.AspNetCore.WebUtilities;

namespace Center.Features;

public sealed class MobileLinks
{
    internal const string AppId = "org.qurancenters.staff";
    private readonly byte[]? androidCertificate;
    private readonly string? appleTeamId;

    internal ReadOnlySpan<byte> AndroidCertificate => androidCertificate;

    public MobileLinks(IConfiguration config)
    {
        var fingerprint = config["CENTER_ANDROID_CERT_SHA256"]?.Trim();
        if (!string.IsNullOrEmpty(fingerprint))
        {
            var hex = fingerprint.Replace(":", "");
            if (hex.Length != 64 || !hex.All(Uri.IsHexDigit))
                throw new InvalidOperationException("CENTER_ANDROID_CERT_SHA256 must be a SHA-256 certificate fingerprint.");
            androidCertificate = Convert.FromHexString(hex);
        }

        appleTeamId = config["CENTER_IOS_TEAM_ID"]?.Trim();
        if (!string.IsNullOrEmpty(appleTeamId) &&
            (appleTeamId.Length != 10 || !appleTeamId.All(c => c is >= 'A' and <= 'Z' or >= '0' and <= '9')))
            throw new InvalidOperationException("CENTER_IOS_TEAM_ID must be a 10-character Apple Team ID.");
    }

    public HashSet<string> PasskeyOrigins(string webOrigin)
    {
        var origins = new HashSet<string>(StringComparer.Ordinal) { webOrigin };
        if (androidCertificate is not null)
            origins.Add("android:apk-key-hash:" + WebEncoders.Base64UrlEncode(androidCertificate));
        return origins;
    }

    public void Map(WebApplication app)
    {
        app.MapGet("/.well-known/assetlinks.json", () =>
            androidCertificate is null ? Results.NotFound() : Results.Json(new[]
            {
                new
                {
                    relation = new[] { "delegate_permission/common.get_login_creds" },
                    target = new
                    {
                        @namespace = "android_app",
                        package_name = AppId,
                        sha256_cert_fingerprints = new[] { BitConverter.ToString(androidCertificate).Replace('-', ':') }
                    }
                }
            }));
        app.MapGet("/.well-known/apple-app-site-association", () =>
            string.IsNullOrEmpty(appleTeamId) ? Results.NotFound() : Results.Json(new
            {
                webcredentials = new { apps = new[] { appleTeamId + "." + AppId } }
            }));
    }
}

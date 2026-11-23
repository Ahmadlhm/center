using System.Formats.Asn1;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using Center.Domain;
using Microsoft.Extensions.Caching.Memory;

namespace Center.Features;

// Android Key Attestation schema: https://source.android.com/docs/security/features/keystore/attestation
internal sealed class AndroidKeyAttestation(IHttpClientFactory clients, IMemoryCache cache, MobileLinks mobileLinks)
{
    private const string AttestationOid = "1.3.6.1.4.1.11129.2.1.17";
    private const string Rejected = "تعذّر اعتماد مفتاح البصمة من هذا الجهاز.";
    private readonly X509Certificate2Collection roots = LoadRoots();

    internal bool Enabled => !mobileLinks.AndroidCertificate.IsEmpty;

    internal (string PublicKey, string[] Serials) Validate(string[] certificates, byte[] challenge, string signature)
    {
        Rules.Require(Enabled, "إثبات الحضور بالبصمة غير مفعّل على الخادم.", 503);
        Rules.Require(certificates is { Length: >= 2 and <= 8 }, Rejected);
        var supplied = new X509Certificate2Collection();
        try
        {
            foreach (var certificate in certificates)
            {
                Rules.Require(certificate is { Length: > 0 and <= 8192 }, Rejected);
                supplied.Add(X509CertificateLoader.LoadCertificate(Convert.FromBase64String(certificate)));
            }

            using var chain = new X509Chain();
            chain.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
            chain.ChainPolicy.CustomTrustStore.AddRange(roots);
            chain.ChainPolicy.DisableCertificateDownloads = true;
            // Google publishes attestation revocations as a JSON status list.
            chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
            for (var i = 1; i < supplied.Count; i++) chain.ChainPolicy.ExtraStore.Add(supplied[i]);
            var leaf = supplied[0];
            Rules.Require(chain.Build(leaf) && chain.ChainElements.Count >= 2, Rejected);
            var verifiedPath = chain.ChainElements.Cast<X509ChainElement>().Select(x => x.Certificate).ToArray();
            // The first attestation extension from the trusted root must describe this key.
            Rules.Require(verifiedPath.Skip(1).All(x => x.Extensions[AttestationOid] is null), Rejected);
            var extension = leaf.Extensions[AttestationOid];
            Rules.Require(extension is not null, Rejected);
            ValidateDescription(extension!.RawData, challenge, mobileLinks.AndroidCertificate);

            using var key = leaf.GetECDsaPublicKey();
            Rules.Require(key is not null && key.ExportParameters(false).Curve.Oid.Value == "1.2.840.10045.3.1.7", Rejected);
            Rules.Require(VerifySignature(key!, challenge, signature), Rejected);
            var serials = verifiedPath.Select(x => x.SerialNumber.TrimStart('0').ToLowerInvariant()).ToArray();
            return (Convert.ToBase64String(key!.ExportSubjectPublicKeyInfo()), serials);
        }
        catch (Exception error) when (error is CryptographicException or AsnContentException or FormatException)
        {
            throw new DomainException(Rejected);
        }
        finally
        {
            foreach (var certificate in supplied) certificate.Dispose();
        }
    }

    internal async Task<bool> IsCurrent(string[] serials, CancellationToken cancellation)
    {
        const string StatusUrl = "https://android.googleapis.com/attestation/status";
        if (!cache.TryGetValue<HashSet<string>>(StatusUrl, out var blocked))
        {
            using var client = clients.CreateClient("android-attestation");
            try
            {
                using var response = await client.GetAsync(StatusUrl, cancellation);
                response.EnsureSuccessStatusCode();
                var status = await response.Content.ReadFromJsonAsync<JsonElement>(cancellation);
                blocked = status.GetProperty("entries").EnumerateObject()
                    .Select(x => x.Name).ToHashSet(StringComparer.Ordinal);
                var maxAge = response.Headers.CacheControl?.MaxAge ?? TimeSpan.FromMinutes(5);
                if (maxAge > TimeSpan.Zero)
                    cache.Set(StatusUrl, blocked, maxAge < TimeSpan.FromHours(1) ? maxAge : TimeSpan.FromHours(1));
            }
            catch (Exception error) when (error is HttpRequestException or JsonException or InvalidOperationException or
                KeyNotFoundException || error is OperationCanceledException && !cancellation.IsCancellationRequested)
            {
                throw new DomainException("تعذّر فحص حالة اعتماد جهاز Android. أعد المحاولة.", 503);
            }
        }
        return serials.Length > 0 && !serials.Any(blocked!.Contains);
    }

    internal static bool VerifySignature(ECDsa key, byte[] challenge, string? signature)
    {
        if (signature is not { Length: > 0 and <= 96 }) return false;
        Span<byte> bytes = stackalloc byte[72];
        return Convert.TryFromBase64String(signature, bytes, out var written) &&
            key.VerifyData(challenge, bytes[..written], HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence);
    }

    private enum SecurityLevel { Software, TrustedEnvironment, StrongBox }
    private enum BootState { Verified, SelfSigned, Unverified, Failed }

    internal static void ValidateDescription(byte[] extension, byte[] challenge, ReadOnlySpan<byte> signingCertificate)
    {
        var reader = new AsnReader(extension, AsnEncodingRules.DER);
        var description = reader.ReadSequence();
        description.ReadInteger(); // Attestation version
        var attestationLevel = description.ReadEnumeratedValue<SecurityLevel>();
        description.ReadInteger(); // Keymaster or KeyMint version
        var keyLevel = description.ReadEnumeratedValue<SecurityLevel>();
        Rules.Require(attestationLevel is SecurityLevel.TrustedEnvironment or SecurityLevel.StrongBox &&
            keyLevel is SecurityLevel.TrustedEnvironment or SecurityLevel.StrongBox, Rejected);
        Rules.Require(CryptographicOperations.FixedTimeEquals(description.ReadOctetString(), challenge), Rejected);
        description.ReadOctetString(); // Unique ID is never used.
        var software = ReadAuthorizations(description.ReadSequence());
        var hardware = ReadAuthorizations(description.ReadSequence());
        description.ThrowIfNotEmpty();
        reader.ThrowIfNotEmpty();

        // KeyMint's biometric-only userAuthType is 2; PIN/device credentials are a different bit.
        Rules.Require(ReadInteger(hardware, 504) == 2 && ReadInteger(hardware, 702) == 0 &&
            ReadInteger(hardware, 505) is null or 0 &&
            !software.ContainsKey(505) && !software.ContainsKey(503) && !hardware.ContainsKey(503),
            Rejected);
        var trust = RequiredTag(hardware, 704).ReadSequence();
        trust.ReadOctetString(); // Verified boot key hash
        Rules.Require(trust.ReadBoolean() && trust.ReadEnumeratedValue<BootState>() == BootState.Verified, Rejected);

        var application = new AsnReader(RequiredTag(software, 709).ReadOctetString(), AsnEncodingRules.DER);
        var id = application.ReadSequence();
        var packages = id.ReadSetOf(skipSortOrderValidation: true);
        var package = packages.ReadSequence();
        Rules.Require(Encoding.UTF8.GetString(package.ReadOctetString()) == MobileLinks.AppId && !packages.HasData, Rejected);
        package.ReadInteger();
        package.ThrowIfNotEmpty();
        var signers = id.ReadSetOf(skipSortOrderValidation: true);
        Rules.Require(!signingCertificate.IsEmpty &&
            CryptographicOperations.FixedTimeEquals(signers.ReadOctetString(), signingCertificate) && !signers.HasData, Rejected);
        id.ThrowIfNotEmpty();
        application.ThrowIfNotEmpty();
    }

    private static Dictionary<int, AsnReader> ReadAuthorizations(AsnReader list)
    {
        var tags = new Dictionary<int, AsnReader>();
        while (list.HasData)
        {
            var tag = list.PeekTag();
            Rules.Require(tag.TagClass == TagClass.ContextSpecific && tag.IsConstructed, Rejected);
            Rules.Require(tags.TryAdd(tag.TagValue, list.ReadSequence(tag)), Rejected);
        }
        return tags;
    }

    private static AsnReader RequiredTag(Dictionary<int, AsnReader> tags, int number) =>
        tags.TryGetValue(number, out var tag) ? tag : throw new DomainException(Rejected);

    private static int? ReadInteger(Dictionary<int, AsnReader> tags, int number)
    {
        if (!tags.TryGetValue(number, out var tag)) return null;
        Rules.Require(tag.TryReadInt32(out var value), Rejected);
        tag.ThrowIfNotEmpty();
        return value;
    }

    private static X509Certificate2Collection LoadRoots()
    {
        // Downloaded from https://android.googleapis.com/attestation/root.
        using var stream = typeof(AndroidKeyAttestation).Assembly.GetManifestResourceStream("Center.Data.android-attestation-roots.pem")!;
        using var file = new StreamReader(stream);
        var trust = new X509Certificate2Collection();
        trust.ImportFromPem(file.ReadToEnd());
        return trust;
    }
}

using System.Security.Cryptography;
using Center.Domain;
using Center.Infrastructure;

namespace Center.Features;

internal static class AndroidAttendance
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/centers/{center:guid}/identity/android-attendance");
        g.MapGet("", async (Guid center, State store, HttpContext http) =>
        {
            var (actor, _) = await Identity.Context(store, http, center);
            var data = await store.Read<IdentityData>(Module.Identity, Guid.Empty);
            return data.AndroidAttendanceKeys.Where(x => x.Account == actor.Id).Select(x => new { x.Id });
        });
        g.MapPost("/register/options", async (Guid center, State store, HttpContext http, AndroidKeyAttestation attestation) =>
        {
            var (actor, _) = await Identity.Context(store, http, center);
            Rules.Require(attestation.Enabled, "إثبات الحضور بالبصمة غير مفعّل على الخادم.", 503);
            return await store.Change<IdentityData, EnrollmentOptions>(Module.Identity, Guid.Empty, data =>
            {
                CheckEnrollmentLimit(data, actor);
                var challenge = Save(data, actor, null);
                return new(challenge.Id, challenge.Value);
            });
        });
        g.MapPost("/register/complete", async (Guid center, Enrollment input, State store, HttpContext http, AndroidKeyAttestation attestation) =>
        {
            var (actor, _) = await Identity.Context(store, http, center);
            var current = await store.Read<IdentityData>(Module.Identity, Guid.Empty);
            var challenge = Find(current, actor, null, input.Id);
            var key = attestation.Validate(input.Chain, challenge.Value, input.Signature);
            Rules.Require(await attestation.IsCurrent(key.Serials, http.RequestAborted), "اعتماد جهاز Android ملغى.");
            await store.Change<IdentityData, bool>(Module.Identity, Guid.Empty, data =>
            {
                var pending = Find(data, actor, null, input.Id);
                CheckEnrollmentLimit(data, actor);
                data.AndroidAttendanceKeys.Add(new(pending.Id, actor.Id, key.PublicKey, key.Serials));
                data.AndroidAttendanceChallenges.Remove(pending);
                data.Audit.Log(actor, "android-attendance.register", pending.Id);
                return true;
            });
            return Results.NoContent();
        });
        g.MapDelete("", async (Guid center, Guid id, State store, HttpContext http) =>
        {
            var (actor, _) = await Identity.Context(store, http, center);
            await store.Change<IdentityData, bool>(Module.Identity, Guid.Empty, data =>
            {
                data.AndroidAttendanceKeys.RemoveAll(x => x.Id == id && x.Account == actor.Id);
                data.AndroidAttendanceChallenges.RemoveAll(x => x.Account == actor.Id);
                data.Audit.Log(actor, "android-attendance.revoke", id);
                return true;
            });
            return Results.NoContent();
        });
        app.MapPost("/internal/android-attendance/options",
            (Passkeys.ProofContext input, State store) => Options(store, input));
        app.MapPost("/internal/android-attendance/verify",
            (Proof input, State store, AndroidKeyAttestation attestation, CancellationToken cancellation) =>
                Verify(store, attestation, input, cancellation));
    }

    internal static Task<AttendanceOptions> Options(State store, Passkeys.ProofContext input) =>
        store.Change<IdentityData, AttendanceOptions>(Module.Identity, Guid.Empty, data =>
        {
            var keys = data.AndroidAttendanceKeys.Where(x => x.Account == input.Actor.Id).Select(x => x.Id).ToArray();
            Rules.Require(keys.Length > 0, "فعّل بصمة الحضور من إعدادات الحساب أولًا.");
            var challenge = Save(data, input.Actor, input.Meeting);
            return new(challenge.Id, challenge.Value, keys);
        });

    internal static async Task<bool> Verify(State store, AndroidKeyAttestation attestation, Proof input, CancellationToken cancellation)
    {
        var current = await store.Read<IdentityData>(Module.Identity, Guid.Empty);
        var challenge = Find(current, input.Actor, input.Meeting, input.Id);
        var key = Rules.Found(current.AndroidAttendanceKeys.Find(x => x.Id == input.Assertion.KeyId && x.Account == input.Actor.Id));
        using var verifier = ECDsa.Create();
        verifier.ImportSubjectPublicKeyInfo(Convert.FromBase64String(key.PublicKey), out _);
        Rules.Require(AndroidKeyAttestation.VerifySignature(verifier, challenge.Value, input.Assertion.Signature),
            "تعذّر التحقق من بصمة الجهاز.");
        Rules.Require(await attestation.IsCurrent(key.CertificateSerials, cancellation), "اعتماد جهاز Android ملغى.");
        return await store.Change<IdentityData, bool>(Module.Identity, Guid.Empty, data =>
        {
            var pending = Find(data, input.Actor, input.Meeting, input.Id);
            Rules.Found(data.AndroidAttendanceKeys.Find(x => x.Id == key.Id && x.Account == input.Actor.Id));
            data.AndroidAttendanceChallenges.Remove(pending);
            return true;
        });
    }

    private static AndroidAttendanceChallenge Save(IdentityData data, Actor actor, Guid? meeting)
    {
        var now = DateTimeOffset.UtcNow;
        data.AndroidAttendanceChallenges.RemoveAll(x => x.Expires <= now ||
            (x.Account == actor.Id && x.Center == actor.Center && x.Meeting == meeting));
        var challenge = new AndroidAttendanceChallenge(Guid.NewGuid(), actor.Id, actor.Center, meeting,
            RandomNumberGenerator.GetBytes(32), now.AddMinutes(2));
        data.AndroidAttendanceChallenges.Add(challenge);
        return challenge;
    }

    private static AndroidAttendanceChallenge Find(IdentityData data, Actor actor, Guid? meeting, Guid id) =>
        Rules.Found(data.AndroidAttendanceChallenges.Find(x => x.Id == id && x.Account == actor.Id &&
            x.Center == actor.Center && x.Meeting == meeting && x.Expires > DateTimeOffset.UtcNow));

    private static void CheckEnrollmentLimit(IdentityData data, Actor actor) =>
        Rules.Require(data.AndroidAttendanceKeys.Count(x => x.Account == actor.Id) < 10,
            "أبطل أحد أجهزة Android قبل تفعيل البصمة على جهاز آخر.");

    internal record EnrollmentOptions(Guid Id, byte[] Challenge);
    internal record Enrollment(Guid Id, string[] Chain, string Signature);
    internal record AttendanceOptions(Guid Id, byte[] Challenge, Guid[] KeyIds);
    internal record Assertion(Guid KeyId, string Signature);
    internal record Proof(Actor Actor, Guid Meeting, Guid Id, Assertion Assertion);
}

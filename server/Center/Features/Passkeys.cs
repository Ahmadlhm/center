using System.Text.Json;
using Center.Domain;
using Center.Infrastructure;
using Fido2NetLib;
using Fido2NetLib.Objects;

namespace Center.Features;

public static class Passkeys
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/centers/{center:guid}/identity/passkeys");
        g.MapGet("", async (Guid center, HttpContext http, State store) =>
        {
            var (actor, _) = await Identity.Context(store, http, center);
            var data = await store.Read<IdentityData>(Module.Identity, Guid.Empty);
            return data.Credentials.Where(x => x.Account == actor.Id).Select(x => new { x.Id });
        });
        g.MapPost("/register/options", async (Guid center, HttpContext http, State store, IFido2 fido) =>
        {
            var (actor, _) = await Identity.Context(store, http, center);
            return await RegistrationOptions(store, fido, actor);
        });
        g.MapPost("/register/complete", async (Guid center, CompleteRegistration input, HttpContext http, State store, IFido2 fido) =>
        {
            var (actor, _) = await Identity.Context(store, http, center);
            return await Register(store, fido, actor, input);
        });
        g.MapDelete("", async (Guid center, string id, HttpContext http, State store) =>
        {
            var (actor, _) = await Identity.Context(store, http, center);
            await store.Change<IdentityData, bool>(Module.Identity, Guid.Empty, data =>
            {
                data.Credentials.RemoveAll(x => x.Id == id && x.Account == actor.Id);
                data.Challenges.RemoveAll(x => x.Account == actor.Id);
                data.Audit.Log(actor, "passkey.revoke", actor.Id);
                return true;
            });
            return Results.NoContent();
        });
        app.MapPost("/internal/passkey/options", (ProofContext data, State store, IFido2 fido) => Options(store, fido, data));
        app.MapPost("/internal/passkey/verify", (Proof data, State store, IFido2 fido) => Verify(store, fido, data));
    }
    private static Task<object> RegistrationOptions(State store, IFido2 fido, Actor actor) =>
        store.Change<IdentityData, object>(Module.Identity, Guid.Empty, data =>
        {
            Rules.Require(data.Credentials.Count(x => x.Account == actor.Id) < 10, "احذف أحد مفاتيح المرور قبل إضافة مفتاح.");
            var options = fido.RequestNewCredential(new RequestNewCredentialParams
            {
                User = new Fido2User { Id = actor.Id.ToByteArray(), Name = data.Accounts.Single(x => x.Id == actor.Id).Email, DisplayName = actor.Name },
                ExcludeCredentials = data.Credentials.Where(x => x.Account == actor.Id).Select(x => new PublicKeyCredentialDescriptor(Convert.FromBase64String(x.Id))).ToArray(),
                AuthenticatorSelection = new AuthenticatorSelection { UserVerification = UserVerificationRequirement.Required },
                AttestationPreference = AttestationConveyancePreference.None
            });
            var challenge = Save(data, actor, null, options.ToJson());
            using var parsed = JsonDocument.Parse(challenge.Options);
            return new { challenge.Id, options = parsed.RootElement.Clone() };
        });
    private static Task<object> Register(State store, IFido2 fido, Actor actor, CompleteRegistration input) =>
        store.Change<IdentityData, object>(Module.Identity, Guid.Empty, async data =>
        {
            var challenge = Find(data, actor, null, input.Id);
            var result = await fido.MakeNewCredentialAsync(new MakeNewCredentialParams
            {
                AttestationResponse = input.Response,
                OriginalOptions = CredentialCreateOptions.FromJson(challenge.Options),
                IsCredentialIdUniqueToUserCallback = (args, _) => Task.FromResult(!data.Credentials.Any(x => x.Id == Convert.ToBase64String(args.CredentialId)))
            });
            data.Credentials.Add(new(actor.Id, Convert.ToBase64String(result.Id), Convert.ToBase64String(result.PublicKey), result.SignCount));
            data.Challenges.Remove(challenge);
            data.Audit.Log(actor, "passkey.register", actor.Id);
            return new { ok = true };
        });
    public static Task<JsonElement> Options(State store, IFido2 fido, ProofContext input) =>
        store.Change<IdentityData, JsonElement>(Module.Identity, Guid.Empty, data =>
        {
            var list = data.Credentials.Where(x => x.Account == input.Actor.Id).Select(x => new PublicKeyCredentialDescriptor(Convert.FromBase64String(x.Id))).ToArray();
            Rules.Require(list.Length > 0, "أضف مفتاح إثبات الحضور من إعدادات حسابك أولًا.");
            var options = fido.GetAssertionOptions(new GetAssertionOptionsParams { AllowedCredentials = list, UserVerification = UserVerificationRequirement.Required });
            var challenge = Save(data, input.Actor, input.Meeting, options.ToJson());
            return JsonSerializer.SerializeToElement(new { challenge.Id, options = JsonDocument.Parse(challenge.Options).RootElement }, State.Json);
        });
    public static Task<bool> Verify(State store, IFido2 fido, Proof input) =>
        store.Change<IdentityData, bool>(Module.Identity, Guid.Empty, async data =>
        {
            var challenge = Find(data, input.Actor, input.Meeting, input.Id);
            var credentialId = Convert.ToBase64String(input.Response.RawId);
            var credential = Rules.Found(data.Credentials.Find(x => x.Id == credentialId && x.Account == input.Actor.Id));
            var result = await fido.MakeAssertionAsync(new MakeAssertionParams
            {
                AssertionResponse = input.Response,
                OriginalOptions = AssertionOptions.FromJson(challenge.Options),
                StoredPublicKey = Convert.FromBase64String(credential.Key),
                StoredSignatureCounter = credential.Counter,
                IsUserHandleOwnerOfCredentialIdCallback = (args, _) => Task.FromResult(args.UserHandle.SequenceEqual(input.Actor.Id.ToByteArray()))
            });
            data.Credentials.Upsert(x => x == credential, credential with { Counter = result.SignCount });
            data.Challenges.Remove(challenge);
            return true;
        });
    private static Challenge Save(IdentityData data, Actor actor, Guid? meeting, string options)
    {
        data.Challenges.RemoveAll(x => x.Expires <= DateTimeOffset.UtcNow || (x.Account == actor.Id && x.Meeting == meeting));
        var item = new Challenge(Guid.NewGuid(), actor.Id, actor.Center, meeting, options, DateTimeOffset.UtcNow.AddMinutes(2));
        data.Challenges.Add(item);
        return item;
    }
    private static Challenge Find(IdentityData data, Actor actor, Guid? meeting, Guid id) =>
        Rules.Found(data.Challenges.Find(x => x.Id == id && x.Account == actor.Id && x.Center == actor.Center && x.Meeting == meeting && x.Expires > DateTimeOffset.UtcNow));
    public record CompleteRegistration(Guid Id, AuthenticatorAttestationRawResponse Response);
    public record ProofContext(Actor Actor, Guid Meeting);
    public record Proof(Actor Actor, Guid Meeting, Guid Id, AuthenticatorAssertionRawResponse Response);
}

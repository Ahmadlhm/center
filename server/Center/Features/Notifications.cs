using Center.Domain;
using Center.Infrastructure;

namespace Center.Features;

public static class Notifications
{
    public static void Add(EducationData data, IEnumerable<Guid> recipients, string text, string route)
    {
        var time = DateTimeOffset.UtcNow;
        foreach (var recipient in recipients.Distinct())
            data.Notifications.Add(new(Guid.NewGuid(), recipient, text, route, time));
    }

    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/notifications", async (Guid center, State store, HttpContext http) =>
        {
            var (actor, _) = await Identity.Context(store, http, center);
            var data = await store.Read<EducationData>(Module.Education, center);
            var own = data.Notifications.Where(x => x.Recipient == actor.Id);
            return new { unread = own.Count(x => !x.Read), items = own.OrderByDescending(x => x.CreatedAt).Take(30) };
        });
        g.MapPut("/notifications/{id:guid}/read", async (Guid center, Guid id, State store, HttpContext http) =>
        {
            var (actor, _) = await Identity.Context(store, http, center);
            await store.Change<EducationData, bool>(Module.Education, center, data =>
            {
                var item = Rules.Found(data.Notifications.Find(x => x.Id == id && x.Recipient == actor.Id));
                data.Notifications.Upsert(x => x.Id == id, item with { Read = true });
                return true;
            });
            return Results.NoContent();
        });
    }
}

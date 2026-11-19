using Center.Domain;
using Center.Infrastructure;

namespace Center.Features;

public sealed class MeetingPlanner(State store, ILogger<MeetingPlanner> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        do
        {
            try
            {
                var centers = store.Local(Module.Identity)
                    ? await Identity.ActiveCenters(store)
                    : await store.Send<CenterInfo[]>(Module.Identity, "/internal/active-centers", new { });
                var catalog = await Catalog.Read(store);
                foreach (var center in centers)
                {
                    var today = Rules.Today(center.TimeZone);
                    var people = await store.Read<PeopleData>(Module.People, center.Id);
                    var groups = people.Groups.Select(g => people.GroupAt(g.Id, today)).OfType<Group>()
                        .Where(g => g.Active(today) && g.Days.Contains(today.DayOfWeek)).ToArray();
                    if (groups.Length == 0) continue;
                    var snapshot = await store.Read<EducationData>(Module.Education, center.Id);
                    if (groups.All(g => snapshot.Meetings.Any(m => m.Group == g.Id && m.Date == today))) continue;
                    await store.Change<EducationData, bool>(Module.Education, center.Id, data =>
                    {
                        foreach (var group in groups.Where(g => !data.Meetings.Any(m => m.Group == g.Id && m.Date == today)))
                            data.Meetings.Add(Education.ForGroup(group, today, people, data, catalog));
                        return true;
                    });
                }
            }
            catch (Exception error) when (!stoppingToken.IsCancellationRequested)
            {
                logger.LogWarning("Scheduled encounter generation could not complete: {ErrorType}", error.GetType().Name);
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}

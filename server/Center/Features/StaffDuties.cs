using System.Security.Cryptography;
using System.Text;
using Center.Domain;
using Center.Infrastructure;

namespace Center.Features;

public static class StaffDuties
{
    public static Guid Occurrence(Guid employee, DateOnly day) =>
        new(SHA256.HashData(Encoding.UTF8.GetBytes($"staff-duty/{employee:N}/{Rules.Iso(day)}")).AsSpan(0, 16));

    public static StaffShift? Shift(WorkData data, Guid employee, DateOnly day) =>
        data.Shifts.Where(x => x.Employee == employee && x.Effective <= day).OrderByDescending(x => x.Effective).FirstOrDefault();

    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/duties", (Guid center, DateOnly? date, HttpContext http, State store) => List(center, date, http, store, false));
        g.MapGet("/duties/configuration", (Guid center, DateOnly? date, HttpContext http, State store) => List(center, date, http, store, true));
        g.MapPut("/duties/configuration/{employee:guid}", async (Guid center, Guid employee, ShiftInput input, HttpContext http, State store) =>
        {
            var (actor, info) = await Identity.Context(store, http, center, configuration: true);
            var staff = await Identity.Staff(store, center);
            Rules.Require(staff.Any(x => x.Id == employee && x.Active), "اختر موظفًا نشطًا.");
            Rules.Require(input.Effective >= Rules.Today(info.TimeZone) && input.From < input.To &&
                (!input.Active || input.Days.Length > 0) && input.Days.All(Enum.IsDefined), "راجع تاريخ السريان والأيام وأوقات الدوام.");
            return await store.Change<WorkData, StaffShift>(Module.Work, center, data =>
            {
                var schedule = new StaffShift(employee, input.Effective, input.Days.Distinct().ToArray(), input.From, input.To, input.Active);
                data.Shifts.Upsert(x => x.Employee == employee && x.Effective == input.Effective, schedule);
                data.Audit.Log(actor, "staff.duty.settings", employee);
                return schedule;
            });
        });
        g.MapPost("/duties/configuration/{id:guid}/review", async (Guid center, Guid id, DateOnly date, Work.CheckReview input, HttpContext http, State store) =>
        {
            var (actor, _) = await Identity.Context(store, http, center, configuration: true);
            await Ensure(store, center, id, input.Teacher, date);
            return await Work.RecordReview(store, actor, id, input, true);
        });
    }

    private static async Task<object> List(Guid center, DateOnly? date, HttpContext http, State store, bool configuration)
    {
        var (actor, info) = await Identity.Context(store, http, center, configuration);
        var day = date ?? Rules.Today(info.TimeZone);
        var data = await store.Read<WorkData>(Module.Work, center);
        var staff = await Identity.Staff(store, center);
        var employees = staff.Where(x => x.Active && (actor.Admin || x.Id == actor.Id)).ToArray();
        var items = employees.Select(x =>
        {
            var id = Occurrence(x.Id, day);
            var shift = Shift(data, x.Id, day);
            return new
            {
                id, employee = x.Id, x.Name, date = day,
                scheduled = shift is { Active: true } && shift.Days.Contains(day.DayOfWeek),
                shift,
                checkIn = data.CheckIns.Find(c => c.Meeting == id && c.Teacher == x.Id)
            };
        });
        return new { date = day, mapUrl = info.MapUrl, items };
    }

    public static async Task<StaffShift> Ensure(State store, Guid center, Guid id, Guid employee, DateOnly day)
    {
        Rules.Require(Occurrence(employee, day) == id, "هذا الدوام خارج تكليفك.", 403);
        var data = await store.Read<WorkData>(Module.Work, center);
        var shift = Shift(data, employee, day);
        var recorded = data.CheckIns.Any(x => x.Meeting == id && x.Teacher == employee);
        Rules.Require(shift is not null && (recorded || (shift.Active && shift.Days.Contains(day.DayOfWeek))), "لا يوجد دوام مجدول لهذا الموظف.", 403);
        return shift!;
    }

    public record ShiftInput(DateOnly Effective, DayOfWeek[] Days, TimeOnly From, TimeOnly To, bool Active);
}

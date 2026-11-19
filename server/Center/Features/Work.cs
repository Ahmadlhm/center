using System.Text.Json;
using Center.Domain;
using Center.Infrastructure;
using Fido2NetLib;

namespace Center.Features;

public static class Work
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/centers/{center:guid}/work");
        StaffDuties.Map(g);
        g.MapGet("", async (Guid center, State store, HttpContext http) =>
        {
            var (actor, _) = await Identity.Context(store, http, center);
            var data = await store.Read<WorkData>(Module.Work, center);
            var people = await store.Read<PeopleData>(Module.People, center);
            var education = await store.Read<EducationData>(Module.Education, center);
            return new
            {
                checkIns = data.CheckIns.Where(x => actor.Admin || x.Teacher == actor.Id || (actor.Manager && education.Meetings.Any(m => m.Id == x.Meeting && Education.VisibleMeeting(actor, people, m)))),
                tasks = data.Tasks.Where(x => actor.Admin || x.Teacher == actor.Id || (actor.Manager && people.Groups.Any(y => y.Id == x.Group && people.InScope(y.Unit, actor.Units))))
            };
        });
        g.MapPost("/checkins/{meeting:guid}/options", async (Guid center, Guid meeting, DateOnly? date, State store, HttpContext http, IFido2 fido) =>
        {
            var (actor, info) = await Identity.Context(store, http, center);
            await CheckContext(store, actor, info, meeting, date);
            var input = new Passkeys.ProofContext(actor, meeting);
            return store.Local(Module.Identity) ? await Passkeys.Options(store, fido, input) :
                await store.Send<JsonElement>(Module.Identity, "/internal/passkey/options", input);
        });
        g.MapPost("/checkins/{meeting:guid}", async (Guid center, Guid meeting, DateOnly? date, CheckInput input, State store, HttpContext http, IFido2 fido) =>
        {
            var (actor, info) = await Identity.Context(store, http, center);
            var old = (await store.Read<WorkData>(Module.Work, center)).CheckIns.Find(x => x.Meeting == meeting && x.Teacher == actor.Id && x.State == "verified");
            if (old is not null) return old;
            var rule = await CheckContext(store, actor, info, meeting, date);
            var age = (DateTimeOffset.UtcNow - input.Captured).TotalSeconds;
            Rules.Require(age is >= -20 and <= 120 && input.Accuracy > 0 && input.Accuracy <= rule.Accuracy && input.Latitude is >= -90 and <= 90 && input.Longitude is >= -180 and <= 180,
                "اطلب قراءة حديثة للموقع بدقة أعلى.");
            Rules.Require(Distance(input.Latitude, input.Longitude, rule.Latitude!.Value, rule.Longitude!.Value) + input.Accuracy <= rule.Radius, "الموقع خارج النطاق أو دقته غير كافية.");
            var proof = new Passkeys.Proof(actor, meeting, input.Id, input.Response);
            var verified = store.Local(Module.Identity) ? await Passkeys.Verify(store, fido, proof) :
                await store.Send<bool>(Module.Identity, "/internal/passkey/verify", proof);
            Rules.Require(verified, "تعذّر التحقق من مفتاح المرور.");
            return await store.Change<WorkData, CheckIn>(Module.Work, center, data =>
            {
                var prior = data.CheckIns.Find(x => x.Meeting == meeting && x.Teacher == actor.Id && x.State == "verified");
                if (prior is not null) return prior;
                var result = new CheckIn(meeting, actor.Id, "verified", DateTimeOffset.UtcNow, "passkey", null, input.Accuracy);
                data.CheckIns.Upsert(x => x.Meeting == meeting && x.Teacher == actor.Id, result);
                data.Audit.Log(actor, "checkin.verified", meeting);
                return result;
            });
        });
        g.MapPost("/checkins/{meeting:guid}/review", async (Guid center, Guid meeting, DateOnly? date, CheckReview input, State store, HttpContext http) =>
        {
            var (actor, _) = await Identity.Context(store, http, center);
            var canDecide = actor.Admin && actor.Id != input.Teacher;
            var employee = canDecide ? input.Teacher : actor.Id;
            DateOnly dutyDate;
            if (date is DateOnly scheduled)
            {
                await StaffDuties.Ensure(store, center, meeting, employee, scheduled);
                dutyDate = scheduled;
            }
            else
            {
                var education = await store.Read<EducationData>(Module.Education, center);
                var target = Rules.Found(education.Meetings.Find(x => x.Id == meeting));
                Rules.Require(target.Teachers.Contains(employee), "هذا الموظف غير مكلّف باللقاء.", 403);
                dutyDate = target.Date;
            }
            var people = await store.Read<PeopleData>(Module.People, center);
            Rules.Require(canDecide || people.At(dutyDate).AllowAttendanceReview, "طلبات المراجعة غير متاحة بحسب سياسة الدوام.", 403);
            return await RecordReview(store, actor, meeting, input with { Teacher = employee }, canDecide);
        });
        g.MapPost("/tasks", async (Guid center, TaskInput input, State store, HttpContext http) =>
        {
            var (actor, _) = await Identity.Context(store, http, center);
            actor.Admin();
            var staff = await Identity.Staff(store, center);
            var people = await store.Read<PeopleData>(Module.People, center);
            var education = await store.Read<EducationData>(Module.Education, center);
            Rules.Require(staff.Any(x => x.Id == input.Teacher && x.Active && x.Roles.Contains("teacher")) &&
                (input.Group is null || people.Groups.Any(x => x.Id == input.Group)) &&
                (input.Course is null || education.Courses.Any(x => x.Id == input.Course)), "اختر معلّمًا ونطاقًا صحيحين.");
            return await store.Change<WorkData, TaskItem>(Module.Work, center, data =>
            {
                var item = new TaskItem(Guid.NewGuid(), input.Teacher, Rules.Required(input.Title), Rules.Required(input.Detail, 4000), input.Due, input.Group, input.Course, "open", null);
                data.Tasks.Add(item);
                data.Audit.Log(actor, "task.create", item.Id);
                return item;
            });
        });
        g.MapPut("/tasks/{id:guid}", async (Guid center, Guid id, TaskAction input, State store, HttpContext http) =>
        {
            var (actor, _) = await Identity.Context(store, http, center);
            return await store.Change<WorkData, TaskItem>(Module.Work, center, data =>
            {
                var old = Rules.Found(data.Tasks.Find(x => x.Id == id));
                Rules.Require((actor.Teacher && old.Teacher == actor.Id && old.State is "open" or "returned" && input.State == "submitted") ||
                    (actor.Admin && old.State == "submitted" && input.State is "approved" or "returned"), "انتقال حالة التكليف غير مسموح.", 403);
                var note = input.State == "approved" ? input.Reply : Rules.Required(input.Reply, 4000);
                var item = old with { State = input.State, Reply = note ?? old.Reply };
                data.Tasks.Upsert(x => x.Id == id, item);
                data.Audit.Log(actor, "task." + input.State, id, input.State == "returned" ? note : null);
                return item;
            });
        });
    }
    public static Task<CheckIn> RecordReview(State store, Actor actor, Guid id, CheckReview input, bool canDecide)
    {
        var reason = Rules.Required(input.Reason, 500);
        Rules.Require(canDecide ? input.State is "manual" or "absent" : input.State == "pending", "حالة المراجعة غير متاحة.");
        return store.Change<WorkData, CheckIn>(Module.Work, actor.Center, data =>
        {
            var old = data.CheckIns.Find(x => x.Meeting == id && x.Teacher == input.Teacher);
            Rules.Require(canDecide || old is null || old.State == "pending", "تم اعتماد الدوام بالفعل.", 409);
            var row = new CheckIn(id, input.Teacher, input.State, DateTimeOffset.UtcNow, "review", reason, null);
            data.CheckIns.Upsert(x => x.Meeting == id && x.Teacher == input.Teacher, row);
            data.Audit.Log(actor, "checkin." + row.State, input.Teacher, reason);
            return row;
        });
    }
    private static async Task<Rule> CheckContext(State store, Actor actor, CenterInfo info, Guid id, DateOnly? date)
    {
        var people = await store.Read<PeopleData>(Module.People, actor.Center);
        Rule rule;
        DateTimeOffset at;
        if (date is DateOnly day)
        {
            var shift = await StaffDuties.Ensure(store, actor.Center, id, actor.Id, day);
            rule = people.At(day);
            at = Rules.Instant(day, shift.From, info.TimeZone);
        }
        else
        {
            var education = await store.Read<EducationData>(Module.Education, actor.Center);
            var meeting = Rules.Found(education.Meetings.Find(x => x.Id == id));
            Rules.Require(actor.Teacher && meeting.Teachers.Contains(actor.Id) && meeting.State != "cancelled", "اللقاء خارج تكليفك.", 403);
            rule = people.At(meeting.Date);
            at = Rules.Instant(meeting.Date, meeting.From, info.TimeZone);
        }
        Rules.Require(rule.Latitude.HasValue && rule.Longitude.HasValue, "يحدد مدير المنصة موقع إثبات الدوام أولًا.");
        var now = DateTimeOffset.UtcNow;
        Rules.Require(now >= at.AddMinutes(-rule.OpenMinutes) && now <= at.AddMinutes(rule.LateMinutes), "أنت خارج نافذة إثبات الحضور.");
        return rule;
    }
    private static double Distance(double lat1, double lon1, double lat2, double lon2)
    {
        const double radians = Math.PI / 180;
        var a = Math.Pow(Math.Sin((lat2 - lat1) * radians / 2), 2) +
            Math.Cos(lat1 * radians) * Math.Cos(lat2 * radians) * Math.Pow(Math.Sin((lon2 - lon1) * radians / 2), 2);
        return 12742000 * Math.Asin(Math.Sqrt(Math.Clamp(a, 0, 1)));
    }
    public record CheckInput(Guid Id, AuthenticatorAssertionRawResponse Response, double Latitude, double Longitude, double Accuracy, DateTimeOffset Captured);
    public record CheckReview(Guid Teacher, string State, string Reason);
    public record TaskInput(Guid Teacher, string Title, string Detail, DateOnly Due, Guid? Group, Guid? Course);
    public record TaskAction(string State, string? Reply);
}

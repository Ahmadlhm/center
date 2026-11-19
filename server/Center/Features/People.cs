using Center.Domain;
using Center.Infrastructure;

namespace Center.Features;

public static class People
{
    public static bool FullStudent(Actor actor, PeopleData data, Guid id, DateOnly day) => actor.Admin || (actor.Teacher &&
        data.Enrollments.Any(x => x.Student == id && x.Active(day) && data.GroupAt(x.Group, day)?.Teacher == actor.Id));
    public static bool CanSeeStudent(Actor actor, PeopleData data, Guid id, DateOnly day) =>
        actor.Admin || data.Enrollments.Where(x => x.Student == id && x.Active(day))
            .Any(x => data.GroupAt(x.Group, day) is { } group && actor.CanSee(data, group));

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/centers/{center:guid}/people");
        g.MapGet("", async (Guid center, State store, HttpContext http) =>
        {
            var (actor, info) = await Identity.Context(store, http, center);
            var data = await store.Read<PeopleData>(Module.People, center);
            var today = Rules.Today(info.TimeZone);
            var groups = (actor.Admin ? data.Groups : data.Groups.Select(x => data.GroupAt(x.Id, today)).OfType<Group>()).Where(x => actor.CanSee(data, x)).ToArray();
            var enrollments = data.Enrollments.Where(x => groups.Any(group => group.Id == x.Group) && (actor.Admin || x.Active(today))).ToArray();
            var students = data.Students.Where(x => actor.Admin || enrollments.Any(e => e.Student == x.Id)).ToArray();
            var units = actor.Admin ? data.Units : data.Units.Where(x => groups.Any(group => data.InScope(group.Unit, [x.Id])) || data.InScope(x.Id, actor.Units)).ToList();
            return new { groups, enrollments, students, units, data.Periods, rules = actor.Admin ? data.Rules : [], rule = data.At(today), data.Policies, today };
        });
        g.MapGet("/configuration", async (Guid center, State store, HttpContext http) =>
        {
            var (_, info) = await Identity.Context(store, http, center, configuration: true);
            var data = await store.Read<PeopleData>(Module.People, center);
            var today = Rules.Today(info.TimeZone);
            return new { data.Units, data.Groups, data.Periods, data.Rules, rule = data.At(today), data.Policies, today };
        });
        g.MapPut("/units/{id:guid}", async (Guid center, Guid id, UnitInput input, State store, HttpContext http) =>
        {
            var (actor, info) = await Identity.Context(store, http, center, configuration: true);
            actor.Admin();
            return await store.Change<PeopleData, Unit>(Module.People, center, data =>
            {
                var existing = data.Units.Find(x => x.Id == id);
                Rules.Require(input.Parent is null || (input.Parent != id && data.Units.Any(x => x.Id == input.Parent && x.Active) && !data.InScope(input.Parent, [id])),
                    "اختر وحدة أصل صالحة.");

                Rules.Require(input.Active || (!data.Units.Any(x => x.Parent == id && x.Active) && !data.Groups.Any(x => x.Unit == id && x.End == null)),
                    "انقل الشعب والوحدات التابعة قبل الأرشفة.");
                var unit = new Unit(id, Rules.Required(input.Name), Rules.Required(input.Kind, 50), input.Parent, input.Active);
                if (existing != null && existing.Parent != input.Parent)
                {
                    if (!data.UnitPlacements.Any(x => x.Unit == id))
                        data.UnitPlacements.Add(new(id, existing.Parent, DateOnly.MinValue));
                    var day = Rules.Today(info.TimeZone);
                    data.UnitPlacements.Upsert(x => x.Unit == id && x.Effective == day, new(id, unit.Parent, day));
                }
                data.Units.Upsert(x => x.Id == id, unit);
                data.Audit.Log(actor, "unit.save", id);
                return unit;
            });
        });
        g.MapPut("/periods/{id:guid}", async (Guid center, Guid id, PeriodInput input, State store, HttpContext http) =>
        {
            var (actor, _) = await Identity.Context(store, http, center, configuration: true);
            actor.Admin();
            Rules.Require(input.End >= input.Start, "نهاية الفترة تسبق بدايتها.");
            return await store.Change<PeopleData, Period>(Module.People, center, data =>
            {
                var period = new Period(id, Rules.Required(input.Name), input.Start, input.End);
                data.Periods.Upsert(x => x.Id == id, period);
                data.Audit.Log(actor, "period.save", id);
                return period;
            });
        });
        g.MapPut("/groups/{id:guid}", async (Guid center, Guid id, GroupInput input, State store, HttpContext http) =>
        {
            var (actor, info) = await Identity.Context(store, http, center, configuration: true);
            actor.Admin();
            Rules.Require(input.Days.Length != 0 && input.Days.All(Enum.IsDefined) && input.From < input.To && (input.End == null || input.End > input.Start),
                "راجع تاريخ الشعبة وأيام الدوام وأوقاته.");
            var staff = await Identity.Staff(store, center);
            Rules.Require(staff.Any(x => x.Id == input.Teacher && x.Active && x.Roles.Contains("teacher")), "اختر معلّمًا نشطًا.");
            var today = Rules.Today(info.TimeZone);
            return await store.Change<PeopleData, Group>(Module.People, center, data =>
            {
                Rules.Require(input.Unit is null || data.Units.Any(x => x.Id == input.Unit && x.Active), "الوحدة غير متاحة.");
                Rules.Require(input.Period is null || data.Periods.Any(x => x.Id == input.Period), "الفترة غير متاحة.");
                var existing = data.Groups.Find(x => x.Id == id);
                var effective = existing is null ? input.Start : input.Effective ?? today;
                Rules.Require(existing is null || effective >= today, "حدّد تاريخ السريان من اليوم فصاعدًا.");
                var group = new Group(id, Rules.Required(input.Name), input.Unit, input.Teacher, input.Period, input.Start, input.End, input.Days.Distinct().ToArray(), input.From, input.To);
                data.Groups.Upsert(x => x.Id == id, group);
                if (existing is not null && !data.GroupHistory.Any(x => x.Group.Id == id)) data.GroupHistory.Add(new(existing, existing.Start));
                data.GroupHistory.Upsert(x => x.Group.Id == id && x.Effective == effective, new(group, effective));
                data.Audit.Log(actor, "group.save", id);
                return group;
            });
        });
        g.MapPut("/students/{id:guid}", async (Guid center, Guid id, StudentInput input, State store, HttpContext http) =>
        {
            var (actor, info) = await Identity.Context(store, http, center);
            actor.Admin();
            Rules.Require(input.Birth is null || input.Birth <= Rules.Today(info.TimeZone), "تاريخ الميلاد في المستقبل.");
            var catalog = await Catalog.Read(store);
            return await store.Change<PeopleData, Student>(Module.People, center, data =>
            {
                var number = Rules.Required(input.Number, 40);
                Rules.Require(!data.Students.Any(x => x.Number == number && x.Id != id), "رقم الطالب مستخدم.");
                var old = data.Students.Find(x => x.Id == id);
                foreach (var span in input.Baseline ?? [])
                    if (old == null || !old.Baseline.Contains(span)) catalog.Validate(span);
                var student = new Student(id, number, Rules.Required(input.Name), input.Birth, input.Contact?.Trim() ?? "", input.Baseline ?? [], input.Estimated);
                data.Students.Upsert(x => x.Id == id, student);
                data.Audit.Log(actor, "student.save", id);
                return student;
            });
        });
        g.MapPost("/students/{id:guid}/enrollment", async (Guid center, Guid id, EnrollInput input, State store, HttpContext http) =>
        {
            var (actor, info) = await Identity.Context(store, http, center);
            actor.Admin();
            Rules.Require(input.Start >= Rules.Today(info.TimeZone), "استخدم تاريخ انتقال من اليوم فصاعدًا.");
            return await store.Change<PeopleData, object>(Module.People, center, data =>
            {
                Rules.Found(data.Students.Find(x => x.Id == id));
                if (input.CloseGroup is Guid old)
                {
                    var current = Rules.Found(data.Enrollments.Find(x => x.Student == id && x.Group == old && x.Active(input.Start)));
                    Rules.Require(current.Start < input.Start || input.Group != old, "اختر شعبة جديدة.");
                    data.Enrollments.Upsert(x => x == current, current with { End = input.Start });
                }
                if (input.Group is Guid next)
                {
                    var group = Rules.Found(data.GroupAt(next, input.Start));
                    Rules.Require(group.Active(input.Start), "الشعبة غير نشطة في التاريخ المحدد.");
                    if (data.Enrollments.Any(x => x.Student == id && x.Group == next && x.Active(input.Start))) return new { ok = true };
                    var relevant = data.Enrollments.Where(x => x.Student == id && (x.End is null || x.End > input.Start)).ToArray();
                    var dates = relevant.Select(x => x.Start).Concat(data.Rules.Select(x => x.Effective)).Append(input.Start).Where(x => x >= input.Start).Distinct();
                    Rules.Require(dates.All(day => relevant.Count(x => x.Active(day)) < data.At(day).GroupLimit), "الطالب تجاوز الحد المسموح لعدد الشعب.");
                    data.Enrollments.Add(new(id, next, input.Start, null));
                }
                data.Audit.Log(actor, "student.enrollment", id);
                return new { ok = true };
            });
        });
        g.MapPost("/rules", async (Guid center, Rule input, State store, HttpContext http) =>
        {
            var (actor, info) = await Identity.Context(store, http, center, configuration: true);
            actor.Admin();
            Rules.Require(input.Effective >= Rules.Today(info.TimeZone) && input.GroupLimit is >= 1 and <= 30 &&
                input.CloseHours is >= 1 and <= 720 && input.OpenMinutes is >= 0 and <= 120 && input.LateMinutes is >= 0 and <= 720 &&
                input.Radius is >= 10 and <= 10000 && input.Accuracy is >= 5 and <= 1000 &&
                ((input.Latitude is null && input.Longitude is null) || (input.Latitude is >= -90 and <= 90 && input.Longitude is >= -180 and <= 180)), "راجع حدود قواعد الدوام والتسجيل.");
            return await store.Change<PeopleData, Rule>(Module.People, center, data =>
            {
                var rule = input with { Version = Guid.NewGuid() };
                data.Rules.Add(rule);
                data.Audit.Log(actor, "rule.save", rule.Version);
                return rule;
            });
        });
        g.MapPost("/policy", async (Guid center, Policy input, State store, HttpContext http) =>
        {
            var (actor, _) = await Identity.Context(store, http, center, configuration: true);
            actor.Admin();
            return await store.Change<PeopleData, Policy>(Module.People, center, data =>
            {
                var policy = input with { Text = Rules.Required(input.Text, 10000) };
                data.Policies.Upsert(x => x.Effective == policy.Effective, policy);
                data.Audit.Log(actor, "policy.save", policy.Effective);
                return policy;
            });
        });
        app.MapPost("/internal/import", async (ImportCommit input, State store) => await Commit(store, input));
    }
    public static Task<Guid[]> Commit(State store, ImportCommit input) => store.Change<PeopleData, Guid[]>(Module.People, input.Actor.Center, data =>
    {
        input.Actor.Admin();
        if (data.Imports.TryGetValue(input.Batch, out var ids)) return ids;
        Rules.Require(input.Rows.Length is > 0 and <= 500, "اختر من ١ إلى ٥٠٠ صف.");
        var results = new List<Guid>();
        foreach (var row in input.Rows)
        {
            var number = Rules.Required(row.Number, 40);
            Rules.Require(!data.Students.Any(x => x.Number == number), $"رقم الطالب {number} مسجّل بالفعل.");
            var student = new Student(Guid.NewGuid(), number, Rules.Required(row.Name), row.Birth, row.Contact ?? "", [], null);
            data.Students.Add(student);
            results.Add(student.Id);
        }
        ids = results.ToArray();
        data.Imports.Add(input.Batch, ids);
        data.Audit.Log(input.Actor, "students.import", input.Batch);
        return ids;
    });
    public record UnitInput(string Name, string Kind, Guid? Parent, bool Active = true);
    public record PeriodInput(string Name, DateOnly Start, DateOnly End);
    public record GroupInput(string Name, Guid? Unit, Guid Teacher, Guid? Period, DateOnly Start, DateOnly? End, DayOfWeek[] Days, TimeOnly From, TimeOnly To, DateOnly? Effective);
    public record StudentInput(string Number, string Name, DateOnly? Birth, string? Contact, VerseSpan[]? Baseline, string? Estimated);
    public record EnrollInput(Guid? Group, Guid? CloseGroup, DateOnly Start);
    public record ImportCommit(Actor Actor, Guid Batch, StudentInput[] Rows);
}

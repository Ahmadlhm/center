using Center.Domain;
using Center.Infrastructure;

namespace Center.Features;

public static class Education
{
    public static HashSet<Guid> CourseStudents(Course course, PeopleData people, DateOnly day) =>
        course.Students.Concat(course.Type == "recitation" ? [] : people.Enrollments.Where(e => e.Active(day) && course.Groups.Contains(e.Group)).Select(e => e.Student)).ToHashSet();
    public static bool CanSeeCourse(Actor actor, PeopleData people, Course course) => actor.Admin ||
        (actor.Teacher && (course.Owner == actor.Id || course.Teachers.Contains(actor.Id))) ||
        (actor.Manager && course.Groups.Any(id => people.Groups.Any(g => g.Id == id && people.InScope(g.Unit, actor.Units))));
    public static Meeting Filter(Actor actor, PeopleData people, Meeting row, DateOnly today)
    {
        if (actor.Admin || (actor.Teacher && row.Teachers.Contains(actor.Id))) return row;
        var permitted = row.Roster.Where(id => people.Enrollments.Any(e => e.Student == id && e.Active(row.Date) &&
            people.GroupAt(e.Group, row.Date) is { } group && people.InScope(group.Unit, actor.Units))).ToHashSet();
        return row with { Roster = row.Roster.Where(permitted.Contains).ToArray(), Marks = row.Marks.Where(mark => permitted.Contains(mark.Student)).ToArray() };
    }
    public static bool VisibleMeeting(Actor actor, PeopleData people, Meeting meeting) => actor.CanSee(people, meeting) ||
        (meeting.Group is Guid id && people.Groups.Any(g => g.Id == id && actor.CanSee(people, g))) ||
        (actor.Manager && meeting.Roster.Any(id => people.Enrollments.Any(e => e.Student == id && e.Active(meeting.Date) &&
            people.GroupAt(e.Group, meeting.Date) is { } group && people.InScope(group.Unit, actor.Units))));
    public static MeetingType[] Types(EducationData data, Course? course, PlatformCatalog catalog) =>
        course?.Type == "recitation" ? catalog.TajweedTypes : Catalog.Settings(data, catalog).Types;

    public static bool IsRecitation(EducationData data, Meeting meeting) =>
        data.Courses.Any(x => x.Type == "recitation" && x.Id == meeting.Course);

    private static string TajweedKind(string kind, PlatformCatalog catalog) => catalog.TajweedTypes.Any(x => x.Key == kind) ? kind : "tajweed-practical";

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/centers/{center:guid}/education");
        g.MapGet("", async (Guid center, State store, HttpContext http) =>
        {
            var (actor, info) = await Identity.Context(store, http, center);
            var peopleTask = store.Read<PeopleData>(Module.People, center);
            var dataTask = store.Read<EducationData>(Module.Education, center);
            await Task.WhenAll(peopleTask, dataTask);
            var people = await peopleTask;
            var data = await dataTask;
            var today = Rules.Today(info.TimeZone);
            var catalog = await Catalog.Read(store);
            var courses = data.Courses.Where(x => CanSeeCourse(actor, people, x)).Select(x => actor.Admin || x.Teachers.Contains(actor.Id)
                ? x : x with { Students = x.Students.Where(id => People.CanSeeStudent(actor, people, id, today)).ToArray() }).ToArray();
            return new
            {
                settings = Catalog.Settings(data, catalog),
                meetings = data.Meetings.Where(x => VisibleMeeting(actor, people, x)).Select(x => Filter(actor, people, x, today)),
                courses,
                commissions = data.Commissions.Where(x => actor.Admin || x.Teacher == actor.Id),
                followUps = data.FollowUps.Where(x => People.FullStudent(actor, people, x.Student, today) || (actor.Manager && people.GroupAt(x.Group, x.Due) is { } group && people.InScope(group.Unit, actor.Units))),
                competitions = data.Competitions,
                entries = data.Entries.Where(x => People.CanSeeStudent(actor, people, x.Student, today))
            };
        });
        g.MapGet("/configuration", async (Guid center, State store, HttpContext http) =>
        {
            await Identity.Context(store, http, center, configuration: true);
            var data = await store.Read<EducationData>(Module.Education, center);
            var catalog = await Catalog.Read(store);
            return new { settings = Catalog.Settings(data, catalog), data.Competitions };
        });
        g.MapGet("/students/{id:guid}", async (Guid center, Guid id, State store, HttpContext http) =>
        {
            var (actor, info) = await Identity.Context(store, http, center);
            var people = await store.Read<PeopleData>(Module.People, center);
            Rules.Require(People.CanSeeStudent(actor, people, id, Rules.Today(info.TimeZone)), "ملف الطالب خارج صلاحيتك.", 403);
            var student = Rules.Found(people.Students.Find(x => x.Id == id));
            var data = await store.Read<EducationData>(Module.Education, center);
            var today = Rules.Today(info.TimeZone);
            var full = People.FullStudent(actor, people, id, today);
            var records = data.Meetings.Where(x => x.State != "cancelled" && x.Marks.Any(mark => mark.Student == id))
                .OrderBy(x => x.Date).ThenBy(x => x.From).ThenBy(x => x.Id)
                .Select(x =>
                {
                    var mark = x.Marks.Single(mark => mark.Student == id);
                    return new { x.Id, x.Date, x.Group, x.Course, mark = IsRecitation(data, x) ? mark with { Readings = [], Practice = null } : mark };
                }).ToArray();
            var memorization = Catalog.Mushaf.Track();
            var baseline = memorization.Add(student.Baseline);
            var visible = full ? null : data.Meetings.Where(m => Filter(actor, people, m, today).Roster.Contains(id)).Select(m => m.Id).ToHashSet();
            var visibleMemorization = baseline;
            var progress = records.Select(r => new
            {
                r.Id, r.Date, r.Group, r.Course, r.mark,
                added = memorization.Add(r.mark.Readings.Where(x => x is { Kind: "new", Result: "passed" }).Select(x => x.Span))
            }).Where(r => visible is null || visible.Contains(r.Id)).ToArray();
            if (!full)
                visibleMemorization = new(baseline.Juz + progress.Sum(x => x.added.Juz), baseline.Pages + progress.Sum(x => x.added.Pages));
            return new
            {
                student, memorized = full ? memorization.Total : visibleMemorization, baseline, progress,
                enrollments = people.Enrollments.Where(x => x.Student == id && (full || people.GroupAt(x.Group, x.Start) is { } group && people.InScope(group.Unit, actor.Units))).Select(x => new { x.Group, x.Start, x.End, name = people.Groups.Find(g => g.Id == x.Group)?.Name }),
                grades = data.Grades.Where(x => x.Student == id && (full || data.Courses.Any(course => course.Id == x.Course && CanSeeCourse(actor, people, course)))).Select(x => new { x.Course, x.State, x.Date, name = data.Courses.Find(c => c.Id == x.Course)?.Name }),
                followUps = data.FollowUps.Where(x => x.Student == id && (full || people.GroupAt(x.Group, x.Due) is { } group && people.InScope(group.Unit, actor.Units))),
                competitions = data.Entries.Where(x => x.Student == id && (full || data.Competitions.Any(c => c.Id == x.Competition && c.Categories.Any(cat => cat.Id == x.Category && people.InScope(cat.Unit, actor.Units))))).Select(x => new { x.Competition, x.Category, x.Score, x.Rank, categoryName = data.Competitions.Find(c => c.Id == x.Competition)?.Categories.FirstOrDefault(cat => cat.Id == x.Category)?.Name, name = data.Competitions.Find(c => c.Id == x.Competition)?.Name })
            };
        });
        g.MapPost("/groups/{groupId:guid}/meeting", async (Guid center, Guid groupId, Dated input, State store, HttpContext http) =>
        {
            var (actor, info) = await Identity.Context(store, http, center);
            var catalog = await Catalog.Read(store);
            var people = await store.Read<PeopleData>(Module.People, center);
            var group = Rules.Found(people.GroupAt(groupId, input.Date));
            Rules.Require(actor.Admin || (actor.Teacher && group.Teacher == actor.Id), "هذه الشعبة خارج صلاحيتك.", 403);
            Rules.Require(group.Active(input.Date) && group.Days.Contains(input.Date.DayOfWeek), "لا توجد حصة مجدولة في هذا اليوم.");
            Rules.Require(input.Date <= Rules.Today(info.TimeZone).AddDays(60), "الجدولة متاحة حتى ٦٠ يومًا.");
            return await store.Change<EducationData, Meeting>(Module.Education, center, data =>
            {
                var existing = data.Meetings.Find(x => x.Group == groupId && x.Date == input.Date && x.Replaces is null);
                if (existing is not null) return existing;
                var meeting = ForGroup(group, input.Date, people, data, catalog);
                data.Meetings.Add(meeting);
                data.Audit.Log(actor, "meeting.create", meeting.Id);
                return meeting;
            });
        });
        g.MapPost("/meetings", async (Guid center, NewMeeting input, State store, HttpContext http) =>
        {
            var (actor, _) = await Identity.Context(store, http, center);
            var catalog = await Catalog.Read(store);
            var people = await store.Read<PeopleData>(Module.People, center);
            var staff = await Identity.Staff(store, center);
            Rules.Require(input.From < input.To && (input.Group.HasValue != input.Course.HasValue), "اختر شعبة أو دورة وموعدًا صالحًا.");
            return await store.Change<EducationData, Meeting>(Module.Education, center, data =>
            {
                var group = input.Group is Guid groupId ? Rules.Found(people.GroupAt(groupId, input.Date)) : null;
                var course = input.Course is Guid courseId ? Rules.Found(data.Courses.Find(x => x.Id == courseId)) : null;
                Rules.Require(actor.Admin || (actor.Teacher && course?.Owner == actor.Id), "ليس لديك صلاحية لجدولة هذا اللقاء.", 403);
                var type = Types(data, course, catalog).FirstOrDefault(x => x.Key == input.Kind);
                Rules.Require(type != null, "نوع اللقاء غير متاح لهذه الدورة.");
                var practiceBy = type!.Practice ? input.PracticeBy : input.LessonBy;
                var teachers = new[] { input.AttendanceBy, input.LessonBy, practiceBy }.Distinct().ToArray();
                Rules.Require(teachers.All(id => staff.Any(x => x.Id == id && x.Active && x.Roles.Contains("teacher")) &&
                    (course is null || course.Teachers.Contains(id))), "اختر المعلّمين المعتمدين لهذا اللقاء.");
                var roster = group is not null ? people.Enrollments.Where(x => x.Group == group.Id && x.Active(input.Date)).Select(x => x.Student).Distinct().ToArray()
                    : CourseStudents(course!, people, input.Date).ToArray();
                var meeting = Build(input.Group, input.Course, input.Date, input.From, input.To, input.Kind, input.AttendanceBy, input.LessonBy,
                    practiceBy, teachers, roster, group?.Unit, people.At(input.Date).Version);
                if (input.Replaces is Guid previous)
                {
                    var old = Rules.Found(data.Meetings.Find(x => x.Id == previous && x.Group == input.Group && x.Course == input.Course));
                    Rules.Require(old.State == "cancelled" && !data.Meetings.Any(x => x.Replaces == previous && x.State != "cancelled"), "اختر لقاءً ملغى دون تعويض سابق.");
                    meeting = meeting with { Replaces = previous };
                }
                data.Meetings.Add(meeting);
                data.Audit.Log(actor, "meeting.schedule", meeting.Id);
                return meeting;
            });
        });
        g.MapPut("/meetings/{id:guid}/schedule", async (Guid center, Guid id, Schedule input, State store, HttpContext http) =>
        {
            var (actor, _) = await Identity.Context(store, http, center);
            actor.Admin();
            var people = await store.Read<PeopleData>(Module.People, center);
            var staff = await Identity.Staff(store, center);
            return await store.Change<EducationData, Meeting>(Module.Education, center, data =>
            {
                var old = Rules.Found(data.Meetings.Find(x => x.Id == id));
                Rules.Require(old.Version == input.Version, "تغيّر اللقاء. حدّث الصفحة.", 409);
                var reason = Rules.Required(input.Reason, 500);
                Rules.Require(input.Cancel || (old.State == "open" && old.Marks.All(x => x.Status is null && x.Readings.Length == 0) && string.IsNullOrWhiteSpace(old.Lesson)
                        && input.From < input.To && staff.Any(x => x.Id == input.Teacher && x.Active && x.Roles.Contains("teacher"))),
                    "يمكن إعادة الجدولة قبل الرصد. استخدم الإلغاء والتعويض بعد الرصد.");
                var group = old.Group is Guid groupId ? people.GroupAt(groupId, input.Date) : null;
                var updated = input.Cancel ? old with { State = "cancelled", Version = old.Version + 1 }
                    : old with { Date = input.Date, From = input.From, To = input.To, Teachers = [input.Teacher], AttendanceBy = input.Teacher,
                        LessonBy = input.Teacher, PracticeBy = input.Teacher, Version = old.Version + 1, RuleVersion = people.At(input.Date).Version,
                        Roster = group is not null ? people.Enrollments.Where(x => x.Group == group.Id && x.Active(input.Date)).Select(x => x.Student).Distinct().ToArray() : old.Roster };
                if (!input.Cancel) updated = updated with { Marks = updated.Roster.Select(x => new Mark(x, null, null, [], null)).ToArray() };
                data.Meetings.Upsert(x => x.Id == id, updated);
                data.Audit.Log(actor, input.Cancel ? "meeting.cancel" : "meeting.reschedule", id, reason);
                return updated;
            });
        });
        g.MapGet("/meetings/{id:guid}", async (Guid center, Guid id, State store, HttpContext http) =>
        {
            var (actor, info) = await Identity.Context(store, http, center);
            var catalog = await Catalog.Read(store);
            var people = await store.Read<PeopleData>(Module.People, center);
            var data = await store.Read<EducationData>(Module.Education, center);
            var meeting = Rules.Found(data.Meetings.Find(x => x.Id == id));
            Rules.Require(VisibleMeeting(actor, people, meeting), "اللقاء خارج صلاحيتك.", 403);
            meeting = Filter(actor, people, meeting, Rules.Today(info.TimeZone));
            var course = data.Courses.Find(c => c.Id == meeting.Course);
            if (course?.Type == "recitation") meeting = meeting with
            {
                Kind = TajweedKind(meeting.Kind, catalog),
                Marks = meeting.Marks.Select(x => x with { Readings = [], Practice = null }).ToArray()
            };
            return new { meeting, students = people.Students.Where(x => meeting.Roster.Contains(x.Id)).Select(x => new { x.Id, x.Name, x.Number }),
                types = Types(data, course, catalog) };
        });
        g.MapPut("/meetings/{id:guid}", async (Guid center, Guid id, SaveMeeting input, State store, HttpContext http) =>
        {
            var (actor, info) = await Identity.Context(store, http, center);
            var catalog = await Catalog.Read(store);
            var people = await store.Read<PeopleData>(Module.People, center);
            return await store.Change<EducationData, Meeting>(Module.Education, center, data =>
            {
                var old = Rules.Found(data.Meetings.Find(x => x.Id == id));
                Rules.Require(actor.Admin || (actor.Teacher && old.Teachers.Contains(actor.Id)), "لا يمكنك تعديل هذا اللقاء.", 403);
                Rules.Require(old.Version == input.Version, "عدّل شخص آخر هذا الكشف. حدّثه قبل الحفظ.", 409);
                Rules.Require(old.State != "cancelled", "اللقاء ملغى.");
                var rule = people.Rules.Find(x => x.Version == old.RuleVersion) ?? people.At(old.Date);
                var cutoff = Rules.Instant(old.Date, old.To, info.TimeZone).AddHours(rule.CloseHours);
                Rules.Require(actor.Admin || DateTimeOffset.UtcNow <= cutoff, "انتهت مهلة الرصد. تواصل مع المدير.", 403);
                var mayMark = actor.Admin || old.AttendanceBy == actor.Id;
                var mayTeach = actor.Admin || old.LessonBy == actor.Id;
                var recitation = IsRecitation(data, old);
                var type = Rules.Found(Types(data, data.Courses.Find(c => c.Id == old.Course), catalog).FirstOrDefault(x => x.Key == (recitation ? TajweedKind(old.Kind, catalog) : old.Kind)));
                var mayPractice = type.Practice && (actor.Admin || old.PracticeBy == actor.Id);
                Rules.Require(!recitation || input.Marks.All(x => x.Practice is null && x.Readings.Length == 0), "لقاءات التجويد ترصد الحضور والدرس النظري أو العملي.");
                Rules.Require(input.Marks.Select(x => x.Student).Distinct().Count() == input.Marks.Length && input.Marks.All(x => old.Roster.Contains(x.Student)), "كشف الطلاب غير صالح.");
                var submitted = input.Marks.ToDictionary(x => x.Student);
                var marks = old.Marks.Select(previous =>
                {
                    if (!submitted.TryGetValue(previous.Student, out var next)) return previous;
                    if (mayMark) Rules.Require(next.Status is null or "present" or "absent" or "excused", "حالة الحضور غير صحيحة.");
                    if (mayPractice)
                    {
                        Rules.Require(next.Practice is null or "done" or "skip" or "optional", "حالة التسميع غير صحيحة.");
                        Rules.Require(next.Readings.Length <= 500 && next.Readings.All(x => x.Kind is "new" or "review" && x.Result is "passed" or "repeat"), "راجع التسميع.");
                        foreach (var reading in next.Readings)
                            if (!previous.Readings.Contains(reading)) catalog.Validate(reading.Span);
                        if (next.Practice == "done") Rules.Require(next.Readings.Length > 0, "أضف مقطع تسميع للطالب.");
                        if (next.Practice == "skip") Rules.Required(next.Note, 500);
                    }
                    return new Mark(previous.Student, mayMark ? next.Status : previous.Status,
                        mayPractice ? next.Practice : previous.Practice, mayPractice ? next.Readings : previous.Readings, mayPractice ? next.Note : previous.Note);
                }).ToArray();
                var lesson = mayTeach ? input.Lesson.Trim() : old.Lesson;
                var lessonCourse = mayTeach ? input.LessonCourse : old.LessonCourse;
                Rules.Require(lesson.Length <= 10000, "اختصر نص الدرس.");
                if (lessonCourse.HasValue) Rules.Require(data.Courses.Any(x => x.Id == lessonCourse &&
                    (x.Id == old.Course || x.Id == old.LessonCourse ||
                        (x.Type != "recitation" && old.Group.HasValue && x.Groups.Contains(old.Group.Value)))), "الدورة غير متاحة لهذا اللقاء.");
                var complete = marks.All(x => x.Status is not null && (!type.Practice || x.Status != "present" || x.Practice is not null)) &&
                    (!type.Lesson || lesson.Length > 0);
                Rules.Require(!input.Finalize || complete, type.Practice ? "استكمل بيانات الحضور والدرس والتسميع قبل الاعتماد." : "استكمل بيانات الحضور والدرس قبل الاعتماد.");
                var revised = old.State == "final";
                var reason = revised ? Rules.Required(input.Reason, 500) : null;
                Rules.Require(!revised || complete, "يجب أن يظل الكشف مكتملًا بعد التصحيح.");
                var updated = old with { Marks = marks, Lesson = lesson, LessonCourse = lessonCourse, State = input.Finalize || revised ? "final" : "open", Version = old.Version + 1 };
                data.Meetings.Upsert(x => x.Id == id, updated);
                data.Audit.Log(actor, revised ? "meeting.correct" : "meeting.record", id, reason);
                return updated;
            });
        });
        g.MapPut("/settings", async (Guid center, MeetingSettings input, State store, HttpContext http) =>
        {
            var (actor, _) = await Identity.Context(store, http, center, configuration: true);
            var catalog = await Catalog.Read(store);
            actor.Admin();
            Rules.Require(input.Levels.Length is > 0 and <= 20 && input.Types.Length is > 0 and <= 20 &&
                input.Types.Select(x => x.Key).Distinct().Count() == input.Types.Length, "حدّد المستويات وأنواع اللقاءات.");
            foreach (var level in input.Levels) Rules.Required(level, 60);
            foreach (var type in input.Types) { Rules.Required(type.Key, 40); Rules.Required(type.Name, 60); }
            return await store.Change<EducationData, MeetingSettings>(Module.Education, center, data =>
            {
                var previous = Catalog.Settings(data, catalog).Types;
                Rules.Require(data.Meetings.All(m => IsRecitation(data, m) || input.Types.Contains(previous.First(x => x.Key == m.Kind))) &&
                    data.Courses.All(c => c.Level is null || input.Levels.Contains(c.Level)), "الأنواع والمستويات المستخدمة في السجلات تبقى معتمدة. أضف نوعًا أو مستوى جديدًا.");
                data.Settings = input;
                data.Audit.Log(actor, "education.settings", center);
                return input;
            });
        });
        Courses.Map(g);
        Notifications.Map(g);
    }
    public static Meeting ForGroup(Group group, DateOnly day, PeopleData people, EducationData data, PlatformCatalog catalog)
    {
        var roster = people.Enrollments.Where(x => x.Group == group.Id && x.Active(day)).Select(x => x.Student).Distinct().ToArray();
        var type = Catalog.Settings(data, catalog).Types.First();
        return Build(group.Id, null, day, group.From, group.To, type.Key, group.Teacher, group.Teacher, group.Teacher,
            [group.Teacher], roster, group.Unit, people.At(day).Version);
    }
    private static Meeting Build(Guid? group, Guid? course, DateOnly date, TimeOnly from, TimeOnly to, string kind, Guid attendance, Guid lesson, Guid practice, Guid[] teachers, Guid[] roster, Guid? unit, Guid rule) =>
        new(Guid.NewGuid(), group, course, date, from, to, kind, "open", attendance, lesson, practice, teachers, roster, "",
            roster.Select(x => new Mark(x, null, null, [], null)).ToArray(), 1, unit, RuleVersion: rule);
    public record Dated(DateOnly Date);
    public record NewMeeting(Guid? Group, Guid? Course, DateOnly Date, TimeOnly From, TimeOnly To, string Kind, Guid AttendanceBy, Guid LessonBy, Guid PracticeBy, Guid? Replaces);
    public record Schedule(int Version, bool Cancel, DateOnly Date, TimeOnly From, TimeOnly To, Guid Teacher, string Reason);
    public record SaveMeeting(int Version, Mark[] Marks, string Lesson, Guid? LessonCourse, bool Finalize, string? Reason);
}

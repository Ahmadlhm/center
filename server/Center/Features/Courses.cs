using Center.Domain;
using Center.Infrastructure;

namespace Center.Features;

public static class Courses
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapPost("/commissions", async (Guid center, CommissionInput input, State store, HttpContext http) =>
        {
            var (actor, _) = await Identity.Context(store, http, center);
            actor.Admin();
            var people = await store.Read<PeopleData>(Module.People, center);
            var staff = await Identity.Staff(store, center);
            Rules.Require(input.Groups.Length > 0 && input.Groups.All(x => people.Groups.Any(y => y.Id == x)), "اختر الشعب المعنية.");
            Rules.Require(staff.Any(x => x.Active && x.Id == input.Teacher && x.Roles.Contains("teacher")), "اختر معلّمًا نشطًا.");
            return await store.Change<EducationData, Commission>(Module.Education, center, data =>
            {
                var commission = new Commission(Guid.NewGuid(), Rules.Required(input.Title), input.Teacher, input.Groups.Distinct().ToArray(), "open");
                data.Commissions.Add(commission);
                Notifications.Add(data, [input.Teacher], $"تكليف بإنشاء دورة: {commission.Title}", "courses");
                data.Audit.Log(actor, "course.commission", commission.Id);
                return commission;
            });
        });
        g.MapPut("/courses/{id:guid}", async (Guid center, Guid id, CourseInput input, State store, HttpContext http) =>
        {
            var (actor, _) = await Identity.Context(store, http, center);
            var people = await store.Read<PeopleData>(Module.People, center);
            var staff = await Identity.Staff(store, center);
            Rules.Require(input.Type is "private" or "central" or "recitation" && input.Status is "active" or "closed", "اختر نوع الدورة وحالتها.");
            Rules.Require(input.Groups.All(x => people.Groups.Any(y => y.Id == x)) && input.Students.All(x => people.Students.Any(y => y.Id == x)), "راجع شعب الدورة وطلابها.");
            return await store.Change<EducationData, Course>(Module.Education, center, data =>
            {
                var existing = data.Courses.Find(x => x.Id == id);
                var commission = data.Commissions.Find(x => x.Id == input.Commission);
                var owner = existing?.Owner ?? (actor.Admin ? input.Teachers.FirstOrDefault() : actor.Id);
                Rules.Require(actor.Admin || (actor.Teacher && owner == actor.Id), "ليس لديك صلاحية تعديل الدورة.", 403);
                Rules.Require(existing is null || (existing.Type == input.Type && existing.Commission == input.Commission), "نوع الدورة والتكليف ثابتان بعد الإنشاء.");
                var groupIds = input.Groups.Distinct().ToArray();
                if (input.Type == "private")
                {
                    Rules.Require(groupIds.Length == 1 && (actor.Admin || people.Groups.Any(x => x.Id == groupIds[0] && x.Teacher == actor.Id)),
                        "الدورة الخاصة مرتبطة بشعبة واحدة من شعبك.");
                    Rules.Require(input.Students.Length == 0, "يُحسب المشاركون في الدورة الخاصة من كشف الشعبة.");
                }
                if (input.Type == "central" && !actor.Admin)
                {
                    Rules.Require(commission is not null && commission.Teacher == actor.Id && (existing is not null || commission.State == "open") &&
                        groupIds.SequenceEqual(commission.Groups) && input.Students.Length == 0, "اختر تكليفًا إداريًا صالحًا.", 403);
                }
                if (input.Type == "recitation")
                {
                    Rules.Require((data.Settings ?? Rules.DefaultTeaching).Levels.Contains(input.Level), "اختر مستوى التلاوة.");
                    Rules.Require(actor.Admin || (existing is null
                        ? commission is { State: "open" } && commission.Teacher == actor.Id && groupIds.SequenceEqual(commission.Groups) && input.Students.Length == 0
                        : existing.Groups.SequenceEqual(groupIds) && existing.Students.SequenceEqual(input.Students)), "يحدد المدير نطاق دورة التلاوة والمشاركين.", 403);
                }
                var requested = input.Teachers.Distinct().ToArray();
                Rules.Require(requested.Length is 1 or 2 && requested.Contains(owner) &&
                    requested.All(id => staff.Any(x => x.Id == id && x.Active && x.Roles.Contains("teacher"))),
                    "اختر معلّمًا واحدًا أو معلّمين، بينهما معلّم الدورة الأساسي.");
                Rules.Require(input.Criterion is "manual" or "complete", "اختر معيار الاجتياز.");
                var teachers = actor.Admin ? requested : existing?.Teachers ?? [];
                var course = new Course(id, Rules.Required(input.Name), input.Type, input.Type == "recitation" ? input.Level : null,
                    owner, teachers, groupIds, input.Students.Distinct().ToArray(), input.Status, commission?.Id, input.Criterion);
                data.Courses.Upsert(x => x.Id == id, course);
                var pending = data.CourseTeacherRequests.Find(x => x.Course == id);
                if (actor.Admin && (existing == null || !requested.ToHashSet().SetEquals(existing.Teachers)))
                {
                    data.CourseTeacherRequests.RemoveAll(x => x.Course == id);
                    Notifications.Add(data, requested.Except(existing?.Teachers ?? []), $"أُسندت إليك دورة «{course.Name}».", Route(course));
                    if (pending != null && !requested.Contains(pending.RequestedBy))
                        Notifications.Add(data, [pending.RequestedBy], $"حُدّث إسناد دورة «{course.Name}» من الإدارة.", Route(course));
                }
                else if (!actor.Admin && !requested.ToHashSet().SetEquals(teachers) && (pending == null || !requested.ToHashSet().SetEquals(pending.Teachers)))
                {
                    data.CourseTeacherRequests.Upsert(x => x.Course == id, new(Guid.NewGuid(), id, actor.Id, requested, DateTimeOffset.UtcNow));
                    Notifications.Add(data, staff.Where(x => x.Active && x.Roles.Contains("admin")).Select(x => x.Id),
                        $"طلب إسناد معلّمين لدورة «{course.Name}».", Route(course));
                }
                else if (!actor.Admin && requested.ToHashSet().SetEquals(teachers))
                    data.CourseTeacherRequests.RemoveAll(x => x.Course == id);
                if (commission != null) data.Commissions.Upsert(x => x.Id == commission.Id, commission with { State = "used" });
                data.Audit.Log(actor, "course.save", id);
                return course;
            });
        });
        g.MapPost("/courses/{id:guid}/teachers/decision", async (Guid center, Guid id, TeacherDecision input, State store, HttpContext http) =>
        {
            var (actor, _) = await Identity.Context(store, http, center);
            actor.Admin();
            var staff = await Identity.Staff(store, center);
            return await store.Change<EducationData, Course>(Module.Education, center, data =>
            {
                var course = Rules.Found(data.Courses.Find(x => x.Id == id));
                var request = data.CourseTeacherRequests.Find(x => x.Course == id && x.Id == input.Request);
                Rules.Require(request != null, "تغيّر طلب الإسناد أو تمت مراجعته. حدّث الصفحة.", 409);
                var reason = input.Approve ? null : Rules.Required(input.Reason, 500);
                if (input.Approve)
                {
                    Rules.Require(request!.Teachers.All(id => staff.Any(x => x.Id == id && x.Active && x.Roles.Contains("teacher"))),
                        "أحد المعلّمين المقترحين غير نشط.");
                    course = course with { Teachers = request.Teachers };
                    data.Courses.Upsert(x => x.Id == id, course);
                }
                var recipients = input.Approve ? request!.Teachers.Append(request.RequestedBy) : [request!.RequestedBy];
                Notifications.Add(data, recipients,
                    input.Approve ? $"اعتمدت الإدارة إسناد دورة «{course.Name}»." : $"رفضت الإدارة إسناد دورة «{course.Name}». {reason}",
                    Route(course));
                data.CourseTeacherRequests.Remove(request);
                data.Audit.Log(actor, input.Approve ? "course.teachers.approved" : "course.teachers.rejected", id, reason);
                return course;
            });
        });
        g.MapGet("/courses/{id:guid}", async (Guid center, Guid id, State store, HttpContext http) =>
        {
            var (actor, info) = await Identity.Context(store, http, center);
            var people = await store.Read<PeopleData>(Module.People, center);
            var data = await store.Read<EducationData>(Module.Education, center);
            var course = Rules.Found(data.Courses.Find(x => x.Id == id));
            Rules.Require(Education.CanSeeCourse(actor, people, course), "الدورة خارج صلاحيتك.", 403);
            var today = Rules.Today(info.TimeZone);
            var members = Education.CourseStudents(course, people, today);
            members.UnionWith(data.Meetings.Where(x => x.Course == id).SelectMany(x => x.Roster));
            if (!actor.Admin && !course.Teachers.Contains(actor.Id)) members.RemoveWhere(x => !People.CanSeeStudent(actor, people, x, today));
            return new
            {
                course = course with { Students = course.Students.Where(members.Contains).ToArray() },
                teacherRequest = actor.Admin || course.Owner == actor.Id ? data.CourseTeacherRequests.Find(x => x.Course == id) : null,
                students = people.Students.Where(x => members.Contains(x.Id)).Select(x => new { x.Id, x.Name, x.Number }),
                grades = data.Grades.Where(x => x.Course == id && members.Contains(x.Student)),
                meetings = data.Meetings.Where(x => x.Course == id || x.LessonCourse == id).Select(x => Education.Filter(actor, people, x, today))
            };
        });
        g.MapPut("/courses/{id:guid}/students/{student:guid}/grade", async (Guid center, Guid id, Guid student, GradeInput input, State store, HttpContext http) =>
        {
            var (actor, info) = await Identity.Context(store, http, center);
            var people = await store.Read<PeopleData>(Module.People, center);
            var day = Rules.Today(info.TimeZone);
            return await store.Change<EducationData, Grade>(Module.Education, center, data =>
            {
                var course = Rules.Found(data.Courses.Find(x => x.Id == id));
                Rules.Require(actor.Admin || (actor.Teacher && course.Teachers.Contains(actor.Id)), "لا يمكنك اعتماد هذه النتيجة.", 403);
                Rules.Require(Education.CourseStudents(course, people, day).Contains(student) ||
                    data.Meetings.Any(x => x.Course == id && x.Roster.Contains(student)), "الطالب غير مسجّل في الدورة.");
                Rules.Require(input.State is "registered" or "completed" or "passed", "اختر حالة النتيجة.");
                if (input.State == "passed" && course.Criterion == "complete")
                {
                    var meetings = data.Meetings.Where(x => x.Course == id && x.State != "cancelled" && x.Roster.Contains(student)).ToArray();
                    Rules.Require(meetings.Length > 0 && meetings.All(x => x.State == "final" && x.Marks.Any(m => m.Student == student && m.Status == "present")), "يتطلب الاجتياز حضور جميع اللقاءات المعتمدة.");
                }
                var grade = new Grade(id, student, input.State, day, actor.Id);
                data.Grades.Upsert(x => x.Course == id && x.Student == student, grade);
                data.Audit.Log(actor, "course.grade", student);
                return grade;
            });
        });
        g.MapPut("/followups/{id:guid}", async (Guid center, Guid id, FollowInput input, State store, HttpContext http) =>
        {
            var (actor, info) = await Identity.Context(store, http, center);
            var people = await store.Read<PeopleData>(Module.People, center);
            var group = Rules.Found(people.Groups.Find(x => x.Id == input.Group));
            Rules.Require(actor.Admin || (actor.Teacher && group.Teacher == actor.Id), "لا يمكنك تعديل هذه المتابعة.", 403);
            Rules.Require(people.Enrollments.Any(x => x.Student == input.Student && x.Group == input.Group && x.Active(Rules.Today(info.TimeZone))), "الطالب غير مسجّل في هذه الشعبة.");
            return await store.Change<EducationData, FollowUp>(Module.Education, center, data =>
            {
                var existing = data.FollowUps.Find(x => x.Id == id);
                Rules.Require(existing == null || (existing.Student == input.Student && existing.Group == input.Group), "المتابعة تخص طالبًا آخر.", 403);
                var follow = new FollowUp(id, input.Student, input.Group, Rules.Required(input.Text, 2000), input.Due, input.Done, actor.Id);
                data.FollowUps.Upsert(x => x.Id == id, follow);
                data.Audit.Log(actor, "followup.save", id);
                return follow;
            });
        });
        g.MapPut("/competitions/{id:guid}", async (Guid center, Guid id, ContestInput input, State store, HttpContext http) =>
        {
            var (actor, _) = await Identity.Context(store, http, center);
            actor.Admin();
            var people = await store.Read<PeopleData>(Module.People, center);
            var categories = input.Categories.Select(x => x with { Name = Rules.Required(x.Name) }).ToArray();
            Rules.Require(categories.Length > 0 && categories.Select(x => x.Id).Distinct().Count() == categories.Length &&
                categories.All(x => (x.Unit is null || people.Units.Any(u => u.Id == x.Unit)) &&
                    x.MinAge is null or >= 0 and <= 120 && x.MaxAge is null or >= 0 and <= 120 && (!x.MinAge.HasValue || !x.MaxAge.HasValue || x.MinAge <= x.MaxAge)), "راجع فئات المسابقة وشروطها.");
            return await store.Change<EducationData, Competition>(Module.Education, center, data =>
            {
                var existing = data.Competitions.Find(x => x.Id == id);
                Rules.Require(existing is null || !data.Entries.Any(x => x.Competition == id) ||
                    (existing.Date == input.Date && existing.Multiple == input.Multiple && existing.Categories.SequenceEqual(categories)),
                    "قواعد المسابقة ثابتة بعد تسجيل المشاركين.");
                var item = new Competition(id, Rules.Required(input.Name), input.Date, input.Multiple, categories);
                data.Competitions.Upsert(x => x.Id == id, item);
                data.Audit.Log(actor, "competition.save", id);
                return item;
            });
        });
        g.MapPut("/competitions/{id:guid}/entries", async (Guid center, Guid id, EntryInput input, State store, HttpContext http) =>
        {
            var (actor, info) = await Identity.Context(store, http, center);
            var people = await store.Read<PeopleData>(Module.People, center);
            Rules.Require(actor.Admin || People.FullStudent(actor, people, input.Student, Rules.Today(info.TimeZone)),
                "يمكنك إسناد المسابقة لطلاب شعبك فقط.", 403);
            Rules.Require(actor.Admin || (input.Score is null && input.Rank is null), "رصد الدرجات والمراكز من صلاحيات الإدارة.", 403);
            var staff = actor.Admin ? [] : await Identity.Staff(store, center);
            return await store.Change<EducationData, ContestEntry>(Module.Education, center, data =>
            {
                var contest = Rules.Found(data.Competitions.Find(x => x.Id == id));
                var category = Rules.Found(contest.Categories.FirstOrDefault(x => x.Id == input.Category));
                var student = Rules.Found(people.Students.Find(x => x.Id == input.Student));
                var age = student.Birth is DateOnly birth ? Rules.Age(birth, contest.Date) : -1;
                Rules.Require((category.MinAge is null && category.MaxAge is null) ||
                    (age >= 0 && age >= (category.MinAge ?? 0) && age <= (category.MaxAge ?? 120)), "العمر خارج شروط الفئة أو تاريخ الميلاد غير مسجّل.");
                Rules.Require(category.Unit is null || people.Enrollments.Any(x => x.Student == student.Id && x.Active(contest.Date) &&
                    people.GroupAt(x.Group, contest.Date) is { } group && people.InScope(group.Unit, [category.Unit.Value])), "الطالب خارج الوحدة المؤهلة في تاريخ المسابقة.");
                Rules.Require(contest.Multiple || !data.Entries.Any(x => x.Competition == id && x.Student == student.Id && x.Category != category.Id), "يسمح للطالب بفئة واحدة.");
                Rules.Require(input.Score is null or >= 0 and <= 100 && input.Rank is null or >= 1, "الدرجة أو المركز غير صحيح.");
                var existing = data.Entries.Find(x => x.Competition == id && x.Category == category.Id && x.Student == student.Id);
                if (!actor.Admin && existing != null) return existing;
                var row = new ContestEntry(id, category.Id, student.Id, input.Score, input.Rank);
                data.Entries.Upsert(x => x.Competition == id && x.Category == category.Id && x.Student == student.Id, row);
                data.Audit.Log(actor, "competition.entry", student.Id);
                if (!actor.Admin)
                    Notifications.Add(data, staff.Where(x => x.Active && x.Roles.Contains("admin")).Select(x => x.Id),
                        $"أُضيف مشارك إلى «{contest.Name}» في فئة «{category.Name}».", "contests");
                return row;
            });
        });
    }
    public static string Route(Course course) => (course.Type == "recitation" ? "recitation-course/" : "course/") + course.Id;
    public record TeacherDecision(Guid Request, bool Approve, string? Reason);
    public record CommissionInput(string Title, Guid Teacher, Guid[] Groups);
    public record CourseInput(string Name, string Type, string? Level, Guid[] Teachers, Guid[] Groups, Guid[] Students, string Status, Guid? Commission, string Criterion = "manual");
    public record GradeInput(string State);
    public record FollowInput(Guid Student, Guid Group, string Text, DateOnly Due, bool Done);
    public record ContestInput(string Name, DateOnly Date, bool Multiple, Category[] Categories);
    public record EntryInput(Guid Student, Guid Category, decimal? Score, int? Rank);
}

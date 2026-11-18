using Center.Domain;
using Center.Features;

namespace Center.Infrastructure;

public static class Demo
{
    private static Guid Id(int value) => Guid.Parse($"cb94a59e-99ec-4c90-83a0-{value:x12}");
    private static readonly Guid Center = Identity.DemoCenter;
    private static readonly DateOnly Day = Rules.Today("Asia/Amman");
    private static readonly TimeOnly Start = new(16, 0);
    private static readonly TimeOnly End = new(17, 30);
    private static readonly string[] First = ["يوسف","معاذ","إبراهيم","محمد","عبدالله","عمر","زين","خالد","حمزة","آدم","زيد","أنس","يحيى","أحمد","علي","موسى","سعد","بلال","بكر","سليم"];
    private static readonly string[] Last = ["العلي","الخطيب","النجار","العبادي","أبو زيد","الحسن","الرحمن","الكيلاني","العمر","السالم"];
    private static Guid Teacher(int index) => index % 2 == 0 ? Identity.DemoTeacher : Identity.DemoSecondTeacher;
    private static readonly string[] Names = ["شعبة الفاروق","شعبة النور","شعبة الهدى","شعبة الإتقان","شعبة البيان","شعبة الفرقان","شعبة الهمّة","شعبة التقوى"];
    private static readonly int[] Units = [4,5,1,4,2,1,5,3];
    private static readonly int[] Sizes = [20,18,22,15,12,13,14,14];
    private static Guid GroupFor(int index)
    {
        for (var i = 0; i < Sizes.Length; i++)
        {
            if (index < Sizes[i]) return Id(20 + i);
            index -= Sizes[i];
        }
        throw new ArgumentOutOfRangeException(nameof(index));
    }
    public static async Task Initialize(State store)
    {
        if (store.Local(Module.People))
            await store.Change<PeopleData, bool>(Module.People, Center, data =>
            {
                if (data.Units.Any() || data.Students.Any()) return false;
                data.Units.AddRange([new(Id(1), "الحافظ الصغير", "قسم", null), new(Id(2), "النادي الصيفي", "قسم", null),
                    new(Id(3), "النادي الدائم", "قسم", null), new(Id(4), "صغار", "فرع", Id(3)), new(Id(5), "كبار", "فرع", Id(3))]);
                data.Periods.Add(new(Id(10), "الفترة الحالية", Day.AddDays(-60), Day.AddDays(90)));
                for (var i = 0; i < Names.Length; i++)
                {
                    var days = i < 3 ? new[] { Day.DayOfWeek, Day.AddDays(2).DayOfWeek } : new[] { Day.AddDays(1).DayOfWeek, Day.AddDays(3).DayOfWeek };
                    var group = new Group(Id(20 + i), Names[i], Id(Units[i]), Teacher(i), Id(10), Day.AddDays(-60), null, days, Start.AddMinutes(i * 15), End.AddMinutes(i * 15));
                    data.Groups.Add(group);
                    data.GroupHistory.Add(new(group, group.Start));
                }
                for (var i = 0; i < 128; i++)
                {
                    var student = new Student(Id(1000 + i), (1001 + i).ToString(), First[i % First.Length] + " " + Last[(i / First.Length + i) % Last.Length], Day.AddYears(i % 7 < 3 ? -9 : -13).AddDays(-i), "", [new(114, 1, 6)], null);
                    data.Students.Add(student);
                    data.Enrollments.Add(new(student.Id, GroupFor(i), Day.AddDays(-60), null));
                }
                data.Rules.Add(Rules.Default with { Latitude = 31.955, Longitude = 35.945, Radius = 150, Version = Id(90) });
                data.Policies.Add(new("يرصد المعلّم حضور طلابه في بداية اللقاء ويعتمد الكشف بعد انتهاء الدوام.", Day.AddDays(-60)));
                return true;
            });
        if (store.Local(Module.Education))
            await store.Change<EducationData, bool>(Module.Education, Center, data =>
            {
                if (data.Meetings.Count > 0 || data.Courses.Count > 0) return false;
                for (var offset = 0; offset < 7; offset++)
                {
                    var count = offset == 0 ? 3 : 3 + offset % 3;
                    for (var i = 0; i < count; i++)
                    {
                        var roster = Enumerable.Range(0, 128).Where(index => GroupFor(index) == Id(20 + i)).ToArray();
                        var marks = roster.Select((index, ordinal) => new Mark(Id(1000 + index),
                            offset == 0 ? i == 0 && ordinal < 14 ? "present" : null : (index + offset) % 13 == 0 ? "absent" : "present",
                            offset == 0 ? null : "done", offset > 0 && (ordinal + offset) % 4 == 0
                                ? [new(new(112 - offset, 1, 3), "new", "passed")] : [], null)).ToArray();
                        data.Meetings.Add(new(Id(100 + offset * 10 + i), Id(20 + i), null, Day.AddDays(-offset), Start.AddMinutes(i * 15), End.AddMinutes(i * 15), "mixed",
                            offset == 0 ? "open" : "final", Teacher(i), Teacher(i), Teacher(i), [Teacher(i)], marks.Select(x => x.Student).ToArray(),
                            offset == 0 ? "" : "تسميع ومراجعة الحفظ", marks, 1, Id(Units[i]), RuleVersion: Id(90)));
                    }
                }
                data.Courses.Add(new(Id(500), "مدخل إلى أحكام التجويد", "recitation", "التمهيدية", Identity.DemoTeacher,
                    [Identity.DemoTeacher, Identity.DemoSecondTeacher], [Id(20), Id(21)], [Id(1000), Id(1001), Id(1020)], "active", null));
                data.Grades.Add(new(Id(500), Id(1000), "passed", Day.AddDays(-2), Identity.DemoTeacher));
                data.Competitions.Add(new(Id(700), "المسابقة القرآنية السنوية", Day.AddDays(35), true,
                    [new(Id(701), "الحافظ الصغير", Id(1), 0, 10), new(Id(702), "الفئة الكبرى", null, null, null)]));
                return true;
            });
        if (store.Local(Module.Work))
            await store.Change<WorkData, bool>(Module.Work, Center, data =>
            {
                if (data.Tasks.Count > 0 || data.CheckIns.Count > 0) return false;
                data.CheckIns.Add(new(Id(100), Identity.DemoTeacher, "manual", Rules.Instant(Day, Start, "Asia/Amman"), "review", "بيانات تجريبية", null));
                data.Tasks.Add(new(Id(800), Identity.DemoTeacher, "إعداد خطة مراجعة", "إعداد خطة لمراجعة الحفظ للأسبوع القادم.", Day.AddDays(2), Id(20), null, "open", null));
                data.Tasks.Add(new(Id(801), Identity.DemoSecondTeacher, "متابعة الحضور", "مراجعة كشف حصة هذا الأسبوع.", Day.AddDays(-1), Id(21), null, "open", null));
                return true;
            });
    }
}

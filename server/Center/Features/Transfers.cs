using System.Diagnostics;
using System.Globalization;
using System.Text;
using Center.Domain;
using Center.Infrastructure;
using ClosedXML.Excel;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Net.Http.Headers;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace Center.Features;

public static class Transfers
{
    public static void MapImports(WebApplication app)
    {
        var g = app.MapGroup("/api/centers/{center:guid}/import");
        g.MapPost("/preview", async (Guid center, State store, HttpContext http, IConfiguration config) =>
        {
            var (actor, _) = await Identity.Context(store, http, center);
            actor.Admin();
            var contentType = MediaTypeHeaderValue.Parse(http.Request.ContentType ?? "");
            Rules.Require(contentType.MediaType == "multipart/form-data" && contentType.Boundary.HasValue, "اختر ملفًا للاستيراد.");
            var reader = new MultipartReader(HeaderUtilities.RemoveQuotes(contentType.Boundary).ToString(), http.Request.Body) { BodyLengthLimit = 10 * 1024 * 1024 };
            var part = await reader.ReadNextSectionAsync(http.RequestAborted);
            Rules.Require(part is not null && ContentDispositionHeaderValue.TryParse(part.ContentDisposition, out _), "اختر ملفًا للاستيراد.");
            var name = ContentDispositionHeaderValue.Parse(part!.ContentDisposition!).FileNameStar.ToString();
            if (name.Length == 0) name = HeaderUtilities.RemoveQuotes(ContentDispositionHeaderValue.Parse(part.ContentDisposition!).FileName).ToString();
            await using var file = new MemoryStream();
            await part.Body.CopyToAsync(file, http.RequestAborted);
            People.StudentInput[] rows;
            if (name.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase))
            {
                using var archive = new System.IO.Compression.ZipArchive(file, System.IO.Compression.ZipArchiveMode.Read, leaveOpen: true);
                Rules.Require(archive.Entries.Count <= 3000 && archive.Entries.Sum(x => x.Length) <= 64L * 1024 * 1024, "ملف Excel يتجاوز سعة المعالجة.");
                file.Position = 0;
                using var book = new XLWorkbook(file);
                var sheet = book.Worksheets.First();
                rows = sheet.RowsUsed().Skip(1).Take(500).Select(row => new People.StudentInput(
                    row.Cell(1).GetFormattedString(), row.Cell(2).GetFormattedString(), ParseDate(row.Cell(3).GetFormattedString()),
                    row.Cell(4).GetFormattedString(), null, null)).ToArray();
            }
            else
            {
                var bytes = file.ToArray();
                using var deadline = CancellationTokenSource.CreateLinkedTokenSource(http.RequestAborted);
                deadline.CancelAfter(TimeSpan.FromSeconds(90));
                var token = deadline.Token;
                var pages = new List<byte[]>();
                if (bytes.AsSpan().StartsWith("%PDF-"u8))
                {
                    var info = Encoding.UTF8.GetString(await Run(config["CENTER_PDFINFO"] ?? "pdfinfo", ["-"], bytes, token));
                    var pageLine = info.Split('\n').FirstOrDefault(x => x.StartsWith("Pages:"));
                    int count = 0;
                    Rules.Require(pageLine != null && int.TryParse(pageLine.Split(':')[1].Trim(), out count) && count is >= 1 and <= 8, "ارفع ملف PDF من ١ إلى ٨ صفحات.");
                    for (var page = 1; page <= count; page++)
                        pages.Add(await Run(config["CENTER_PDFTOPPM"] ?? "pdftoppm", ["-f", page.ToString(), "-l", page.ToString(), "-scale-to", "2200", "-png", "-"], bytes, token));
                }
                else
                {
                    Rules.Require(bytes.AsSpan().StartsWith(new byte[] { 137, 80, 78, 71 }) || bytes.AsSpan().StartsWith(new byte[] { 255, 216, 255 }), "ارفع Excel أو PDF أو صورة PNG/JPEG.");
                    pages.Add(bytes);
                }
                var output = new StringBuilder();
                foreach (var page in pages)
                    output.AppendLine(Encoding.UTF8.GetString(await Run(config["CENTER_TESSERACT"] ?? "tesseract", ["stdin", "stdout", "-l", "ara+eng", "--psm", "6"], page, token)));
                rows = ParseText(output.ToString());
            }
            var people = await store.Read<PeopleData>(Module.People, center);
            return new
            {
                batch = Guid.NewGuid(),
                rows = rows.Select(x => new { row = x, possible = people.Students.Where(p => p.Number == x.Number || p.Name.Trim() == x.Name.Trim()).Select(p => p.Name).Take(3) })
            };
        });
        g.MapPost("/commit", async (Guid center, CommitInput input, State store, HttpContext http) =>
        {
            var (actor, info) = await Identity.Context(store, http, center);
            actor.Admin();
            Rules.Require(input.Batch != Guid.Empty && input.Rows.All(x => x.Birth is null || x.Birth <= Rules.Today(info.TimeZone)), "راجع تاريخ الميلاد.");
            var payload = new People.ImportCommit(actor, input.Batch, input.Rows);
            var ids = store.Local(Module.People) ? await People.Commit(store, payload) : await store.Send<Guid[]>(Module.People, "/internal/import", payload);
            return new { count = ids.Length };
        });
    }
    private static DateOnly? ParseDate(string value) => DateOnly.TryParse(value, CultureInfo.InvariantCulture, out var day) ? day : null;
    private static People.StudentInput[] ParseText(string text) => text.Split('\n', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
        .Where(x => !x.Contains("اسم الطالب") && !x.Contains("تاريخ الميلاد")).Take(500).Select(line =>
        {
            var cells = System.Text.RegularExpressions.Regex.Split(line, @"\s{2,}|[|\t]+").Select(x => x.Trim()).Where(x => x.Length > 0).ToArray();
            var name = cells.FirstOrDefault(x => x.Any(c => c is >= '\u0600' and <= '\u06ff' && char.IsLetter(c))) ?? line;
            var number = cells.FirstOrDefault(x => x.All(char.IsDigit)) ?? "";
            var birth = cells.Select(ParseDate).FirstOrDefault(x => x.HasValue);
            var contact = cells.FirstOrDefault(x => x != number && x.All(c => char.IsDigit(c) || c is '+' or '-') && x.Length >= 8) ?? "";
            return new People.StudentInput(number, name, birth, contact, null, null);
        }).ToArray();
    private static async Task<byte[]> Run(string name, string[] args, byte[] input, CancellationToken cancel)
    {
        var start = new ProcessStartInfo(name) { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
        foreach (var arg in args) start.ArgumentList.Add(arg);
        Process process;
        try { process = Process.Start(start)!; }
        catch (System.ComponentModel.Win32Exception) { throw new DomainException("أداة OCR غير متاحة في هذه البيئة. شغّل خدمة الاستيراد عبر Docker.", 503); }
        using (process)
        {
            using var registration = cancel.Register(() => { try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { } });
            var stderr = process.StandardError.ReadToEndAsync(cancel);
            async Task Feed()
            {
                await process.StandardInput.BaseStream.WriteAsync(input, cancel);
                process.StandardInput.Close();
            }
            using var result = new MemoryStream();
            await Task.WhenAll(Feed(), process.StandardOutput.BaseStream.CopyToAsync(result, cancel), process.WaitForExitAsync(cancel), stderr);
            Rules.Require(process.ExitCode == 0, "تعذّرت قراءة المستند. جرّب صورة أوضح.");
            return result.ToArray();
        }
    }

    public static void MapReports(WebApplication app)
    {
        app.MapGet("/api/centers/{center:guid}/education/report", async (Guid center, HttpContext http, State store,
            string? kind, DateOnly? from, DateOnly? to, Guid? unit, Guid? group, Guid? course, string? format) =>
        {
            var (actor, info) = await Identity.Context(store, http, center);
            Rules.Require(actor.Admin || actor.Manager || actor.Teacher, "ليس لديك صلاحية التقارير.", 403);
            var p = store.Read<PeopleData>(Module.People, center);
            var e = store.Read<EducationData>(Module.Education, center);
            var w = store.Read<WorkData>(Module.Work, center);
            var s = Identity.Staff(store, center);
            await Task.WhenAll(p, e, w, s);
            var people = await p;
            var education = await e;
            var work = await w;
            var staff = await s;
            string Person(Guid id) => people.Students.Find(x => x.Id == id)?.Name ?? "—";
            string Teacher(Guid id) => staff.FirstOrDefault(x => x.Id == id)?.Name ?? "—";
            var end = to ?? Rules.Today(info.TimeZone);
            var start = from ?? end.AddDays(-29);
            Rules.Require(start <= end && end.DayNumber - start.DayNumber <= 3660, "راجع الفترة المحددة.");
            Rules.Require(unit is null || people.Units.Any(x => x.Id == unit), "الوحدة غير متاحة.");
            bool Matching(Group x) => (group is null || x.Id == group) && (unit is null || people.InScope(x.Unit, [unit.Value]));
            var groups = people.Groups.Select(x => people.GroupAt(x.Id, end)).OfType<Group>().Where(x => x.Active(end) && actor.CanSee(people, x) && Matching(x)).ToArray();
            var enrollments = people.Enrollments.Where(x => x.Active(end) && groups.Any(y => y.Id == x.Group)).ToArray();
            var meetings = education.Meetings.Where(x => x.Date >= start && x.Date <= end && x.State != "cancelled" &&
                Education.VisibleMeeting(actor, people, x) && (group is null || x.Group == group) &&
                (course is null || x.Course == course || x.LessonCourse == course) &&
                (unit is null || people.InScope(x.Unit, [unit.Value]))).ToArray();
            var filtered = meetings.Select(x => Education.Filter(actor, people, x, end)).ToArray();
            var rows = new List<string[]>();
            string[] columns;
            string title;
            if (kind == "counts")
            {
                title = "أعداد الشعب والطلاب";
                columns = ["الشعبة", "المعلّم", "عدد الطلاب"];
                rows.AddRange(groups.Select(x => new[] { x.Name, Teacher(x.Teacher), enrollments.Count(y => y.Group == x.Id).ToString() }));
                rows.Add(["إجمالي الشعب", "", groups.Length.ToString()]);
                rows.Add(["إجمالي الطلاب الفريدين", "", enrollments.Select(x => x.Student).Distinct().Count().ToString()]);
                rows.Add(["إجمالي التسجيلات", "", enrollments.Length.ToString()]);
            }
            else if (kind == "courses")
            {
                title = "الدورات والتلاوة";
                columns = ["الدورة", "المستوى", "الحالة", "لقاءات في الفترة", "أكمل", "اجتاز"];
                foreach (var item in education.Courses.Where(x => Education.CanSeeCourse(actor, people, x) &&
                    (course is null || x.Id == course) && (group is null || x.Groups.Contains(group.Value)) &&
                    (unit is null || x.Groups.Any(id => people.GroupAt(id, end) is { } target && people.InScope(target.Unit, [unit.Value])))))
                {
                    var grades = education.Grades.Where(x => x.Course == item.Id && x.Date >= start && x.Date <= end &&
                        (actor.Admin || item.Teachers.Contains(actor.Id) || People.CanSeeStudent(actor, people, x.Student, end))).ToArray();
                    rows.Add([item.Name, item.Level ?? "—", item.Status == "active" ? "قائمة" : "منتهية",
                        filtered.Count(x => x.Course == item.Id || x.LessonCourse == item.Id).ToString(),
                        grades.Count(x => x.State == "completed").ToString(), grades.Count(x => x.State == "passed").ToString()]);
                }
            }
            else if (kind == "work")
            {
                title = "متابعة المعلّمين";
                columns = ["التاريخ", "المعلّم", "الدوام", "الحضور المرصود", "الدرس", "التسميع"];
                foreach (var meeting in filtered)
                    foreach (var teacher in meeting.Teachers.Where(t => actor.Admin || actor.Manager || t == actor.Id))
                    {
                        var check = work.CheckIns.Find(x => x.Teacher == teacher && x.Meeting == meeting.Id);
                        if (actor.Manager && !actor.Admin && !people.InScope(meeting.Unit, actor.Units) && teacher != actor.Id) continue;
                        rows.Add([Rules.Iso(meeting.Date), Teacher(teacher), check?.State switch
                        {
                            "verified" => TimeZoneInfo.ConvertTime(check.At, TimeZoneInfo.FindSystemTimeZoneById(info.TimeZone)).ToString("HH:mm"),
                            "manual" => "معتمد يدويًا", "absent" => "غائب", "pending" => "قيد المراجعة", _ => "غير مرصود"
                        }, teacher == meeting.AttendanceBy ? $"{meeting.Marks.Count(x => x.Status != null)}/{meeting.Roster.Length}" : "—",
                        teacher == meeting.LessonBy ? (meeting.Lesson.Length > 0 ? "مسجّل" : "—") : "—",
                        teacher == meeting.PracticeBy ? meeting.Marks.Count(x => x.Practice is "done" or "skip").ToString() : "—"]);
                    }
                foreach (var task in work.Tasks.Where(x => x.Due >= start && x.Due <= end && (actor.Admin || x.Teacher == actor.Id ||
                    (actor.Manager && people.Groups.Any(g => g.Id == x.Group && people.InScope(g.Unit, actor.Units)))) &&
                    (group is null || x.Group == group) && (course is null || x.Course == course)))
                    rows.Add([Rules.Iso(task.Due), Teacher(task.Teacher), "تكليف", task.Title, task.State switch
                    { "approved" => "معتمد", "submitted" => "مسلّم", "returned" => "للاستكمال", _ => task.Due < end ? "متأخر" : "مفتوح" }, "—"]);
            }
            else
            {
                title = "الحضور وإنجاز الحفظ";
                columns = ["الطالب", "حاضر", "غائب", "بعذر", "غير مرصود", "نسبة الحضور", "آيات جديدة", "مقاطع مراجعة"];
                var allowed = filtered.SelectMany(m => m.Roster.Select(id => (m.Id, id))).ToHashSet();
                var aggregate = new Dictionary<Guid, int[]>();
                var seen = people.Students.ToDictionary(x => x.Id, x => x.Baseline.SelectMany(Rules.Verses).ToHashSet());
                foreach (var m in education.Meetings.Where(x => x.Date <= end && x.State != "cancelled").OrderBy(x => x.Date).ThenBy(x => x.From).ThenBy(x => x.Id))
                    foreach (var mark in m.Marks)
                    {
                        if (!seen.TryGetValue(mark.Student, out var verses)) continue;
                        var newCount = mark.Readings.Where(x => x.Kind == "new" && x.Result == "passed").SelectMany(x => Rules.Verses(x.Span)).Count(verses.Add);
                        if (!allowed.Contains((m.Id, mark.Student))) continue;
                        if (!aggregate.TryGetValue(mark.Student, out var totals)) aggregate[mark.Student] = totals = new int[8];
                        var index = mark.Status switch { "present" => 0, "absent" => 1, "excused" => 2, _ => 3 };
                        totals[index]++;
                        var rule = people.Rules.Find(x => x.Version == m.RuleVersion) ?? people.At(m.Date);
                        if (index is 0 or 1 || (index == 2 && rule.CountExcused)) totals[4]++;
                        totals[5] += newCount;
                        totals[6] += mark.Readings.Count(x => x.Kind == "review");
                    }
                rows.AddRange(aggregate.OrderBy(x => Person(x.Key)).Select(x => new[] { Person(x.Key), x.Value[0].ToString(), x.Value[1].ToString(),
                    x.Value[2].ToString(), x.Value[3].ToString(), x.Value[4] == 0 ? "—" : $"{x.Value[0] * 100.0 / x.Value[4]:0.0}%",
                    x.Value[5].ToString(), x.Value[6].ToString() }));
            }
            var subtitle = $"{info.Name} | {(kind == "counts" ? Rules.Iso(end) : $"{Rules.Iso(start)} إلى {Rules.Iso(end)}")}";
            var notes = kind switch
            {
                "counts" => "الطالب يُحسب مرة واحدة على مستوى التقرير.",
                "work" => "الدوام المسجّل يعبّر عن وقت الإثبات أو المراجعة.",
                "courses" => "تُحسب نتائج الدورات في الفترة حسب تاريخ اعتماد النتيجة.",
                _ => "معدل الحضور من الحالات المحسومة حسب قاعدة المركز السارية."
            };
            var updated = DateTimeOffset.UtcNow;
            if (format is "xlsx" or "pdf")
                await store.Change<EducationData, bool>(Module.Education, center, data => { data.Audit.Log(actor, "report.export", kind ?? "learning"); return true; });
            if (format == "xlsx")
            {
                using var book = new XLWorkbook();
                var sheet = book.AddWorksheet("التقرير");
                sheet.RightToLeft = true;
                sheet.Cell(1, 1).Value = title;
                sheet.Cell(2, 1).Value = subtitle;
                sheet.Cell(3, 1).Value = notes;
                sheet.Cell(4, 1).Value = updated.ToString("u");
                for (var i = 0; i < columns.Length; i++) sheet.Cell(6, i + 1).Value = columns[i];
                for (var row = 0; row < rows.Count; row++)
                    for (var cell = 0; cell < rows[row].Length; cell++) sheet.Cell(row + 7, cell + 1).Value = rows[row][cell];
                sheet.Range(6, 1, 6, columns.Length).Style.Font.Bold = true;
                sheet.Columns().AdjustToContents();
                using var buffer = new MemoryStream();
                book.SaveAs(buffer);
                return Results.File(buffer.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "center-report.xlsx");
            }
            if (format == "pdf")
            {
                QuestPDF.Settings.License = LicenseType.Community;
                var document = Document.Create(root => root.Page(page =>
                {
                    page.Size(PageSizes.A4.Landscape());
                    page.Margin(26);
                    page.ContentFromRightToLeft();
                    page.DefaultTextStyle(x => x.FontFamily("Noto Sans Arabic", "Arial").FontSize(10));
                    page.Header().Column(column =>
                    {
                        column.Item().Text(title).FontSize(22).Bold();
                        column.Item().Text(subtitle);
                        column.Item().Text(notes);
                    });
                    page.Content().PaddingTop(14).Table(table =>
                    {
                        table.ColumnsDefinition(def => { foreach (var _ in columns) def.RelativeColumn(); });
                        table.Header(header => { foreach (var column in columns) header.Cell().Background("#e9f2eb").Padding(5).Text(column).Bold(); });
                        foreach (var row in rows) foreach (var cell in row) table.Cell().BorderBottom(0.5f).BorderColor("#dce6e0").Padding(5).Text(cell);
                    });
                    page.Footer().Text(updated.ToString("u")).FontSize(8);
                }));
                return Results.File(document.GeneratePdf(), "application/pdf", "center-report.pdf");
            }
            return Results.Ok(new { title, subtitle, notes, columns, rows, updated });
        });
    }
    public record CommitInput(Guid Batch, People.StudentInput[] Rows);
}

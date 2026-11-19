using System.Globalization;

namespace Center.Domain;

public sealed class DomainException(string message, int status = 400) : Exception(message)
{
    public int Status { get; } = status;
}
public static class Rules
{
    public static readonly Rule Default = new(DateOnly.MinValue, 1, true, 24, 15, 30, null, null, 100, 50);
    public static void Require(bool valid, string message, int status = 400)
    {
        if (!valid) throw new DomainException(message, status);
    }
    public static T Found<T>(T? value) where T : class => value ?? throw new DomainException("السجل غير متاح.", 404);
    public static void Admin(this Actor actor) => Require(actor.Admin, "هذه العملية متاحة لمدير المركز.", 403);
    public static void Platform(this Actor actor) => Require(actor.Platform, "هذه العملية متاحة لإدارة المنصة.", 403);
    public static string Required(string? value, int max = 150)
    {
        value = value?.Trim();
        Require(!string.IsNullOrWhiteSpace(value) && value.Length <= max, $"أدخل قيمة بطول لا يتجاوز {max} حرفًا.");
        return value!;
    }
    public static DateOnly Today(string zone) => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, TimeZoneInfo.FindSystemTimeZoneById(zone)).DateTime);
    public static DateTimeOffset Instant(DateOnly day, TimeOnly time, string zone)
    {
        var local = day.ToDateTime(time);
        var tz = TimeZoneInfo.FindSystemTimeZoneById(zone);
        Require(!tz.IsInvalidTime(local), "هذا الوقت غير متاح في المنطقة الزمنية.");
        return new(local, tz.GetUtcOffset(local));
    }
    public static Rule At(this PeopleData data, DateOnly date) => data.Rules.Where(x => x.Effective <= date).OrderBy(x => x.Effective).LastOrDefault() ?? Default;
    public static Group? GroupAt(this PeopleData data, Guid id, DateOnly date) =>
        data.GroupHistory.Where(x => x.Group.Id == id && x.Effective <= date).OrderBy(x => x.Effective).LastOrDefault()?.Group
        ?? (data.GroupHistory.Any(x => x.Group.Id == id) ? null : data.Groups.Find(x => x.Id == id));
    public static bool Active(this Enrollment e, DateOnly day) => e.Start <= day && (e.End is null || day < e.End);
    public static bool Active(this Group g, DateOnly day) => g.Start <= day && (g.End is null || day < g.End);
    public static bool InScope(this PeopleData data, Guid? unit, Guid[] roots, DateOnly? day = null)
    {
        var seen = new HashSet<Guid>();
        for (var current = unit; current.HasValue && seen.Add(current.Value);)
        {
            if (roots.Contains(current.Value)) return true;
            var placement = day.HasValue ? data.UnitPlacements.Where(x => x.Unit == current && x.Effective <= day.Value)
                .OrderByDescending(x => x.Effective).FirstOrDefault() : null;
            current = placement != null ? placement.Parent : data.Units.Find(x => x.Id == current)?.Parent;
        }
        return false;
    }
    public static bool CanSee(this Actor actor, PeopleData data, Group group) =>
        actor.Admin || (actor.Teacher && group.Teacher == actor.Id) || (actor.Manager && data.InScope(group.Unit, actor.Units));
    public static bool CanSee(this Actor actor, PeopleData data, Meeting meeting) =>
        actor.Admin || (actor.Teacher && meeting.Teachers.Contains(actor.Id)) || (actor.Manager && data.InScope(meeting.Unit, actor.Units));
    public static int Age(DateOnly birth, DateOnly day) => day.Year - birth.Year - (birth.AddYears(day.Year - birth.Year) > day ? 1 : 0);
    public static IEnumerable<int> Verses(VerseSpan span)
    {
        Require(span.Surah is >= 1 and <= 114 && span.From >= 1 && span.To >= span.From && span.To <= 999,
            "نطاق الآيات غير صحيح.");
        return Enumerable.Range(span.From, span.To - span.From + 1).Select(number => span.Surah * 1000 + number);
    }
    public static string OriginalEmail(string value) => new System.Net.Mail.MailAddress(Required(value)).Address.ToLowerInvariant();
    public static string Iso(DateOnly value) => value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    public static void Upsert<T>(this List<T> list, Predicate<T> predicate, T record)
    {
        var index = list.FindIndex(predicate);
        if (index < 0) list.Add(record);
        else list[index] = record;
    }
    public static void Log(this List<Audit> audit, Actor actor, string action, object target, string? reason = null) =>
        audit.Add(new(DateTimeOffset.UtcNow, actor.Id, action, target.ToString()!, reason));
}

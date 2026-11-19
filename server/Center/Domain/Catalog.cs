namespace Center.Domain;

public record SurahReference(int Number, string Name, int Verses);
public record QuranPartition(int Number, string Name, int Surah, int Ayah);
public record TeachingChapter(int Number, string Title);
public record RecitationLevel(string Key, string Name, string Book, int[] Chapters, int[] RequiredJuz, int ChooseJuz, int[] ExcludedJuz, bool Active = true);
public record ContestLevel(Guid Id, string Name, int? MinAge, int? MaxAge);
public record CatalogSettings(int Version, string[] UnitKinds, TeachingChapter[] Chapters, RecitationLevel[] Levels,
    ContestLevel[] ContestLevels, MeetingType[] TajweedTypes, MeetingType[] GroupTypes);
public record PlatformCatalog(int Version, string Mushaf, SurahReference[] Surahs, QuranPartition[] Juz, QuranPartition[] Pages,
    string[] UnitKinds, TeachingChapter[] Chapters, RecitationLevel[] Levels, ContestLevel[] ContestLevels,
    MeetingType[] TajweedTypes, MeetingType[] GroupTypes)
{
    public void Validate(VerseSpan span)
    {
        var surah = Surahs.FirstOrDefault(x => x.Number == span.Surah);
        Rules.Require(surah != null && span.From >= 1 && span.To >= span.From && span.To <= surah.Verses, "نطاق الآيات غير صحيح.");
    }
}
public record CourseCurriculum(string Level, string Book, TeachingChapter[] Chapters, int[] RequiredJuz, int ChooseJuz, int[] ExcludedJuz);
public record CourseChoice(Guid Course, Guid Student, int[] Juz);

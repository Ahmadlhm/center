using System.Text.Json;
using Center.Domain;
using Center.Infrastructure;

namespace Center.Features;

public static class Catalog
{
    public static PlatformCatalog Seed()
    {
        using var stream = typeof(Catalog).Assembly.GetManifestResourceStream("Center.Data.catalog.json")
            ?? throw new InvalidOperationException("Catalog seed missing.");
        return JsonSerializer.Deserialize<PlatformCatalog>(stream, State.Json)!;
    }

    public static async Task<PlatformCatalog> Read(State store)
    {
        if (!store.Local(Module.Identity)) return await store.Send<PlatformCatalog>(Module.Identity, "/internal/catalog", new { });
        return (await store.Read<IdentityData>(Module.Identity, Guid.Empty)).Catalog ?? Seed();
    }

    public static MeetingSettings Settings(EducationData education, PlatformCatalog catalog) =>
        education.Settings ?? new(catalog.Levels.Where(l => l.Active).Select(l => l.Key).ToArray(), catalog.GroupTypes);

    public static CourseCurriculum? Curriculum(PlatformCatalog catalog, string? key)
    {
        var level = catalog.Levels.FirstOrDefault(l => l.Key == key);
        return level is null ? null : new(level.Name, level.Book, level.Chapters.Select(number => catalog.Chapters.Single(x => x.Number == number)).ToArray(),
            level.RequiredJuz, level.ChooseJuz, level.ExcludedJuz);
    }

    public static void Map(WebApplication app)
    {
        app.MapPost("/internal/catalog", (State store) => Read(store));
        app.MapGet("/api/auth/catalog", async (HttpContext http, State store) =>
        {
            await Identity.AccountReady(store, http);
            return await Read(store);
        });
        app.MapPut("/api/auth/catalog", async (PlatformCatalog input, HttpContext http, State store) =>
        {
            var actor = await Identity.PlatformActor(store, http);
            var snapshot = await Read(store);
            Validate(input, snapshot);
            return await store.Change<IdentityData, PlatformCatalog>(Module.Identity, Guid.Empty, data =>
            {
                var version = data.Catalog?.Version ?? snapshot.Version;
                Rules.Require(input.Version == version, "تغيّر الكتالوج. حدّث الصفحة قبل الحفظ.", 409);
                var updated = input with { Version = version + 1 };
                data.Catalog = updated;
                data.Audit.Log(actor, "catalog.update", updated.Version);
                return updated;
            });
        });
    }

    private static void Validate(PlatformCatalog catalog, PlatformCatalog previous)
    {
        Rules.Required(catalog.Mushaf);
        Rules.Require(catalog.Surahs.Select(x => x.Number).Order().SequenceEqual(previous.Surahs.Select(x => x.Number).Order()),
            "تحافظ السور على أرقامها المرجعية.");
        foreach (var surah in catalog.Surahs)
        {
            Rules.Required(surah.Name, 70);
            Rules.Require(surah.Verses is > 0 and <= 999, "عدد الآيات غير صالح.");
        }
        Partitions(catalog.Juz, catalog, previous.Juz);
        Partitions(catalog.Pages, catalog, previous.Pages);
        Rules.Require(catalog.UnitKinds.Length is > 0 and <= 100 && catalog.UnitKinds.Distinct().Count() == catalog.UnitKinds.Length, "راجع أنواع الوحدات.");
        foreach (var kind in catalog.UnitKinds) Rules.Required(kind, 50);
        Rules.Require(catalog.Chapters.Length <= 200 && catalog.Chapters.Select(x => x.Number).Distinct().Count() == catalog.Chapters.Length, "أرقام الفصول يجب أن تكون فريدة.");
        foreach (var chapter in catalog.Chapters)
        {
            Rules.Require(chapter.Number > 0, "رقم الفصل غير صالح.");
            Rules.Required(chapter.Title, 300);
        }
        Rules.Require(catalog.Levels.Length is > 0 and <= 100 && catalog.Levels.Any(x => x.Active) &&
            catalog.Levels.Select(x => x.Key).Distinct().Count() == catalog.Levels.Length &&
            previous.Levels.All(x => catalog.Levels.Any(y => y.Key == x.Key)), "أوقف المستوى القديم من خيار نشط للاحتفاظ بمرجعه.");
        var juz = catalog.Juz.Select(x => x.Number).ToHashSet();
        foreach (var level in catalog.Levels)
        {
            Rules.Required(level.Key, 80);
            Rules.Required(level.Name, 80);
            Rules.Required(level.Book, 150);
            Rules.Require(level.Chapters.Distinct().Count() == level.Chapters.Length &&
                level.Chapters.All(n => catalog.Chapters.Any(x => x.Number == n)), "مستوى مرتبط بفصل غير موجود أو مكرر.");
            var excluded = level.RequiredJuz.Concat(level.ExcludedJuz).ToHashSet();
            Rules.Require(level.RequiredJuz.Distinct().Count() == level.RequiredJuz.Length && level.ExcludedJuz.Distinct().Count() == level.ExcludedJuz.Length &&
                excluded.IsSubsetOf(juz) && level.ChooseJuz >= 0 && level.ChooseJuz <= juz.Count - excluded.Count, "راجع مقرر الحفظ والأجزاء المستثناة.");
        }
        Rules.Require(catalog.ContestLevels.Length <= 100 && catalog.ContestLevels.Select(x => x.Id).Distinct().Count() == catalog.ContestLevels.Length,
            "قوالب المسابقة يجب أن تكون فريدة.");
        foreach (var level in catalog.ContestLevels)
        {
            Rules.Required(level.Name);
            Rules.Require(level.MinAge is null or >= 0 and <= 120 && level.MaxAge is null or >= 0 and <= 120 &&
                (!level.MinAge.HasValue || !level.MaxAge.HasValue || level.MinAge <= level.MaxAge), "حدود عمر الفئة غير صالحة.");
        }
        MeetingTypes(catalog.TajweedTypes, previous.TajweedTypes, tajweed: true);
        MeetingTypes(catalog.GroupTypes, previous.GroupTypes, tajweed: false);
    }

    private static void Partitions(QuranPartition[] partitions, PlatformCatalog catalog, QuranPartition[] previous)
    {
        var sorted = partitions.OrderBy(x => x.Number).ToArray();
        Rules.Require(sorted.Select(x => x.Number).SequenceEqual(previous.Select(x => x.Number).Order()), "حافظ على الترقيم المرجعي للأجزاء والصفحات.");
        var last = 0;
        foreach (var item in sorted)
        {
            Rules.Required(item.Name, 70);
            catalog.Validate(new(item.Surah, item.Ayah, item.Ayah));
            var reference = item.Surah * 1000 + item.Ayah;
            Rules.Require(reference > last && (last != 0 || reference == 1001), "يجب أن تتتابع بدايات الأجزاء والصفحات حسب ترتيب المصحف.");
            last = reference;
        }
    }

    private static void MeetingTypes(MeetingType[] types, MeetingType[] previous, bool tajweed)
    {
        Rules.Require(types.Length is > 0 and <= 30 && types.Select(x => x.Key).Distinct().Count() == types.Length &&
            previous.All(x => types.Any(y => y.Key == x.Key)) && (!tajweed || types.All(x => x.Lesson && !x.Practice)),
            "حافظ على رموز اللقاءات المستخدمة. لقاء التجويد يعتمد الدرس والحضور.");
        foreach (var t in types)
        {
            Rules.Required(t.Key, 40);
            Rules.Required(t.Name, 60);
        }
    }
}

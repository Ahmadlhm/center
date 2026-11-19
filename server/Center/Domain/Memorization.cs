namespace Center.Domain;

public record struct MemorizationAmount(int Juz, int Pages);

public sealed class MushafLayout
{
    private readonly Dictionary<int, (int Juz, int Page)> verseLocations = [];
    private readonly int[] juzLengths;
    private readonly int[] pageLengths;

    public MushafLayout(PlatformCatalog reference)
    {
        var juzStarts = Starts(reference.Juz);
        var pageStarts = Starts(reference.Pages);
        juzLengths = new int[juzStarts.Length];
        pageLengths = new int[pageStarts.Length];
        var juz = 0;
        var page = 0;
        foreach (var surah in reference.Surahs.OrderBy(x => x.Number))
            for (var ayah = 1; ayah <= surah.Verses; ayah++)
            {
                var verse = surah.Number * 1000 + ayah;
                if (juz + 1 < juzStarts.Length && verse == juzStarts[juz + 1]) juz++;
                if (page + 1 < pageStarts.Length && verse == pageStarts[page + 1]) page++;
                verseLocations.Add(verse, (juz, page));
                juzLengths[juz]++;
                pageLengths[page]++;
            }
    }

    private static int[] Starts(QuranPartition[] partitions) =>
        partitions.OrderBy(x => x.Number).Select(x => x.Surah * 1000 + x.Ayah).ToArray();

    public Progress Track() => new(this);

    public sealed class Progress(MushafLayout layout)
    {
        private readonly int[] juzCounts = new int[layout.juzLengths.Length];
        private readonly int[] pageCounts = new int[layout.pageLengths.Length];
        private readonly HashSet<int> seen = [];

        public MemorizationAmount Total { get; private set; }

        public MemorizationAmount Add(IEnumerable<VerseSpan> spans)
        {
            var juz = 0;
            var pages = 0;
            foreach (var verse in spans.SelectMany(Rules.Verses))
            {
                if (!layout.verseLocations.TryGetValue(verse, out var location) || !seen.Add(verse)) continue;
                if (++juzCounts[location.Juz] == layout.juzLengths[location.Juz]) juz++;
                if (++pageCounts[location.Page] == layout.pageLengths[location.Page]) pages++;
            }
            Total = new(Total.Juz + juz, Total.Pages + pages);
            return new(juz, pages);
        }
    }
}

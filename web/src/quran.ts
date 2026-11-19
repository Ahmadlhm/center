import type { MeetingType, Span } from "./model";

export type SurahReference = { number: number; name: string; verses: number };
export type Partition = {
  number: number;
  name: string;
  surah: number;
  ayah: number;
};
export type Chapter = { number: number; title: string };
export type RecitationLevel = {
  key: string;
  name: string;
  book: string;
  chapters: number[];
  requiredJuz: number[];
  chooseJuz: number;
  excludedJuz: number[];
  active: boolean;
};
export type ContestLevel = {
  id: string;
  name: string;
  minAge: number | null;
  maxAge: number | null;
};
export type Catalog = {
  version: number;
  mushaf: string;
  surahs: SurahReference[];
  juz: Partition[];
  pages: Partition[];
  unitKinds: string[];
  chapters: Chapter[];
  levels: RecitationLevel[];
  contestLevels: ContestLevel[];
  tajweedTypes: MeetingType[];
  groupTypes: MeetingType[];
};
export type Curriculum = {
  level: string;
  book: string;
  chapters: Chapter[];
  requiredJuz: number[];
  chooseJuz: number;
  excludedJuz: number[];
};

export function expanded(
  catalog: Catalog,
  source: "surah" | "juz" | "pages",
  first: number,
  last = first,
): Span[] {
  const surahs = [...catalog.surahs].sort((a, b) => a.number - b.number);
  const list =
    source === "juz"
      ? catalog.juz
      : source === "pages"
        ? catalog.pages
        : surahs;
  const numbering = [...list].sort((a, b) => a.number - b.number);
  const start = numbering.find((x) => x.number === first);
  const end = numbering.findIndex((x) => x.number === last);
  if (!start || end < 0 || last < first) return [];
  if (!("ayah" in start))
    return surahs
      .filter((s) => s.number >= first && s.number <= last)
      .map((s) => ({ surah: s.number, from: 1, to: s.verses }));
  const next = numbering[end + 1];
  return surahs.flatMap((s) => {
    if (
      s.number < start.surah ||
      (next && "ayah" in next && s.number > next.surah)
    )
      return [];
    const from = s.number === start.surah ? start.ayah : 1;
    const to =
      next && "ayah" in next && s.number === next.surah
        ? next.ayah - 1
        : s.verses;
    return to < from ? [] : [{ surah: s.number, from, to }];
  });
}
export const levelName = (catalog: Catalog, key: string | null) =>
  catalog.levels.find((x) => x.key === key)?.name ?? key;

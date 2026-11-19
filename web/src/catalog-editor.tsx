import { useState } from "react";
import { api, message, uid } from "./model";
import type { Catalog, RecitationLevel } from "./quran";
import {
  Add,
  Button,
  CardHead,
  Checks,
  Empty,
  ErrorBox,
  Field,
  Select,
  Table,
  Tabs,
} from "./ui";

export function CatalogEditor({
  catalog,
  saved,
}: {
  catalog: Catalog;
  saved: (next: Catalog) => void;
}) {
  const [draft, setDraft] = useState(catalog);
  const [tab, setTab] = useState("levels");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function change<
    K extends Exclude<
      keyof Catalog,
      "version" | "mushaf" | "surahs" | "juz" | "pages"
    >,
  >(key: K, value: Catalog[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const next = await api<Catalog>("/api/auth/catalog", "PUT", draft);
      setDraft(next);
      saved(next);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  const dirty = draft !== catalog;
  const updateLevel = (row: RecitationLevel, patch: Partial<RecitationLevel>) =>
    change(
      "levels",
      draft.levels.map((x) => (x.key === row.key ? { ...x, ...patch } : x)),
    );
  const chapters = draft.chapters.map((x) => ({
    value: String(x.number),
    name: x.number + " · " + x.title,
  }));
  const parts = draft.juz.map((x) => ({
    value: String(x.number),
    name: x.name,
  }));
  return (
    <>
      <section className="card">
        <CardHead title="كتالوج المنصة" desc={"نسخة " + draft.version}>
          <div className="actions">
            {dirty && (
              <Button
                kind="outline"
                onClick={() => {
                  setDraft(catalog);
                  setError("");
                }}
              >
                تراجع عن التعديلات
              </Button>
            )}
            <Button disabled={!dirty || busy} onClick={() => void save()}>
              حفظ الكتالوج
            </Button>
          </div>
        </CardHead>
      </section>
      {error && <ErrorBox>{error}</ErrorBox>}
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "levels", name: "مناهج التلاوة" },
          { value: "chapters", name: "فصول المنير" },
          { value: "surahs", name: "السور والآيات" },
          { value: "juz", name: "الأجزاء" },
          { value: "pages", name: "صفحات المصحف" },
          { value: "contest", name: "مستويات المسابقة" },
          { value: "units", name: "أنواع الوحدات" },
          { value: "meetings", name: "أنواع اللقاءات" },
        ]}
      />
      {tab === "levels" && (
        <section className="card panel">
          <CardHead title="مستويات التلاوة">
            <Add
              onClick={() =>
                change("levels", [
                  ...draft.levels,
                  {
                    key: uid(),
                    name: "",
                    book: draft.levels[0]?.book ?? "",
                    chapters: [],
                    requiredJuz: [],
                    excludedJuz: [],
                    chooseJuz: 0,
                    active: true,
                  },
                ])
              }
            >
              إضافة مستوى
            </Add>
          </CardHead>
          <div className="catalog-stack">
            {draft.levels.map((row) => (
              <details className="catalog-editor-row" key={row.key}>
                <summary>
                  {row.name || "مستوى جديد"} {row.active ? "" : "· مؤرشف"}
                </summary>
                <div className="form-grid">
                  <Field label="اسم المستوى">
                    <input
                      value={row.name}
                      onChange={(e) =>
                        updateLevel(row, { name: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="الكتاب">
                    <input
                      value={row.book}
                      onChange={(e) =>
                        updateLevel(row, { book: e.target.value })
                      }
                    />
                  </Field>
                  <div className="field wide">
                    <span>الفصول المشمولة</span>
                    <Checks
                      options={chapters}
                      value={row.chapters.map(String)}
                      onChange={(values) =>
                        updateLevel(row, { chapters: values.map(Number) })
                      }
                    />
                  </div>
                  <div className="field wide">
                    <span>الأجزاء المطلوبة</span>
                    <Checks
                      options={parts}
                      value={row.requiredJuz.map(String)}
                      onChange={(values) =>
                        updateLevel(row, { requiredJuz: values.map(Number) })
                      }
                    />
                  </div>
                  <Field label="عدد الأجزاء التي يختارها الطالب">
                    <input
                      type="number"
                      min="0"
                      max="30"
                      value={row.chooseJuz}
                      onChange={(e) =>
                        updateLevel(row, { chooseJuz: +e.target.value })
                      }
                    />
                  </Field>
                  <label className="check-line">
                    <input
                      type="checkbox"
                      checked={row.active}
                      onChange={(e) =>
                        updateLevel(row, { active: e.target.checked })
                      }
                    />
                    مستوى نشط
                  </label>
                  {row.chooseJuz > 0 && (
                    <div className="field wide">
                      <span>الأجزاء المستثناة من الاختيار</span>
                      <Checks
                        options={parts}
                        value={row.excludedJuz.map(String)}
                        onChange={(values) =>
                          updateLevel(row, { excludedJuz: values.map(Number) })
                        }
                      />
                    </div>
                  )}
                </div>
              </details>
            ))}
          </div>
        </section>
      )}
      {tab === "chapters" && (
        <section className="card">
          <CardHead title="الفصول">
            <Add
              onClick={() =>
                change("chapters", [
                  ...draft.chapters,
                  {
                    number:
                      Math.max(0, ...draft.chapters.map((x) => x.number)) + 1,
                    title: "",
                  },
                ])
              }
            >
              إضافة فصل
            </Add>
          </CardHead>
          <Table headers={["الرقم", "العنوان", ""]}>
            {draft.chapters.map((row) => (
              <tr key={row.number}>
                <td>{row.number}</td>
                <td>
                  <input
                    aria-label={"عنوان الفصل " + row.number}
                    value={row.title}
                    onChange={(e) =>
                      change(
                        "chapters",
                        draft.chapters.map((x) =>
                          x.number === row.number
                            ? { ...x, title: e.target.value }
                            : x,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <Button
                    kind="outline"
                    disabled={draft.levels.some((x) =>
                      x.chapters.includes(row.number),
                    )}
                    onClick={() =>
                      change(
                        "chapters",
                        draft.chapters.filter((x) => x.number !== row.number),
                      )
                    }
                  >
                    إزالة
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        </section>
      )}
      {tab === "surahs" && <SurahTable catalog={catalog} />}
      {(tab === "juz" || tab === "pages") && (
        <PartitionTable key={tab} catalog={catalog} subject={tab} />
      )}
      {tab === "contest" && (
        <section className="card">
          <CardHead title="قوالب فئات المسابقة السنوية">
            <Add
              onClick={() =>
                change("contestLevels", [
                  ...draft.contestLevels,
                  { id: uid(), name: "", minAge: null, maxAge: null },
                ])
              }
            >
              إضافة مستوى
            </Add>
          </CardHead>
          {draft.contestLevels.length ? (
            <Table
              headers={["الفئة", "الحد الأدنى للعمر", "الحد الأعلى للعمر", ""]}
            >
              {draft.contestLevels.map((row) => {
                const patch = (p: Partial<typeof row>) =>
                  change(
                    "contestLevels",
                    draft.contestLevels.map((x) =>
                      x.id === row.id ? { ...x, ...p } : x,
                    ),
                  );
                return (
                  <tr key={row.id}>
                    <td>
                      <input
                        aria-label="اسم الفئة"
                        value={row.name}
                        onChange={(e) => patch({ name: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        aria-label="أقل عمر"
                        type="number"
                        min="0"
                        value={row.minAge ?? ""}
                        onChange={(e) =>
                          patch({
                            minAge: e.target.value ? +e.target.value : null,
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label="أعلى عمر"
                        type="number"
                        min="0"
                        value={row.maxAge ?? ""}
                        onChange={(e) =>
                          patch({
                            maxAge: e.target.value ? +e.target.value : null,
                          })
                        }
                      />
                    </td>
                    <td>
                      <Button
                        kind="outline"
                        onClick={() =>
                          change(
                            "contestLevels",
                            draft.contestLevels.filter((x) => x.id !== row.id),
                          )
                        }
                      >
                        إزالة
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </Table>
          ) : (
            <Empty />
          )}
        </section>
      )}
      {tab === "units" && (
        <section className="card panel">
          <Field label="أنواع الوحدات، نوع في كل سطر">
            <textarea
              rows={7}
              value={draft.unitKinds.join("\n")}
              onChange={(e) => change("unitKinds", e.target.value.split("\n"))}
            />
          </Field>
        </section>
      )}
      {tab === "meetings" && (
        <div className="catalog-stack">
          {(["groupTypes", "tajweedTypes"] as const).map((key) => (
            <section className="card" key={key}>
              <CardHead
                title={
                  key === "groupTypes" ? "لقاءات الشعب" : "لقاءات دورات التلاوة"
                }
              >
                <Add
                  onClick={() =>
                    change(key, [
                      ...draft[key],
                      { key: uid(), name: "", lesson: true, practice: false },
                    ])
                  }
                >
                  إضافة نوع
                </Add>
              </CardHead>
              <Table
                headers={[
                  "نوع اللقاء",
                  ...(key === "groupTypes" ? ["درس مطلوب", "تسميع مطلوب"] : []),
                ]}
              >
                {draft[key].map((row) => {
                  const patch = (p: Partial<typeof row>) =>
                    change(
                      key,
                      draft[key].map((x) =>
                        x.key === row.key ? { ...x, ...p } : x,
                      ),
                    );
                  return (
                    <tr key={row.key}>
                      <td>
                        <input
                          aria-label="اسم نوع اللقاء"
                          value={row.name}
                          onChange={(e) => patch({ name: e.target.value })}
                        />
                      </td>
                      {key === "groupTypes" && (
                        <>
                          <td>
                            <input
                              aria-label="درس مطلوب"
                              type="checkbox"
                              checked={row.lesson}
                              onChange={(e) =>
                                patch({ lesson: e.target.checked })
                              }
                            />
                          </td>
                          <td>
                            <input
                              aria-label="تسميع مطلوب"
                              type="checkbox"
                              checked={row.practice}
                              onChange={(e) =>
                                patch({ practice: e.target.checked })
                              }
                            />
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </Table>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function SurahTable({ catalog }: { catalog: Catalog }) {
  const [query, setQuery] = useState("");
  return (
    <section className="card">
      <CardHead title="السور وعدد الآيات" desc="مرجع ثابت للقراءة فقط">
        <input
          aria-label="بحث عن سورة"
          placeholder="اسم السورة أو رقمها"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </CardHead>
      <Table headers={["رقم السورة", "الاسم", "عدد الآيات"]}>
        {catalog.surahs
          .filter((x) => x.name.includes(query) || String(x.number) === query)
          .map((row) => (
            <tr key={row.number}>
              <td>{row.number}</td>
              <td>{row.name}</td>
              <td>{row.verses}</td>
            </tr>
          ))}
      </Table>
    </section>
  );
}

function PartitionTable({
  catalog,
  subject,
}: {
  catalog: Catalog;
  subject: "pages" | "juz";
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const list = catalog[subject].filter(
    (x) => x.name.includes(query) || String(x.number) === query,
  );
  return (
    <section className="card">
      <CardHead
        title={subject === "pages" ? "صفحات المصحف" : "أجزاء المصحف"}
        desc={catalog.mushaf + " · مرجع ثابت للقراءة فقط"}
      >
        <input
          aria-label="بحث بالاسم أو الرقم"
          placeholder="الاسم أو الرقم"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
      </CardHead>
      <Table headers={["الرقم", "الاسم", "سورة البداية", "الآية"]}>
        {list.slice(page * 20, (page + 1) * 20).map((row) => (
          <tr key={row.number}>
            <td>{row.number}</td>
            <td>{row.name}</td>
            <td>{catalog.surahs.find((x) => x.number === row.surah)?.name}</td>
            <td>{row.ayah}</td>
          </tr>
        ))}
      </Table>
      <div className="pager">
        <Button
          kind="outline"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          السابق
        </Button>
        <span>
          {page + 1} / {Math.max(1, Math.ceil(list.length / 20))}
        </span>
        <Button
          kind="outline"
          disabled={(page + 1) * 20 >= list.length}
          onClick={() => setPage(page + 1)}
        >
          التالي
        </Button>
      </div>
    </section>
  );
}

import { SpanInputs, SpanPicker } from "./span-picker";
import { useEffect, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronLeft,
  FileUp,
  FolderOpen,
  GraduationCap,
  Plus,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  active,
  api,
  date,
  fmt,
  go,
  groupOf,
  message,
  uid,
  type Context,
  type Mark,
  type Span,
  type Student,
} from "./model";
import {
  Add,
  Badge,
  Button,
  CardHead,
  Dialog,
  Empty,
  ErrorBox,
  Field,
  PageHead,
  SearchBox,
  Select,
  Table,
  Tabs,
  optional,
  options,
  val,
} from "./ui";
import { admin, editGroup, f, Summary } from "./learning";
import { Documents } from "./records";
export function Students({ c }: { c: Context }) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [modal, setModal] = useState(false);
  const [page, setPage] = useState(0);
  const list = c.people.students.filter(
    (x) =>
      (x.name.includes(query) || x.number.includes(query)) &&
      (!group ||
        c.people.enrollments.some(
          (e) =>
            x.id === e.student &&
            e.group === group &&
            active(e, c.people.today),
        )),
  );
  return (
    <>
      <PageHead title="الطلاب" desc="ملفات الطلاب وتسجيلاتهم وإنجازاتهم.">
        {admin(c) && (
          <>
            <Button kind="outline" onClick={() => go("import")}>
              <FileUp size={17} />
              استيراد كشف
            </Button>
            <Add onClick={() => setModal(true)}>إضافة طالب</Add>
          </>
        )}
      </PageHead>
      <div className="toolbar">
        <SearchBox
          value={query}
          onChange={(x) => {
            setQuery(x);
            setPage(0);
          }}
          placeholder="ابحث بالاسم أو رقم الطالب"
        />
        <Select
          options={options(c.people.groups)}
          value={group}
          onChange={(x) => {
            setGroup(x);
            setPage(0);
          }}
          placeholder="جميع الشعب"
        />
        <span className="toolbar-count">{fmt(list.length)} طالبًا</span>
      </div>
      <div className="card">
        {list.length ? (
          <>
            <Table
              headers={[
                "اسم الطالب",
                "رقم الطالب",
                "الشعب الحالية",
                "مواليد",
                "",
              ]}
            >
              {list.slice(page * 20, page * 20 + 20).map((s) => (
                <tr key={s.id}>
                  <td>
                    <a href={"#student/" + s.id} className="row-link">
                      <span className="mini-icon">
                        <UserRound size={16} />
                      </span>
                      {s.name}
                    </a>
                  </td>
                  <td>{s.number}</td>
                  <td>
                    {c.people.enrollments
                      .filter(
                        (e) => e.student === s.id && active(e, c.people.today),
                      )
                      .map((e) => groupOf(c, e.group))
                      .join("، ") || "—"}
                  </td>
                  <td>{s.birth ?? "—"}</td>
                  <td>
                    <a className="text-action" href={"#student/" + s.id}>
                      الملف <ChevronLeft size={15} />
                    </a>
                  </td>
                </tr>
              ))}
            </Table>
            {list.length > 20 && (
              <div className="pager">
                <Button
                  kind="outline"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  السابق
                </Button>
                <span>
                  {fmt(page + 1)} / {fmt(Math.ceil(list.length / 20))}
                </span>
                <Button
                  kind="outline"
                  disabled={(page + 1) * 20 >= list.length}
                  onClick={() => setPage(page + 1)}
                >
                  التالي
                </Button>
              </div>
            )}
          </>
        ) : (
          <Empty title="لا يوجد طلاب مطابقون" />
        )}
      </div>
      {modal && <StudentForm c={c} close={() => setModal(false)} />}
    </>
  );
}
function StudentForm({
  c,
  student,
  close,
}: {
  c: Context;
  student?: Student;
  close: () => void;
}) {
  const [baseline, setBaseline] = useState<Span[]>(student?.baseline ?? []);
  return (
    <Dialog
      title={student ? "تعديل بيانات الطالب" : "إضافة طالب"}
      close={close}
      submit={async (form) => {
        const id = student?.id ?? uid();
        await api(f(c, "/people/students/" + id), "PUT", {
          name: val(form, "name"),
          number: val(form, "number"),
          birth: optional(form, "birth"),
          contact: val(form, "contact"),
          estimated: optional(form, "estimated"),
          baseline,
        });
        await c.refresh();
        c.notify("حُفظت بيانات الطالب");
        go("student/" + id);
      }}
    >
      <div className="form-grid">
        <Field label="اسم الطالب" wide>
          <input name="name" defaultValue={student?.name} required />
        </Field>
        <Field label="رقم الطالب">
          <input name="number" defaultValue={student?.number} required />
        </Field>
        <Field label="تاريخ الميلاد">
          <input
            name="birth"
            type="date"
            max={c.people.today}
            defaultValue={student?.birth ?? ""}
          />
        </Field>
        <Field label="هاتف ولي الأمر">
          <input name="contact" type="tel" defaultValue={student?.contact} />
        </Field>
        <Field label="رصيد حفظ تقديري">
          <input
            name="estimated"
            defaultValue={student?.estimated}
            placeholder="مثال: جزء عمّ"
          />
        </Field>
      </div>
      <h3>مقاطع محفوظة عند الانتساب</h3>
      {baseline.map((span, i) => (
        <div className="reading-row" key={i}>
          <SpanInputs
            catalog={c.catalog}
            value={span}
            onChange={(value) =>
              setBaseline(baseline.map((x, j) => (i === j ? value : x)))
            }
          />
          <button
            type="button"
            className="icon-button danger"
            aria-label="حذف مقطع"
            onClick={() => setBaseline(baseline.filter((_, j) => j !== i))}
          >
            <Trash2 size={17} />
          </button>
        </div>
      ))}
      <SpanPicker
        catalog={c.catalog}
        add={(ranges) => setBaseline((current) => [...current, ...ranges])}
      />
    </Dialog>
  );
}
type StudentData = {
  student: Student;
  memorized: number;
  baseline: number;
  progress: {
    id: string;
    date: string;
    group: string | null;
    course: string | null;
    mark: Mark;
    added: number;
  }[];
  enrollments: {
    group: string;
    name: string;
    start: string;
    end: string | null;
  }[];
  grades: { course: string; name: string; state: string; date: string }[];
  followUps: {
    id: string;
    group: string;
    text: string;
    due: string;
    done: boolean;
  }[];
  competitions: {
    competition: string;
    category: string;
    categoryName: string | null;
    name: string;
    score: number | null;
    rank: number | null;
  }[];
};
export function StudentDetail({ c, id }: { c: Context; id: string }) {
  const [data, setData] = useState<StudentData>();
  const [error, setError] = useState("");
  const [tab, setTab] = useState("progress");
  const [modal, setModal] = useState("");
  const [chosen, setChosen] = useState("");
  const [old, setOld] = useState("");
  const reload = () =>
    api<StudentData>(f(c, "/education/students/" + id))
      .then(setData)
      .catch((e) => setError(message(e)));
  useEffect(() => {
    void reload();
  }, [id, c.people]);
  if (!data)
    return error ? (
      <ErrorBox>{error}</ErrorBox>
    ) : (
      <Empty title="جارٍ تحميل ملف الطالب…" />
    );
  const s = data.student;
  const groups = data.enrollments.filter((e) =>
    active({ student: id, ...e }, c.people.today),
  );
  const cgroups = groups.filter((e) => {
    const g = c.people.groups.find((x) => x.id === e.group);
    return g && editGroup(c, g);
  });
  return (
    <>
      <PageHead
        title={s.name}
        desc={
          s.number +
          " · " +
          (groups.map((x) => x.name).join("، ") || "دون شعبة نشطة")
        }
        crumb={<a href="#students">الطلاب</a>}
      >
        {admin(c) && (
          <>
            <Button kind="outline" onClick={() => setModal("edit")}>
              تعديل البيانات
            </Button>
            <Add
              onClick={() => {
                setChosen("");
                setOld("");
                setModal("enroll");
              }}
            >
              إدارة الانتساب
            </Add>
          </>
        )}
      </PageHead>
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="detail-summary">
        <Summary
          title="إجمالي الحفظ"
          value={fmt(data.memorized) + " آية"}
          icon={<BookOpen size={20} />}
        />
        <Summary
          title="رصيد الانتساب"
          value={fmt(data.baseline) + " آية"}
          icon={<FolderOpen size={20} />}
        />
        <Summary
          title="حضر"
          value={
            fmt(
              data.progress.filter((x) => x.mark.status === "present").length,
            ) + " لقاء"
          }
          icon={<Check size={20} />}
        />
        <Summary
          title="دورات مجتازة"
          value={fmt(data.grades.filter((x) => x.state === "passed").length)}
          icon={<GraduationCap size={20} />}
        />
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "progress", name: "الحضور والتسميع" },
          { value: "courses", name: "الدورات والمسابقات" },
          { value: "documents", name: "الشهادات" },
          { value: "follow", name: "المتابعة التربوية" },
          { value: "info", name: "الانتساب والبيانات" },
        ]}
      />
      {tab === "progress" && (
        <div className="card">
          {data.progress.length ? (
            <Table
              headers={["التاريخ", "الشعبة", "الحضور", "تسميع", "آيات جديدة"]}
            >
              {[...data.progress].reverse().map((r) => (
                <tr key={r.id}>
                  <td>{date(r.date)}</td>
                  <td>{groupOf(c, r.group)}</td>
                  <td>
                    <Badge value={r.mark.status} />
                  </td>
                  <td>
                    {r.mark.readings
                      .map(
                        (x) =>
                          (c.catalog.surahs.find(
                            (s) => s.number === x.span.surah,
                          )?.name ?? String(x.span.surah)) +
                          " " +
                          x.span.from +
                          "–" +
                          x.span.to,
                      )
                      .join("، ") ||
                      (r.mark.practice === "skip" ? "لم يسمّع" : "—")}
                  </td>
                  <td>{fmt(r.added)}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty />
          )}
        </div>
      )}
      {tab === "courses" && (
        <>
          <div className="card">
            <CardHead title="الدورات" />
            {data.grades.length ? (
              <Table headers={["الدورة", "النتيجة", "التاريخ"]}>
                {data.grades.map((g) => (
                  <tr key={g.course}>
                    <td>{g.name}</td>
                    <td>
                      <Badge value={g.state} />
                    </td>
                    <td>{date(g.date)}</td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty />
            )}
          </div>
          <div className="card">
            <CardHead title="المسابقات">
              {(admin(c) || cgroups.length > 0) &&
                c.education.competitions.length > 0 && (
                  <Add onClick={() => setModal("contest")}>إسناد مسابقة</Add>
                )}
            </CardHead>
            {data.competitions.length ? (
              <Table headers={["المسابقة", "الفئة", "الدرجة", "المركز"]}>
                {data.competitions.map((r) => (
                  <tr key={r.competition + r.category}>
                    <td>{r.name}</td>
                    <td>{r.categoryName ?? "—"}</td>
                    <td>{r.score ?? "—"}</td>
                    <td>{r.rank ?? "—"}</td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty />
            )}
          </div>
        </>
      )}
      {tab === "documents" && (
        <Documents
          c={c}
          student={id}
          canUpload={cgroups.length > 0}
          groups={cgroups.map((e) => e.group)}
        />
      )}
      {tab === "info" && (
        <div className="card">
          <CardHead title="بيانات الطالب" />
          <div className="info-strip">
            <span>
              الميلاد <b>{s.birth ?? "—"}</b>
            </span>
            <span>
              هاتف ولي الأمر <b>{s.contact || "—"}</b>
            </span>
            <span>
              رصيد تقديري <b>{s.estimated || "—"}</b>
            </span>
          </div>
          <Table headers={["الشعبة", "البداية", "النهاية"]}>
            {data.enrollments.map((x, i) => (
              <tr key={i}>
                <td>{x.name}</td>
                <td>{date(x.start)}</td>
                <td>{x.end ? date(x.end) : "مستمرة"}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}
      {tab === "follow" && (
        <div className="card">
          <CardHead title="إجراءات المتابعة">
            {cgroups.length > 0 && (
              <Add
                onClick={() => {
                  setChosen(cgroups[0].group);
                  setModal("follow");
                }}
              >
                إضافة متابعة
              </Add>
            )}
          </CardHead>
          {data.followUps.length ? (
            <Table headers={["الإجراء", "موعد المراجعة", "الحالة"]}>
              {data.followUps.map((r) => (
                <tr key={r.id}>
                  <td>{r.text}</td>
                  <td>{date(r.due)}</td>
                  <td>
                    {r.done ? (
                      <Badge value="approved" text="مكتمل" />
                    ) : cgroups.some((e) => e.group === r.group) ? (
                      <Button
                        kind="outline"
                        onClick={() =>
                          void api(
                            f(c, "/education/followups/" + r.id),
                            "PUT",
                            { ...r, student: id, done: true },
                          )
                            .then(reload)
                            .catch((e) => setError(message(e)))
                        }
                      >
                        تمت المتابعة
                      </Button>
                    ) : (
                      <Badge value="open" />
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty />
          )}
        </div>
      )}
      {modal === "contest" && (
        <AssignContest c={c} student={id} close={() => setModal("")} />
      )}
      {modal === "edit" && (
        <StudentForm c={c} student={s} close={() => setModal("")} />
      )}
      {modal === "enroll" && (
        <Dialog
          title="تسجيل أو نقل الطالب"
          close={() => setModal("")}
          submit={async (form) => {
            if (!chosen && !old)
              throw new Error("اختر شعبة للانتساب أو لإنهاء التسجيل.");
            await api(f(c, "/people/students/" + id + "/enrollment"), "POST", {
              group: chosen || null,
              closeGroup: old || null,
              start: val(form, "start"),
            });
            await c.refresh();
            await reload();
            c.notify("حُدّث الانتساب");
          }}
        >
          <div className="form-grid">
            <Field label="الانتساب إلى شعبة">
              <Select
                options={options(c.people.groups)}
                placeholder="اختر شعبة جديدة"
                value={chosen}
                onChange={setChosen}
              />
            </Field>
            <Field label="إنهاء الانتساب إلى">
              <Select
                options={groups.map((e) => ({ value: e.group, name: e.name }))}
                placeholder="أبقِ التسجيلات الحالية"
                value={old}
                onChange={setOld}
              />
            </Field>
            <Field label="تاريخ السريان">
              <input
                type="date"
                name="start"
                min={c.people.today}
                defaultValue={c.people.today}
                required
              />
            </Field>
          </div>
        </Dialog>
      )}
      {modal === "follow" && (
        <Dialog
          title="إجراء متابعة"
          close={() => setModal("")}
          submit={async (form) => {
            await api(f(c, "/education/followups/" + uid()), "PUT", {
              student: id,
              group: chosen,
              text: val(form, "text"),
              due: val(form, "due"),
              done: false,
            });
            await reload();
          }}
        >
          <Field label="الشعبة">
            <Select
              options={cgroups.map((x) => ({ value: x.group, name: x.name }))}
              value={chosen}
              onChange={setChosen}
            />
          </Field>
          <Field label="الإجراء">
            <textarea name="text" required />
          </Field>
          <Field label="موعد المراجعة">
            <input
              type="date"
              name="due"
              defaultValue={c.people.today}
              required
            />
          </Field>
        </Dialog>
      )}
    </>
  );
}

function AssignContest({
  c,
  student,
  close,
}: {
  c: Context;
  student: string;
  close: () => void;
}) {
  const [id, setId] = useState("");
  const [category, setCategory] = useState("");
  const choices = c.education.competitions.filter(
    (contest) =>
      contest.multiple ||
      !c.education.entries.some(
        (e) => e.competition === contest.id && e.student === student,
      ),
  );
  const contest = choices.find((x) => x.id === id);
  const categories = (contest?.categories ?? []).filter(
    (cat) =>
      !c.education.entries.some(
        (e) =>
          e.competition === id &&
          e.category === cat.id &&
          e.student === student,
      ),
  );
  return (
    <Dialog
      title="إسناد مسابقة للطالب"
      close={close}
      submit={async () => {
        if (!id || !category) throw new Error("اختر المسابقة والفئة.");
        await api(f(c, "/education/competitions/" + id + "/entries"), "PUT", {
          student,
          category,
          score: null,
          rank: null,
        });
        await c.refresh();
        c.notify("أُسندت المسابقة للطالب");
      }}
    >
      <Field label="المسابقة">
        <Select
          options={options(choices)}
          value={id}
          onChange={(value) => {
            setId(value);
            setCategory("");
          }}
          required
          placeholder="اختر مسابقة"
        />
      </Field>
      <Field label="الفئة">
        <Select
          options={options(categories)}
          value={category}
          onChange={setCategory}
          required
          placeholder="اختر فئة"
        />
      </Field>
    </Dialog>
  );
}

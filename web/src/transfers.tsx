import { useEffect, useState, type FormEvent } from "react";
import {
  Download,
  FileSpreadsheet,
  FileUp,
  ScanLine,
  Trash2,
} from "lucide-react";
import {
  api,
  fmt,
  go,
  message,
  offset,
  unitPath,
  withinUnit,
  active,
  type Context,
} from "./model";
import {
  Button,
  CardHead,
  Dialog,
  Empty,
  ErrorBox,
  Field,
  PageHead,
  Select,
  Table,
  options,
  val,
} from "./ui";
import { f } from "./learning";
type Report = {
  title: string;
  subtitle: string;
  notes: string;
  columns: string[];
  rows: string[][];
  updated: string;
};
export function Reports({ c }: { c: Context }) {
  const [type, setType] = useState("learning");
  const [unit, setUnit] = useState("");
  const [group, setGroup] = useState("");
  const [course, setCourse] = useState("");
  const [contest, setContest] = useState("");
  const [from, setFrom] = useState(offset(c.people.today, -6));
  const [to, setTo] = useState(c.people.today);
  const [report, setReport] = useState<Report>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [generated, setGenerated] = useState("");
  const isManagement = c.center.roles.some(
    (role) => role === "admin" || role === "manager",
  );
  const reportGroups = c.people.groups.filter(
    (g) => isManagement || g.teacher === c.user.id,
  );
  const units = c.people.units.filter(
    (u) =>
      isManagement ||
      reportGroups.some((g) => withinUnit(c.people.units, g.unit, u.id)),
  );
  const groups = reportGroups.filter(
    (g) => !unit || withinUnit(c.people.units, g.unit, unit),
  );
  const courses = c.education.courses.filter(
    (x) =>
      (isManagement || x.teachers.includes(c.user.id)) &&
      (type === "recitation"
        ? x.type === "recitation"
        : type !== "courses" || x.type !== "recitation") &&
      ((!unit && !group) ||
        groups.some(
          (g) =>
            (!group || g.id === group) &&
            (x.groups.includes(g.id) ||
              c.people.enrollments.some(
                (e) =>
                  e.group === g.id &&
                  active(e, to) &&
                  x.students.includes(e.student),
              )),
        )),
  );
  function changeType(value: string) {
    setType(value);
    setCourse("");
    setContest("");
    if (value === "competitions" && c.education.competitions.length > 0) {
      const dates = c.education.competitions.map((x) => x.date).sort();
      setFrom(dates[0]);
      setTo(dates[dates.length - 1]);
    }
  }
  const query = new URLSearchParams({
    kind: type,
    from: type === "counts" ? to : from,
    to,
  });
  if (unit) query.set("unit", unit);
  if (group) query.set("group", group);
  if (
    course &&
    courses.some((x) => x.id === course) &&
    type !== "counts" &&
    type !== "competitions"
  )
    query.set("course", course);
  if (contest && type === "competitions") query.set("competition", contest);
  const path = f(c, "/education/report") + "?" + query.toString();
  async function load() {
    setError("");
    setBusy(true);
    try {
      setReport(await api<Report>(path));
      setGenerated(path);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <PageHead
        title="التقارير"
        desc="أنشئ تقارير الحضور والإنجاز والأعداد ضمن نطاق صلاحيتك."
      />
      <form
        className="card panel"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <div className="report-controls">
          <Field label="التقرير">
            <Select
              options={[
                { value: "learning", name: "الحضور وإنجاز الحفظ" },
                { value: "counts", name: "أعداد الشعب والطلاب" },
                ...(isManagement
                  ? [{ value: "work", name: "متابعة المعلّمين" }]
                  : []),
                { value: "courses", name: "الدورات" },
                { value: "recitation", name: "دورات التلاوة" },
                { value: "competitions", name: "المسابقة السنوية" },
              ]}
              value={type}
              onChange={changeType}
            />
          </Field>
          {type !== "counts" && (
            <Field label="من تاريخ">
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                required
              />
            </Field>
          )}
          <Field label={type === "counts" ? "في تاريخ" : "إلى تاريخ"}>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              required
            />
          </Field>
          <Field label="الوحدة">
            <Select
              options={units.map((x) => ({
                value: x.id,
                name: unitPath(c.people.units, x.id),
              }))}
              value={unit}
              onChange={(value) => {
                setUnit(value);
                setGroup("");
                setCourse("");
              }}
              placeholder="جميع الوحدات"
            />
          </Field>
          <Field label="الشعبة">
            <Select
              options={options(groups)}
              value={group}
              onChange={(value) => {
                setGroup(value);
                setCourse("");
              }}
              placeholder="جميع الشعب"
            />
          </Field>
          {type === "competitions" && (
            <Field label="المسابقة">
              <Select
                options={options(c.education.competitions)}
                value={contest}
                onChange={setContest}
                placeholder="جميع المسابقات"
              />
            </Field>
          )}
          {type !== "counts" && type !== "competitions" && (
            <Field label={type === "recitation" ? "دورة التلاوة" : "الدورة"}>
              <Select
                options={options(courses)}
                value={courses.some((x) => x.id === course) ? course : ""}
                onChange={setCourse}
                placeholder="جميع الدورات"
              />
            </Field>
          )}
          <Button type="submit" disabled={busy}>
            عرض التقرير
          </Button>
        </div>
      </form>
      {error && <ErrorBox>{error}</ErrorBox>}
      {report && (
        <div className="card">
          <CardHead title={report.title} desc={report.subtitle}>
            <div className="actions">
              <a href={generated + "&format=pdf"} className="btn outline">
                <Download size={16} />
                PDF
              </a>
              <a href={generated + "&format=xlsx"} className="btn outline">
                <FileSpreadsheet size={16} />
                Excel
              </a>
            </div>
          </CardHead>
          {report.rows.length ? (
            <Table headers={report.columns}>
              {report.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </Table>
          ) : (
            <Empty title="لا توجد سجلات للفترة المحدّدة" />
          )}
          <div className="table-note">{report.notes}</div>
        </div>
      )}
    </>
  );
}
type Row = {
  number: string;
  name: string;
  birth: string | null;
  contact: string;
};
type Preview = { batch: string; rows: { row: Row; possible: string[] }[] };
export function Imports({ c }: { c: Context }) {
  const [preview, setPreview] = useState<Preview>();
  const [file, setFile] = useState<File>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const path = f(c, "/import");
  async function read(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      setPreview(await api<Preview>(path + "/preview", "POST", form));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  function update(index: number, patch: Partial<Row>) {
    setPreview((p) =>
      p
        ? {
            ...p,
            rows: p.rows.map((x, i) =>
              i === index ? { ...x, row: { ...x.row, ...patch } } : x,
            ),
          }
        : undefined,
    );
  }
  return (
    <>
      <PageHead
        title="استيراد الطلاب"
        desc="راجع المعلومات المستخرجة من الكشف قبل اعتمادها."
        crumb={<a href="#students">الطلاب</a>}
      />
      <form onSubmit={read} className="card panel import-panel">
        <span className="metric-icon mint">
          <ScanLine size={23} />
        </span>
        <h2>رفع كشف طلاب</h2>
        <p>
          Excel بترتيب رقم الطالب، والاسم، وتاريخ الميلاد، وهاتف وليّ الأمر. يُنشأ
          الرقم تلقائيًا إذا كان فارغًا. يدعم الاستخراج أيضًا PDF أو PNG أو JPEG
          لكشف عربي مطبوع.
        </p>
        <input
          type="file"
          aria-label="ملف كشف الطلاب"
          accept=".xlsx,.pdf,.png,.jpg,.jpeg"
          onChange={(e) => {
            setFile(e.target.files?.[0]);
            setPreview(undefined);
          }}
        />
        <Button type="submit" disabled={!file || busy}>
          <FileUp size={17} />
          {busy ? "جارٍ قراءة الملف…" : "معاينة البيانات"}
        </Button>
      </form>
      {error && <ErrorBox>{error}</ErrorBox>}
      {preview && (
        <div className="card">
          <CardHead
            title="معاينة الصفوف"
            desc={
              fmt(preview.rows.length) +
              " صفوف مستخرجة. عدّل البيانات قبل الاعتماد."
            }
          >
            {preview.rows.length > 0 && (
              <Button onClick={() => setDone(true)}>اعتماد الصفوف</Button>
            )}
          </CardHead>
          {preview.rows.length ? (
            <Table
              headers={[
                "رقم الطالب",
                "الاسم",
                "الميلاد",
                "هاتف وليّ الأمر",
                "تطابقات محتملة",
                "",
              ]}
            >
              {preview.rows.map(({ row, possible }, i) => (
                <tr key={i}>
                  <td>
                    <input
                      aria-label="رقم الطالب"
                      placeholder="تلقائي"
                      value={row.number}
                      onChange={(e) => update(i, { number: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label="الاسم"
                      value={row.name}
                      onChange={(e) => update(i, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      aria-label="الميلاد"
                      value={row.birth ?? ""}
                      onChange={(e) =>
                        update(i, { birth: e.target.value || null })
                      }
                    />
                  </td>
                  <td>
                    <input
                      aria-label="هاتف وليّ الأمر"
                      value={row.contact}
                      onChange={(e) => update(i, { contact: e.target.value })}
                    />
                  </td>
                  <td>{possible.join("، ") || "—"}</td>
                  <td>
                    <button
                      className="icon-button danger"
                      aria-label="استبعاد الصف"
                      type="button"
                      onClick={() =>
                        setPreview({
                          ...preview,
                          rows: preview.rows.filter((_, j) => j !== i),
                        })
                      }
                    >
                      <Trash2 size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty title="لم يُعثر على صفوف" />
          )}
        </div>
      )}
      {done && preview && (
        <Dialog
          title="اعتماد استيراد الطلاب"
          close={() => setDone(false)}
          confirm="اعتماد"
          submit={async () => {
            const result = await api<{ count: number }>(
              path + "/commit",
              "POST",
              { batch: preview.batch, rows: preview.rows.map((x) => x.row) },
            );
            await c.refresh();
            c.notify("تم استيراد " + fmt(result.count) + " طالبًا");
            go("students");
          }}
        >
          <p>سيُحفظ {fmt(preview.rows.length)} طالبًا من المعاينة الحالية.</p>
        </Dialog>
      )}
    </>
  );
}

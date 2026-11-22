import { useEffect, useState } from "react";
import { captureLocation } from "./device";
import { startAuthentication } from "@simplewebauthn/browser";
import {
  BookOpen,
  Check,
  Clock3,
  Fingerprint,
  Plus,
  Save,
  Trash2,
  Users,
} from "lucide-react";
import {
  api,
  clock,
  courseRoute,
  date,
  fmt,
  groupOf,
  label,
  message,
  type Context,
  type Mark,
  type Meeting,
  type MeetingType,
  type Reading,
} from "./model";
import {
  Badge,
  Button,
  CardHead,
  Dialog,
  Empty,
  ErrorBox,
  Field,
  PageHead,
  Select,
  Table,
  optional,
  options,
  val,
} from "./ui";
import { admin, f, Summary } from "./learning";
import { SpanInputs, SpanPicker } from "./span-picker";
import type { Catalog } from "./quran";
type MeetingData = {
  meeting: Meeting;
  students: { id: string; name: string; number: string }[];
  types: MeetingType[];
  attendanceWindow: { from: string; to: string } | null;
};
export function MeetingDetail({ c, id }: { c: Context; id: string }) {
  const [data, setData] = useState<MeetingData>();
  const [marks, setMarks] = useState<Mark[]>([]);
  const [lesson, setLesson] = useState("");
  const [course, setCourse] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [modal, setModal] = useState("");
  const [edit, setEdit] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    void api<MeetingData>(f(c, "/education/meetings/" + id))
      .then((r) => {
        setData(r);
        setLesson(r.meeting.lesson);
        setMarks(r.meeting.marks);
        setCourse(r.meeting.lessonCourse ?? "");
      })
      .catch((e) => setError(message(e)));
  }, [id, c.center.id]);
  useEffect(() => {
    if (!data?.attendanceWindow || data.meeting.state !== "open") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [data?.attendanceWindow, data?.meeting.state]);
  if (!data)
    return error ? (
      <ErrorBox>{error}</ErrorBox>
    ) : (
      <Empty title="جارٍ تحميل الكشف…" />
    );
  const m = data.meeting;
  const cancelled = m.state === "cancelled";
  const can = !cancelled && (m.state !== "final" || edit);
  const mine =
    m.teachers.includes(c.user.id) && c.center.roles.includes("teacher");
  const canMark = can && (admin(c) || m.attendanceBy === c.user.id);
  const canTeach = can && (admin(c) || m.lessonBy === c.user.id);
  const type = data.types.find((t) => t.key === m.kind);
  const withMemorization = type?.practice ?? false;
  const canPractice =
    withMemorization && can && (admin(c) || m.practiceBy === c.user.id);
  const linkedCourse = c.education.courses.find((x) => x.id === m.course);
  const check = c.work.checkIns.find(
    (x) => x.meeting === id && x.teacher === c.user.id,
  );
  const attendanceWindow = data.attendanceWindow;
  const canVerify =
    m.state === "open" &&
    attendanceWindow &&
    now >= Date.parse(attendanceWindow.from) &&
    now < Date.parse(attendanceWindow.to);
  const update = (id: string, patch: Partial<Mark>) =>
    setMarks((rows) =>
      rows.map((x) => (x.student === id ? { ...x, ...patch } : x)),
    );
  const title = m.group
    ? groupOf(c, m.group)
    : (c.education.courses.find((x) => x.id === m.course)?.name ??
      "لقاء الدورة");
  const query = f(c, "/work/checkins/" + id);
  async function checkIn() {
    setError("");
    setBusy(true);
    try {
      const r = await api<{
        id: string;
        options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
      }>(query + "/options", "POST");
      const pos = await captureLocation();
      const response = await startAuthentication({ optionsJSON: r.options });
      await api(query, "POST", {
        id: r.id,
        response,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        captured: new Date(pos.timestamp).toISOString(),
      });
      await c.refresh();
      c.notify("تم إثبات حضورك");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function save(finalize: boolean, reason?: string) {
    setBusy(true);
    setError("");
    try {
      const updated = await api<Meeting>(
        f(c, "/education/meetings/" + id),
        "PUT",
        {
          version: m.version,
          lesson,
          lessonCourse: course || null,
          marks,
          finalize,
          reason,
        },
      );
      setData({ ...data!, meeting: updated });
      setMarks(updated.marks);
      setLesson(updated.lesson);
      setEdit(false);
      await c.refresh();
      c.notify(
        finalize || m.state === "final" ? "اعتُمد الكشف" : "حُفظت المسودة",
      );
    } catch (e) {
      setError(message(e));
      if (reason) throw e;
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHead
        title={title}
        desc={
          date(m.date, true) +
          " · " +
          clock(m.from) +
          " – " +
          clock(m.to) +
          " · " +
          (type?.name ?? "لقاء")
        }
        crumb={
          <a
            href={
              m.group
                ? "#group/" + m.group
                : linkedCourse
                  ? "#" + courseRoute(linkedCourse)
                  : "#courses"
            }
          >
            عودة
          </a>
        }
      >
        <Badge value={m.state} />
        {m.state === "final" && (mine || admin(c)) && (
          <Button kind="outline" onClick={() => setEdit(!edit)}>
            {edit ? "إلغاء التصحيح" : "تصحيح الكشف"}
          </Button>
        )}
      </PageHead>
      {error && <ErrorBox>{error}</ErrorBox>}
      {mine && !cancelled && (
        <div className="check-in card">
          <span className="metric-icon mint">
            <Fingerprint size={23} />
          </span>
          <div>
            <b>دوام المعلّم</b>
            <p>
              {check
                ? label(check.state)
                : canVerify
                  ? "أثبت حضورك وأنت داخل نطاق المركز."
                  : "يتاح إثبات الحضور أثناء الحصة المفتوحة وفي وقتها المجدول."}
            </p>
          </div>
          <div className="actions">
            {!check || check.state === "pending" ? (
              <>
                <Button kind="outline" onClick={() => setModal("review")}>
                  طلب مراجعة
                </Button>
                {canVerify && (
                  <Button onClick={() => void checkIn()} disabled={busy}>
                    <Fingerprint size={17} />
                    إثبات حضوري
                  </Button>
                )}
              </>
            ) : (
              <Badge value={check.state} />
            )}
          </div>
        </div>
      )}
      <div className="detail-summary">
        <Summary
          title="عدد الطلاب"
          value={fmt(m.roster.length)}
          icon={<Users size={20} />}
        />
        <Summary
          title="حاضرون"
          value={fmt(marks.filter((x) => x.status === "present").length)}
          icon={<Check size={20} />}
        />
        <Summary
          title="لم يُرصدوا"
          value={fmt(marks.filter((x) => !x.status).length)}
          icon={<Clock3 size={20} />}
        />
        {withMemorization && (
          <Summary
            title="متابعة التسميع"
            value={fmt(
              marks.filter(
                (x) => x.practice === "done" || x.practice === "skip",
              ).length,
            )}
            icon={<BookOpen size={20} />}
          />
        )}
      </div>
      <div className="card panel">
        <h2>درس اللقاء</h2>
        <div className="form-grid">
          <Field label="ما الذي قُدّم في اللقاء؟" wide>
            <textarea
              disabled={!canTeach}
              value={lesson}
              onChange={(e) => setLesson(e.target.value)}
              placeholder="اكتب موضوع الدرس وملاحظاته"
            />
          </Field>
          <Field label="ربط الدرس بدورة">
            <Select
              value={course}
              onChange={(v) => canTeach && setCourse(v)}
              options={options(
                c.education.courses.filter(
                  (x) =>
                    x.id === m.course ||
                    x.id === m.lessonCourse ||
                    (x.type !== "recitation" &&
                      m.group &&
                      x.groups.includes(m.group)),
                ),
              )}
              placeholder="درس مستقل"
            />
          </Field>
        </div>
      </div>
      <div className="card">
        <CardHead
          title="كشف الطلاب"
          desc={
            withMemorization
              ? "حالة الحضور ومتابعة التسميع لكل طالب."
              : "حالة الحضور لكل طالب."
          }
        >
          {canMark && (
            <Button
              kind="outline"
              onClick={() =>
                setMarks(
                  marks.map((x) =>
                    x.status ? x : { ...x, status: "present" },
                  ),
                )
              }
            >
              تحديد غير المرصودين كحاضرين
            </Button>
          )}
        </CardHead>
        {marks.length ? (
          <Table
            headers={
              withMemorization
                ? ["الطالب", "الحضور", "التسميع", "المقاطع"]
                : ["الطالب", "الحضور"]
            }
          >
            {marks.map((row) => (
              <tr key={row.student}>
                <td>
                  {data.students.find((s) => s.id === row.student)?.name ?? "—"}
                </td>
                <td>
                  {canMark ? (
                    <Select
                      value={row.status ?? ""}
                      onChange={(v) =>
                        update(row.student, { status: v || null })
                      }
                      placeholder="غير مرصود"
                      options={[
                        { value: "present", name: "حاضر" },
                        { value: "absent", name: "غائب" },
                        { value: "excused", name: "غائب بعذر" },
                      ]}
                    />
                  ) : (
                    <Badge value={row.status} />
                  )}
                </td>
                {withMemorization && (
                  <>
                    <td>
                      {canPractice ? (
                        <Select
                          value={row.practice ?? ""}
                          onChange={(v) => {
                            if (v === "done" || v === "skip") {
                              setReading(row.student);
                              if (v === "skip")
                                update(row.student, { practice: "skip" });
                            } else
                              update(row.student, {
                                practice: v || null,
                                readings: [],
                                note: null,
                              });
                          }}
                          placeholder="غير مرصود"
                          options={[
                            { value: "done", name: "تم التسميع" },
                            { value: "skip", name: "لم يسمّع اليوم" },
                            { value: "optional", name: "غير مطلوب" },
                          ]}
                        />
                      ) : row.practice === "done" ? (
                        "تم التسميع"
                      ) : row.practice === "skip" ? (
                        "لم يسمّع"
                      ) : row.practice === "optional" ? (
                        "غير مطلوب"
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {canPractice ? (
                        <Button
                          kind="ghost"
                          onClick={() => setReading(row.student)}
                        >
                          <Plus size={15} />
                          {row.readings.length
                            ? fmt(row.readings.length) + " مقاطع"
                            : "تسجيل التسميع"}
                        </Button>
                      ) : (
                        fmt(row.readings.length)
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </Table>
        ) : (
          <Empty title="كشف الحصة فارغ" />
        )}
      </div>
      {(canMark || canTeach || canPractice) && (
        <div className="sticky-actions">
          {m.state === "final" ? (
            <Button onClick={() => setModal("reason")} disabled={busy}>
              <Save size={17} />
              حفظ التصحيح
            </Button>
          ) : (
            <>
              <Button
                kind="outline"
                onClick={() => void save(false)}
                disabled={busy}
              >
                <Save size={16} />
                حفظ مسودة
              </Button>
              <Button onClick={() => void save(true)} disabled={busy}>
                <Check size={17} />
                اعتماد الكشف
              </Button>
            </>
          )}
        </div>
      )}
      {modal === "review" && (
        <Dialog
          title="طلب مراجعة الدوام"
          close={() => setModal("")}
          submit={async (form) => {
            await api(query + "/review", "POST", {
              teacher: c.user.id,
              state: "pending",
              reason: val(form, "reason"),
            });
            await c.refresh();
            c.notify("أُرسل طلب المراجعة");
          }}
        >
          <Field label="سبب تعذّر الإثبات">
            <textarea name="reason" required />
          </Field>
        </Dialog>
      )}
      {modal === "reason" && (
        <Dialog
          title="اعتماد تصحيح الكشف"
          close={() => setModal("")}
          submit={async (form) => save(true, val(form, "reason"))}
        >
          <Field label="سبب التعديل">
            <textarea name="reason" required />
          </Field>
        </Dialog>
      )}
      {reading && (
        <ReadingForm
          catalog={c.catalog}
          mark={marks.find((x) => x.student === reading)!}
          name={data.students.find((s) => s.id === reading)?.name ?? ""}
          close={() => setReading(null)}
          save={(patch) => update(reading, patch)}
        />
      )}
    </>
  );
}
function ReadingForm({
  catalog,
  mark,
  name,
  close,
  save,
}: {
  catalog: Catalog;
  mark: Mark;
  name: string;
  close: () => void;
  save: (patch: Partial<Mark>) => void;
}) {
  const initial: Reading = {
    span: { surah: catalog.surahs[0].number, from: 1, to: 1 },
    kind: "new",
    result: "passed",
  };
  const [rows, setRows] = useState<Reading[]>(mark.readings);
  const [skip, setSkip] = useState(mark.practice === "skip");
  const edit = (i: number, patch: Partial<Reading>) =>
    setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <Dialog
      title={"تسميع " + name}
      close={close}
      wide
      submit={async (form) => {
        if (!skip && !rows.length) throw new Error("أضف مقطع تسميع.");
        save({
          practice: skip ? "skip" : "done",
          readings: skip ? [] : rows,
          note: optional(form, "note"),
        });
      }}
    >
      <label className="check-line">
        <input
          type="checkbox"
          checked={skip}
          onChange={(e) => setSkip(e.target.checked)}
        />
        لم يسمّع اليوم
      </label>
      {!skip && (
        <>
          {rows.map((r, i) => (
            <div className="reading-edit" key={i}>
              <div className="reading-row">
                <SpanInputs
                  catalog={catalog}
                  value={r.span}
                  onChange={(span) => edit(i, { span })}
                />
                <button
                  type="button"
                  className="icon-button danger"
                  aria-label="حذف مقطع"
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                >
                  <Trash2 size={18} />
                </button>
              </div>
              <div className="form-grid">
                <Field label="النوع">
                  <Select
                    options={[
                      { value: "new", name: "حفظ جديد" },
                      { value: "review", name: "مراجعة" },
                    ]}
                    value={r.kind}
                    onChange={(kind) => edit(i, { kind })}
                  />
                </Field>
                <Field label="النتيجة">
                  <Select
                    options={[
                      { value: "passed", name: "أُتقن" },
                      { value: "repeat", name: "يحتاج إعادة" },
                    ]}
                    value={r.result}
                    onChange={(result) => edit(i, { result })}
                  />
                </Field>
              </div>
            </div>
          ))}
          <SpanPicker
            catalog={catalog}
            add={(ranges) =>
              setRows((rows) => [
                ...rows,
                ...ranges.map((span) => ({ ...initial, span })),
              ])
            }
          />
        </>
      )}
      <Field label={skip ? "سبب عدم التسميع" : "ملاحظة (اختياري)"}>
        <textarea name="note" defaultValue={mark.note ?? ""} required={skip} />
      </Field>
    </Dialog>
  );
}

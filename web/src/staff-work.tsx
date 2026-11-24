import { useEffect, useState } from "react";
import {
  androidBiometricsAvailable,
  devicePasskeyError,
  isAndroidApp,
  openAndroidBiometricSettings,
  prepareDeviceEnrollment,
  revokeAttendanceDevice,
} from "./device-passkeys";
import { ClipboardCheck, Fingerprint, ShieldCheck, Trash2 } from "lucide-react";
import { PasskeyAction } from "./passkey-action";
import {
  api,
  clock,
  courseOf,
  date,
  fmt,
  groupOf,
  message,
  teacherOf,
  type Context,
  type Task,
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
  Select,
  Table,
  options,
  val,
} from "./ui";
import { admin, f } from "./learning";
export function Tasks({ c }: { c: Context }) {
  const [modal, setModal] = useState("");
  const [task, setTask] = useState<Task>();
  const [teacher, setTeacher] = useState("");
  const [group, setGroup] = useState("");
  const [course, setCourse] = useState("");
  const [filter, setFilter] = useState("");
  const rows = c.work.tasks.filter((x) => !filter || x.teacher === filter);
  return (
    <>
      <PageHead
        title="التكليفات"
        desc="المهام المسندة إلى المعلّمين ومواعيد تسليمها."
      >
        {admin(c) && (
          <Add
            onClick={() => {
              setTeacher("");
              setGroup("");
              setCourse("");
              setModal("new");
            }}
          >
            إضافة تكليف
          </Add>
        )}
      </PageHead>
      {admin(c) && (
        <div className="toolbar">
          <Select
            options={options(
              c.staff.filter((x) => x.roles.includes("teacher")),
            )}
            value={filter}
            onChange={setFilter}
            placeholder="جميع المعلّمين"
          />
        </div>
      )}
      <div className="card">
        {rows.length ? (
          <Table headers={["التكليف", "المعلّم", "الموعد", "الحالة", ""]}>
            {rows.map((t) => (
              <tr key={t.id}>
                <td>
                  <span className="row-link">
                    <span className="mini-icon">
                      <ClipboardCheck size={16} />
                    </span>
                    {t.title}
                  </span>
                  <small className="subline">{t.detail}</small>
                  {t.reply && (
                    <small className="subline">آخر ملاحظة · {t.reply}</small>
                  )}
                </td>
                <td>{teacherOf(c, t.teacher)}</td>
                <td>{date(t.due)}</td>
                <td>
                  <Badge
                    value={t.state}
                    text={
                      t.due < c.people.today &&
                      ["open", "returned"].includes(t.state)
                        ? "متأخر"
                        : undefined
                    }
                  />
                </td>
                <td>
                  {t.teacher === c.user.id &&
                    ["open", "returned"].includes(t.state) && (
                      <Button
                        onClick={() => {
                          setTask(t);
                          setModal("submitted");
                        }}
                      >
                        تسليم
                      </Button>
                    )}
                  {admin(c) && t.state === "submitted" && (
                    <div className="actions">
                      <Button
                        onClick={() => {
                          setTask(t);
                          setModal("approved");
                        }}
                      >
                        اعتماد
                      </Button>
                      <Button
                        kind="outline"
                        onClick={() => {
                          setTask(t);
                          setModal("returned");
                        }}
                      >
                        إعادة
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty title="لا توجد تكليفات" />
        )}
      </div>
      {modal === "new" && (
        <Dialog
          title="تكليف جديد"
          close={() => setModal("")}
          submit={async (form) => {
            await api(f(c, "/work/tasks"), "POST", {
              title: val(form, "title"),
              detail: val(form, "detail"),
              due: val(form, "due"),
              teacher,
              group: group || null,
              course: course || null,
            });
            await c.refresh();
            c.notify("أُسند التكليف");
          }}
        >
          <div className="form-grid">
            <Field label="عنوان التكليف" wide>
              <input name="title" required />
            </Field>
            <Field label="المطلوب" wide>
              <textarea name="detail" required />
            </Field>
            <Field label="المعلّم">
              <Select
                options={options(
                  c.staff.filter(
                    (x) => x.active && x.roles.includes("teacher"),
                  ),
                )}
                value={teacher}
                onChange={setTeacher}
                placeholder="اختر معلّمًا"
                required
              />
            </Field>
            <Field label="موعد التسليم">
              <input
                name="due"
                type="date"
                required
                defaultValue={c.people.today}
              />
            </Field>
            <Field label="الشعبة">
              <Select
                options={options(c.people.groups)}
                value={group}
                onChange={setGroup}
                placeholder="اختياري"
              />
            </Field>
            <Field label="الدورة">
              <Select
                options={options(c.education.courses)}
                value={course}
                onChange={setCourse}
                placeholder="اختياري"
              />
            </Field>
          </div>
        </Dialog>
      )}
      {modal && modal !== "new" && task && (
        <Dialog
          title={
            modal === "submitted"
              ? "تسليم التكليف"
              : modal === "approved"
                ? "اعتماد التكليف"
                : "إعادة للاستكمال"
          }
          close={() => setModal("")}
          submit={async (form) => {
            await api(f(c, "/work/tasks/" + task.id), "PUT", {
              state: modal,
              reply: val(form, "reply") || null,
            });
            await c.refresh();
            c.notify("حُدّث التكليف");
          }}
        >
          <p>{task.title}</p>
          <Field
            label={modal === "returned" ? "ما الذي يحتاج استكمالًا؟" : "ملاحظة"}
          >
            <textarea name="reply" required={modal !== "approved"} />
          </Field>
        </Dialog>
      )}
    </>
  );
}
export function FollowTeachers({ c }: { c: Context }) {
  const [day, setDay] = useState(c.people.today);
  const [teacher, setTeacher] = useState("");
  const [item, setItem] = useState<{ meeting: string; teacher: string } | null>(
    null,
  );
  const rows = c.education.meetings
    .filter((x) => x.date === day && x.state !== "cancelled")
    .flatMap((m) =>
      m.teachers
        .filter((t) => !teacher || t === teacher)
        .map((t) => ({
          m,
          t,
          check: c.work.checkIns.find(
            (x) => x.meeting === m.id && x.teacher === t,
          ),
        })),
    );
  return (
    <>
      <PageHead
        title="متابعة المعلّمين"
        desc="دوام المعلّمين وما أُنجز من الدروس وكشوف الطلاب."
      >
        <a className="btn outline" href="#reports">
          تقرير الدوام
        </a>
      </PageHead>
      <div className="toolbar">
        <input
          type="date"
          aria-label="تاريخ الدوام"
          value={day}
          onChange={(e) => setDay(e.target.value)}
        />
        <Select
          options={options(c.staff.filter((x) => x.roles.includes("teacher")))}
          value={teacher}
          onChange={setTeacher}
          placeholder="جميع المعلّمين"
        />
      </div>
      <div className="card">
        <CardHead
          title="سجل اللقاءات"
          desc={fmt(rows.length) + " تكليفات تدريس في هذا اليوم"}
        />
        {rows.length ? (
          <Table
            headers={[
              "المعلّم",
              "اللقاء",
              "الدوام",
              "كشف الطلاب",
              "الدرس",
              "التسميع",
              "",
            ]}
          >
            {rows.map(({ m, t, check }) => {
              const present = m.marks.filter(
                (x) => x.status === "present" && x.practice !== "optional",
              );
              const kind = c.education.settings.types.find(
                (x) => x.key === m.kind,
              );
              return (
                <tr key={m.id + t}>
                  <td>{teacherOf(c, t)}</td>
                  <td>
                    <a className="text-action" href={"#meeting/" + m.id}>
                      {m.group ? groupOf(c, m.group) : courseOf(c, m.course)}
                    </a>
                    <small className="subline">{clock(m.from)}</small>
                  </td>
                  <td>
                    <Badge value={check?.state} />
                    {check?.reason && (
                      <small className="subline">{check.reason}</small>
                    )}
                    {check?.state === "verified" && (
                      <small className="subline">
                        {new Intl.DateTimeFormat("ar-JO-u-nu-latn", {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: c.center.timeZone,
                        }).format(new Date(check.at))}
                      </small>
                    )}
                  </td>
                  <td>
                    {m.attendanceBy === t
                      ? `${m.marks.filter((x) => x.status).length} / ${m.roster.length}`
                      : "—"}
                  </td>
                  <td>
                    {m.lessonBy === t && kind?.lesson
                      ? m.lesson
                        ? "مسجّل"
                        : "ناقص"
                      : "—"}
                  </td>
                  <td>
                    {m.practiceBy === t && kind?.practice
                      ? `${present.filter((x) => x.practice === "done" || x.practice === "skip").length} / ${present.length}`
                      : "—"}
                  </td>
                  <td>
                    {admin(c) && (
                      <Button
                        kind="outline"
                        onClick={() => setItem({ meeting: m.id, teacher: t })}
                      >
                        مراجعة
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        ) : (
          <Empty title="لا توجد لقاءات في التاريخ المحدد" />
        )}
      </div>
      {item && (
        <Dialog
          title={"مراجعة دوام " + teacherOf(c, item.teacher)}
          close={() => setItem(null)}
          submit={async (form) => {
            await api(
              f(c, "/work/checkins/" + item.meeting + "/review"),
              "POST",
              {
                teacher: item.teacher,
                state: val(form, "state"),
                reason: val(form, "reason"),
              },
            );
            await c.refresh();
            c.notify("حُفظت مراجعة الدوام");
          }}
        >
          <Field label="النتيجة">
            <Select name="state" defaultValue="manual"
              options={[{ value: "manual", name: "اعتماد حضور يدويًا" }, { value: "absent", name: "غياب معتمد" }]}
            />
          </Field>
          <Field label="سبب القرار">
            <textarea name="reason" required />
          </Field>
        </Dialog>
      )}
    </>
  );
}
export function PasskeyPage({ c }: { c: Context }) {
  const [rows, setRows] = useState<{ id: string }[]>([]);
  const [error, setError] = useState("");
  const [revoke, setRevoke] = useState("");
  const android = isAndroidApp();
  const path = f(c, android ? "/identity/android-attendance" : "/identity/passkeys");
  const load = () =>
    api<{ id: string }[]>(path)
      .then(setRows)
      .catch((e) => setError(message(e)));
  useEffect(() => {
    void load();
  }, [path]);
  return (
    <>
      <PageHead
        title={android ? "بصمة إثبات الحضور" : "مفتاح إثبات الحضور"}
        desc={android
          ? "فعّل بصمة الحضور مرة واحدة لكل هاتف تستخدمه."
          : "أضف مفتاحًا على هذا الجهاز لتأكيد حضورك بالبصمة أو رمز قفل الجهاز."}
      >
        <PasskeyAction
          title={android ? "تفعيل بصمة الحضور" : "إعداد مفتاح على هذا الجهاز"}
          description={android
            ? "تابع لتأكيد بصمتك في نافذة Android. إذا لم تسجّل بصمة إصبع، أضفها من إعدادات الهاتف."
            : "احفظ مفتاح الحضور على هذا الجهاز عند ظهور نافذة الحفظ."}
          prepare={async () => {
            const enroll = await prepareDeviceEnrollment(path);
            return async () => {
              await enroll();
              await load();
              c.notify(android ? "تم تفعيل بصمة الحضور" : "أُضيف مفتاح المرور");
            };
          }}
        >
          <Fingerprint size={18} />
          {android ? "تفعيل البصمة" : "إضافة مفتاح مرور"}
        </PasskeyAction>
        {androidBiometricsAvailable() && (
          <Button kind="outline" onClick={() => {
            setError("");
            void openAndroidBiometricSettings().catch((failure) => setError(devicePasskeyError(failure)));
          }}>
            إعدادات البصمة على الهاتف
          </Button>
        )}
      </PageHead>
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="card">
        <CardHead
          title={android ? "أجهزة Android المرتبطة بحسابك" : "مفاتيح حسابك"}
          desc={android ? undefined : "يطلب الجهاز بصمة أو رمز قفله عند التحقق."}
        />
        <div className="list-stack">
          {rows.map((row, i) => (
            <div className="list-row" key={row.id}>
              <span className="row-link">
                <span className="mini-icon">
                  <ShieldCheck size={16} />
                </span>
                {android ? "جهاز" : "مفتاح"} {i + 1} · <bdi>{row.id.slice(0, 8)}</bdi>
              </span>
              <Button kind="outline" onClick={() => setRevoke(row.id)}>
                <Trash2 size={15} />
                إبطال
              </Button>
            </div>
          ))}
        </div>
        {!rows.length && <Empty title={android ? "لم تُفعّل البصمة على أي هاتف بعد" : "لم تضف مفتاح مرور بعد"} />}
      </div>
      {revoke && (
        <Dialog
          title={android ? "إبطال بصمة هذا الجهاز" : "إبطال مفتاح المرور"}
          close={() => setRevoke("")}
          confirm="إبطال"
          submit={async () => {
            await revokeAttendanceDevice(path, revoke);
            await load();
          }}
        >
          <p>{android
            ? "يلزم تفعيل بصمة الحضور مرة ثانية لاستخدام هذا الهاتف."
            : "تحتاج مفتاح مرور صالحًا لإثبات الحضور في اللقاءات القادمة."}</p>
        </Dialog>
      )}
    </>
  );
}

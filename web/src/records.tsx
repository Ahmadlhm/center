import { useEffect, useState } from "react";
import { Download, FileCheck2, FileUp, Pencil, Trash2 } from "lucide-react";
import {
  api,
  clock,
  date,
  go,
  groupOf,
  message,
  studentOf,
  type Group,
  type Context,
  type Certificate,
  type Meeting,
} from "./model";
import {
  Button,
  CardHead,
  Dialog,
  Empty,
  ErrorBox,
  Field,
  Select,
  Table,
  options,
  val,
} from "./ui";
import { admin, f } from "./learning";
export function MeetingForm({
  c,
  group,
  course,
  close,
  replaces,
  defaults,
  teachers,
  recitation = false,
}: {
  c: Context;
  group?: string;
  course?: string;
  close: () => void;
  replaces?: string;
  defaults?: Group;
  teachers?: string[];
  recitation?: boolean;
}) {
  const entries = options(
    c.staff.filter(
      (x) =>
        x.active &&
        x.roles.includes("teacher") &&
        (!teachers || teachers.includes(x.id)),
    ),
  );
  const meetingTypes = recitation
    ? c.catalog.tajweedTypes
    : c.education.settings.types;
  const [kind, setKind] = useState(meetingTypes[0]?.key ?? "");
  const withMemorization = meetingTypes.some(
    (x) => x.key === kind && x.practice,
  );
  const [lead, setLead] = useState(
    defaults?.teacher ?? entries[0]?.value ?? "",
  );
  const [lesson, setLesson] = useState("");
  const [practice, setPractice] = useState("");
  return (
    <Dialog
      title={replaces ? "لقاء تعويضي" : "جدولة لقاء"}
      close={close}
      submit={async (form) => {
        const m = await api<Meeting>(f(c, "/education/meetings"), "POST", {
          group: group ?? null,
          course: course ?? null,
          replaces: replaces ?? null,
          date: val(form, "date"),
          from: val(form, "from"),
          to: val(form, "to"),
          kind,
          attendanceBy: lead,
          lessonBy: lesson || lead,
          practiceBy: withMemorization ? practice || lead : lesson || lead,
        });
        await c.refresh();
        c.notify("جُدول اللقاء");
        go("meeting/" + m.id);
      }}
    >
      <div className="form-grid">
        <Field label="التاريخ">
          <input
            type="date"
            name="date"
            defaultValue={c.people.today}
            required
          />
        </Field>
        <Field label="نوع اللقاء">
          <Select
            options={meetingTypes.map((x) => ({
              value: x.key,
              name: x.name,
            }))}
            value={kind}
            onChange={setKind}
          />
        </Field>
        <Field label="البداية">
          <input
            type="time"
            name="from"
            defaultValue={clock(defaults?.from ?? "16:00")}
            required
          />
        </Field>
        <Field label="النهاية">
          <input
            type="time"
            name="to"
            defaultValue={clock(defaults?.to ?? "17:30")}
            required
          />
        </Field>
        <Field label="مسؤول كشف الحضور" wide>
          <Select
            options={entries}
            value={lead}
            onChange={setLead}
            placeholder="اختر معلّمًا"
            required
          />
        </Field>
        <Field label={recitation ? "مسؤول لقاء التجويد" : "مسؤول الدرس"}>
          <Select
            options={entries}
            value={lesson}
            onChange={setLesson}
            placeholder="مسؤول الحضور"
          />
        </Field>
        {withMemorization && (
          <Field label="مسؤول التسميع">
            <Select
              options={entries}
              value={practice}
              onChange={setPractice}
              placeholder="مسؤول الحضور"
            />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
export function ScheduleForm({
  c,
  meeting,
  close,
}: {
  c: Context;
  meeting: Meeting;
  close: () => void;
}) {
  const [teacher, setTeacher] = useState(meeting.attendanceBy);
  const [cancel, setCancel] = useState(false);
  return (
    <Dialog
      title="تعديل موعد اللقاء"
      close={close}
      submit={async (form) => {
        await api(
          f(c, "/education/meetings/" + meeting.id + "/schedule"),
          "PUT",
          {
            version: meeting.version,
            cancel,
            date: cancel ? meeting.date : val(form, "date"),
            from: cancel ? meeting.from : val(form, "from"),
            to: cancel ? meeting.to : val(form, "to"),
            teacher,
            reason: val(form, "reason"),
          },
        );
        await c.refresh();
        c.notify("حُدّث الموعد");
      }}
    >
      <div className="form-grid">
        <label className="check-line wide">
          <input
            type="checkbox"
            checked={cancel}
            onChange={(e) => setCancel(e.target.checked)}
          />{" "}
          إلغاء اللقاء
        </label>
        {!cancel && (
          <>
            <Field label="التاريخ">
              <input
                name="date"
                type="date"
                defaultValue={meeting.date}
                required
              />
            </Field>
            <Field label="المعلّم المكلّف">
              <Select
                options={options(
                  c.staff.filter(
                    (s) => s.active && s.roles.includes("teacher"),
                  ),
                )}
                value={teacher}
                onChange={setTeacher}
                required
              />
            </Field>
            <Field label="البداية">
              <input
                name="from"
                type="time"
                defaultValue={clock(meeting.from)}
                required
              />
            </Field>
            <Field label="النهاية">
              <input
                name="to"
                type="time"
                defaultValue={clock(meeting.to)}
                required
              />
            </Field>
          </>
        )}
        <Field label="سبب التعديل" wide>
          <textarea name="reason" required />
        </Field>
      </div>
    </Dialog>
  );
}
export function Documents({
  c,
  group,
  student,
  canUpload,
  groups = [],
}: {
  c: Context;
  group?: string;
  student?: string;
  canUpload: boolean;
  groups?: string[];
}) {
  const [rows, setRows] = useState<Certificate[]>([]);
  const [error, setError] = useState("");
  const [upload, setUpload] = useState(false);
  const [remove, setRemove] = useState<Certificate>();
  const [link, setLink] = useState<Certificate>();
  const [target, setTarget] = useState(group ?? groups[0] ?? "");
  const [person, setPerson] = useState(student ?? "");
  const path = f(c, "/documents");
  const reload = () =>
    api<Certificate[]>(
      path + "?" + (group ? "group=" + group : "student=" + student),
    )
      .then(setRows)
      .catch((e) => setError(message(e)));
  useEffect(() => {
    void reload();
  }, [path, group, student]);
  const people = c.people.students.filter((s) =>
    c.people.enrollments.some((e) => e.student === s.id && e.group === target),
  );
  return (
    <div className="card">
      <CardHead
        title={group ? "مجلد الشعبة" : "شهادات الطالب"}
        desc="شهادات التلاوة والمسابقة السنوية"
      >
        {canUpload && (
          <Button
            onClick={() => {
              setPerson(student ?? "");
              setUpload(true);
            }}
          >
            <FileUp size={17} />
            رفع شهادة
          </Button>
        )}
      </CardHead>
      {error && <ErrorBox>{error}</ErrorBox>}
      {rows.length ? (
        <Table
          headers={[
            "الشهادة",
            "التصنيف",
            group ? "الطالب" : "الشعبة",
            "تاريخ الرفع",
            "",
          ]}
        >
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <a className="row-link" href={path + "/" + r.id + "/file"}>
                  <span className="mini-icon">
                    <FileCheck2 size={16} />
                  </span>
                  {r.title}
                </a>
                <small className="subline">{r.name}</small>
              </td>
              <td>
                {r.category === "recitation" ? "التلاوة" : "المسابقة السنوية"}
              </td>
              <td>{group ? studentOf(c, r.student) : groupOf(c, r.group)}</td>
              <td>{date(r.uploadedAt.slice(0, 10))}</td>
              <td>
                <div className="actions">
                  <a className="btn outline" href={path + "/" + r.id + "/file"}>
                    <Download size={16} />
                    تنزيل
                  </a>
                  {group && canUpload && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="تعديل أو ربط الشهادة"
                      onClick={() => {
                        setPerson(r.student ?? "");
                        setLink(r);
                      }}
                    >
                      <Pencil size={16} />
                    </button>
                  )}
                  {admin(c) && (
                    <button
                      className="icon-button danger"
                      type="button"
                      aria-label="حذف الشهادة"
                      onClick={() => setRemove(r)}
                    >
                      <Trash2 size={17} />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <Empty
          title="لا توجد شهادات مرفوعة"
          desc={
            group ? "يمكن ربط الشهادة بطالب لتظهر أيضًا في ملفه." : undefined
          }
        />
      )}
      {upload && (
        <Dialog
          title="رفع شهادة"
          close={() => setUpload(false)}
          submit={async (form) => {
            form.set("group", target);
            form.set("student", person);
            await api(path, "POST", form);
            await reload();
            c.notify("رُفعت الشهادة");
          }}
        >
          <div className="form-grid">
            <Field label="عنوان الشهادة" wide>
              <input name="title" required />
            </Field>
            <Field label="نوع الشهادة">
              <select name="category">
                <option value="recitation">التلاوة</option>
                <option value="competition">المسابقة السنوية</option>
              </select>
            </Field>
            {student ? (
              <Field label="الشعبة">
                <Select
                  options={options(
                    c.people.groups.filter((g) => groups.includes(g.id)),
                  )}
                  value={target}
                  onChange={setTarget}
                  required
                />
              </Field>
            ) : (
              <Field label="ربط بطالب (اختياري)">
                <Select
                  options={options(people)}
                  value={person}
                  onChange={setPerson}
                  placeholder="شهادة عامة للشعبة"
                />
              </Field>
            )}
            <Field label="الملف · PDF أو PNG أو JPEG حتى 10 MB" wide>
              <input
                type="file"
                name="file"
                accept="application/pdf,image/png,image/jpeg"
                required
              />
            </Field>
          </div>
        </Dialog>
      )}
      {link && (
        <Dialog
          title="تعديل بيانات الشهادة"
          close={() => setLink(undefined)}
          submit={async (form) => {
            await api(path + "/" + link.id, "PUT", {
              title: val(form, "title"),
              category: val(form, "category"),
              student: person || null,
            });
            await reload();
            c.notify("حُدّثت الشهادة");
          }}
        >
          <Field label="عنوان الشهادة">
            <input name="title" required defaultValue={link.title} />
          </Field>
          <Field label="نوع الشهادة">
            <select name="category" defaultValue={link.category}>
              <option value="recitation">التلاوة</option>
              <option value="competition">المسابقة السنوية</option>
            </select>
          </Field>
          <Field label="الطالب المرتبط">
            <Select
              options={options(people)}
              value={person}
              onChange={setPerson}
              placeholder="شهادة عامة للشعبة"
            />
          </Field>
        </Dialog>
      )}
      {remove && (
        <Dialog
          title="حذف الشهادة"
          close={() => setRemove(undefined)}
          confirm="حذف"
          submit={async () => {
            await api(path + "/" + remove.id, "DELETE");
            await reload();
            c.notify("حُذفت الشهادة");
          }}
        >
          <p>سيُحذف ملف «{remove.title}» من مجلد الشعبة وملف الطالب.</p>
        </Dialog>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import {
  BookOpen,
  CalendarDays,
  ChevronLeft,
  GraduationCap,
  Trophy,
} from "lucide-react";
import {
  api,
  clock,
  date,
  fmt,
  go,
  groupOf,
  message,
  studentOf,
  teacherOf,
  uid,
  unitPath,
  type Category,
  type Contest,
  type Context,
  type Course,
  type Meeting,
} from "./model";
import {
  Add,
  Badge,
  Button,
  CardHead,
  Checks,
  Dialog,
  Empty,
  ErrorBox,
  Field,
  PageHead,
  SearchBox,
  Select,
  Table,
  num,
  options,
  val,
} from "./ui";
import { admin, f } from "./learning";
import { MeetingForm } from "./records";
const types = [
  { value: "private", name: "خاصة بالشعبة" },
  { value: "central", name: "مركزية" },
  { value: "recitation", name: "تلاوة" },
];
const typeLabel = (v: string) => types.find((x) => x.value === v)?.name ?? v;
export function Courses({
  c,
  recitation = false,
}: {
  c: Context;
  recitation?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [edit, setEdit] = useState(false);
  const [commission, setCommission] = useState(false);
  const can = admin(c) || c.center.roles.includes("teacher");
  const rows = c.education.courses.filter(
    (x) =>
      (recitation ? x.type === "recitation" : x.type !== "recitation") &&
      (!status || x.status === status) &&
      x.name.includes(search),
  );
  return (
    <>
      <PageHead
        title={recitation ? "دورات التلاوة" : "الدورات"}
        desc={
          recitation
            ? "مستويات التلاوة والمشاركون والنتائج."
            : "الدورات الخاصة بالشعب والبرامج المركزية."
        }
      >
        {admin(c) && (
          <Button kind="outline" onClick={() => setCommission(true)}>
            تكليف بإنشاء دورة
          </Button>
        )}
        {can && <Add onClick={() => setEdit(true)}>إضافة دورة</Add>}
      </PageHead>
      <div className="toolbar">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="ابحث عن دورة"
        />
        <Select
          value={status}
          onChange={setStatus}
          placeholder="جميع الحالات"
          options={[
            { value: "active", name: "قائمة" },
            { value: "closed", name: "منتهية" },
          ]}
        />
      </div>
      {recitation && (
        <div className="level-strip">
          {c.education.settings.levels.map((x, i) => (
            <span key={x}>
              <GraduationCap size={16} />
              {x}
              <b>
                {fmt(
                  c.education.courses.filter(
                    (y) => y.level === x && y.status === "active",
                  ).length,
                )}
              </b>
              {i < 0 && null}
            </span>
          ))}
        </div>
      )}
      {rows.length ? (
        <div className="group-grid">
          {rows.map((r) => (
            <article className="card group-card" key={r.id}>
              <div className="group-top">
                <span className="metric-icon mint">
                  {recitation ? (
                    <GraduationCap size={21} />
                  ) : (
                    <BookOpen size={21} />
                  )}
                </span>
                <Badge value={r.status} />
              </div>
              <div className="eyebrow">{r.level ?? typeLabel(r.type)}</div>
              <h2>
                <a href={"#course/" + r.id}>{r.name}</a>
              </h2>
              <div className="group-meta">
                {r.teachers.map((x) => teacherOf(c, x)).join("، ")}
              </div>
              <p>
                {r.groups.map((x) => groupOf(c, x)).join("، ") ||
                  "طلاب من المركز"}
              </p>
              <div className="group-foot">
                <a href={"#course/" + r.id}>
                  تفاصيل الدورة <ChevronLeft size={16} />
                </a>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="card">
          <Empty title="لا توجد دورات مطابقة" />
        </div>
      )}
      {edit && (
        <CourseForm
          c={c}
          recitation={recitation}
          close={() => setEdit(false)}
        />
      )}
      {commission && (
        <CommissionForm c={c} close={() => setCommission(false)} />
      )}
      {!admin(c) &&
        can &&
        c.education.commissions.some((x) => x.state === "open") && (
          <div className="card panel">
            <h2>تكليفات إنشاء الدورات</h2>
            {c.education.commissions
              .filter((x) => x.state === "open")
              .map((x) => (
                <div className="list-row" key={x.id}>
                  <span>{x.title}</span>
                  <Button kind="outline" onClick={() => setEdit(true)}>
                    إنشاء دورة
                  </Button>
                </div>
              ))}
          </div>
        )}
    </>
  );
}
function CommissionForm({ c, close }: { c: Context; close: () => void }) {
  const [teacher, setTeacher] = useState("");
  const [groups, setGroups] = useState<string[]>([]);
  return (
    <Dialog
      title="تكليف بإنشاء دورة"
      close={close}
      submit={async (form) => {
        await api(f(c, "/education/commissions"), "POST", {
          title: val(form, "title"),
          teacher,
          groups,
        });
        await c.refresh();
        c.notify("أُرسل التكليف إلى المعلّم");
      }}
    >
      <Field label="عنوان التكليف">
        <input name="title" required />
      </Field>
      <Field label="المعلّم">
        <Select
          options={options(
            c.staff.filter((x) => x.active && x.roles.includes("teacher")),
          )}
          value={teacher}
          onChange={setTeacher}
          placeholder="اختر معلّمًا"
          required
        />
      </Field>
      <div className="field">
        <span>الشعب المعنية</span>
        <Checks
          options={options(c.people.groups)}
          value={groups}
          onChange={setGroups}
        />
      </div>
    </Dialog>
  );
}
function CourseForm({
  c,
  recitation,
  course,
  close,
}: {
  c: Context;
  recitation?: boolean;
  course?: Course;
  close: () => void;
}) {
  const [type, setType] = useState(
    course?.type ?? (recitation ? "recitation" : "private"),
  );
  const [level, setLevel] = useState(
    course?.level ?? c.education.settings.levels[0] ?? "",
  );
  const [teachers, setTeachers] = useState(course?.teachers ?? []);
  const [groups, setGroups] = useState(course?.groups ?? []);
  const [students, setStudents] = useState(course?.students ?? []);
  const [commission, setCommission] = useState(course?.commission ?? "");
  const [filter, setFilter] = useState("");
  const isAdmin = admin(c);
  const assigned = c.education.commissions.find((x) => x.id === commission);
  const eligible = c.people.students.filter(
    (x) =>
      x.name.includes(filter) &&
      (!groups.length ||
        c.people.enrollments.some(
          (e) => e.student === x.id && groups.includes(e.group),
        )),
  );
  const canEditGroups = isAdmin || type === "private";
  return (
    <Dialog
      title={course ? "تعديل الدورة" : "إضافة دورة"}
      close={close}
      wide
      submit={async (form) => {
        const id = course?.id ?? uid();
        await api(f(c, "/education/courses/" + id), "PUT", {
          name: val(form, "name"),
          type,
          level: type === "recitation" ? level : null,
          teachers: isAdmin ? teachers : [c.user.id],
          groups: canEditGroups
            ? groups
            : (assigned?.groups ?? course?.groups ?? []),
          students: type === "recitation" ? students : [],
          status: val(form, "status"),
          criterion: val(form, "criterion"),
          commission: commission || null,
        });
        await c.refresh();
        c.notify("حُفظت الدورة");
        go("course/" + id);
      }}
    >
      <div className="form-grid">
        <Field label="اسم الدورة" wide>
          <input name="name" required defaultValue={course?.name} />
        </Field>
        {!recitation && !course && (
          <Field label="نوع الدورة">
            <Select
              options={types.filter((x) => x.value !== "recitation")}
              value={type}
              onChange={(v) => {
                setType(v);
                setGroups([]);
                setCommission("");
              }}
            />
          </Field>
        )}
        {type === "recitation" && (
          <Field label="مستوى التلاوة">
            <Select
              options={c.education.settings.levels.map((x) => ({
                value: x,
                name: x,
              }))}
              value={level}
              onChange={setLevel}
            />
          </Field>
        )}
        <Field label="حالة الدورة">
          <select name="status" defaultValue={course?.status ?? "active"}>
            <option value="active">قائمة</option>
            <option value="closed">منتهية</option>
          </select>
        </Field>
        <Field label="معيار الاجتياز">
          <select name="criterion" defaultValue={course?.criterion ?? "manual"}>
            <option value="manual">اعتماد المعلّم</option>
            <option value="complete">حضور جميع اللقاءات</option>
          </select>
        </Field>
        {!isAdmin && type !== "private" && !course && (
          <Field label="التكليف الإداري" wide>
            <Select
              options={c.education.commissions
                .filter((x) => x.state === "open")
                .map((x) => ({ value: x.id, name: x.title }))}
              value={commission}
              onChange={setCommission}
              required
              placeholder="اختر تكليفًا"
            />
          </Field>
        )}
        {canEditGroups &&
          (type === "private" ? (
            <Field label="الشعبة" wide>
              <Select
                options={options(
                  c.people.groups.filter(
                    (x) => isAdmin || x.teacher === c.user.id,
                  ),
                )}
                value={groups[0] ?? ""}
                onChange={(v) => setGroups([v])}
                placeholder="اختر شعبة"
                required
              />
            </Field>
          ) : (
            <div className="field wide">
              <span>الشعب المعنية</span>
              <Checks
                options={options(c.people.groups)}
                value={groups}
                onChange={setGroups}
              />
            </div>
          ))}
        {isAdmin && (
          <div className="field wide">
            <span>المعلّمون المكلّفون</span>
            <Checks
              options={options(
                c.staff.filter((x) => x.active && x.roles.includes("teacher")),
              )}
              value={teachers}
              onChange={setTeachers}
            />
          </div>
        )}
        {isAdmin && type === "recitation" && (
          <div className="field wide">
            <span>المشاركون ({students.length})</span>
            <SearchBox
              value={filter}
              onChange={setFilter}
              placeholder="ابحث عن مشارك"
            />
            <div className="scroll-checks">
              <Checks
                options={options(eligible)}
                value={students}
                onChange={setStudents}
              />
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
type CourseData = {
  course: Course;
  students: { id: string; name: string; number: string }[];
  meetings: Meeting[];
  grades: { student: string; state: string; date: string }[];
};
export function CourseDetail({ c, id }: { c: Context; id: string }) {
  const [data, setData] = useState<CourseData>();
  const [error, setError] = useState("");
  const [modal, setModal] = useState("");
  const [student, setStudent] = useState("");
  const reload = () =>
    api<CourseData>(f(c, "/education/courses/" + id))
      .then(setData)
      .catch((e) => setError(message(e)));
  useEffect(() => {
    void reload();
  }, [c.people, id]);
  if (!data)
    return error ? (
      <ErrorBox>{error}</ErrorBox>
    ) : (
      <Empty title="جارٍ تحميل الدورة…" />
    );
  const course = data.course;
  const canTeach = admin(c) || course.teachers.includes(c.user.id);
  const canEdit = admin(c) || course.owner === c.user.id;
  return (
    <>
      <PageHead
        title={course.name}
        desc={
          (course.level ?? typeLabel(course.type)) +
          " · " +
          course.teachers.map((x) => teacherOf(c, x)).join("، ")
        }
        crumb={
          <a href={course.type === "recitation" ? "#recitation" : "#courses"}>
            الدورات
          </a>
        }
      >
        <Badge value={course.status} />
        {canEdit && (
          <Button kind="outline" onClick={() => setModal("edit")}>
            تعديل الدورة
          </Button>
        )}
        {canEdit && <Add onClick={() => setModal("meeting")}>جدولة لقاء</Add>}
      </PageHead>
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="card">
        <CardHead title="لقاءات الدورة" />
        {data.meetings.length ? (
          <Table headers={["الموعد", "الوقت", "الحالة", "الدرس", ""]}>
            {data.meetings.map((m) => (
              <tr key={m.id}>
                <td>{date(m.date)}</td>
                <td dir="ltr">
                  {clock(m.from)} – {clock(m.to)}
                </td>
                <td>
                  <Badge value={m.state} />
                </td>
                <td>{m.lesson || "—"}</td>
                <td>
                  <a className="text-action" href={"#meeting/" + m.id}>
                    فتح الكشف <ChevronLeft size={15} />
                  </a>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty title="لا توجد لقاءات بعد" />
        )}
      </div>
      <div className="card">
        <CardHead
          title="المشاركون"
          desc={fmt(data.students.length) + " طالبًا في الدورة"}
        />
        {data.students.length ? (
          <Table headers={["الطالب", "حضر", "النتيجة", ""]}>
            {data.students.map((s) => {
              const grade = data.grades.find((x) => x.student === s.id);
              return (
                <tr key={s.id}>
                  <td>
                    {c.people.students.some((x) => x.id === s.id) ? (
                      <a className="text-action" href={"#student/" + s.id}>
                        {s.name}
                      </a>
                    ) : (
                      s.name
                    )}
                  </td>
                  <td>
                    {fmt(
                      data.meetings.filter(
                        (m) =>
                          m.state !== "cancelled" &&
                          m.marks.some(
                            (x) => x.student === s.id && x.status === "present",
                          ),
                      ).length,
                    )}
                  </td>
                  <td>
                    <Badge value={grade?.state ?? "registered"} />
                  </td>
                  <td>
                    {canTeach && (
                      <Button
                        kind="outline"
                        onClick={() => {
                          setStudent(s.id);
                          setModal("grade");
                        }}
                      >
                        تسجيل النتيجة
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        ) : (
          <Empty title="لا يوجد طلاب مسجلون" />
        )}
      </div>
      {modal === "edit" && (
        <CourseForm c={c} course={course} close={() => setModal("")} />
      )}
      {modal === "meeting" && (
        <MeetingForm
          c={c}
          course={course.id}
          teachers={course.teachers}
          close={() => setModal("")}
        />
      )}
      {modal === "grade" && (
        <Dialog
          title="نتيجة الطالب في الدورة"
          close={() => setModal("")}
          submit={async (form) => {
            await api(
              f(
                c,
                "/education/courses/" +
                  course.id +
                  "/students/" +
                  student +
                  "/grade",
              ),
              "PUT",
              { state: val(form, "state") },
            );
            await reload();
            c.notify("حُفظت النتيجة");
          }}
        >
          <Field label="النتيجة">
            <select
              name="state"
              defaultValue={
                data.grades.find((x) => x.student === student)?.state ??
                "registered"
              }
            >
              <option value="registered">مسجّل</option>
              <option value="completed">أكمل الدورة</option>
              <option value="passed">اجتاز التقييم</option>
            </select>
          </Field>
        </Dialog>
      )}
    </>
  );
}
export function Contests({ c }: { c: Context }) {
  const [id, setId] = useState(c.education.competitions[0]?.id ?? "");
  const [form, setForm] = useState("");
  const [student, setStudent] = useState("");
  const [category, setCategory] = useState("");
  const contest = c.education.competitions.find((x) => x.id === id);
  const rows = c.education.entries.filter((x) => x.competition === id);
  return (
    <>
      <PageHead
        title="المسابقة السنوية"
        desc="الفئات والمشاركون ونتائج المسابقات القرآنية."
      >
        {admin(c) && <Add onClick={() => setForm("new")}>إضافة مسابقة</Add>}
      </PageHead>
      {contest ? (
        <>
          <div className="card panel">
            <div className="contests-head">
              <span className="metric-icon sand">
                <Trophy size={24} />
              </span>
              <div>
                <h2>{contest.name}</h2>
                <p>
                  <CalendarDays size={15} /> {date(contest.date, true)}
                </p>
              </div>
              <Select
                options={options(c.education.competitions)}
                value={id}
                onChange={setId}
              />
            </div>
            <div className="level-strip">
              {contest.categories.map((x) => (
                <span key={x.id}>
                  {x.name}
                  <b>
                    {x.minAge !== null || x.maxAge !== null
                      ? (x.minAge ?? 0) + "–" + (x.maxAge ?? "∞") + " سنة"
                      : "العمر مفتوح"}
                  </b>
                </span>
              ))}
            </div>
          </div>
          <div className="card">
            <CardHead
              title="المشاركون والنتائج"
              desc={
                contest.multiple
                  ? "يمكن للمؤهل المشاركة في أكثر من فئة."
                  : "مشاركة واحدة لكل طالب."
              }
            >
              {admin(c) && (
                <div className="actions">
                  <Button kind="outline" onClick={() => setForm("edit")}>
                    تعديل المسابقة
                  </Button>
                  <Add
                    onClick={() => {
                      setStudent("");
                      setCategory("");
                      setForm("entry");
                    }}
                  >
                    إضافة مشاركة
                  </Add>
                </div>
              )}
            </CardHead>
            {rows.length ? (
              <Table headers={["الطالب", "الفئة", "الدرجة", "المركز", ""]}>
                {rows.map((x) => (
                  <tr key={x.student + x.category}>
                    <td>{studentOf(c, x.student)}</td>
                    <td>
                      {
                        contest.categories.find((y) => y.id === x.category)
                          ?.name
                      }
                    </td>
                    <td>{x.score ?? "—"}</td>
                    <td>{x.rank ?? "—"}</td>
                    <td>
                      {admin(c) && (
                        <Button
                          kind="outline"
                          onClick={() => {
                            setStudent(x.student);
                            setCategory(x.category);
                            setForm("entry");
                          }}
                        >
                          تسجيل النتيجة
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty title="لا توجد مشاركات بعد" />
            )}
          </div>
        </>
      ) : (
        <div className="card">
          <Empty title="أضف أول مسابقة سنوية" />
        </div>
      )}
      {(form === "new" || form === "edit") && (
        <ContestForm
          c={c}
          contest={form === "edit" ? contest : undefined}
          close={() => setForm("")}
          selected={setId}
        />
      )}
      {form === "entry" && contest && (
        <Dialog
          title="مشاركة في المسابقة"
          close={() => setForm("")}
          submit={async (info) => {
            await api(
              f(c, "/education/competitions/" + id + "/entries"),
              "PUT",
              {
                student,
                category,
                score: num(info, "score"),
                rank: num(info, "rank"),
              },
            );
            await c.refresh();
            c.notify("حُفظت المشاركة");
          }}
        >
          <div className="form-grid">
            <Field label="الطالب">
              <Select
                options={options(c.people.students)}
                value={student}
                onChange={setStudent}
                required
                placeholder="اختر طالبًا"
              />
            </Field>
            <Field label="الفئة">
              <Select
                options={options(contest.categories)}
                value={category}
                onChange={setCategory}
                required
                placeholder="اختر فئة"
              />
            </Field>
            <Field label="الدرجة">
              <input
                name="score"
                type="number"
                min="0"
                max="100"
                step=".1"
                defaultValue={
                  rows.find(
                    (x) => x.student === student && x.category === category,
                  )?.score ?? ""
                }
              />
            </Field>
            <Field label="المركز">
              <input
                name="rank"
                type="number"
                min="1"
                defaultValue={
                  rows.find(
                    (x) => x.student === student && x.category === category,
                  )?.rank ?? ""
                }
              />
            </Field>
          </div>
        </Dialog>
      )}
    </>
  );
}
function ContestForm({
  c,
  contest,
  close,
  selected,
}: {
  c: Context;
  contest?: Contest;
  close: () => void;
  selected: (id: string) => void;
}) {
  const fresh = () => ({
    id: uid(),
    name: "",
    unit: null,
    minAge: null,
    maxAge: null,
  });
  const [rows, setRows] = useState<Category[]>(
    contest?.categories ?? [fresh()],
  );
  const set = (id: string, patch: Partial<Category>) =>
    setRows(rows.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  return (
    <Dialog
      title={contest ? "تعديل المسابقة" : "إضافة مسابقة سنوية"}
      close={close}
      wide
      submit={async (fdata) => {
        const id = contest?.id ?? uid();
        await api(f(c, "/education/competitions/" + id), "PUT", {
          name: val(fdata, "name"),
          date: val(fdata, "date"),
          multiple: fdata.has("multiple"),
          categories: rows,
        });
        await c.refresh();
        selected(id);
        c.notify("حُفظت المسابقة");
      }}
    >
      <div className="form-grid">
        <Field label="اسم المسابقة">
          <input name="name" required defaultValue={contest?.name} />
        </Field>
        <Field label="تاريخ المسابقة واحتساب العمر">
          <input
            name="date"
            type="date"
            required
            defaultValue={contest?.date ?? c.people.today}
          />
        </Field>
        <label className="check-line wide">
          <input
            name="multiple"
            type="checkbox"
            defaultChecked={contest?.multiple ?? true}
          />
          السماح بالمشاركة في أكثر من فئة
        </label>
      </div>
      {rows.map((r, i) => (
        <div className="reading-edit" key={r.id}>
          <div className="split">
            <b>الفئة {i + 1}</b>
            {rows.length > 1 && (
              <Button
                kind="ghost"
                onClick={() => setRows(rows.filter((x) => x.id !== r.id))}
              >
                إزالة
              </Button>
            )}
          </div>
          <div className="form-grid">
            <Field label="الاسم">
              <input
                required
                value={r.name}
                onChange={(e) => set(r.id, { name: e.target.value })}
              />
            </Field>
            <Field label="الوحدة المؤهلة">
              <Select
                options={c.people.units.map((u) => ({
                  value: u.id,
                  name: unitPath(c.people.units, u.id),
                }))}
                value={r.unit ?? ""}
                onChange={(v) => set(r.id, { unit: v || null })}
                placeholder="جميع الوحدات"
              />
            </Field>
            <Field label="أدنى عمر">
              <input
                type="number"
                min="0"
                value={r.minAge ?? ""}
                onChange={(e) =>
                  set(r.id, {
                    minAge: e.target.value === "" ? null : +e.target.value,
                  })
                }
              />
            </Field>
            <Field label="أعلى عمر">
              <input
                type="number"
                min="0"
                value={r.maxAge ?? ""}
                onChange={(e) =>
                  set(r.id, {
                    maxAge: e.target.value === "" ? null : +e.target.value,
                  })
                }
              />
            </Field>
          </div>
        </div>
      ))}
      <Button kind="outline" onClick={() => setRows([...rows, fresh()])}>
        إضافة فئة
      </Button>
    </Dialog>
  );
}

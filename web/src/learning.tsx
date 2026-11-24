import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  Clock3,
  FileUp,
  GraduationCap,
  Plus,
  UserRound,
  Users,
} from "lucide-react";
import {
  active,
  api,
  base,
  clock,
  date,
  dayOf,
  days,
  fmt,
  go,
  groupOf,
  message,
  offset,
  teacherOf,
  uid,
  unitPath,
  type Context,
  type Group,
  type Mark,
  type Meeting,
  type Span,
  type Student,
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
  Tabs,
  optional,
  options,
  val,
} from "./ui";
import { Documents, MeetingForm, ScheduleForm } from "./records";
export { MeetingDetail } from "./meeting";
export const admin = (c: Context) => c.center.roles.includes("admin");
export const editGroup = (c: Context, g: Group) =>
  admin(c) || (c.center.roles.includes("teacher") && g.teacher === c.user.id);
export const f = (c: Context, path: string) => base(c.center) + path;
export async function openMeeting(c: Context, group: Group, day: string) {
  try {
    const prior = c.education.meetings.find(
      (m) => m.group === group.id && m.date === day && m.state !== "cancelled",
    );
    const result =
      prior ??
      (await api<Meeting>(
        f(c, "/education/groups/" + group.id + "/meeting"),
        "POST",
        { date: day },
      ));
    go("meeting/" + result.id);
  } catch (e) {
    c.notify(message(e));
  }
}
const next = (g: Group, today: string) =>
  Array.from({ length: 8 }, (_, i) => offset(today, i)).find(
    (x) => x >= g.start && (!g.end || x < g.end) && g.days.includes(dayOf(x)),
  );
const teacherView = (c: Context) =>
  c.center.roles.includes("teacher") &&
  !c.center.roles.includes("admin") &&
  !c.center.roles.includes("manager");

const centerTime = (c: Context, now: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: c.center.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);

const inSession = (slot: Pick<Group, "from" | "to">, time: string) =>
  clock(slot.from) <= time && time < clock(slot.to);

function todaySession(c: Context, group: Group, time: string) {
  const meetings = c.education.meetings
    .filter((m) => m.group === group.id && m.date === c.people.today)
    .sort((a, b) => a.from.localeCompare(b.from));
  const available = meetings.filter((m) => m.state !== "cancelled");
  const meeting =
    available.find((m) => m.state !== "final" && inSession(m, time)) ??
    available.find((m) => m.state !== "final" && time < clock(m.from)) ??
    available.at(-1);
  return {
    meeting,
    scheduled: !!meeting || (!meetings.length && next(group, c.people.today) === c.people.today),
  };
}

function GroupSchedule({ g, count }: { g: Pick<Group, "from" | "to">; count: number }) {
  return (
    <div className="group-meta">
      <span><Clock3 size={16} /><bdi>{clock(g.from)} – {clock(g.to)}</bdi></span>
      <span><Users size={16} />{fmt(count)} طالبًا</span>
    </div>
  );
}

function TeacherGroups({ c, groups, filters }: { c: Context; groups: Group[]; filters: ReactNode }) {
  const today = c.people.today;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(timer);
  }, []);
  const time = centerTime(c, now);
  const entries = groups.map((g) => {
    const { meeting, scheduled } = todaySession(c, g, time);
    const count = c.people.enrollments.filter((e) => e.group === g.id && active(e, today)).length;
    return { g, slot: meeting ?? g, meeting, count, scheduled };
  }).sort((a, b) => a.slot.from.localeCompare(b.slot.from));
  const live = entries.find(({ slot, meeting, scheduled }) =>
    scheduled && meeting?.state !== "final" && inSession(slot, time),
  );
  const upcoming = entries.filter((entry) =>
    entry !== live && entry.scheduled && entry.meeting?.state !== "final" && time < clock(entry.slot.from),
  );
  const remaining = entries.filter((entry) => entry !== live && !upcoming.includes(entry));
  const tiles = (items: typeof entries) => items.map(({ g, slot, count }) => (
    <a className="card teacher-group-link" href={"#group/" + g.id} key={g.id}>
      <span>
        <small>{unitPath(c.people.units, g.unit)}</small>
        <h3>{g.name}</h3>
        <GroupSchedule g={slot} count={count} />
      </span>
      <ChevronLeft size={18} />
    </a>
  ));
  return (
    <div className="teacher-day">
      <header className="teacher-day-title">
        <div><p>{date(today, true)}</p><h1 aria-label="شُعَبي"><span className="my-groups-title" aria-hidden="true">شعَبي</span></h1></div>
        <small>{fmt(groups.length)} شعب</small>
      </header>
      {live ? (
        <section className="group-hero">
          <Badge value="active" text="الحصة الجارية" />
          <p>{unitPath(c.people.units, live.g.unit)}</p>
          <h2>{live.g.name}</h2>
          <GroupSchedule g={live.slot} count={live.count} />
          <a className="btn light" href={"#group/" + live.g.id}>فتح لوحة الشعبة <ArrowLeft size={18} /></a>
        </section>
      ) : !entries.some((entry) => entry.scheduled) ? (
        <div className="card"><Empty title={groups.length ? "ما عندك حصة اليوم" : "لا توجد شعب مطابقة"} /></div>
      ) : null}
      {upcoming.length > 0 && <section><h2>لاحقًا اليوم</h2>{tiles(upcoming)}</section>}
      {remaining.length > 0 && <section><h2>{live || upcoming.length ? "شعب أخرى" : "الشعب"}</h2>{tiles(remaining)}</section>}
      {filters}
    </div>
  );
}

export function Groups({
  c,
  configuration = false,
}: {
  c: Context;
  configuration?: boolean;
}) {
  const [editing, setEditing] = useState<Group>();
  const [search, setSearch] = useState("");
  const [unit, setUnit] = useState("");
  const [modal, setModal] = useState(false);
  function within(id: string | null): boolean {
    return (
      !unit ||
      (!!id &&
        (id === unit ||
          within(c.people.units.find((x) => x.id === id)?.parent ?? null)))
    );
  }
  const groups = c.people.groups
    .filter((g) => within(g.unit) && g.name.includes(search))
    .sort(
      (a, b) =>
        Number(next(b, c.people.today) === c.people.today) -
        Number(next(a, c.people.today) === c.people.today),
    );
  const filters = (
    <div className="toolbar">
      <SearchBox value={search} onChange={setSearch} placeholder="ابحث عن شعبة" />
      <Select options={options(c.people.units)} placeholder="جميع الوحدات" value={unit} onChange={setUnit} />
      <span className="toolbar-count">{fmt(groups.length)} شعب</span>
    </div>
  );
  if (!configuration && teacherView(c)) return <TeacherGroups c={c} groups={groups} filters={filters} />;
  return (
    <>
      <PageHead
        title="الشعب"
        desc="متابعة الشعب والجداول والحضور في المركز."
      >
        {configuration && (
          <Add
            onClick={() => {
              setEditing(undefined);
              setModal(true);
            }}
          >
            إضافة شعبة
          </Add>
        )}
      </PageHead>
      {filters}
      {groups.length ? (
        <div className="group-grid">
          {groups.map((g) => {
            const day = next(g, c.people.today);
            const count = c.people.enrollments.filter(
              (x) => x.group === g.id && active(x, c.people.today),
            ).length;
            return (
              <article className="card group-card" key={g.id}>
                <div className="group-top">
                  <span className="metric-icon mint">
                    <BookOpen size={22} />
                  </span>
                  {day === c.people.today && (
                    <Badge value="active" text="حصة اليوم" />
                  )}
                </div>
                <div className="eyebrow">
                  {unitPath(c.people.units, g.unit)}
                </div>
                <h2>
                  {configuration ? (
                    g.name
                  ) : (
                    <a href={"#group/" + g.id}>{g.name}</a>
                  )}
                </h2>
                <div className="group-meta">
                  <span>
                    <Users size={16} />
                    {fmt(count)} طالبًا
                  </span>
                  <span>
                    <Clock3 size={16} />
                    <bdi>
                      {clock(g.from)} – {clock(g.to)}
                    </bdi>
                  </span>
                </div>
                <p>
                  {day
                    ? "الموعد القادم · " + date(day, true)
                    : "لا يوجد موعد قادم"}
                </p>
                <div className="group-foot">
                  {configuration ? (
                    <Button
                      kind="outline"
                      onClick={() => {
                        setEditing(g);
                        setModal(true);
                      }}
                    >
                      تعديل الشعبة
                    </Button>
                  ) : (
                    <a href={"#group/" + g.id}>
                      لوحة الشعبة <ChevronLeft size={16} />
                    </a>
                  )}
                  {day === c.people.today &&
                    !configuration &&
                    editGroup(c, g) && (
                      <Button onClick={() => void openMeeting(c, g, day)}>
                        فتح حصة اليوم
                      </Button>
                    )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <Empty
            title="لا توجد شعب مطابقة"
            desc={
              admin(c)
                ? "أضف شعبة من هذه الشاشة أو غيّر التصفية."
                : "تظهر هنا الشعب المسندة إليك."
            }
          />
        </div>
      )}
      {modal && configuration && (
        <GroupForm c={c} group={editing} close={() => setModal(false)} />
      )}
    </>
  );
}
function GroupForm({
  c,
  group,
  close,
}: {
  c: Context;
  group?: Group;
  close: () => void;
}) {
  const [unit, setUnit] = useState(group?.unit ?? "");
  const [teacher, setTeacher] = useState(group?.teacher ?? "");
  const [period, setPeriod] = useState(group?.period ?? "");
  const [selected, setSelected] = useState(group?.days.map(String) ?? []);
  return (
    <Dialog
      title={group ? "تعديل الشعبة" : "إضافة شعبة"}
      close={close}
      submit={async (form) => {
        await api(f(c, "/people/groups/" + (group?.id ?? uid())), "PUT", {
          name: val(form, "name"),
          unit: unit || null,
          teacher,
          period: period || null,
          start: val(form, "start"),
          end: optional(form, "end"),
          from: val(form, "from"),
          to: val(form, "to"),
          effective: optional(form, "effective"),
          days: selected.map(Number),
        });
        await c.refresh();
        c.notify("حُفظت الشعبة");
      }}
    >
      <div className="form-grid">
        <Field label="اسم الشعبة" wide>
          <input name="name" defaultValue={group?.name} required />
        </Field>
        <Field label="الوحدة التابعة لها">
          <Select
            options={c.people.units
              .filter((x) => x.active)
              .map((x) => ({
                value: x.id,
                name: unitPath(c.people.units, x.id),
              }))}
            placeholder="في المركز مباشرة"
            value={unit}
            onChange={setUnit}
          />
        </Field>
        <Field label="المعلّم">
          <Select
            options={options(
              c.staff.filter((s) => s.active && s.roles.includes("teacher")),
            )}
            placeholder="اختر معلّمًا"
            value={teacher}
            onChange={setTeacher}
            required
          />
        </Field>
        <Field label="الفترة">
          <Select
            options={options(c.people.periods)}
            placeholder="شعبة مستمرة"
            value={period}
            onChange={setPeriod}
          />
        </Field>
        <Field label="بداية الشعبة">
          <input
            type="date"
            name="start"
            defaultValue={group?.start ?? c.people.today}
            required
          />
        </Field>
        <Field label="نهاية الشعبة (اختياري)">
          <input type="date" name="end" defaultValue={group?.end ?? ""} />
        </Field>
        {group && (
          <Field label="سريان التعديل">
            <input
              type="date"
              name="effective"
              min={c.people.today}
              defaultValue={c.people.today}
            />
          </Field>
        )}
        <Field label="وقت البداية">
          <input
            type="time"
            name="from"
            defaultValue={group ? clock(group.from) : "16:00"}
            required
          />
        </Field>
        <Field label="وقت النهاية">
          <input
            type="time"
            name="to"
            defaultValue={group ? clock(group.to) : "17:30"}
            required
          />
        </Field>
        <div className="field wide">
          <span>أيام الدوام</span>
          <Checks
            options={days.map((name, i) => ({ name, value: String(i) }))}
            value={selected}
            onChange={setSelected}
          />
        </div>
      </div>
    </Dialog>
  );
}
export function GroupDetail({ c, id }: { c: Context; id: string }) {
  const [tab, setTab] = useState("students");
  const [edit, setEdit] = useState(false);
  const [schedule, setSchedule] = useState<Meeting | null>(null);
  const [newMeeting, setNewMeeting] = useState(false);
  const [day, setDay] = useState(c.people.today);
  const [range, setRange] = useState("30");
  const group = c.people.groups.find((g) => g.id === id);
  if (!group) return <Empty title="الشعبة غير متاحة" />;
  const students = c.people.students.filter((x) =>
    c.people.enrollments.some(
      (e) => e.student === x.id && e.group === id && active(e, c.people.today),
    ),
  );
  const meetings = c.education.meetings
    .filter((x) => x.group === id)
    .sort((a, b) => b.date.localeCompare(a.date));
  const recent = meetings.filter(
    (m) =>
      m.date >= offset(c.people.today, -Number(range) + 1) &&
      m.date <= c.people.today &&
      m.state !== "cancelled",
  );
  const marks = recent.flatMap((x) => x.marks);
  const { meeting: todayMeeting, scheduled: hasSession } = todaySession(c, group, centerTime(c, new Date()));
  return (
    <>
      <PageHead
        title={group.name}
        desc={
          unitPath(c.people.units, group.unit) +
          " · " +
          teacherOf(c, group.teacher)
        }
        crumb={<a href="#groups">{teacherView(c) ? "شُعَبي" : "الشعب"}</a>}
      >
        {c.user.platform && (
          <Button kind="outline" onClick={() => setEdit(true)}>
            تعديل الشعبة
          </Button>
        )}
      </PageHead>
      <section className="group-hero">
        <p>{date(c.people.today, true)}</p>
        <h2>{hasSession ? "حصة اليوم" : "دوام الشعبة"}</h2>
        <GroupSchedule g={todayMeeting ?? group} count={students.length} />
        {todayMeeting ? (
          <a className="btn light" href={"#meeting/" + todayMeeting.id}>
            {todayMeeting.state === "final" ? "عرض الكشف المحفوظ" : "فتح كشف الحصة"} <ArrowLeft size={18} />
          </a>
        ) : hasSession && editGroup(c, group) ? (
          <Button kind="light" onClick={() => void openMeeting(c, group, c.people.today)}>
            فتح حصة اليوم <ArrowLeft size={18} />
          </Button>
        ) : null}
      </section>
      <div className="detail-summary">
        <Summary
          title="الطلاب الحاليون"
          value={fmt(students.length)}
          icon={<Users size={20} />}
        />
        <Summary
          title="الحصص في الفترة"
          value={fmt(recent.length)}
          icon={<CalendarDays size={20} />}
        />
        <Summary
          title="حالات الحضور"
          value={fmt(marks.filter((x) => x.status === "present").length)}
          icon={<Check size={20} />}
        />
        <Summary
          title="المقاطع المتقنة"
          value={fmt(
            marks
              .flatMap((x) => x.readings)
              .filter((x) => x.result === "passed").length,
          )}
          icon={<BookOpen size={20} />}
        />
      </div>
      <div className="card">
        <CardHead
          title="دوام الشعبة"
          desc={
            group.days.map((x) => days[x]).join("، ") +
            " · " +
            clock(group.from) +
            " – " +
            clock(group.to)
          }
        >
          <Select
            options={[
              { value: "7", name: "آخر 7 أيام" },
              { value: "30", name: "آخر 30 يومًا" },
              { value: "90", name: "آخر 90 يومًا" },
            ]}
            value={range}
            onChange={setRange}
          />
        </CardHead>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "students", name: "كشف الطلاب" },
          { value: "meetings", name: "الحصص والدروس" },
          { value: "documents", name: "مجلد الشعبة" },
        ]}
      />
      {tab === "students" && (
        <div className="card">
          {students.length ? (
            <Table headers={["الطالب", "رقم الطالب", "الحضور في الفترة", ""]}>
              {students.map((s) => (
                <tr key={s.id}>
                  <td>
                    <a className="row-link" href={"#student/" + s.id}>
                      <span className="mini-icon">
                        <UserRound size={15} />
                      </span>
                      {s.name}
                    </a>
                  </td>
                  <td>{s.number}</td>
                  <td>
                    {fmt(
                      marks.filter(
                        (m) => m.student === s.id && m.status === "present",
                      ).length,
                    )}{" "}
                    لقاء
                  </td>
                  <td>
                    <a href={"#student/" + s.id} className="text-action">
                      الملف <ChevronLeft size={15} />
                    </a>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty title="لا يوجد طلاب مسجّلون في الشعبة" />
          )}
        </div>
      )}
      {tab === "meetings" && (
        <div className="card">
          <CardHead
            title="اللقاءات"
            desc={recent.find((x) => x.lesson)?.lesson}
          >
            <div className="actions">
              {editGroup(c, group) && (
                <>
                  <input
                    type="date"
                    aria-label="تاريخ اللقاء"
                    value={day}
                    onChange={(e) => setDay(e.target.value)}
                  />
                  <Button
                    kind="outline"
                    onClick={() => void openMeeting(c, group, day)}
                  >
                    فتح الموعد المجدول
                  </Button>
                </>
              )}
              {admin(c) && (
                <Add onClick={() => setNewMeeting(true)}>إضافة لقاء</Add>
              )}
            </div>
          </CardHead>
          {meetings.length ? (
            <Table headers={["التاريخ", "الموعد", "الدرس", "الحالة", ""]}>
              {meetings.map((m) => (
                <tr key={m.id}>
                  <td>{date(m.date)}</td>
                  <td dir="ltr">
                    {clock(m.from)} – {clock(m.to)}
                  </td>
                  <td>{m.lesson || "—"}</td>
                  <td>
                    <Badge value={m.state} />
                  </td>
                  <td>
                    <div className="actions">
                      <a className="text-action" href={"#meeting/" + m.id}>
                        فتح الكشف
                      </a>
                      {admin(c) &&
                        (m.state !== "cancelled" ? (
                          <Button kind="ghost" onClick={() => setSchedule(m)}>
                            تعديل الموعد
                          </Button>
                        ) : (
                          <Button
                            kind="ghost"
                            onClick={() => {
                              setSchedule(m);
                              setNewMeeting(true);
                            }}
                          >
                            تعويض
                          </Button>
                        ))}
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty />
          )}
        </div>
      )}
      {tab === "documents" && (
        <Documents c={c} group={id} canUpload={editGroup(c, group)} />
      )}
      {edit && <GroupForm c={c} group={group} close={() => setEdit(false)} />}
      {newMeeting && (
        <MeetingForm
          c={c}
          group={id}
          replaces={schedule?.state === "cancelled" ? schedule.id : undefined}
          defaults={group}
          close={() => {
            setNewMeeting(false);
            setSchedule(null);
          }}
        />
      )}
      {schedule && !newMeeting && (
        <ScheduleForm
          c={c}
          meeting={schedule}
          close={() => setSchedule(null)}
        />
      )}
    </>
  );
}
export function Summary({
  title,
  value,
  icon,
}: {
  title: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <div className="summary card">
      <span className="metric-icon mint">{icon}</span>
      <div>
        <small>{title}</small>
        <b>{value}</b>
      </div>
    </div>
  );
}
export { Students, StudentDetail } from "./students";

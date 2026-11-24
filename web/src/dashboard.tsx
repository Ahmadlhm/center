import { useEffect, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowUpLeft,
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ClipboardCheck,
  Clock3,
  Download,
  FolderTree,
  GraduationCap,
  Plus,
  UserCheck,
  UserRound,
  Users,
} from "lucide-react";
import {
  active,
  api,
  base,
  clock,
  date,
  days,
  dayOf,
  fmt,
  go,
  groupOf,
  latestRulesByDate,
  offset,
  teacherOf,
  type Context,
} from "./model";
import { Badge, Button, CardHead, Empty, Select, Table } from "./ui";
import type { DutyList } from "./staff-duty";

const confirmed = (state?: string) => state === "verified" || state === "manual";

function CurrentDuty({ c }: { c: Context }) {
  const [now, setNow] = useState(() => new Date());
  const [duties, setDuties] = useState<DutyList>();
  const [stale, setStale] = useState(false);
  const { today, groups, students } = c.people;
  const showStaffShifts = c.center.roles.includes("admin");
  const dutyUrl = base(c.center) + "/work/duties?date=" + today;
  const { refresh } = c;
  useEffect(() => {
    let live = true;
    let refreshing = false;
    const update = async (reload: boolean) => {
      if (refreshing || (reload && document.hidden)) return;
      refreshing = true;
      setNow(new Date());
      try {
        await Promise.all([
          reload && refresh(),
          showStaffShifts && api<DutyList>(dutyUrl).then((data) => {
            if (live) setDuties(data);
          }),
        ]);
        if (live) setStale(false);
      } catch {
        if (live) setStale(true);
      } finally {
        refreshing = false;
      }
    };
    void update(false);
    const timer = window.setInterval(() => void update(true), 30000);
    const onVisibility = () => void update(true);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [dutyUrl, refresh, showStaffShifts]);

  const localTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: c.center.timeZone, hour: "2-digit", minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  const during = (from: string, to: string) => clock(from) <= localTime && localTime < clock(to);
  const todayMeetings = c.education.meetings.filter((meeting) => meeting.date === today);
  const officialGroups = new Set(todayMeetings.map((meeting) => meeting.group));
  const liveMeetings = todayMeetings.filter(
    (meeting) => meeting.state !== "cancelled" && during(meeting.from, meeting.to),
  );
  const studentIds = new Set(liveMeetings.flatMap((meeting) =>
    meeting.marks.filter(({ status }) => status === "present").map(({ student }) => student),
  ));
  const teacherIds = new Set(c.work.checkIns.filter((check) =>
    confirmed(check.state) && liveMeetings.some((meeting) =>
      meeting.id === check.meeting && meeting.teachers.includes(check.teacher),
    ),
  ).map(({ teacher }) => teacher));
  if (duties?.date === today) {
    for (const item of duties.items) {
      if (item.scheduled && item.shift && during(item.shift.from, item.shift.to) && confirmed(item.checkIn?.state)) {
        teacherIds.add(item.employee);
      }
    }
  }
  const liveStudents = students.filter(({ id }) => studentIds.has(id));
  const liveTeachers = c.staff.filter((teacher) => teacher.roles.includes("teacher") && teacherIds.has(teacher.id));
  const liveGroups = groups.flatMap((group) => {
    const meeting = liveMeetings.find((item) => item.group === group.id);
    const scheduled = !officialGroups.has(group.id) && group.start <= today &&
      (!group.end || today < group.end) &&
      group.days.includes(dayOf(today)) && during(group.from, group.to);
    return meeting || scheduled ? [{ group, meeting }] : [];
  });
  return (
    <section className="card current-duty">
      <header className="card-head">
        <div>
          <h1>الدوام الآن</h1>
          <p>يتحدّث تلقائيًا بحسب توقيت المركز وكشوف الحضور.</p>
        </div>
        <span className="duty-clock"><Clock3 size={16} /><bdi>{localTime}</bdi></span>
      </header>
      {stale && <p className="duty-notice" role="status">تعذّر تحديث الدوام. تظهر آخر البيانات المتاحة.</p>}
      <div className="current-duty-grid">
        <div className="duty-column">
          <h3><FolderTree size={18} /> الشعب في الدوام <b>{fmt(liveGroups.length)}</b></h3>
          {liveGroups.length ? <ul>{liveGroups.map(({ group, meeting }) => (
            <li key={group.id}>
              <a href={meeting ? "#meeting/" + meeting.id : "#group/" + group.id}>{group.name}</a>
              <small dir="ltr">{clock(meeting?.from ?? group.from)} – {clock(meeting?.to ?? group.to)}</small>
              {!meeting && <small>لم يُفتح الكشف</small>}
            </li>
          ))}</ul> : <p>لا توجد شعب في الدوام الآن.</p>}
        </div>
        <div className="duty-column">
          <h3><Users size={18} /> الطلاب الحاضرون <b>{fmt(liveStudents.length)}</b></h3>
          {liveStudents.length ? <ul>{liveStudents.map(({ id, name }) => (
            <li key={id}><a href={"#student/" + id}>{name}</a></li>
          ))}</ul> : <p>لم يُرصد حضور طلاب في الحصص الحالية.</p>}
        </div>
        <div className="duty-column">
          <h3><UserCheck size={18} /> المعلّمون الحاضرون <b>{fmt(liveTeachers.length)}</b></h3>
          {liveTeachers.length ? <ul>{liveTeachers.map(({ id, name }) => (
            <li key={id}>{name}</li>
          ))}</ul> : <p>لا يوجد حضور مؤكّد لمعلّمين الآن.</p>}
        </div>
      </div>
    </section>
  );
}

function rate(c: Context, from: string, end: string) {
  const currentByDate = latestRulesByDate(c.people.rules);
  const rows = c.education.meetings
    .filter((m) => m.date >= from && m.date <= end && m.state !== "cancelled")
    .flatMap((meeting) => {
      const rule =
        c.people.rules.find((x) => x.version === meeting.ruleVersion) ??
        currentByDate.find((x) => x.effective <= meeting.date) ??
        c.people.rule;
      return meeting.marks.map((mark) => ({ mark, rule }));
    });
  const yes = rows.filter((x) => x.mark.status === "present").length;
  const all = rows.filter(
    (x) =>
      x.mark.status === "present" ||
      x.mark.status === "absent" ||
      (x.mark.status === "excused" && x.rule.countExcused),
  ).length;
  return all ? Math.round((yes * 100) / all) : null;
}

export function Dashboard({ c }: { c: Context }) {
  const [week, setWeek] = useState("current");
  const today = c.people.today;
  const end = week === "current" ? today : offset(today, -7);
  const start = offset(end, -6);
  const current = c.people.groups.filter(
    (g) => g.start <= today && (!g.end || today < g.end),
  );
  const enrolled = new Set(
    c.people.enrollments
      .filter((e) => active(e, today) && current.some((g) => g.id === e.group))
      .map((e) => e.student),
  );
  const meetings = c.education.meetings
    .filter((m) => m.date === today && m.state !== "cancelled")
    .sort((a, b) => a.from.localeCompare(b.from));
  const attended = rate(c, start, end);
  const oldRate = rate(c, offset(end, -13), offset(end, -7));
  const courses = c.education.courses.filter((x) => x.status === "active");
  const past = c.education.meetings.filter(
    (m) => m.date === offset(today, -1) && m.state === "final",
  ).length;
  const todo = [
    ...c.work.tasks
      .filter(
        (t) =>
          t.state === "open" ||
          t.state === "returned" ||
          t.state === "submitted",
      )
      .map((t) => ({
        id: t.id,
        name: t.title,
        desc:
          teacherOf(c, t.teacher) +
          " · " +
          (t.due < today ? "تجاوز موعده" : "مستحق " + date(t.due)),
        type: t.due < today ? "danger" : "task",
        link: "tasks",
      })),
    ...meetings
      .filter((m) => m.state === "open" && m.marks.some((x) => !x.status))
      .map((m) => ({
        id: m.id,
        name: "استكمال كشف الحضور",
        desc:
          groupOf(c, m.group) +
          " · " +
          fmt(m.marks.filter((x) => !x.status).length) +
          " غير مرصود",
        type: "record",
        link: "meeting/" + m.id,
      })),
  ];
  const stats = [
    {
      name: "الطلاب النشطون",
      value: fmt(enrolled.size),
      note: "الطلاب المسجّلون حاليًا",
      icon: Users,
      tone: "mint",
      link: "students",
    },
    {
      name: "الشعب النشطة",
      value: fmt(current.length),
      note:
        fmt(c.people.units.filter((x) => !x.parent && x.active).length) +
        " وحدات رئيسية",
      icon: FolderTree,
      tone: "sand",
      link: "groups",
    },
    {
      name: "متوسط الحضور",
      value: attended === null ? "—" : fmt(attended) + "%",
      note:
        oldRate !== null && attended !== null
          ? (attended - oldRate >= 0 ? "+" : "") +
            fmt(attended - oldRate) +
            " نقطة عن الأسبوع السابق"
          : "خلال الفترة المعروضة",
      icon: UserCheck,
      tone: "mint",
      link: "reports",
    },
    {
      name: "الدورات القائمة",
      value: fmt(courses.length),
      note:
        fmt(courses.filter((x) => x.type === "recitation").length) +
        " دورات تلاوة",
      icon: GraduationCap,
      tone: "purple",
      link: "courses",
    },
  ];
  return (
    <>
      {c.center.roles.includes("admin") && current.length === 0 && (
        <section className="card panel setup-start">
          <CardHead
            title="لا توجد شعب نشطة بعد"
            desc="يمكن لمدير المنصة إضافة الشعب وإسنادها إلى المعلّمين من إعدادات المركز."
          />
        </section>
      )}
      <header className="dashboard-top">
        <div className="today-label">
          <CalendarDays size={16} />
          <time>{date(today, true)}</time>
        </div>
        <Button kind="outline" onClick={() => go("reports")}>
          <Download size={17} />
          تصدير تقرير
        </Button>
      </header>
      <CurrentDuty c={c} />
      <div className="section-title">
        <h2>نظرة عامة</h2>
        <span>
          <i /> بيانات المركز
        </span>
      </div>
      <section className="stats">
        {stats.map(({ name, value, note, icon: Icon, tone, link }) => (
          <a href={"#" + link} key={name} className="stat">
            <div className="stat-top">
              <span className={"metric-icon " + tone}>
                <Icon size={20} />
              </span>
              <ArrowUpLeft size={15} className="muted" />
            </div>
            <div className="stat-name">{name}</div>
            <strong dir="ltr">{value}</strong>
            <small>{note}</small>
          </a>
        ))}
      </section>
      <div className="dashboard-grid">
        <section className="card chart-card">
          <CardHead title="نسبة الحضور" desc="متابعة حضور الطلاب خلال الأسبوع">
            <Select
              className="compact-select"
              value={week}
              onChange={setWeek}
              aria-label="فترة الرسم"
              options={[
                { value: "current", name: "آخر 7 أيام" },
                { value: "previous", name: "الأسبوع السابق" },
              ]}
            />
          </CardHead>
          <AttendanceChart c={c} end={end} />
        </section>
        <section className="card todo-card">
          <CardHead title="يحتاج متابعة" desc="تكليفات وكشوف تتطلب إجراءً">
            <span className="count-pill">{fmt(todo.length)}</span>
          </CardHead>
          {todo.length ? (
            <div className="todo-list">
              {todo.slice(0, 4).map((item) => (
                <a href={"#" + item.link} key={item.id}>
                  <span className={"todo-icon " + item.type}>
                    {item.type === "danger" ? (
                      <Clock3 size={17} />
                    ) : item.type === "task" ? (
                      <ClipboardCheck size={17} />
                    ) : (
                      <BookOpen size={17} />
                    )}
                  </span>
                  <div>
                    <b>{item.name}</b>
                    <small>{item.desc}</small>
                  </div>
                  <ChevronLeft size={16} />
                </a>
              ))}
            </div>
          ) : (
            <Empty
              title="كل شيء محدّث"
              desc="ستظهر التكليفات والكشوف الناقصة هنا."
            />
          )}
          <a href="#tasks" className="card-link">
            عرض التكليفات <ArrowLeft size={15} />
          </a>
        </section>
      </div>
      <section className="card today-card">
        <CardHead
          title="حصص اليوم"
          desc={fmt(meetings.length) + " حصص مرصودة في جدول اليوم"}
        >
          <Button kind="outline" onClick={() => go("groups")}>
            <Plus size={16} />
            فتح شعبة
          </Button>
        </CardHead>
        {meetings.length ? (
          <Table
            headers={[
              "الشعبة / اللقاء",
              "المعلّم",
              "الموعد",
              "حضور الطلاب",
              "حالة الكشف",
              "",
            ]}
          >
            {meetings.map((m) => (
              <tr key={m.id}>
                <td>
                  <a className="row-link" href={"#meeting/" + m.id}>
                    <span className="mini-icon">
                      <BookOpen size={16} />
                    </span>
                    {groupOf(c, m.group)}
                  </a>
                </td>
                <td>
                  <span className="row-person">
                    <UserRound size={15} />
                    {teacherOf(c, m.lessonBy)}
                  </span>
                </td>
                <td dir="ltr">
                  {clock(m.from)} – {clock(m.to)}
                </td>
                <td>
                  <bdi dir="ltr">
                    {fmt(m.marks.filter((x) => x.status).length)} /{" "}
                    {fmt(m.roster.length)}
                  </bdi>
                </td>
                <td>
                  <Badge
                    value={m.state}
                    text={m.state === "open" ? "قيد الرصد" : undefined}
                  />
                </td>
                <td>
                  <a
                    aria-label="فتح الكشف"
                    className="text-action"
                    href={"#meeting/" + m.id}
                  >
                    <ChevronLeft size={17} />
                  </a>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty
            title="لا توجد لقاءات مفتوحة اليوم"
            desc="يمكن فتح لقاء مجدول من لوحة الشعبة."
          />
        )}
      </section>
      <footer className="content-footer">
        <span>
          <Activity size={14} /> {c.center.name}
        </span>
        {past > 0 && (
          <span>
            <Check size={14} /> تم اعتماد {fmt(past)} كشوف أمس
          </span>
        )}
      </footer>
    </>
  );
}
function AttendanceChart({ c, end }: { c: Context; end: string }) {
  const data = Array.from({ length: 7 }, (_, i) => offset(end, i - 6)).map(
    (d) => ({ d, v: rate(c, d, d) }),
  );
  if (data.every((x) => x.v === null))
    return <Empty title="لا يوجد حضور مرصود في هذه الفترة" />;
  const w = 690,
    h = 197,
    x = 22,
    y = 13,
    plotW = w - 71,
    plotH = 144;
  const xPos = (i: number) => x + (i * plotW) / 6;
  const yPos = (value: number) => y + (plotH * (100 - value)) / 100;
  const segments: string[][] = [];
  let segment: string[] = [];
  data.forEach(({ v }, i) => {
    if (v === null) {
      if (segment.length) segments.push(segment);
      segment = [];
    } else segment.push(xPos(i) + "," + yPos(v));
  });
  if (segment.length) segments.push(segment);
  return (
    <div className="chart-wrap">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="chart"
        role="img"
        aria-label="مخطط نسبة الحضور اليومية"
      >
        <defs>
          <linearGradient id="attendance-fill" x2="0" y2="1">
            <stop stopColor="#88bea4" stopOpacity=".53" />
            <stop offset="1" stopColor="#e9f5ed" stopOpacity=".23" />
          </linearGradient>
        </defs>
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line
              x1={x}
              x2={x + plotW}
              y1={yPos(v)}
              y2={yPos(v)}
              stroke="#e8efea"
              strokeDasharray={v ? "3 4" : "0"}
            />
            <text x={w - 8} y={yPos(v) + 4} textAnchor="end" fill="#758078">
              {v}%
            </text>
          </g>
        ))}
        {segments.map((points, i) => (
          <g key={i}>
            <polygon
              points={`${points[0].split(",")[0]},${y + plotH} ${points.join(" ")} ${points[points.length - 1].split(",")[0]},${y + plotH}`}
              fill="url(#attendance-fill)"
            />
            <polyline
              points={points.join(" ")}
              fill="none"
              stroke="#36765e"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
          </g>
        ))}
        {data.map(({ d, v }, i) => (
          <g key={d}>
            <text
              x={xPos(i)}
              y={y + plotH + 27}
              textAnchor="middle"
              fill="#737d76"
            >
              {days[dayOf(d)]}
            </text>
            {v !== null && (
              <circle
                cx={xPos(i)}
                cy={yPos(v)}
                r={i === 6 ? 5 : 3.4}
                fill={i === 6 ? "#36765e" : "#fff"}
                stroke="#36765e"
                strokeWidth="2"
              >
                <title>
                  {date(d)}: {v}%
                </title>
              </circle>
            )}
          </g>
        ))}
      </svg>
      <span className="chart-legend">
        <i /> نسبة حضور الطلاب
      </span>
    </div>
  );
}

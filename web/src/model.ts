import type { Catalog } from "./quran";
export type Key = string;
export type Unit = {
  id: Key;
  name: string;
  kind: string;
  parent: Key | null;
  active: boolean;
};
export type Group = {
  id: Key;
  name: string;
  unit: Key | null;
  teacher: Key;
  period: Key | null;
  start: string;
  end: string | null;
  days: number[];
  from: string;
  to: string;
};
export type Period = { id: Key; name: string; start: string; end: string };
export type Span = { surah: number; from: number; to: number };
export type Student = {
  id: Key;
  number: string;
  name: string;
  birth: string | null;
  contact: string;
  baseline: Span[];
  estimated?: string;
};
export type Enrollment = {
  student: Key;
  group: Key;
  start: string;
  end: string | null;
};
export type Rule = {
  version: string;
  effective: string;
  groupLimit: number;
  countExcused: boolean;
  closeHours: number;
  openMinutes: number;
  lateMinutes: number;
  latitude: number | null;
  longitude: number | null;
  radius: number;
  accuracy: number;
  allowAttendanceReview: boolean;
};
export function latestRulesByDate(rules: Rule[]) {
  return [...new Map(rules.map((rule) => [rule.effective, rule])).values()]
    .sort((a, b) => b.effective.localeCompare(a.effective));
}
export type People = {
  units: Unit[];
  groups: Group[];
  students: Student[];
  enrollments: Enrollment[];
  periods: Period[];
  rule: Rule;
  rules: Rule[];
  policies: { text: string; effective: string }[];
  today: string;
};
export type Reading = { span: Span; kind: string; result: string };
export type Mark = {
  student: Key;
  status: string | null;
  practice: string | null;
  readings: Reading[];
  note: string | null;
};
export type Meeting = {
  ruleVersion?: string;
  id: Key;
  group: Key | null;
  course: Key | null;
  date: string;
  from: string;
  to: string;
  kind: string;
  state: string;
  attendanceBy: Key;
  lessonBy: Key;
  practiceBy: Key;
  teachers: Key[];
  roster: Key[];
  lesson: string;
  marks: Mark[];
  version: number;
  lessonCourse: Key | null;
  replaces: Key | null;
};
export type MeetingType = {
  key: string;
  name: string;
  lesson: boolean;
  practice: boolean;
};
export const courseRoute = (course: Pick<Course, "id" | "type">) =>
  (course.type === "recitation" ? "recitation-course/" : "course/") + course.id;
export type CourseTeacherRequest = {
  id: Key;
  requestedBy: Key;
  teachers: Key[];
  submittedAt: string;
};
export type Course = {
  id: Key;
  name: string;
  type: string;
  level: string | null;
  owner: Key;
  groups: Key[];
  students: Key[];
  teachers: Key[];
  status: string;
  commission: Key | null;
  criterion: string;
};
export type Commission = {
  id: Key;
  title: string;
  teacher: Key;
  groups: Key[];
  state: string;
};
export type Category = {
  id: Key;
  name: string;
  unit: Key | null;
  minAge: number | null;
  maxAge: number | null;
};
export type Contest = {
  id: Key;
  name: string;
  date: string;
  multiple: boolean;
  categories: Category[];
};
export type Entry = {
  competition: Key;
  category: Key;
  student: Key;
  score: number | null;
  rank: number | null;
};
export type FollowUp = {
  id: Key;
  student: Key;
  group: Key;
  text: string;
  due: string;
  done: boolean;
};
export type Education = {
  meetings: Meeting[];
  courses: Course[];
  commissions: Commission[];
  competitions: Contest[];
  entries: Entry[];
  settings: { levels: string[]; types: MeetingType[] };
  followUps: FollowUp[];
};
export type CheckIn = {
  meeting: Key;
  teacher: Key;
  at: string;
  state: string;
  source: string;
  reason: string | null;
  accuracy: number | null;
};
export type Task = {
  id: Key;
  teacher: Key;
  title: string;
  detail: string;
  due: string;
  group: Key | null;
  course: Key | null;
  state: string;
  reply: string | null;
};
export type Work = { checkIns: CheckIn[]; tasks: Task[] };
export type Staff = {
  id: Key;
  name: string;
  roles: string[];
  units: Key[];
  active: boolean;
};
export type Center = {
  id: Key;
  name: string;
  timeZone: string;
  logo?: string | null;
  mapUrl?: string | null;
  roles: string[];
  units: Key[];
};
export type Session = {
  id: Key;
  name: string;
  email: string;
  platform: boolean;
  requiresMfa: boolean;
  mustChangePassword: boolean;
  hasAuthenticator: boolean;
  hasPasskey: boolean;
  centers: Center[];
};
export type Certificate = {
  id: Key;
  group: Key;
  student: Key | null;
  title: string;
  category: string;
  name: string;
  contentType: string;
  size: number;
  uploadedAt: string;
};
export type Context = {
  center: Center;
  user: Session;
  catalog: Catalog;
  people: People;
  education: Education;
  work: Work;
  staff: Staff[];
  refresh: () => Promise<void>;
  notify: (message: string) => void;
};
export const uid = () => crypto.randomUUID();
export const fmt = (v: number) =>
  new Intl.NumberFormat("ar-JO-u-nu-latn").format(v);
export const date = (v: string, long = false) =>
  new Intl.DateTimeFormat("ar-JO-u-nu-latn", {
    weekday: long ? "long" : undefined,
    day: "numeric",
    month: "long",
    year: long ? "numeric" : undefined,
    timeZone: "UTC",
  }).format(new Date(v + "T12:00:00Z"));
export const dayOf = (v: string) => new Date(v + "T12:00:00Z").getUTCDay();
export const offset = (v: string, days: number) => {
  const dt = new Date(v + "T12:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
};
export const clock = (v: string) => v.slice(0, 5);
export const active = (e: Enrollment, day: string) =>
  e.start <= day && (!e.end || day < e.end);
export const days = [
  "الأحد",
  "الاثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
];
export const statuses: Record<string, string> = {
  present: "حاضر",
  absent: "غائب",
  excused: "بعذر",
  verified: "مثبت",
  manual: "معتمد يدويًا",
  pending: "بانتظار المراجعة",
  open: "مفتوح",
  final: "معتمد",
  cancelled: "ملغى",
  submitted: "مسلّم",
  approved: "معتمد",
  returned: "للاستكمال",
  active: "قائمة",
  closed: "منتهية",
  registered: "مسجّل",
  completed: "مكتملة",
  passed: "مجتاز",
};
export const label = (key: string | null | undefined) =>
  key ? (statuses[key] ?? key) : "غير مرصود";
export const roleLabel = (roles: string[]) =>
  roles.includes("admin")
    ? "مدير المركز"
    : roles.includes("manager")
      ? "مدير القسم"
      : "معلّم";
export const base = (center: Center) => "/api/centers/" + center.id;
export async function api<T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers:
      body instanceof FormData || body === undefined
        ? undefined
        : { "Content-Type": "application/json" },
    body:
      body instanceof FormData
        ? body
        : body === undefined
          ? undefined
          : JSON.stringify(body),
  });
  if (!response.ok) {
    if (
      response.status === 401 &&
      path !== "/api/auth/login" &&
      path !== "/api/auth/me"
    )
      window.dispatchEvent(new Event("session-expired"));
    let message = "تعذّر إكمال العملية.";
    try {
      const p = await response.json();
      message = p.error ?? message;
    } catch {}
    throw new Error(message);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export const message = (error: unknown) =>
  error instanceof Error ? error.message : "تعذّر إكمال العملية.";
export const groupOf = (ctx: Context, id: Key | null) =>
  ctx.people.groups.find((x) => x.id === id)?.name ?? "—";
export const studentOf = (ctx: Context, id: Key | null) =>
  ctx.people.students.find((x) => x.id === id)?.name ?? "—";
export const teacherOf = (ctx: Context, id: Key | null) =>
  ctx.staff.find((x) => x.id === id)?.name ?? "—";
export const courseOf = (ctx: Context, id: Key | null) =>
  ctx.education.courses.find((x) => x.id === id)?.name ?? "—";
export function withinUnit(
  units: Unit[],
  item: Key | null,
  parent: Key,
): boolean {
  const parents = new Map(units.map((unit) => [unit.id, unit.parent]));
  const visited = new Set<Key>();
  for (
    let current = item;
    current && !visited.has(current);
    current = parents.get(current) ?? null
  ) {
    if (current === parent) return true;
    visited.add(current);
  }
  return false;
}
export function unitPath(units: Unit[], id: Key | null): string {
  if (id === null) return "المركز";
  const unit = units.find((x) => x.id === id);
  return unit
    ? (unit.parent ? unitPath(units, unit.parent) + " / " : "") + unit.name
    : "المركز";
}
export const go = (path: string) => {
  location.hash = path;
};

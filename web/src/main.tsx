import React, { useCallback, useEffect, useState, type FormEvent } from "react";
import { AdminMfa } from "./admin-mfa";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowLeft,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ClipboardCheck,
  DoorOpen,
  FileBarChart,
  FolderTree,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserRound,
  Users,
  X,
} from "lucide-react";
import "@fontsource-variable/noto-sans-arabic";
import "./style.css";
import logo from "../../logo.png";
import {
  api,
  base,
  date,
  go,
  message,
  roleLabel,
  type Center,
  type Context,
  type Education,
  type People,
  type Session,
  type Staff,
  type Work,
} from "./model";
import {
  Button,
  Dialog,
  Empty,
  ErrorBox,
  Field,
  Select,
  Toast,
  val,
  options,
  Badge,
  Table,
} from "./ui";
import { Dashboard } from "./dashboard";
import {
  Groups,
  GroupDetail,
  Students,
  StudentDetail,
  MeetingDetail,
} from "./learning";
import {
  Setup,
  StaffPage,
  Reports,
  Imports,
  Tasks,
  PasskeyPage,
  FollowTeachers,
} from "./admin";
import { Courses, CourseDetail, Contests } from "./programs";

const sections = [
  {
    name: "العمل اليومي",
    items: [
      { key: "home", name: "متابعة اليوم", icon: LayoutDashboard },
      { key: "groups", name: "الشعب", icon: FolderTree },
      { key: "students", name: "الطلاب", icon: Users },
      {
        key: "work",
        name: "متابعة المعلّمين",
        icon: Activity,
        scope: "manager",
      },
      { key: "tasks", name: "التكليفات", icon: ClipboardCheck },
    ],
  },
  {
    name: "البرامج",
    items: [
      { key: "courses", name: "الدورات", icon: BookOpen },
      { key: "recitation", name: "دورات التلاوة", icon: GraduationCap },
      { key: "contests", name: "المسابقة السنوية", icon: Trophy },
    ],
  },
  {
    name: "إدارة المركز",
    items: [
      { key: "reports", name: "التقارير", icon: FileBarChart },
      { key: "staff", name: "الموظفون", icon: ShieldCheck, scope: "admin" },
      {
        key: "settings",
        name: "إعدادات المركز",
        icon: Settings,
        scope: "admin",
      },
    ],
  },
];
function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [hash, setHash] = useState(location.hash.slice(1));
  useEffect(() => {
    const change = () => setHash(location.hash.slice(1));
    const expired = () => setSession(null);
    window.addEventListener("hashchange", change);
    window.addEventListener("session-expired", expired);
    return () => {
      window.removeEventListener("hashchange", change);
      window.removeEventListener("session-expired", expired);
    };
  }, []);
  const load = useCallback(async () => {
    try {
      setSession(await api<Session>("/api/auth/me"));
    } catch {
      setSession(null);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const logout = async () => {
    await api("/api/auth/logout", "POST");
    setSession(null);
    go("");
  };
  if (session === undefined)
    return (
      <div className="loading">
        <img src={logo} alt="" />
        <p>جارٍ فتح المنصة…</p>
      </div>
    );
  if (!session) return <Auth key={hash} hash={hash} login={load} />;
  if (session.requiresMfa)
    return <AdminMfa user={session} done={load} logout={logout} />;
  if (session.platform && (!session.centers.length || hash === "platform"))
    return <Platform logout={logout} />;
  if (!session.centers.length)
    return (
      <div className="standalone">
        <Empty title="لا توجد عضوية مفعّلة في مركز">
          <Button onClick={() => void logout()}>تسجيل الخروج</Button>
        </Empty>
      </div>
    );
  return (
    <Workspace user={session} hash={hash} logout={logout} reloadUser={load} />
  );
}
const demos = [
  { name: "مدير المركز", email: "admin@demo.local", pass: "Demo-Admin-2026!" },
  { name: "معلّم", email: "teacher@demo.local", pass: "Demo-Teacher-2026!" },
  {
    name: "إدارة المنصة",
    email: "platform@demo.local",
    pass: "Demo-Platform-2026!",
  },
];
function Auth({ hash, login }: { hash: string; login: () => Promise<void> }) {
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  const apply = hash === "apply";
  const activate = hash.startsWith("activate/");
  useEffect(() => {
    void api<{ demo: boolean }>("/api/auth/info")
      .then((x) => setDemo(x.demo))
      .catch(() => {});
  }, []);
  async function signIn(email: string, password: string) {
    await api("/api/auth/login", "POST", { email, password });
    go("");
    await login();
  }
  async function run(fn: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run(async () => {
      if (apply) {
        await api("/api/auth/requests", "POST", {
          name: val(f, "name"),
          contact: val(f, "contact"),
          email: val(f, "email"),
        });
        setDone("استلمت إدارة المنصة طلبك. سيصلك رابط التفعيل بعد الموافقة.");
      } else if (activate) {
        const r = await api<{ email: string }>("/api/auth/activate", "POST", {
          token: hash.split("/")[1],
          password: val(f, "password"),
        });
        await signIn(r.email, val(f, "password"));
      } else await signIn(val(f, "email"), val(f, "password"));
    });
  }
  return (
    <main className="auth">
      <section className="auth-art">
        <div className="auth-arch" />
        <div className="auth-identity">
          <div className="logo-tile">
            <img src={logo} alt="جمعية المحافظة على القرآن الكريم" />
          </div>
          <p>إدارة المراكز القرآنية</p>
          <h1>
            منظومة واحدة
            <br />
            لكل حلقاتك.
          </h1>
          <span>الطلاب، والشعب، والتلاوة، في مكان واحد.</span>
        </div>
        <div className="auth-foot">
          مركز نداء الخير القرآني · فرع عمّان الأول
        </div>
      </section>
      <section className="auth-content">
        <div className="auth-form">
          <div className="mini-brand">
            <Sparkles size={17} /> بوابة الموظفين
          </div>
          <h2>
            {apply
              ? "انضمام مركز جديد"
              : activate
                ? "تفعيل الحساب"
                : "تسجيل الدخول"}
          </h2>
          <p>
            {apply
              ? "أرسل بيانات المركز لتراجعها إدارة المنصة."
              : activate
                ? "اختر كلمة مرور لحساب الموظف الخاص بك."
                : "أدخل بيانات حسابك للانتقال إلى مركزك."}
          </p>
          {error && <ErrorBox>{error}</ErrorBox>}
          {done ? (
            <div className="notice">{done}</div>
          ) : (
            <form onSubmit={submit} className="auth-fields">
              {apply && (
                <>
                  <Field label="اسم المركز">
                    <input name="name" required />
                  </Field>
                  <Field label="اسم المدير المقترح">
                    <input name="contact" required />
                  </Field>
                </>
              )}
              {!activate && (
                <Field label="البريد الإلكتروني">
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    dir="ltr"
                    placeholder="name@example.com"
                    required
                  />
                </Field>
              )}
              {!apply && (
                <Field label="كلمة المرور">
                  <input
                    name="password"
                    type="password"
                    dir="ltr"
                    autoComplete={
                      activate ? "new-password" : "current-password"
                    }
                    required
                  />
                </Field>
              )}
              <Button type="submit" disabled={busy}>
                {apply
                  ? "إرسال الطلب"
                  : activate
                    ? "تفعيل حسابي"
                    : "دخول المنصة"}
                <ArrowLeft size={17} />
              </Button>
            </form>
          )}
          {demo && !apply && !activate && (
            <div className="demo">
              <small>تجربة المنصة ببيانات نموذجية</small>
              <div>
                {demos.map((d) => (
                  <Button
                    key={d.email}
                    kind="outline"
                    disabled={busy}
                    onClick={() => void run(() => signIn(d.email, d.pass))}
                  >
                    {d.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <a className="auth-link" href={apply || activate ? "#" : "#apply"}>
            {apply || activate
              ? "العودة إلى تسجيل الدخول"
              : "يريد مركزك الانضمام؟ قدّم طلبًا"}{" "}
            <ArrowLeft size={15} />
          </a>
        </div>
      </section>
    </main>
  );
}
type PlatformData = {
  requests: {
    id: string;
    name: string;
    email: string;
    contact: string;
    state: string;
    created: string;
    reason?: string;
  }[];
  centers: { id: string; name: string; active: boolean }[];
};
function Platform({ logout }: { logout: () => Promise<void> }) {
  const [data, setData] = useState<PlatformData>();
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [decision, setDecision] = useState<{
    id: string;
    approve: boolean;
  } | null>(null);
  const reload = () =>
    api<PlatformData>("/api/auth/requests")
      .then(setData)
      .catch((e) => setError(message(e)));
  useEffect(() => {
    void reload();
  }, []);
  return (
    <main className="standalone admin-platform">
      <div className="page-head">
        <div>
          <h1>إدارة المنصة</h1>
          <p>طلبات انضمام المراكز وحالة التفعيل</p>
        </div>
        <Button kind="outline" onClick={() => void logout()}>
          <LogOut size={17} />
          تسجيل الخروج
        </Button>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <section className="panel">
        <h2>طلبات الانضمام</h2>
        {data?.requests.length ? (
          <Table headers={["المركز", "المدير", "البريد", "الحالة", ""]}>
            {data.requests.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.contact}</td>
                <td>{r.email}</td>
                <td>
                  <Badge
                    value={r.state}
                    text={
                      {
                        pending: "قيد المراجعة",
                        approved: "مقبول",
                        rejected: "مرفوض",
                      }[r.state]
                    }
                  />
                </td>
                <td>
                  {r.state === "pending" ? (
                    <div className="actions">
                      <Button
                        onClick={() => setDecision({ id: r.id, approve: true })}
                      >
                        موافقة
                      </Button>
                      <Button
                        kind="outline"
                        onClick={() =>
                          setDecision({ id: r.id, approve: false })
                        }
                      >
                        رفض
                      </Button>
                    </div>
                  ) : (
                    r.reason
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty />
        )}
      </section>
      <section className="panel">
        <h2>المراكز</h2>
        <Table headers={["المركز", "الحالة", ""]}>
          {data?.centers.map((x) => (
            <tr key={x.id}>
              <td>{x.name}</td>
              <td>
                <Badge
                  value={x.active ? "active" : "closed"}
                  text={x.active ? "مفعّل" : "معلّق"}
                />
              </td>
              <td>
                <Button
                  kind="outline"
                  onClick={() =>
                    void api("/api/auth/centers/" + x.id + "/active", "PUT", {
                      value: !x.active,
                    })
                      .then(reload)
                      .catch((e) => setError(message(e)))
                  }
                >
                  {x.active ? "تعليق" : "تفعيل"}
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      </section>
      {decision && (
        <Dialog
          title={decision.approve ? "الموافقة على انضمام المركز" : "رفض الطلب"}
          close={() => setDecision(null)}
          submit={async (f) => {
            const r = await api<{ token?: string }>(
              "/api/auth/requests/" + decision.id + "/decision",
              "POST",
              { approve: decision.approve, reason: val(f, "reason") },
            );
            if (r.token) setToken(r.token);
            await reload();
          }}
        >
          {decision.approve ? (
            <p>يُنشأ المركز ويظهر رابط تفعيل مديره.</p>
          ) : (
            <Field label="سبب الرفض">
              <textarea name="reason" required />
            </Field>
          )}
        </Dialog>
      )}
      {token && <Invite token={token} close={() => setToken("")} />}
    </main>
  );
}
export function Invite({ token, close }: { token: string; close: () => void }) {
  const link = location.origin + "/#activate/" + token;
  const [copied, setCopied] = useState(false);
  return (
    <Dialog title="رابط تفعيل الموظف" close={close}>
      <p>
        انسخ الرابط وأرسله مباشرة إلى صاحب الحساب. تنتهي صلاحيته بعد ثلاثة أيام.
      </p>
      <input value={link} readOnly dir="ltr" />
      <Button
        onClick={() =>
          void navigator.clipboard.writeText(link).then(() => setCopied(true))
        }
      >
        {copied ? "تم النسخ" : "نسخ الرابط"}
      </Button>
    </Dialog>
  );
}
function Workspace({
  user,
  hash,
  logout,
  reloadUser,
}: {
  user: Session;
  hash: string;
  logout: () => Promise<void>;
  reloadUser: () => Promise<void>;
}) {
  const [centerId, setCenterId] = useState(
    localStorage.getItem("center-active") ?? "",
  );
  const center = user.centers.find((c) => c.id === centerId) ?? user.centers[0];
  const endpoint = base(center);
  const [data, setData] = useState<{
    id: string;
    people: People;
    education: Education;
    work: Work;
    staff: Staff[];
  }>();
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const [q, setQ] = useState("");
  const isAdmin = center.roles.includes("admin");
  const isManager = isAdmin || center.roles.includes("manager");
  const isTeacher = center.roles.includes("teacher");
  const refresh = useCallback(async () => {
    const [people, education, work, staff] = await Promise.all([
      api<People>(endpoint + "/people"),
      api<Education>(endpoint + "/education"),
      api<Work>(endpoint + "/work"),
      api<Staff[]>(endpoint + "/identity/staff"),
    ]);
    setData({ id: center.id, people, education, work, staff });
    setError("");
  }, [endpoint, center.id]);
  useEffect(() => {
    void refresh().catch((e) => setError(message(e)));
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    setDrawer(false);
    setMenu(false);
    setSearch(false);
  }, [hash]);
  const [raw = "", id = ""] = hash.split("/");
  const route = raw || (!isManager && isTeacher ? "groups" : "home");
  const nav = sections.map((s) => ({
    ...s,
    items: s.items
      .filter(
        (i) =>
          (i.scope !== "admin" || isAdmin) &&
          (i.scope !== "manager" || isManager) &&
          (i.key !== "home" || isManager),
      )
      .map((i) => ({
        ...i,
        name: i.key === "groups" && isTeacher && !isAdmin ? "شُعَبي" : i.name,
      })),
  }));
  const current =
    nav.flatMap((s) => s.items).find((x) => x.key === route)?.name ??
    (
      {
        group: "لوحة الشعبة",
        student: "ملف الطالب",
        meeting: "كشف اللقاء",
        course: "تفاصيل الدورة",
        import: "استيراد الطلاب",
        passkey: "مفتاح المرور",
      } as Record<string, string>
    )[route] ??
    "الرئيسية";
  const ctx: Context | undefined =
    data?.id === center.id
      ? { center, user, ...data, refresh, notify: setToast }
      : undefined;
  let page: React.ReactNode;
  if (ctx) {
    const views: Record<string, () => React.ReactNode> = {
      home: () => (isManager ? <Dashboard c={ctx} /> : <Groups c={ctx} />),
      groups: () => <Groups c={ctx} />,
      group: () => <GroupDetail c={ctx} id={id} />,
      students: () => <Students c={ctx} />,
      student: () => <StudentDetail c={ctx} id={id} />,
      meeting: () => <MeetingDetail c={ctx} id={id} />,
      work: () => (isManager ? <FollowTeachers c={ctx} /> : <Empty />),
      tasks: () => <Tasks c={ctx} />,
      courses: () => <Courses c={ctx} />,
      recitation: () => <Courses c={ctx} recitation />,
      course: () => <CourseDetail c={ctx} id={id} />,
      contests: () => <Contests c={ctx} />,
      reports: () => <Reports c={ctx} />,
      staff: () => (isAdmin ? <StaffPage c={ctx} /> : <Empty />),
      settings: () =>
        isAdmin ? <Setup c={ctx} reloadUser={reloadUser} /> : <Empty />,
      import: () => (isAdmin ? <Imports c={ctx} /> : <Empty />),
      passkey: () => <PasskeyPage c={ctx} />,
    };
    page = views[route]?.() ?? <Empty title="الصفحة غير متاحة" />;
  }
  return (
    <div className="app-shell">
      {drawer && (
        <button
          className="drawer-overlay"
          aria-label="إغلاق القائمة"
          onClick={() => setDrawer(false)}
        />
      )}
      <aside className={"sidebar " + (drawer ? "shown" : "")}>
        <div className="brand">
          <div className="logo-tile">
            {center.logo ||
            center.id === "e751f402-dbd9-449f-9d01-40b525f06c29" ? (
              <img src={center.logo ?? logo} alt="" />
            ) : (
              <BookOpen size={21} />
            )}
          </div>
          <div>
            <strong>{center.name}</strong>
            <small>إدارة المراكز القرآنية</small>
          </div>
          <button
            className="mobile-only icon-button"
            aria-label="إغلاق القائمة"
            onClick={() => setDrawer(false)}
          >
            <X size={20} />
          </button>
        </div>
        {user.centers.length > 1 && (
          <div className="center-select">
            <Select
              options={options(user.centers)}
              value={center.id}
              onChange={(v) => {
                localStorage.setItem("center-active", v);
                setCenterId(v);
                go("");
              }}
            />
          </div>
        )}
        <nav>
          {nav.map((s) => (
            <div key={s.name} className="nav-section">
              <p>{s.name}</p>
              {s.items.map(({ key, name, icon: Icon }) => (
                <a
                  href={"#" + key}
                  key={key}
                  className={
                    route === key ||
                    (key === "groups" &&
                      ["group", "meeting"].includes(route)) ||
                    (key === "students" && route === "student") ||
                    (key === "courses" && route === "course")
                      ? "selected"
                      : ""
                  }
                >
                  <Icon size={18} />
                  {name}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-footer">
          <a href="#passkey">
            <ShieldCheck size={17} />
            مفتاح المرور
          </a>
          <button onClick={() => void logout()}>
            <LogOut size={17} />
            تسجيل الخروج
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="top-crumb">
            <button
              className="icon-button mobile-only"
              aria-label="القائمة"
              onClick={() => setDrawer(true)}
            >
              <Menu size={22} />
            </button>
            <span className="top-center">المركز</span>
            <ChevronLeft size={14} />
            <strong>{current}</strong>
          </div>
          <div className="top-actions">
            <button
              className="icon-button search-trigger"
              aria-label="البحث في الطلاب والشعب"
              onClick={() => {
                setQ("");
                setSearch(true);
              }}
            >
              <Search size={20} />
            </button>
            <div className="divider" />
            <button
              className="account"
              onClick={() => setMenu(!menu)}
              aria-expanded={menu}
            >
              <span className="avatar">
                <UserRound size={19} />
              </span>
              <span>
                <b>{user.name}</b>
                <small>{roleLabel(center.roles)}</small>
              </span>
              <ChevronDown size={15} />
            </button>
            {menu && (
              <div className="account-menu">
                <a href="#passkey">
                  <ShieldCheck size={16} />
                  مفتاح المرور
                </a>
                {user.platform && (
                  <a href="#platform">
                    <DoorOpen size={16} />
                    إدارة المنصة
                  </a>
                )}
                <button onClick={() => void logout()}>
                  <LogOut size={16} />
                  تسجيل الخروج
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="content" key={center.id + "/" + hash}>
          {error && (
            <ErrorBox>
              {error}{" "}
              <Button
                kind="outline"
                onClick={() =>
                  void refresh().catch((e) => setError(message(e)))
                }
              >
                إعادة المحاولة
              </Button>
            </ErrorBox>
          )}
          {ctx ? (
            page
          ) : !error ? (
            <div className="loading compact">
              <CalendarDays size={25} />
              <p>جارٍ تجهيز بيانات المركز…</p>
            </div>
          ) : null}
        </main>
      </div>
      {search && ctx && (
        <Dialog title="البحث في المركز" close={() => setSearch(false)}>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="اسم طالب أو شعبة"
            aria-label="كلمة البحث"
          />
          {q.trim() && (
            <div className="search-results">
              {[
                ...ctx.people.students
                  .filter((x) => x.name.includes(q) || x.number.includes(q))
                  .slice(0, 8)
                  .map((x) => ({ name: x.name, hash: "student/" + x.id })),
                ...ctx.people.groups
                  .filter((x) => x.name.includes(q))
                  .slice(0, 8)
                  .map((x) => ({ name: x.name, hash: "group/" + x.id })),
              ].map((x) => (
                <a key={x.hash} href={"#" + x.hash}>
                  {x.name}
                  <ChevronLeft size={16} />
                </a>
              ))}
            </div>
          )}
        </Dialog>
      )}
      {toast && <Toast>{toast}</Toast>}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { chromium, request } from "@playwright/test";

const origin = process.env.CENTER_TEST_ORIGIN ?? "http://localhost:8088";
const main = "e751f402-dbd9-449f-9d01-40b525f06c29";
const teacherId = "79ba9bb4-6618-49b5-ae9e-bdc87e2eda0c";
const api = (center, resource) => "/api/centers/" + center + resource;
const unique = randomUUID().slice(0, 8);
const password = "Testing-Local-2026!";
const newContext = () =>
  request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
const admin = await newContext();
const teacher = await newContext();
const platform = await newContext();
const applicant = await newContext();

async function expectResponse(context, method, path, data, expected = 200) {
  const response = await context.fetch(path, { method, data });
  assert.equal(
    response.status(),
    expected,
    method +
      " " +
      path +
      " " +
      (response.status() === expected ? "" : await response.text()),
  );
  return response;
}
async function json(context, method, path, data) {
  return (await expectResponse(context, method, path, data)).json();
}
async function login(context, email, pass) {
  await json(context, "POST", "/api/auth/login", { email, password: pass });
}
const email = "center-" + unique + "@test.local";
let browser;
try {
  await Promise.all([
    login(admin, "admin@demo.local", "Demo-Admin-2026!"),
    login(teacher, "teacher@demo.local", "Demo-Teacher-2026!"),
    login(platform, "platform@demo.local", "Demo-Platform-2026!"),
  ]);
  const [full, limited] = await Promise.all([
    json(admin, "GET", api(main, "/people")),
    json(teacher, "GET", api(main, "/people")),
  ]);
  assert.equal(full.groups.length, 8);
  assert(limited.groups.every((x) => x.teacher === teacherId));
  const group = full.groups.find((x) => x.teacher === teacherId);
  const other = full.groups.find((x) => x.teacher !== teacherId);
  const enrollment = full.enrollments.find(
    (e) => e.group === group.id && e.end === null,
  );
  const outsider = full.enrollments.find(
    (e) => e.group === other.id && e.end === null,
  );
  await expectResponse(
    teacher,
    "GET",
    api(main, "/education/students/" + outsider.student),
    undefined,
    403,
  );
  await expectResponse(platform, "GET", api(main, "/people"), undefined, 403);

  const pending = await json(applicant, "POST", "/api/auth/requests", {
    name: "مركز اختبار " + unique,
    contact: "مدير الاختبار",
    email,
  });
  const approval = await json(
    platform,
    "POST",
    "/api/auth/requests/" + pending.id + "/decision",
    { approve: true },
  );
  const second = approval.request.center;
  assert(approval.token);
  assert.equal(
    (
      await json(
        platform,
        "POST",
        "/api/auth/requests/" + pending.id + "/decision",
        { approve: true },
      )
    ).request.center,
    second,
  );
  await json(applicant, "POST", "/api/auth/activate", {
    token: approval.token,
    password,
  });
  await login(applicant, email, password);
  const empty = await json(applicant, "GET", api(second, "/people"));
  assert.equal(empty.groups.length, 0);
  await expectResponse(applicant, "GET", api(main, "/people"), undefined, 403);
  await expectResponse(
    teacher,
    "GET",
    api(second, "/education"),
    undefined,
    403,
  );
  const unit = randomUUID(),
    child = randomUUID();
  await json(applicant, "PUT", api(second, "/people/units/" + unit), {
    name: "برنامج القراءة",
    kind: "برنامج",
    parent: null,
    active: true,
  });
  await json(applicant, "PUT", api(second, "/people/units/" + child), {
    name: "المستوى الأول",
    kind: "مستوى",
    parent: unit,
    active: true,
  });
  await json(applicant, "POST", api(second, "/people/rules"), {
    ...empty.rule,
    effective: empty.today,
    groupLimit: 2,
  });
  assert.equal(
    (await json(applicant, "GET", api(second, "/people"))).rule.groupLimit,
    2,
  );
  assert.equal(
    (await json(admin, "GET", api(main, "/people"))).rule.groupLimit,
    1,
  );

  const content = Buffer.from("%PDF-1.4\n% synthetic certificate smoke test\n");
  const upload = await admin.post(api(main, "/documents"), {
    multipart: {
      group: group.id,
      student: enrollment.student,
      title: "شهادة اختبار " + unique,
      category: "recitation",
      file: {
        name: "certificate.pdf",
        mimeType: "application/pdf",
        buffer: content,
      },
    },
  });
  assert.equal(upload.status(), 200, await upload.text());
  const item = await upload.json();
  assert(
    (
      await json(teacher, "GET", api(main, "/documents?group=" + group.id))
    ).some((x) => x.id === item.id),
  );
  assert(
    (
      await json(
        teacher,
        "GET",
        api(main, "/documents?student=" + enrollment.student),
      )
    ).some((x) => x.id === item.id),
  );
  const download = await expectResponse(
    teacher,
    "GET",
    api(main, "/documents/" + item.id + "/file"),
  );
  assert.deepEqual(await download.body(), content);
  await expectResponse(
    teacher,
    "GET",
    api(main, "/documents?group=" + other.id),
    undefined,
    403,
  );
  await expectResponse(
    applicant,
    "GET",
    api(second, "/documents/" + item.id + "/file"),
    undefined,
    404,
  );

  const date = full.today;
  for (const format of ["pdf", "xlsx"]) {
    const result = await expectResponse(
      admin,
      "GET",
      api(
        main,
        "/education/report?kind=counts&to=" + date + "&format=" + format,
      ),
    );
    assert((await result.body()).length > 1000);
  }
  const task = await json(admin, "POST", api(main, "/work/tasks"), {
    teacher: teacherId,
    title: "تكليف اختبار " + unique,
    detail: "متابعة",
    due: date,
    group: group.id,
    course: null,
  });
  await json(teacher, "PUT", api(main, "/work/tasks/" + task.id), {
    state: "submitted",
    reply: "تم",
  });
  await json(admin, "PUT", api(main, "/work/tasks/" + task.id), {
    state: "approved",
    reply: null,
  });

  const browserPath =
    process.env.CENTER_CHROME ??
    "C:/Program Files/Google/Chrome/Application/chrome.exe";
  browser = await chromium.launch({
    executablePath: fs.existsSync(browserPath) ? browserPath : undefined,
    headless: true,
  });
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    baseURL: origin,
    acceptDownloads: true,
  });
  const page = await desktop.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "مدير المركز", exact: true }).click();
  await page.getByRole("heading", { name: /أهلًا أحمد/ }).waitFor();
  const directory = process.env.CENTER_TEST_ARTIFACTS ?? "../.local";
  fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: directory + "/dashboard.png", fullPage: true });
  await page.goto("/#group/" + group.id);
  await page.getByRole("button", { name: "مجلد الشعبة" }).click();
  await page.getByText(item.title).waitFor();
  await page.goto("/#student/" + enrollment.student);
  await page.getByRole("button", { name: "الشهادات", exact: true }).click();
  await page.getByText(item.title).waitFor();
  assert.equal(browserErrors.length, 0, browserErrors.join("\n"));

  const phone = await browser.newContext({
    viewport: { width: 393, height: 852 },
    isMobile: true,
    deviceScaleFactor: 1,
    hasTouch: true,
    baseURL: origin,
    geolocation: { latitude: 31.955, longitude: 35.945, accuracy: 8 },
    permissions: ["geolocation"],
  });
  const mobile = await phone.newPage();
  await mobile.goto("/");
  await mobile.getByRole("button", { name: "معلّم", exact: true }).click();
  await mobile.getByRole("heading", { name: "شُعَبي", exact: true }).waitFor();
  assert.equal(
    await mobile.locator(".group-card").count(),
    limited.groups.length,
  );
  await mobile.screenshot({
    path: directory + "/mobile-groups.png",
    fullPage: true,
  });
  assert(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  const cdp = await phone.newCDPSession(mobile);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await mobile.goto("/#passkey");
  await mobile.getByRole("button", { name: "إضافة مفتاح مرور" }).click();
  await mobile.getByText("أُضيف مفتاح المرور").waitFor();

  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Amman",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
  const end = time < "23:58" ? "23:59" : "23:59:59";
  const meeting = await json(admin, "POST", api(main, "/education/meetings"), {
    group: group.id,
    course: null,
    date,
    from: time,
    to: end,
    kind: "theory",
    attendanceBy: teacherId,
    lessonBy: teacherId,
    practiceBy: teacherId,
    replaces: null,
  });
  await mobile.goto("/#meeting/" + meeting.id);
  await mobile.getByRole("button", { name: "إثبات حضوري" }).click();
  await mobile.getByText("تم إثبات حضورك").waitFor();
  await mobile
    .getByRole("button", { name: "تحديد غير المرصودين كحاضرين" })
    .click();
  await mobile
    .getByLabel("ما الذي قُدّم في اللقاء؟")
    .fill("درس تجريبي في أحكام التلاوة");
  await mobile.getByRole("button", { name: "اعتماد الكشف" }).click();
  await mobile.getByText("اعتُمد الكشف").waitFor();
  const saved = await json(
    admin,
    "GET",
    api(main, "/education/meetings/" + meeting.id),
  );
  assert.equal(saved.meeting.state, "final");
  assert.equal(
    saved.meeting.marks.every((x) => x.status === "present"),
    true,
  );
  await expectResponse(
    teacher,
    "PUT",
    api(main, "/education/meetings/" + meeting.id),
    { version: 1, marks: [], lesson: "", lessonCourse: null, finalize: false },
    409,
  );
  await expectResponse(
    admin,
    "DELETE",
    api(main, "/documents/" + item.id),
    undefined,
    204,
  );
  assert(
    !(
      await json(
        admin,
        "GET",
        api(main, "/documents?student=" + enrollment.student),
      )
    ).some((x) => x.id === item.id),
  );
  console.log(
    "PASS: registration, tenant isolation, scoped student access, certificate upload/list/download/delete, reports, tasks, desktop/mobile UI, passkeys, geofenced check-in, attendance and concurrent update.",
  );
} finally {
  await browser?.close();
  await Promise.all([
    admin.dispose(),
    teacher.dispose(),
    platform.dispose(),
    applicant.dispose(),
  ]);
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chromium, request } from "@playwright/test";

const origin = process.env.CENTER_TEST_ORIGIN ?? "http://localhost:8088";
const center = "/api/centers/e751f402-dbd9-449f-9d01-40b525f06c29";
const auth = "/api/auth";
const teacher = "79ba9bb4-6618-49b5-ae9e-bdc87e2eda0c";
const director = "a62ab256-e646-4458-b21e-14132a0492dd";
const open = () =>
  request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
const [platform, manager, staff, secondSession] = await Promise.all([
  open(),
  open(),
  open(),
  open(),
]);
let browser;
async function call(client, method, path, data, expected = 200) {
  const response = await client.fetch(path, { method, data });
  assert.equal(
    response.status(),
    expected,
    method +
      " " +
      path +
      " " +
      (response.status() === expected ? "" : await response.text()),
  );
  return response.status() === 204 ? undefined : await response.json();
}
async function login(client, email, password) {
  await call(client, "POST", auth + "/login", { email, password });
}
try {
  await Promise.all([
    login(platform, "platform@demo.local", "Demo-Platform-2026!"),
    login(manager, "admin@demo.local", "Demo-Admin-2026!"),
  ]);
  const [catalog, setup, people] = await Promise.all([
    call(platform, "GET", auth + "/catalog"),
    call(platform, "GET", center + "/people/configuration"),
    call(manager, "GET", center + "/people"),
  ]);
  assert.equal(catalog.surahs.length, 114);
  assert.equal(catalog.juz.length, 30);
  assert.equal(catalog.pages.length, 604);
  assert.deepEqual(
    catalog.levels.map((l) => [
      l.chapters,
      l.requiredJuz,
      l.chooseJuz,
      l.excludedJuz,
    ]),
    [
      [[1, 2, 3, 4, 5], [30], 0, []],
      [[6, 7, 8], [29], 0, []],
      [[9, 10], [15], 0, []],
      [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [], 2, [15, 29, 30]],
    ],
  );
  assert(!Object.hasOwn(setup, "students"));
  await call(platform, "GET", center + "/people", undefined, 403);
  await call(manager, "GET", center + "/people/configuration", undefined, 403);
  await call(manager, "PUT", auth + "/catalog", catalog, 403);
  const saved = await call(platform, "PUT", auth + "/catalog", catalog);
  assert.equal(saved.version, catalog.version + 1);
  await call(platform, "PUT", auth + "/catalog", catalog, 409);

  const me = await call(manager, "GET", auth + "/me");
  const profile = me.centers[0];
  assert.equal(profile.mapUrl, "https://share.google/9aJWp46FtxrBkJsDT");
  await call(
    manager,
    "PUT",
    center + "/identity/profile",
    { name: profile.name, timeZone: profile.timeZone, mapUrl: profile.mapUrl },
    403,
  );
  await call(platform, "PUT", center + "/identity/profile", {
    name: profile.name,
    timeZone: profile.timeZone,
    mapUrl: profile.mapUrl,
  });
  await call(
    manager,
    "POST",
    center + "/people/rules",
    { ...setup.rule, effective: setup.today },
    403,
  );
  const email = "temp-" + randomUUID().slice(0, 8) + "@example.test";
  const payload = { name: "موظف تجريبي", email, roles: ["teacher"], units: [] };
  await call(manager, "POST", center + "/identity/staff/invite", payload, 403);
  const creds = await call(
    platform,
    "POST",
    center + "/identity/staff/invite",
    payload,
  );
  assert(creds.temporaryPassword && !creds.token);
  await login(staff, email, creds.temporaryPassword);
  const first = await call(staff, "GET", auth + "/me");
  assert(first.mustChangePassword);
  await call(staff, "GET", center + "/people", undefined, 403);
  await call(
    staff,
    "POST",
    auth + "/password/change",
    {
      currentPassword: creds.temporaryPassword,
      password: "Test-New-Password-2026!",
    },
    204,
  );
  assert(!(await call(staff, "GET", auth + "/me")).mustChangePassword);
  await call(
    staff,
    "POST",
    auth + "/login",
    { email, password: creds.temporaryPassword },
    401,
  );
  await login(secondSession, email, "Test-New-Password-2026!");
  await call(staff, "POST", auth + "/password/forgot", { email }, 204);
  await call(
    staff,
    "POST",
    auth + "/password/reset",
    { token: "a".repeat(64), password: "Invalid-Token-2026!" },
    400,
  );
  const reissued = await call(
    platform,
    "POST",
    center + "/identity/staff/" + first.id + "/temporary",
  );
  assert.notEqual(reissued.temporaryPassword, creds.temporaryPassword);
  await call(secondSession, "GET", auth + "/me", undefined, 401);

  const group = people.groups.find((g) => g.teacher === teacher);
  const student = people.enrollments.find(
    (e) => e.group === group.id && !e.end,
  ).student;
  const level = catalog.levels.find((l) => l.chooseJuz === 2);
  const id = randomUUID();
  const courseInput = {
    name: "إجازة اختبار " + id.slice(0, 8),
    type: "recitation",
    level: level.key,
    teachers: [teacher],
    groups: [group.id],
    students: [student],
    status: "active",
    criterion: "manual",
    commission: null,
  };
  const course = await call(
    manager,
    "PUT",
    center + "/education/courses/" + id,
    courseInput,
  );
  assert.equal(course.curriculum.chapters.length, 10);
  const result = center + "/education/courses/" + id + "/students/" + student;
  await call(manager, "PUT", result + "/grade", { state: "passed" }, 400);
  await call(manager, "PUT", result + "/memorization", { juz: [1, 30] }, 400);
  await call(manager, "PUT", result + "/memorization", { juz: [1, 1] }, 400);
  await call(manager, "PUT", result + "/memorization", { juz: [1, 2] });
  await call(manager, "PUT", result + "/grade", { state: "passed" });

  const now = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Amman",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
  const day = Number(new Date(people.today + "T12:00:00Z").getUTCDay());
  const shift = {
    effective: people.today,
    days: [day],
    from: now,
    to: "23:59:59",
    active: true,
  };
  const shiftPath = center + "/work/duties/configuration/" + director;
  await call(manager, "PUT", shiftPath, shift, 403);
  await call(platform, "PUT", shiftPath, shift);
  const duties = await call(manager, "GET", center + "/work/duties");
  const entry = duties.items.find((x) => x.employee === director);
  assert(entry?.scheduled);
  const review =
    center + "/work/checkins/" + entry.id + "/review?date=" + people.today;
  await call(
    manager,
    "POST",
    review,
    { teacher: director, state: "manual", reason: "اختبار الصلاحية" },
    400,
  );

  const chrome =
    process.env.CENTER_CHROME ??
    "C:/Program Files/Google/Chrome/Application/chrome.exe";
  browser = await chromium.launch({
    executablePath: existsSync(chrome) ? chrome : undefined,
  });
  const context = await browser.newContext({
    baseURL: origin,
    geolocation: {
      latitude: setup.rule.latitude,
      longitude: setup.rule.longitude,
      accuracy: 8,
    },
    permissions: ["geolocation"],
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "مدير المركز", exact: true }).click();
  await page.getByRole("heading", { name: /أهلًا أحمد/ }).waitFor();
  assert.equal(
    await page.locator('.nav-section a[href="#settings"]').count(),
    0,
  );
  const cdp = await context.newCDPSession(page);
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
  await page.goto("/#passkey");
  await page.getByRole("button", { name: "إضافة مفتاح مرور" }).click();
  await page.getByText("أُضيف مفتاح المرور").waitFor();
  await page.goto("/#duty");
  await page.getByRole("button", { name: "إثبات الحضور", exact: true }).click();
  await page.getByText("أُثبت الدوام", { exact: true }).waitFor();
  assert.equal(
    (await call(manager, "GET", center + "/work/duties")).items.find(
      (x) => x.employee === director,
    ).checkIn.state,
    "verified",
  );

  const platformContext = await browser.newContext({ baseURL: origin });
  const ui = await platformContext.newPage();
  await ui.goto("/");
  await ui.getByRole("button", { name: "إدارة المنصة", exact: true }).click();
  await ui.getByRole("button", { name: "كتالوج المنصة", exact: true }).click();
  await ui.getByText("التمهيدية", { exact: true }).waitFor();
  await ui
    .getByRole("button", { name: "إعدادات المراكز", exact: true })
    .click();
  await ui
    .locator("label.field")
    .filter({ has: ui.getByText("اختر مركزًا", { exact: true }) })
    .locator("select")
    .selectOption(center.split("/").at(-1));
  await ui.getByRole("button", { name: "بيانات المركز", exact: true }).click();
  await ui
    .getByRole("button", { name: "تعديل بيانات المركز", exact: true })
    .click();
  assert.equal(
    await ui.getByLabel("رابط موقع المركز").inputValue(),
    profile.mapUrl,
  );
  console.log(
    "PASS: editable catalog, platform-only settings, Minir curricula, temporary passwords, password changes, and director passkey attendance.",
  );
} finally {
  await browser?.close();
  await Promise.all([
    platform.dispose(),
    manager.dispose(),
    staff.dispose(),
    secondSession.dispose(),
  ]);
}

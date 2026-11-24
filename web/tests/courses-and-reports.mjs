import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chromium, request } from "@playwright/test";

const origin = process.env.CENTER_TEST_ORIGIN ?? "http://localhost:8088";
const center = "/api/centers/e751f402-dbd9-449f-9d01-40b525f06c29";
const education = center + "/education";
const teacherId = "79ba9bb4-6618-49b5-ae9e-bdc87e2eda0c";
const colleagueId = "d5ce01f6-87dd-4723-a634-81dd3a805a6d";
const open = () =>
  request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
const admin = await open();
const teacher = await open();
const colleague = await open();
const platform = await open();

async function call(context, method, path, data, expected = 200) {
  const response = await context.fetch(path, { method, data });
  const body = await response.text();
  assert.equal(response.status(), expected, method + " " + path + " " + body);
  return body ? JSON.parse(body) : undefined;
}
async function login(client, email, password) {
  await call(client, "POST", "/api/auth/login", { email, password });
}

let browser;
try {
  await Promise.all([
    login(admin, "admin@demo.local", "Demo-Admin-2026!"),
    login(teacher, "teacher@demo.local", "Demo-Teacher-2026!"),
    login(colleague, "omar@demo.local", "Demo-Omar-2026!"),
    login(platform, "platform@demo.local", "Demo-Platform-2026!"),
  ]);
  const people = await call(teacher, "GET", center + "/people");
  const all = await call(admin, "GET", center + "/people");
  const group = people.groups.find((x) => x.unit && x.teacher === teacherId);
  const outsider = all.groups.find((x) => x.teacher !== teacherId);
  const ownStudent = people.enrollments.find(
    (x) => x.group === group.id,
  ).student;
  const otherStudent = all.enrollments.find(
    (x) => x.group === outsider.id,
  ).student;
  await call(
    teacher,
    "GET",
    education + "/report?kind=work&format=xlsx",
    undefined,
    403,
  );
  await call(
    teacher,
    "GET",
    education + "/report?kind=counts&group=" + outsider.id,
    undefined,
    403,
  );

  const courseId = randomUUID();
  const name = "تجربة إسناد " + courseId.slice(0, 8);
  const courseInput = {
    name,
    type: "private",
    level: null,
    teachers: [teacherId, colleagueId],
    groups: [group.id],
    students: [],
    status: "active",
    commission: null,
    criterion: "manual",
  };
  const proposed = await call(
    teacher,
    "PUT",
    education + "/courses/" + courseId,
    courseInput,
  );
  assert.deepEqual(proposed.teachers, []);
  const pending = (
    await call(teacher, "GET", education + "/courses/" + courseId)
  ).teacherRequest;
  assert.deepEqual(pending.teachers, [teacherId, colleagueId]);
  const decision = education + "/courses/" + courseId + "/teachers/decision";
  await call(
    teacher,
    "POST",
    decision,
    { request: pending.id, approve: true },
    403,
  );
  await call(
    colleague,
    "GET",
    education + "/courses/" + courseId,
    undefined,
    403,
  );
  await call(
    teacher,
    "GET",
    education + "/report?kind=courses&course=" + courseId,
    undefined,
    403,
  );
  const adminNotice = (
    await call(admin, "GET", education + "/notifications")
  ).items.find((n) => n.route === "course/" + courseId);
  assert(adminNotice && !adminNotice.read);
  await call(
    colleague,
    "PUT",
    education + "/notifications/" + adminNotice.id + "/read",
    undefined,
    404,
  );
  await call(
    admin,
    "PUT",
    education + "/notifications/" + adminNotice.id + "/read",
    undefined,
    204,
  );
  const approved = await call(admin, "POST", decision, {
    request: pending.id,
    approve: true,
  });
  assert.deepEqual(approved.teachers, [teacherId, colleagueId]);
  await call(
    admin,
    "POST",
    decision,
    { request: pending.id, approve: true },
    409,
  );
  assert(
    (await call(colleague, "GET", education + "/notifications")).items.some(
      (n) => n.route === "course/" + courseId,
    ),
  );
  assert(
    (await call(teacher, "GET", education + "/report?kind=courses")).rows.some(
      (row) => row[0] === name,
    ),
  );
  assert(
    !(
      await call(teacher, "GET", education + "/report?kind=recitation")
    ).rows.some((row) => row[0] === name),
  );

  const courses = (await call(teacher, "GET", education)).courses;
  const recitation = courses.find((x) => x.type === "recitation");
  const meeting = {
    group: null,
    course: recitation.id,
    date: people.today,
    from: "16:00",
    to: "17:30",
    attendanceBy: teacherId,
    lessonBy: teacherId,
    practiceBy: teacherId,
    replaces: null,
  };
  await call(
    teacher,
    "POST",
    education + "/meetings",
    { ...meeting, kind: "mixed" },
    400,
  );
  const practical = await call(teacher, "POST", education + "/meetings", {
    ...meeting,
    kind: "tajweed-practical",
  });
  const detail = await call(
    teacher,
    "GET",
    education + "/meetings/" + practical.id,
  );
  assert.deepEqual(
    detail.types.map((x) => [x.key, x.practice]),
    [
      ["theory", false],
      ["tajweed-practical", false],
    ],
  );
  const marks = detail.meeting.marks.map((x) => ({ ...x, status: "present" }));
  const save = {
    version: practical.version,
    marks,
    lesson: "تطبيق أحكام النون الساكنة",
    lessonCourse: null,
    finalize: true,
  };
  await call(
    teacher,
    "PUT",
    education + "/meetings/" + practical.id,
    {
      ...save,
      marks: marks.map((x, i) => (i === 0 ? { ...x, practice: "done" } : x)),
    },
    400,
  );
  assert.equal(
    (await call(teacher, "PUT", education + "/meetings/" + practical.id, save))
      .state,
    "final",
  );

  const competitionId = randomUUID();
  const category = {
    id: randomUUID(),
    name: "فئة تجريبية",
    unit: null,
    minAge: null,
    maxAge: null,
  };
  const competition = {
    name: "مسابقة " + competitionId.slice(0, 8),
    date: people.today,
    multiple: false,
    categories: [category],
  };
  await call(
    platform,
    "PUT",
    education + "/competitions/" + competitionId,
    competition,
  );
  const entry = education + "/competitions/" + competitionId + "/entries";
  const enrollment = {
    category: category.id,
    student: ownStudent,
    score: null,
    rank: null,
  };
  await call(
    teacher,
    "PUT",
    entry,
    { ...enrollment, student: otherStudent },
    403,
  );
  await call(teacher, "PUT", entry, { ...enrollment, score: 100 }, 403);

  const browserPath =
    process.env.CENTER_CHROME ??
    "C:/Program Files/Google/Chrome/Application/chrome.exe";
  browser = await chromium.launch({
    executablePath: existsSync(browserPath) ? browserPath : undefined,
  });
  const context = await browser.newContext({ baseURL: origin });
  const page = await context.newPage();
  const fieldSelect = (label) =>
    page
      .locator("label.field")
      .filter({ has: page.getByText(label, { exact: true }) })
      .getByRole("combobox");
  const choose = async (label, name) => {
    await fieldSelect(label).click();
    await page.getByRole("option", { name, exact: true }).click();
  };
  await page.goto("/");
  await page.locator('a[href="/c/e751f402-dbd9-449f-9d01-40b525f06c29"]').click();
  await page.getByRole("button", { name: "معلّم", exact: true }).click();
  await page.getByRole("heading", { name: "شُعَبي", exact: true }).waitFor();
  await page.goto("/#reports");
  await page.getByRole("heading", { name: "التقارير", exact: true }).waitFor();
  assert.equal(await page.locator('option[value="work"]').count(), 0);
  await fieldSelect("الوحدة").click();
  await page.getByRole("option").filter({ hasText: people.units.find((unit) => unit.id === group.unit).name }).first().click();
  await fieldSelect("الشعبة").click();
  const groupOptions = await page.getByRole("option").allTextContents();
  assert(groupOptions.includes(group.name));
  assert(!groupOptions.includes(outsider.name));
  assert(groupOptions.length < people.groups.length + 1);
  await page.keyboard.press("Escape");
  await page.goto("/#recitation");
  await page
    .getByRole("link", { name: "تفاصيل الدورة", exact: false })
    .first()
    .click();
  await page.waitForURL(url => url.pathname === "/c/e751f402-dbd9-449f-9d01-40b525f06c29" && url.hash.startsWith("#recitation-course/"));
  assert.equal(
    await page.locator(".nav-section a.selected").getAttribute("href"),
    "#recitation",
  );
  await page.getByRole("button", { name: "جدولة لقاء" }).click();
  await fieldSelect("نوع اللقاء").click();
  const typeOptions = await page.getByRole("option").allTextContents();
  assert.deepEqual(typeOptions, ["نظري", "عملي"]);
  await page.keyboard.press("Escape");
  assert.equal(
    await page.getByLabel("مسؤول التسميع", { exact: true }).count(),
    0,
  );
  await page.getByRole("button", { name: "إغلاق", exact: true }).click();
  await page.goto("/#student/" + ownStudent);
  await page
    .getByRole("button", { name: "الدورات والمسابقات", exact: true })
    .click();
  await page.getByRole("button", { name: "إسناد مسابقة" }).click();
  await choose("المسابقة", competition.name);
  await choose("الفئة", category.name);
  await page.getByRole("button", { name: "حفظ", exact: true }).click();
  await page.getByText("أُسندت المسابقة للطالب").waitFor();
  const report = await call(
    teacher,
    "GET",
    education + "/report?kind=competitions&competition=" + competitionId,
  );
  assert.equal(report.rows[0][0], competition.name);
  await call(admin, "PUT", entry, { ...enrollment, score: 80, rank: 2 });
  const duplicate = await call(teacher, "PUT", entry, enrollment);
  assert.equal(duplicate.score, 80);
  console.log(
    "PASS: report scope, dynamic filters, course approvals, private inbox, Tajweed meetings, and student competition enrollment.",
  );
} finally {
  await browser?.close();
  await Promise.all([
    platform.dispose(),
    admin.dispose(),
    teacher.dispose(),
    colleague.dispose(),
  ]);
}

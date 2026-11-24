import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chromium, request } from "@playwright/test";

const origin = process.env.CENTER_TEST_ORIGIN ?? "http://localhost:8088";
const chrome =
  process.env.CENTER_CHROME ??
  "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({
  executablePath: existsSync(chrome) ? chrome : undefined,
});
const apiOptions = { baseURL: origin, extraHTTPHeaders: { Origin: origin } };
const director = await request.newContext(apiOptions);
const teacher = await request.newContext(apiOptions);
const auth = "/api/auth";

async function call(client, method, path, data, status = 200) {
  const response = await client.fetch(path, {
    method,
    data,
    headers: { Origin: origin },
  });
  assert.equal(response.status(), status, method + " " + path);
  return status < 400 && status !== 204 ? response.json() : undefined;
}

async function firstLogin(client, credentials, roles, center, password) {
  await call(client, "POST", auth + "/login", {
    email: credentials.email,
    password: credentials.temporaryPassword,
    portal: "center", center,
  });
  const initial = await call(client, "GET", auth + "/me");
  assert.equal(initial.mustChangePassword, true);
  assert.deepEqual(
    initial.centers.map(({ id, roles }) => ({ id, roles })),
    [{ id: center, roles }],
  );
  const people = "/api/centers/" + center + "/people";
  await call(client, "GET", people, undefined, 403);
  await call(
    client,
    "POST",
    auth + "/password/change",
    { currentPassword: credentials.temporaryPassword, password },
    204,
  );
  await call(client, "GET", people);
}

try {
  const context = await browser.newContext({ baseURL: origin });
  const page = await context.newPage();
  assert.equal((await call(context.request, "GET", auth + "/info")).demo, true);
  const suffix = randomUUID().slice(0, 8);
  const name = "مركز اختبار " + suffix;
  const manager = {
    name: "مدير اختبار " + suffix,
    email: "director-" + suffix + "@example.test",
  };
  const email = "teacher-" + suffix + "@example.test";

  await page.goto("/");
  await page.getByRole("link", { name: "بوابة مدير المنصة" }).click();
  await page.getByRole("button", { name: "إدارة المنصة", exact: true }).click();
  await page.getByRole("button", { name: "إضافة مركز", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("اسم المركز", { exact: true }).fill(name);
  await dialog.getByLabel("اسم مدير المركز", { exact: true }).fill(manager.name);
  await dialog.getByLabel("البريد الإلكتروني للمدير").fill(manager.email);
  const [created] = await Promise.all([
    page.waitForResponse(
      (response) =>
        /\/api\/auth\/centers\/[^/]+$/.test(response.url()) &&
        response.request().method() === "PUT",
    ),
    dialog.getByRole("button", { name: "إنشاء المركز" }).click(),
  ]);
  assert.equal(created.status(), 200);
  const result = await created.json();
  const { id } = result.center;
  const credentials = page
    .getByRole("dialog")
    .filter({ hasText: "بيانات دخول مؤقتة" });
  await credentials.waitFor();
  assert.equal(
    await credentials.getByLabel("البريد الإلكتروني").inputValue(),
    manager.email,
  );
  assert.ok(await credentials.getByLabel("كلمة المرور المؤقتة").inputValue());
  await credentials.getByRole("button", { name: "إغلاق" }).click();
  await page.getByRole("row", { name: new RegExp(manager.name) }).waitFor();

  await page.getByRole("button", { name: "الطلبات والمراكز" }).click();
  await page
    .getByRole("row", { name: new RegExp(name) })
    .getByRole("button", { name: "الحسابات", exact: true })
    .click();
  await page.getByRole("button", { name: "إضافة حساب", exact: true }).click();
  await dialog.getByLabel("اسم الموظف").fill("معلّم اختبار " + suffix);
  await dialog.getByLabel("البريد الإلكتروني").fill(email);
  assert.equal(
    await dialog.getByRole("checkbox", { name: "معلّم" }).isChecked(),
    true,
  );
  await dialog.getByRole("button", { name: "حفظ", exact: true }).click();
  await credentials.waitFor();
  const teacherCredentials = {
    email: await credentials.getByLabel("البريد الإلكتروني").inputValue(),
    temporaryPassword: await credentials.getByLabel("كلمة المرور المؤقتة").inputValue(),
  };
  assert.equal(teacherCredentials.email, email);
  assert.ok(teacherCredentials.temporaryPassword);
  await credentials.getByRole("button", { name: "إغلاق" }).click();

  const managerPassword = "Center-Director-" + suffix + "!";
  await firstLogin(director, result.credentials, ["admin"], id, managerPassword);
  await firstLogin(
    teacher,
    teacherCredentials,
    ["teacher"],
    id,
    "Center-Teacher-" + suffix + "!",
  );
  const create = auth + "/centers/";
  const payload = { name, timeZone: "Asia/Amman", director: manager };
  await call(director, "PUT", create + randomUUID(), payload, 403);
  await call(teacher, "PUT", create + randomUUID(), payload, 403);
  assert.equal(
    (await call(context.request, "PUT", create + id, payload)).credentials,
    null,
  );

  const secondId = randomUUID();
  const second = await call(context.request, "PUT", create + secondId, {
    ...payload,
    name: name + " ب",
  });
  assert.ok(second.credentials.temporaryPassword);
  assert.equal(second.credentials.token, null);
  const secondAccount = await request.newContext(apiOptions);
  const login = { email: manager.email, password: managerPassword, portal: "center" };
  await call(secondAccount, "POST", auth + "/login", { ...login, center: secondId }, 401);
  await call(secondAccount, "POST", auth + "/login", login, 401);
  await firstLogin(secondAccount, second.credentials, ["admin"], secondId, "Independent-Second-" + suffix);
  const secondSession = await call(secondAccount, "GET", auth + "/me");
  const session = await call(director, "GET", auth + "/me");
  assert.deepEqual(session.centers.map(c => c.id), [id]);
  assert.notEqual(session.id, secondSession.id);
  const local = "/api/centers/" + id;
  const settings = local + "/people/configuration";
  await call(director, "GET", settings, undefined, 403);
  const assign = { roles: ["center-config", "admin"], units: [], active: true };
  await call(director, "PUT", local + "/identity/staff/" + session.id, assign, 403);
  await call(context.request, "PUT", local + "/identity/staff/" + session.id, assign);
  await call(director, "GET", settings);
  const localUi = await browser.newContext({ baseURL: origin, storageState: await director.storageState(), viewport: { width: 390, height: 844 } });
  const workspace = await localUi.newPage();
  await workspace.goto("/c/" + id);
  await workspace.getByRole("button", { name: "بيانات المركز", exact: true }).waitFor();
  await workspace.getByRole("link", { name: "الحسابات", exact: true }).click();
  await workspace.getByRole("button", { name: "إضافة حساب", exact: true }).click();
  assert.equal(await workspace.getByRole("checkbox", { name: "مدير منصة المركز" }).count(), 0);
  await workspace.getByRole("button", { name: "إلغاء", exact: true }).click();
  await workspace.getByRole("link", { name: "العمل اليومي" }).click();
  await workspace.getByRole("heading", { name: "الدوام الآن" }).waitFor();
  await localUi.close();
  await call(director, "GET", "/api/centers/" + secondId + "/people/configuration", undefined, 403);
  await call(director, "PUT", auth + "/brand", { name: "تجربة" }, 403);
  await call(director, "POST", local + "/identity/staff/invite", { ...manager, email, roles: ["center-config"], units: [] }, 403);
  await call(director, "GET", "/api/centers/" + secondId + "/people", undefined, 403);
  await call(context.request, "PUT", local + "/identity/profile", { name: name + " الأول", timeZone: "Asia/Amman" });
  const directory = await call(secondAccount, "GET", auth + "/directory");
  assert.deepEqual(Object.keys(directory.centers.find(c => c.id === id)).sort(), ["id", "logo", "name"]);
  const reset = await call(context.request, "POST", local + "/identity/staff/" + session.id + "/temporary");
  assert.ok(reset.temporaryPassword);
  assert.equal((await call(secondAccount, "GET", auth + "/me")).id, secondSession.id);
  await call(context.request, "PUT", create + secondId + "/active", { value: false });
  assert.equal((await call(context.request, "GET", auth + "/directory")).centers.some(c => c.id === secondId), false);
  await call(secondAccount, "GET", "/api/centers/" + secondId + "/people", undefined, 403);
  await secondAccount.dispose();
  await call(
    teacher, "GET", "/api/centers/" + secondId + "/people", undefined, 403,
  );
  const thirdId = randomUUID();
  const third = await call(context.request, "PUT", create + thirdId, {
    name: name + " ج",
    timeZone: "Asia/Amman",
  });
  assert.equal(third.center.id, thirdId);
  assert.equal(third.credentials, null);
  assert.deepEqual(
    await call(
      context.request, "GET", "/api/centers/" + thirdId + "/identity/staff/configuration",
    ),
    [],
  );
  console.log("PASS: directory, independent same-email accounts, credential isolation, scoped configuration and deactivation.");
} finally {
  await Promise.all([director.dispose(), teacher.dispose(), browser.close()]);
}

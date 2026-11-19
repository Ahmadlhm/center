import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chromium, request } from "@playwright/test";

const origin = process.env.CENTER_TEST_ORIGIN ?? "http://localhost:8088";
const auth = "/api/auth";
const center = "/api/centers/e751f402-dbd9-449f-9d01-40b525f06c29";
const peoplePath = center + "/people";
const education = center + "/education";
const [admin, teacher, anonymous] = await Promise.all(
  Array.from({ length: 3 }, () =>
    request.newContext({
      baseURL: origin,
      extraHTTPHeaders: { Origin: origin },
    }),
  ),
);
let browser;
async function call(client, method, path, data, expected = 200) {
  const result = await client.fetch(path, { method, data });
  assert.equal(
    result.status(),
    expected,
    method + " " + path + ": " + (await result.text()),
  );
  return result.status() === 204 ? undefined : result.json();
}
try {
  await call(admin, "POST", auth + "/login", {
    email: "admin@demo.local",
    password: "Demo-Admin-2026!",
  });
  await call(teacher, "POST", auth + "/login", {
    email: "teacher@demo.local",
    password: "Demo-Teacher-2026!",
  });
  const [people, catalog] = await Promise.all([
    call(admin, "GET", peoplePath),
    call(admin, "GET", auth + "/catalog"),
  ]);
  const sequence = peoplePath + "/students/next-number";
  await call(anonymous, "GET", sequence, undefined, 401);
  await call(teacher, "GET", sequence, undefined, 403);
  const next = BigInt((await call(admin, "GET", sequence)).number);
  const first = randomUUID();
  const second = randomUUID();
  const firstPath = peoplePath + "/students/" + first;
  const secondPath = peoplePath + "/students/" + second;
  const baseline = [{ surah: 1, from: 1, to: 6 }];
  const marker = "اختبار-طالب-" + first.slice(0, 6);
  await call(teacher, "PUT", firstPath, { name: marker }, 403);
  await call(
    admin,
    "PUT",
    firstPath,
    { name: marker, birth: "2100-01-01" },
    400,
  );
  const juzStart = catalog.juz.at(-1);
  const fullJuz = catalog.surahs
    .filter((surah) => surah.number >= juzStart.surah)
    .map((surah) => ({
      surah: surah.number,
      from: surah.number === juzStart.surah ? juzStart.ayah : 1,
      to: surah.verses,
    }));
  const [firstResult, secondResult] = await Promise.all([
    call(admin, "PUT", firstPath, { name: marker, baseline }),
    call(admin, "PUT", secondPath, {
      name: marker + " كامل",
      baseline: fullJuz,
    }),
  ]);
  assert.deepEqual(
    new Set([firstResult.number, secondResult.number]),
    new Set([String(next), String(next + 1n)]),
  );
  assert.equal(
    (
      await call(admin, "PUT", firstPath, {
        name: marker,
        number: "manual",
        baseline,
      })
    ).number,
    firstResult.number,
  );
  assert.equal((await call(admin, "GET", sequence)).number, String(next + 2n));
  const read = (id) => call(admin, "GET", education + "/students/" + id);
  assert.deepEqual((await read(first)).memorized, { juz: 0, pages: 0 });
  assert.deepEqual((await read(second)).baseline, {
    juz: 1,
    pages: catalog.pages.filter(
      (p) => p.surah * 1000 + p.ayah >= juzStart.surah * 1000 + juzStart.ayah,
    ).length,
  });
  const batch = randomUUID();
  const external = String(next + 50n);
  const commit = center + "/import/commit";
  const importBody = {
    batch,
    rows: [
      { name: marker + " استيراد آلي" },
      { name: marker + " استيراد قديم", number: external },
    ],
  };
  assert.equal((await call(admin, "POST", commit, importBody)).count, 2);
  assert.equal((await call(admin, "POST", commit, importBody)).count, 2);
  assert.equal((await call(admin, "GET", sequence)).number, String(next + 52n));
  await call(
    admin,
    "POST",
    commit,
    { batch: randomUUID(), rows: [{ name: marker, number: external }] },
    400,
  );

  const [group, destination] = people.groups.filter(
    (g) => !g.end && g.start <= people.today,
  );
  assert(group && destination);
  const enrollment = firstPath + "/enrollment";
  const move = (group, closeGroup, expected = 200) =>
    call(
      admin,
      "POST",
      enrollment,
      { group, closeGroup, start: people.today },
      expected,
    );
  await move(null, null, 400);
  await move(group.id, null);
  await move(group.id, group.id, 400);
  const mark = {
    student: first,
    status: "present",
    practice: "done",
    note: null,
  };
  for (const [index, readings] of [
    [{ span: { surah: 1, from: 6, to: 7 }, kind: "new", result: "passed" }],
    [{ span: { surah: 1, from: 1, to: 7 }, kind: "new", result: "passed" }],
  ].entries()) {
    const meeting = await call(admin, "POST", education + "/meetings", {
      group: group.id,
      date: people.today,
      from: "09:0" + index,
      to: "11:00",
      kind: "mixed",
      attendanceBy: group.teacher,
      lessonBy: group.teacher,
      practiceBy: group.teacher,
    });
    await call(admin, "PUT", education + "/meetings/" + meeting.id, {
      version: meeting.version,
      marks: [{ ...mark, readings }],
      lesson: "اختبار اكتمال الصفحة",
      finalize: false,
    });
  }
  const complete = await read(first);
  assert.deepEqual(complete.memorized, { juz: 0, pages: 1 });
  assert.deepEqual(
    complete.progress.map((row) => row.added.pages),
    [1, 0],
  );
  const report = await call(
    admin,
    "GET",
    education + "/report?group=" + group.id,
  );
  assert.deepEqual(report.columns.slice(6), [
    "أجزاء أُكملت",
    "صفحات أُكملت",
    "مقاطع مراجعة",
  ]);
  assert.deepEqual(report.rows.find((row) => row[0] === marker).slice(6, 8), [
    "0",
    "1",
  ]);
  await move(destination.id, group.id);
  const after = (await read(first)).enrollments;
  assert(
    after.some((row) => row.group === group.id && row.end === people.today),
  );
  assert(after.some((row) => row.group === destination.id && row.end === null));

  const chrome =
    process.env.CENTER_CHROME ??
    "C:/Program Files/Google/Chrome/Application/chrome.exe";
  browser = await chromium.launch({
    executablePath: existsSync(chrome) ? chrome : undefined,
  });
  const page = await browser.newPage({ baseURL: origin });
  await page.goto("/");
  await page.getByRole("button", { name: "مدير المركز", exact: true }).click();
  await page.getByRole("link", { name: "الطلاب", exact: true }).first().click();
  await page.getByRole("button", { name: "إضافة طالب" }).click();
  const number = page.getByRole("dialog").locator('input[name="number"]');
  await page.waitForFunction(
    () => document.querySelector('input[name="number"]')?.value.length > 0,
  );
  assert.equal(await number.inputValue(), String(next + 52n));
  assert.equal(await number.getAttribute("readonly"), "");
  await page.getByRole("button", { name: "إلغاء", exact: true }).click();
  await page.goto("/#student/" + first);
  await page.getByRole("button", { name: "الشهادات", exact: true }).click();
  await page.getByRole("button", { name: "رفع شهادة" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[name="title"]').fill(marker);
  await dialog
    .locator('input[type="file"]')
    .evaluate((input) =>
      input.dispatchEvent(new Event("cancel", { bubbles: true })),
    );
  assert.equal(await dialog.isVisible(), true);
  assert.equal(
    await dialog.locator('input[name="title"]').inputValue(),
    marker,
  );
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  console.log(
    "PASS: student sequence concurrency, import retry, enrollment transfer, Juz and page completion, report totals and file cancellation.",
  );
} finally {
  await browser?.close();
  await Promise.all([admin.dispose(), teacher.dispose(), anonymous.dispose()]);
}

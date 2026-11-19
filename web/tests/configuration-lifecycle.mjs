import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request } from "@playwright/test";

const origin = process.env.CENTER_TEST_ORIGIN ?? "http://localhost:8088";
const centerId = "e751f402-dbd9-449f-9d01-40b525f06c29";
const center = "/api/centers/" + centerId;
const people = center + "/people",
  education = center + "/education",
  identity = center + "/identity";
const auth = "/api/auth";
const [platform, admin, teacher, manager] = await Promise.all(
  Array.from({ length: 4 }, () =>
    request.newContext({
      baseURL: origin,
      extraHTTPHeaders: { Origin: origin },
    }),
  ),
);
async function call(actor, method, route, data, expected = 200) {
  const response = await actor.fetch(route, { method, data });
  assert.equal(
    response.status(),
    expected,
    method + " " + route + ": " + (await response.text()),
  );
  return response.status() === 204 ? undefined : response.json();
}
const login = (actor, email, password) =>
  call(actor, "POST", auth + "/login", { email, password });
try {
  await login(platform, "platform@demo.local", "Demo-Platform-2026!");
  await login(admin, "admin@demo.local", "Demo-Admin-2026!");
  await login(teacher, "teacher@demo.local", "Demo-Teacher-2026!");
  const staff = await call(platform, "GET", identity + "/staff/configuration");
  const teacherId = (await call(teacher, "GET", auth + "/me")).id;
  assert(staff.some((x) => x.id === teacherId && x.roles.includes("teacher")));
  const director = (await call(admin, "GET", auth + "/me")).id;
  const config = await call(platform, "GET", people + "/configuration");
  const today = config.today;
  const weekday = new Date(today + "T12:00:00Z").getUTCDay();
  const tests = randomUUID().slice(0, 6);
  const newUnit = async (name, parent) =>
    call(platform, "PUT", people + "/units/" + randomUUID(), {
      name: name + tests,
      kind: "قسم",
      parent,
    });
  const first = await newUnit("قسم أ ", null);
  const child = await newUnit("قسم فرعي ", first.id);
  const second = await newUnit("قسم ب ", null);
  const extra = await newUnit("قسم ثالث ", null);
  await call(
    platform,
    "PUT",
    people + "/units/" + first.id,
    { ...first, parent: child.id },
    400,
  );
  const periodPath = people + "/periods/" + randomUUID();
  const periodBody = { name: "فترة " + tests, start: today, end: today };
  await call(admin, "PUT", periodPath, periodBody, 403);
  const period = await call(platform, "PUT", periodPath, periodBody);
  const groups = [];
  for (const unit of [child, second, extra]) {
    const route = people + "/groups/" + randomUUID();
    const group = {
      name: "شعبة " + unit.name,
      unit: unit.id,
      period: period.id,
      teacher: teacherId,
      start: today,
      days: [weekday],
      from: "10:00",
      to: "12:00",
    };
    await call(admin, "PUT", route, group, 403);
    groups.push(await call(platform, "PUT", route, group));
  }
  const policy = { effective: today, text: "لائحة اختبار " + tests };
  await call(admin, "POST", people + "/policy", policy, 403);
  assert.equal(
    (await call(platform, "POST", people + "/policy", policy)).text,
    policy.text,
  );
  const edu = await call(platform, "GET", education + "/configuration");
  await call(admin, "PUT", education + "/settings", edu.settings, 403);
  await call(platform, "PUT", education + "/settings", edu.settings);

  const managerEmail = "manager-" + tests + "@example.test";
  const invitation = await call(platform, "POST", identity + "/staff/invite", {
    name: "مشرف الأقسام",
    email: managerEmail,
    roles: ["manager"],
    units: [first.id, second.id],
  });
  await login(manager, managerEmail, invitation.temporaryPassword);
  await call(
    manager,
    "POST",
    auth + "/password/change",
    {
      currentPassword: invitation.temporaryPassword,
      password: "Manager-Demo-" + tests + "!",
    },
    204,
  );
  const managerId = (await call(manager, "GET", auth + "/me")).id;
  const scoped = await call(manager, "GET", people);
  assert.deepEqual(
    new Set(scoped.groups.map((x) => x.id)),
    new Set(groups.slice(0, 2).map((x) => x.id)),
  );
  const membership = {
    name: "مشرف قسم واحد",
    roles: ["manager"],
    units: [second.id],
    active: true,
  };
  await call(admin, "PUT", identity + "/staff/" + managerId, membership, 403);
  await call(platform, "PUT", identity + "/staff/" + managerId, membership);
  assert.deepEqual(
    (await call(manager, "GET", people)).groups.map((x) => x.id),
    [groups[1].id],
  );

  const student = randomUUID();
  await call(admin, "PUT", people + "/students/" + student, {
    name: "طالب متابعة " + tests,
  });
  await call(admin, "POST", people + "/students/" + student + "/enrollment", {
    group: groups[0].id,
    start: today,
  });
  const follow = {
    student,
    group: groups[0].id,
    text: "متابعة تجريبية",
    due: today,
    done: false,
  };
  const followPath = education + "/followups/" + randomUUID();
  await call(manager, "PUT", followPath, follow, 403);
  assert.equal((await call(teacher, "PUT", followPath, follow)).done, false);
  assert.equal(
    (await call(teacher, "PUT", followPath, { ...follow, done: true })).done,
    true,
  );

  const commission = {
    title: "تكليف دورة " + tests,
    teacher: teacherId,
    groups: [groups[0].id, groups[1].id],
  };
  await call(teacher, "POST", education + "/commissions", commission, 403);
  assert.equal(
    (await call(admin, "POST", education + "/commissions", commission)).state,
    "open",
  );
  const scheduled = education + "/groups/" + groups[0].id + "/meeting";
  const meeting = await call(teacher, "POST", scheduled, { date: today });
  assert.equal(
    (await call(teacher, "POST", scheduled, { date: today })).id,
    meeting.id,
  );
  const schedule = education + "/meetings/" + meeting.id + "/schedule";
  const edit = {
    version: meeting.version,
    cancel: false,
    date: today,
    from: "13:00",
    to: "15:00",
    teacher: teacherId,
    reason: "تغيير توقيت تجريبي",
  };
  await call(teacher, "PUT", schedule, edit, 403);
  const rescheduled = await call(admin, "PUT", schedule, edit);
  assert.match(rescheduled.from, /^13:00/);
  await call(admin, "PUT", schedule, edit, 409);
  assert.equal(
    (
      await call(admin, "PUT", schedule, {
        ...edit,
        version: rescheduled.version,
        cancel: true,
      })
    ).state,
    "cancelled",
  );

  const docs = center + "/documents";
  const upload = await admin.post(docs, {
    multipart: {
      group: groups[0].id,
      title: "شهادة أولية",
      category: "recitation",
      file: {
        name: "test.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
      },
    },
  });
  assert.equal(upload.status(), 200, await upload.text());
  const document = await upload.json();
  await call(
    teacher,
    "PUT",
    docs + "/" + document.id,
    { title: "شهادة محدثة", category: "competition", student },
    204,
  );
  const linked = (await call(admin, "GET", docs + "?student=" + student)).find(
    (x) => x.id === document.id,
  );
  assert.equal(linked?.student, student);
  assert.equal(linked?.category, "competition");
  await call(admin, "DELETE", docs + "/" + document.id, undefined, 204);

  const shiftPath = center + "/work/duties/configuration";
  await call(admin, "GET", shiftPath, undefined, 403);
  await call(platform, "PUT", shiftPath + "/" + director, {
    effective: today,
    days: [weekday],
    from: "08:00",
    to: "17:00",
    active: true,
  });
  const duties = await call(platform, "GET", shiftPath);
  const shift = duties.items.find((x) => x.employee === director);
  assert.equal(shift.scheduled, true);
  const review = shiftPath + "/" + shift.id + "/review?date=" + today;
  await call(
    admin,
    "POST",
    review,
    { teacher: director, state: "manual", reason: "اختبار صلاحية" },
    403,
  );
  assert.equal(
    (
      await call(platform, "POST", review, {
        teacher: director,
        state: "manual",
        reason: "إثبات يدوي تجريبي",
      })
    ).state,
    "manual",
  );

  const passkeys = identity + "/passkeys";
  const keys = await call(teacher, "GET", passkeys);
  for (const key of keys)
    await call(
      teacher,
      "DELETE",
      passkeys + "?id=" + encodeURIComponent(key.id),
      undefined,
      204,
    );
  if (!keys.length)
    await call(teacher, "DELETE", passkeys + "?id=unused", undefined, 204);
  await call(
    platform,
    "DELETE",
    identity + "/staff/" + managerId + "/passkeys",
    undefined,
    204,
  );
  await call(manager, "GET", auth + "/me", undefined, 401);
  const active = auth + "/centers/" + centerId + "/active";
  await call(admin, "PUT", active, { value: false }, 403);
  await call(platform, "PUT", active, { value: false });
  try {
    await call(teacher, "GET", people, undefined, 403);
  } finally {
    await call(platform, "PUT", active, { value: true });
  }
  await call(teacher, "GET", people);
  await call(teacher, "POST", auth + "/logout");
  await call(teacher, "GET", auth + "/me", undefined, 401);
  console.log(
    "PASS: configuration grants, multi-unit scope, follow-ups, commissions, meeting lifecycle, certificates, duty review, passkey revocation and center activation.",
  );
} finally {
  await Promise.all([
    platform.dispose(),
    admin.dispose(),
    teacher.dispose(),
    manager.dispose(),
  ]);
}

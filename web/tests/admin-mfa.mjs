import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

const origin = process.env.CENTER_TEST_ORIGIN ?? "http://localhost:8088";
const chrome =
  process.env.CENTER_CHROME ??
  "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({
  executablePath: existsSync(chrome) ? chrome : undefined,
});
function totp(seed, step) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...seed]
    .map((character) =>
      alphabet.indexOf(character).toString(2).padStart(5, "0"),
    )
    .join("");
  const key = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
  const clock = Buffer.alloc(8);
  clock.writeBigUInt64BE(BigInt(step));
  const hash = createHmac("sha1", key).update(clock).digest();
  const offset = hash.at(-1) & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(
    6,
    "0",
  );
}
try {
  const context = await browser.newContext({ baseURL: origin });
  const page = await context.newPage();
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
  const login = (name) =>
    page.getByRole("button", { name, exact: true }).click();
  const post = (route, data) =>
    context.request.post("/api/auth/" + route, {
      data,
      headers: { Origin: origin },
    });
  const logout = () => post("logout");
  const enter = async (code, label = "رمز التطبيق") => {
    await page.getByLabel(label, { exact: true }).fill(code);
    await page.getByRole("button", { name: "تحقق", exact: true }).click();
  };
  const open = page.getByRole("button", { name: "إنشاء مفتاح مرور" });
  await page.goto("/");
  await login("إدارة المنصة");
  const qr = page.getByAltText("رمز QR لإعداد تطبيق التحقق");
  await qr.waitFor();
  assert.match(await qr.getAttribute("src"), /^data:image\/png;base64,/);
  assert.equal((await context.request.get("/api/auth/catalog")).status(), 403);
  assert.equal((await post("mfa/register/options")).status(), 403);
  assert.equal(
    (
      await post("password/change", {
        currentPassword: "Demo-Platform-2026!",
        password: "Different-Demo-Pass!",
      })
    ).status(),
    403,
  );
  const setup = await (await post("mfa/totp/setup")).json();
  assert.equal(await qr.getAttribute("src"), setup.qr);
  const step = Math.floor(Date.now() / 30000);
  const initial = totp(setup.key, step);
  const invalid = ["000000", "000001", "000002", "000003"].find(
    (value) =>
      ![step - 1, step, step + 1, step + 2].some(
        (window) => totp(setup.key, window) === value,
      ),
  );
  assert.equal(
    (await post("mfa/totp/verify", { code: invalid })).status(),
    400,
  );
  await enter(initial);
  await page.getByRole("heading", { name: "احفظ رموز الاسترداد" }).waitFor();
  const recoveryCodes = await page
    .locator(".authenticator-codes code")
    .allTextContents();
  assert.equal(recoveryCodes.length, 8);
  assert.equal(new Set(recoveryCodes).size, 8);
  await page.getByRole("button", { name: "تم حفظ الرموز" }).click();
  await page.getByRole("button", { name: "كتالوج المنصة" }).waitFor();
  assert.equal((await context.request.get("/api/auth/catalog")).status(), 200);
  assert.equal((await post("mfa/totp/setup")).status(), 403);

  await logout();
  await page.reload();
  await login("إدارة المنصة");
  await page
    .getByRole("heading", { name: "التحقق من حساب مدير المنصة" })
    .waitFor();
  assert.equal((await post("mfa/totp/setup")).status(), 409);
  assert.equal(
    (await post("mfa/totp/verify", { code: initial })).status(),
    400,
  );
  const later = Math.max(Math.floor(Date.now() / 30000), step + 1);
  await enter(totp(setup.key, later));
  await page.getByRole("button", { name: "كتالوج المنصة" }).waitFor();

  await logout();
  await page.reload();
  await login("إدارة المنصة");
  await page.getByRole("button", { name: "استخدام رمز استرداد" }).click();
  await enter(recoveryCodes[0], "رمز الاسترداد");
  await page.getByRole("button", { name: "كتالوج المنصة" }).waitFor();

  await logout();
  await page.reload();
  await login("إدارة المنصة");
  await page
    .getByRole("heading", { name: "التحقق من حساب مدير المنصة" })
    .waitFor();
  assert.equal(
    (await post("mfa/totp/verify", { code: recoveryCodes[0] })).status(),
    400,
  );
  await logout();
  await page.reload();

  await login("مدير المركز");
  await open.waitFor();
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const card = await page
      .getByRole("heading", { name: "إعداد مفتاح مرور للمدير" })
      .locator("..")
      .boundingBox();
    assert(card);
    assert(Math.abs(card.x + card.width / 2 - viewport.width / 2) <= 2);
    assert(Math.abs(card.y + card.height / 2 - viewport.height / 2) <= 2);
  }
  assert.equal((await post("mfa/totp/setup")).status(), 403);
  await open.click();
  await page.getByText(/أهلًا أحمد/).waitFor();
  await logout();
  await page.reload();
  await login("مدير المركز");
  await page.getByRole("button", { name: "تحقق الآن", exact: true }).click();
  await page.getByText(/أهلًا أحمد/).waitFor();
  const user = await (await context.request.get("/api/auth/me")).json();
  assert.equal(user.requiresMfa, false);
  assert.equal(user.hasPasskey, true);
  await logout();
  console.log(
    "PASS: platform TOTP enrollment, replay prevention, recovery, center director WebAuthn and centered screens.",
  );
} finally {
  await browser.close();
}

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

const origin = process.env.CENTER_TEST_ORIGIN ?? "http://localhost:8088";
const chrome =
  process.env.CENTER_CHROME ??
  "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({
  executablePath: existsSync(chrome) ? chrome : undefined,
});
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
  const platform = () =>
    page.getByRole("button", { name: "إدارة المنصة", exact: true }).click();
  const open = page.getByRole("button", { name: "إنشاء مفتاح مرور" });
  await page.goto("/");
  await platform();
  await open.waitFor();
  assert.equal((await context.request.get("/api/auth/catalog")).status(), 403);
  await open.click();
  await page.getByRole("button", { name: "كتالوج المنصة" }).waitFor();
  assert.equal((await context.request.get("/api/auth/catalog")).status(), 200);
  const logout = () =>
    context.request.post("/api/auth/logout", { headers: { Origin: origin } });
  await logout();
  await page.reload();
  await platform();
  await page.getByRole("button", { name: "تحقق الآن", exact: true }).click();
  await page.getByRole("button", { name: "كتالوج المنصة" }).waitFor();
  const user = await (await context.request.get("/api/auth/me")).json();
  assert.equal(user.requiresMfa, false);
  assert.equal(user.hasPasskey, true);
  await logout();
  console.log(
    "PASS: platform mandatory MFA, WebAuthn registration and fresh-session authentication.",
  );
} finally {
  await browser.close();
}

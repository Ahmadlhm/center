import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const origin = process.env.CENTER_TEST_ORIGIN ?? "http://localhost:5173";
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage();
  const testPage = new URL("/__android-biometrics-test", origin).href;
  const enrollment = "/identity/android-attendance";
  const attendance = "/work/checkins/meeting";
  const requests = [];
  await page.route(testPage, (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
  );
  await page.route("**/api/mock/**", async (route) => {
    const request = route.request();
    const address = new URL(request.url());
    requests.push([request.method(), address.pathname + address.search, request.postDataJSON()]);
    if (address.pathname.endsWith("/register/options")) {
      await route.fulfill({ json: { id: "device-key", challenge: "enroll-challenge" } });
    } else if (address.pathname.endsWith("/checkins/meeting/options")) {
      await route.fulfill({ json: { id: "attendance-proof", challenge: "attendance-challenge", keyIds: ["device-key"] } });
    } else {
      await route.fulfill({ status: 204 });
    }
  });
  await page.goto(testPage);
  const result = await page.evaluate(async ({ enrollment, attendance }) => {
    const calls = [];
    window.androidBridge = {};
    window.Capacitor = {
      PluginHeaders: [{
        name: "AndroidBiometrics",
        methods: ["enroll", "sign", "remove", "openSettings"].map((name) => ({ name, rtype: "promise" })),
      }],
      nativePromise: async (plugin, method, input) => {
        calls.push([plugin, method, input]);
        if (method === "enroll") return { chain: ["certificate"], signature: "enrollment-signature" };
        if (method === "sign") return { keyId: "device-key", signature: "attendance-signature" };
      },
    };
    navigator.credentials.create = navigator.credentials.get = () => {
      throw new Error("Android attendance called browser WebAuthn");
    };
    const device = await import("/src/device-passkeys.ts");
    const enroll = await device.prepareDeviceEnrollment("/api/mock" + enrollment);
    const choicesBeforeUserTap = calls.length;
    await enroll();
    const sign = await device.prepareDeviceAssertion("/api/mock" + attendance, "2026-11-23");
    const assertion = await sign();
    await device.revokeAttendanceDevice("/api/mock" + enrollment, "device-key");
    return {
      supported: device.supportsDevicePasskeys(),
      choicesBeforeUserTap,
      calls,
      assertion,
      cancellation: device.devicePasskeyError({ code: "PROMPT_13" }),
      noBiometrics: device.devicePasskeyError({ code: "NOT_ENROLLED" }),
    };
  }, { enrollment, attendance });
  assert(result.supported);
  assert.equal(result.choicesBeforeUserTap, 0);
  assert.deepEqual(result.calls, [
    ["AndroidBiometrics", "enroll", { id: "device-key", challenge: "enroll-challenge" }],
    ["AndroidBiometrics", "sign", { challenge: "attendance-challenge", keyIds: ["device-key"] }],
    ["AndroidBiometrics", "remove", { keyId: "device-key" }],
  ]);
  assert.deepEqual(result.assertion, {
    id: "attendance-proof",
    android: { keyId: "device-key", signature: "attendance-signature" },
  });
  assert.deepEqual(requests, [
    ["POST", "/api/mock" + enrollment + "/register/options", null],
    ["POST", "/api/mock" + enrollment + "/register/complete", {
      id: "device-key", chain: ["certificate"], signature: "enrollment-signature",
    }],
    ["POST", "/api/mock" + attendance + "/options?date=2026-11-23&android=true", null],
    ["DELETE", "/api/mock" + enrollment + "?id=device-key", null],
  ]);
  assert.match(result.cancellation, /أُلغي التحقق بالبصمة/);
  assert.match(result.noBiometrics, /سجّل بصمة إصبع/);
  console.log("PASS: Android biometric enrollment, assertion, revoke and error handling through the native bridge.");
} finally {
  await browser.close();
}

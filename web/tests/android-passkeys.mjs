import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const origin = process.env.CENTER_TEST_ORIGIN ?? "http://localhost:5173";
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage();
  const testPage = new URL("/__android-passkeys-test", origin).href;
  await page.route(testPage, (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
  );
  await page.goto(testPage);
  const result = await page.evaluate(async () => {
    const calls = [];
    window.androidBridge = {};
    window.Capacitor = {
      PluginHeaders: [{
        name: "AndroidPasskeys",
        methods: ["register", "verify"].map((name) => ({ name, rtype: "promise" })),
      }],
      nativePromise: async (plugin, method, input) => {
        calls.push({ plugin, method, options: input.options });
        return { id: "credential-from-android", type: "public-key" };
      },
    };
    navigator.credentials.create = navigator.credentials.get = () => {
      throw new Error("Android attendance called browser WebAuthn");
    };

    const passkeys = await import("/src/device-passkeys.ts");
    const registration = await passkeys.registerDevicePasskey({
      challenge: "registration-challenge",
      pubKeyCredParams: [
        { type: "public-key", alg: -8 },
        { type: "public-key", alg: -7 },
      ],
      authenticatorSelection: { userVerification: "required" },
    });
    const assertionOptions = {
      challenge: "assertion-challenge",
      rpId: "centers.men",
      allowCredentials: [{ id: registration.id, type: "public-key" }],
      userVerification: "required",
    };
    const assertion = await passkeys.verifyDevicePasskey(assertionOptions);
    return {
      supported: passkeys.supportsDevicePasskeys(),
      calls,
      assertionOptions,
      assertion,
      cancellation: passkeys.devicePasskeyError({ code: "GetCredentialCancellationException" }),
      noKey: passkeys.devicePasskeyError({ code: "NoCredentialException" }),
    };
  });
  assert(result.supported);
  assert.deepEqual(result.calls.map(({ plugin, method }) => [plugin, method]), [
    ["AndroidPasskeys", "register"],
    ["AndroidPasskeys", "verify"],
  ]);
  assert.deepEqual(result.calls[0].options.pubKeyCredParams, [{ type: "public-key", alg: -7 }]);
  assert.deepEqual(result.calls[0].options.authenticatorSelection, {
    userVerification: "required",
    authenticatorAttachment: "platform",
    residentKey: "required",
    requireResidentKey: true,
  });
  assert.deepEqual(result.calls[1].options, result.assertionOptions);
  assert.equal(result.assertion.id, "credential-from-android");
  assert.match(result.cancellation, /أُغلق طلب التحقق/);
  assert.match(result.noKey, /ما في مفتاح حضور/);
  console.log("PASS: Android bridge routing, ES256 registration, assertion options and errors.");
} finally {
  await browser.close();
}

import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { api, message } from "./model";

type RegistrationOptions = Parameters<typeof startRegistration>[0]["optionsJSON"];
type AuthenticationOptions = Parameters<typeof startAuthentication>[0]["optionsJSON"];
type Challenge = { id: string; challenge: string };
type AndroidAssertion = { keyId: string; signature: string };

const android = registerPlugin<{
  enroll(input: Challenge): Promise<{ chain: string[]; signature: string }>;
  sign(input: { challenge: string; keyIds: string[] }): Promise<AndroidAssertion>;
  remove(input: { keyId: string }): Promise<void>;
  openSettings(): Promise<void>;
}>("AndroidBiometrics");

export function isAndroidApp() {
  return Capacitor.getPlatform() === "android";
}

export function androidBiometricsAvailable() {
  return isAndroidApp() && Capacitor.isPluginAvailable("AndroidBiometrics");
}

export function supportsDevicePasskeys() {
  return window.isSecureContext &&
    (isAndroidApp() ? androidBiometricsAvailable() : browserSupportsWebAuthn());
}

export async function prepareDeviceEnrollment(path: string) {
  const optionsPath = path + "/register/options";
  const completePath = path + "/register/complete";
  if (isAndroidApp()) {
    const challenge = await api<Challenge>(optionsPath, "POST");
    return async () => {
      const attestation = await android.enroll(challenge);
      await api(completePath, "POST", { id: challenge.id, ...attestation });
    };
  }
  const challenge = await api<{ id: string; options: RegistrationOptions }>(optionsPath, "POST");
  return async () => {
    const response = await startRegistration({ optionsJSON: challenge.options });
    await api(completePath, "POST", { id: challenge.id, response });
  };
}

export async function prepareDeviceAssertion(endpoint: string, date?: string) {
  const query = new URLSearchParams();
  if (date) query.set("date", date);
  if (isAndroidApp()) {
    query.set("android", "true");
    const challenge = await api<Challenge & { keyIds: string[] }>(
      endpoint + "/options?" + query, "POST",
    );
    return async () => ({
      id: challenge.id,
      android: await android.sign({ challenge: challenge.challenge, keyIds: challenge.keyIds }),
    });
  }
  const challenge = await api<{ id: string; options: AuthenticationOptions }>(
    endpoint + "/options" + (date ? "?" + query : ""), "POST",
  );
  return async () => ({
    id: challenge.id,
    response: await startAuthentication({ optionsJSON: challenge.options }),
  });
}

export function openAndroidBiometricSettings() {
  return android.openSettings();
}

export async function revokeAttendanceDevice(path: string, id: string) {
  await api(path + "?id=" + encodeURIComponent(id), "DELETE");
  if (androidBiometricsAvailable()) await android.remove({ keyId: id });
}

export function devicePasskeyError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  switch (code) {
    case "DEVICE_NOT_REGISTERED":
      return "فعّل بصمة الحضور لهذا الحساب على الهاتف من صفحة «مفتاح إثبات الحضور».";
    case "NOT_ENROLLED":
    case "PROMPT_11":
      return "سجّل بصمة إصبع وقفل شاشة في إعدادات الأمان على الهاتف، ثم حاول مرة ثانية.";
    case "NO_FINGERPRINT":
      return "هذا الهاتف ما فيه مستشعر بصمة إصبع.";
    case "UNSUPPORTED_ANDROID":
      return "البصمة المباشرة تحتاج Android 11 أو أحدث.";
    case "PROMPT_5":
    case "PROMPT_10":
    case "PROMPT_13":
      return "أُلغي التحقق بالبصمة. حاول مرة ثانية عند الاستعداد.";
    case "PROMPT_7":
    case "PROMPT_9":
      return "البصمة مقفلة مؤقتًا. افتح قفل الهاتف ثم حاول مرة ثانية.";
    case "SETTINGS_UNAVAILABLE":
      return "افتح إعدادات الأمان والبصمة على الهاتف.";
    case "KEY_UNAVAILABLE":
    case "SENSOR_UNAVAILABLE":
      return "تعذّر تشغيل البصمة الآمنة. تأكّد من إعدادات البصمة وقفل الشاشة ثم حاول مرة ثانية.";
  }
  if (typeof code === "string" && code.startsWith("PROMPT_"))
    return "تعذّر إكمال التحقق بالبصمة. حاول مرة ثانية.";
  if (error instanceof Error && error.name === "NotAllowedError")
    return "لم يكتمل التحقق على هذا الجهاز. حاول مرة أخرى وتابع نافذة الجهاز.";
  return message(error);
}

import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { message } from "./model";

export type RegistrationOptions = Parameters<typeof startRegistration>[0]["optionsJSON"];
export type AuthenticationOptions = Parameters<typeof startAuthentication>[0]["optionsJSON"];

const androidPasskeys = registerPlugin<{
  register(input: { options: RegistrationOptions }): ReturnType<typeof startRegistration>;
  verify(input: { options: AuthenticationOptions }): ReturnType<typeof startAuthentication>;
}>("AndroidPasskeys");

export function usesAndroidPasskeys() {
  return Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("AndroidPasskeys");
}

export function supportsDevicePasskeys() {
  return window.isSecureContext && (usesAndroidPasskeys() || browserSupportsWebAuthn());
}

export function registerDevicePasskey(options: RegistrationOptions) {
  if (!usesAndroidPasskeys()) return startRegistration({ optionsJSON: options });

  // Android's built-in passkey providers support ES256.
  const algorithms = options.pubKeyCredParams.filter(({ alg }) => alg === -7);
  if (!algorithms.length) throw new Error("خادم المنصة لا يوفّر خوارزمية متوافقة مع مفاتيح Android.");
  return androidPasskeys.register({
    options: {
      ...options,
      pubKeyCredParams: algorithms,
      authenticatorSelection: {
        ...options.authenticatorSelection,
        authenticatorAttachment: "platform",
        residentKey: "required",
        requireResidentKey: true,
      },
    },
  });
}

export function verifyDevicePasskey(options: AuthenticationOptions) {
  if (usesAndroidPasskeys()) return androidPasskeys.verify({ options });
  return startAuthentication({ optionsJSON: options });
}

export function devicePasskeyError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  switch (code) {
    case "NoCredentialException":
      return "ما في مفتاح حضور متاح لهذا الحساب على الجهاز. أضف مفتاحًا من صفحة «مفتاح إثبات الحضور» ثم أعد المحاولة.";
    case "UNSUPPORTED_ANDROID":
      return "مفاتيح الحضور تحتاج Android 9 أو أحدث.";
    case "CreateCredentialCancellationException":
    case "GetCredentialCancellationException":
      return "أُغلق طلب التحقق. أعد المحاولة وأكمل التحقق من نافذة Android.";
    case "CreateCredentialNoCreateOptionException":
    case "CreateCredentialProviderConfigurationException":
    case "GetCredentialProviderConfigurationException":
    case "CreateCredentialUnsupportedException":
    case "GetCredentialUnsupportedException":
      return "فعّل قفل الشاشة والبصمة ومدير مفاتيح المرور من إعدادات Android، ثم أعد المحاولة.";
  }
  if (typeof code === "string" && (
    code.startsWith("CreateCredential") ||
    code.startsWith("GetCredential") ||
    code.endsWith("PublicKeyCredentialDomException")
  )) {
    return "تعذّر إكمال طلب مفتاح الحضور على Android. تأكّد من تفعيل البصمة ومدير مفاتيح المرور ثم أعد المحاولة.";
  }
  if (error instanceof Error && error.name === "NotAllowedError")
    return "لم يكتمل التحقق على هذا الجهاز. حاول مرة أخرى وتابع نافذة الجهاز.";
  if (Capacitor.getPlatform() === "android" && message(error).includes("pubKeyCredParams"))
    return "حدّث تطبيق Android لتتمكن من إعداد مفتاح الحضور من نافذة الجهاز.";
  return message(error);
}

import { useState } from "react";
import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { Fingerprint, LogOut } from "lucide-react";
import { api, message, type Session } from "./model";
import { GoogleAdminLink } from "./passwords";
import { Button, ErrorBox } from "./ui";

export function AdminMfa({
  user,
  done,
  logout,
}: {
  user: Session;
  done: () => Promise<void>;
  logout: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function verify() {
    setError("");
    setBusy(true);
    try {
      if (!window.isSecureContext)
        throw new Error(
          "يحتاج مفتاح المرور اتصال HTTPS بشهادة يثق بها المتصفح.",
        );
      if (user.hasPasskey) {
        const challenge = await api<{
          id: string;
          options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
        }>("/api/auth/mfa/options", "POST");
        const response = await startAuthentication({
          optionsJSON: challenge.options,
        });
        await api("/api/auth/mfa/complete", "POST", {
          id: challenge.id,
          response,
        });
      } else {
        const challenge = await api<{
          id: string;
          options: Parameters<typeof startRegistration>[0]["optionsJSON"];
        }>("/api/auth/mfa/register/options", "POST");
        const response = await startRegistration({
          optionsJSON: challenge.options,
        });
        await api("/api/auth/mfa/register/complete", "POST", {
          id: challenge.id,
          response,
        });
      }
      await done();
    } catch (e) {
      const detail = message(e);
      setError(
        /tls certificate errors/i.test(detail)
          ? "تعذّر استخدام مفتاح المرور لأن المتصفح لا يثق بشهادة HTTPS لهذا الاتصال."
          : detail,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-checkpoint">
      <section className="card panel mfa-panel">
        <span className="metric-icon mint">
          <Fingerprint size={23} />
        </span>
        <h1>
          {user.hasPasskey
            ? "التحقق من حساب المدير"
            : "إعداد مفتاح مرور للمدير"}
        </h1>
        <p>أكمل التحقق بالبصمة أو رمز قفل الجهاز المرتبط بمفتاح حسابك.</p>
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="actions">
          <Button disabled={busy} onClick={() => void verify()}>
            {user.hasPasskey ? "تحقق الآن" : "إنشاء مفتاح مرور"}
          </Button>
          <Button kind="outline" onClick={() => void logout()}>
            <LogOut size={16} />
            خروج
          </Button>
        </div>
        {user.googleSignIn && <GoogleAdminLink />}
      </section>
    </main>
  );
}

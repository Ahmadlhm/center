import { useEffect, useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { api, message } from "./model";
import { Button, ErrorBox, Field } from "./ui";

const endpoint = "/api/auth/mfa/totp";

export function AuthenticatorMfa({
  enrolled,
  done,
  logout,
}: {
  enrolled: boolean;
  done: () => Promise<void>;
  logout: () => Promise<void>;
}) {
  const [setup, setSetup] = useState<{ qr: string; key: string }>();
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (enrolled) return;
    let active = true;
    void api<{ qr: string; key: string }>(endpoint + "/setup", "POST").then(
      (value) => {
        if (active) setSetup(value);
      },
      (failure) => {
        if (active) setError(message(failure));
      },
    );
    return () => {
      active = false;
    };
  }, [enrolled]);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const normalized = code.replace(/[٠-٩۰-۹]/g, (digit) =>
      String(digit.charCodeAt(0) - (digit <= "٩" ? 0x660 : 0x6f0)),
    );
    try {
      const { recoveryCodes } = await api<{ recoveryCodes: string[] }>(
        endpoint + "/verify",
        "POST",
        { code: normalized },
      );
      if (recoveryCodes.length) setRecoveryCodes(recoveryCodes);
      else await done();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-checkpoint">
      <section className="card panel mfa-panel">
        <span className="metric-icon mint">
          <KeyRound size={23} />
        </span>
        {recoveryCodes.length ? (
          <>
            <h1>احفظ رموز الاسترداد</h1>
            <p>
              احتفظ بها في مكان آمن لاستخدامها إذا فقدت تطبيق التحقق. كل رمز
              يعمل مرة واحدة.
            </p>
            <div className="authenticator-codes" dir="ltr">
              {recoveryCodes.map((value) => (
                <code key={value}>{value}</code>
              ))}
            </div>
            <div className="actions">
              <Button onClick={() => void done()}>تم حفظ الرموز</Button>
            </div>
          </>
        ) : (
          <>
            <h1>
              {enrolled
                ? "التحقق من حساب مدير المنصة"
                : "إعداد Google Authenticator"}
            </h1>
            <p>
              {enrolled
                ? "أدخل الرمز الحالي من تطبيق Google Authenticator."
                : "امسح رمز QR من تطبيق Google Authenticator، ثم أدخل الرمز الذي يظهر فيه."}
            </p>
            {error && <ErrorBox>{error}</ErrorBox>}
            {setup && (
              <>
                <img
                  className="authenticator-qr"
                  src={setup.qr}
                  alt="رمز QR لإعداد تطبيق التحقق"
                />
                <details>
                  <summary>عرض مفتاح الإعداد اليدوي</summary>
                  <Field label="مفتاح الإعداد">
                    <input readOnly dir="ltr" value={setup.key} />
                  </Field>
                </details>
              </>
            )}
            <form
              className="auth-fields"
              onSubmit={(event) => void verify(event)}
            >
              <Field label={recovery ? "رمز الاسترداد" : "رمز التطبيق"}>
                <input
                  name="code"
                  dir="ltr"
                  inputMode={recovery ? "text" : "numeric"}
                  autoComplete="one-time-code"
                  maxLength={recovery ? 30 : 6}
                  required
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </Field>
              <div className="actions">
                <Button type="submit" disabled={busy || (!enrolled && !setup)}>
                  تحقق
                </Button>
                <Button
                  kind="outline"
                  disabled={busy}
                  onClick={() => void logout()}
                >
                  تسجيل الخروج
                </Button>
              </div>
            </form>
            {enrolled && (
              <div>
                <Button
                  kind="outline"
                  disabled={busy}
                  onClick={() => {
                    setRecovery(!recovery);
                    setCode("");
                    setError("");
                  }}
                >
                  {recovery ? "استخدام رمز التطبيق" : "استخدام رمز استرداد"}
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}

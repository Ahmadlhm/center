import { useState, type FormEvent } from "react";
import { api, message } from "./model";
import { Button, Dialog, ErrorBox, Field } from "./ui";

export type IssuedCredentials = {
  email: string;
  temporaryPassword: string | null;
  token: string | null;
};

export function TemporaryCredentials({
  info,
  close,
}: {
  info: IssuedCredentials;
  close: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog title="بيانات دخول مؤقتة" close={close}>
      <p>
        شاركها مع صاحب الحساب. تنتهي الصلاحية بعد ثلاثة أيام، ويغيّرها المستخدم
        عند أول دخول.
      </p>
      <Field label="البريد الإلكتروني">
        <input value={info.email} readOnly dir="ltr" />
      </Field>
      <Field label="كلمة المرور المؤقتة">
        <input value={info.temporaryPassword ?? ""} readOnly dir="ltr" />
      </Field>
      <Button
        onClick={() =>
          void navigator.clipboard
            .writeText(info.email + "\n" + info.temporaryPassword)
            .then(() => setCopied(true))
        }
      >
        {copied ? "تم النسخ" : "نسخ بيانات الدخول"}
      </Button>
    </Dialog>
  );
}

export function ChangePassword({
  forced = false,
  done,
  logout,
}: {
  forced?: boolean;
  done?: () => Promise<void>;
  logout?: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const currentPassword = String(form.get("current") ?? "");
    const password = String(form.get("password") ?? "");
    setError("");
    setNotice("");
    if (password !== form.get("confirm")) {
      setError("تأكيد كلمة المرور غير مطابق.");
      return;
    }
    setSaving(true);
    try {
      await api("/api/auth/password/change", "POST", {
        currentPassword,
        password,
      });
      element.reset();
      setNotice("تم تحديث كلمة المرور.");
      if (done) await done();
    } catch (error) {
      setError(message(error));
    } finally {
      setSaving(false);
    }
  }

  const panel = (
    <section className="card panel password-panel">
      <h2>{forced ? "غيّر كلمة المرور المؤقتة" : "تغيير كلمة المرور"}</h2>
      {forced && <p>اختر كلمة مرور جديدة لمتابعة الدخول.</p>}
      {error && <ErrorBox>{error}</ErrorBox>}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <form className="auth-fields" onSubmit={submit}>
        <Field label={forced ? "كلمة المرور المؤقتة" : "كلمة المرور الحالية"}>
          <input
            type="password"
            name="current"
            autoComplete="current-password"
            dir="ltr"
            required
          />
        </Field>
        <Field label="كلمة المرور الجديدة">
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            dir="ltr"
            required
          />
        </Field>
        <Field label="تأكيد كلمة المرور الجديدة">
          <input
            type="password"
            name="confirm"
            autoComplete="new-password"
            dir="ltr"
            required
          />
        </Field>
        <div className="actions">
          <Button type="submit" disabled={saving}>
            تحديث كلمة المرور
          </Button>
          {logout && (
            <Button kind="outline" onClick={() => void logout()}>
              تسجيل الخروج
            </Button>
          )}
        </div>
      </form>
    </section>
  );
  return forced ? <main className="auth-checkpoint">{panel}</main> : panel;
}

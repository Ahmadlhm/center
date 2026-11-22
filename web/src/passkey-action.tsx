import { useState, type ReactNode } from "react";
import {
  browserSupportsWebAuthn,
  startAuthentication,
} from "@simplewebauthn/browser";
import { captureLocation } from "./device";
import { api, message } from "./model";
import { Button, Dialog, ErrorBox } from "./ui";

type Confirm = () => Promise<void>;

export function PasskeyAction({
  title,
  description,
  prepare,
  children,
  disabled,
  showSetup,
}: {
  title: string;
  description: string;
  prepare: () => Promise<Confirm>;
  children: ReactNode;
  disabled?: boolean;
  showSetup?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<Confirm>();

  async function initialize() {
    setOpen(true);
    setBusy(true);
    setError("");
    setConfirm(undefined);
    try {
      if (!window.isSecureContext || !browserSupportsWebAuthn())
        throw new Error("افتح المنصة عبر HTTPS في متصفح يدعم مفاتيح المرور مثل Safari.");
      const action = await prepare();
      setConfirm(() => action);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!confirm) return;
    setBusy(true);
    setError("");
    try {
      // The credential request begins inside this click, before any other await.
      await confirm();
      setOpen(false);
    } catch (failure) {
      setError(
        failure instanceof Error && failure.name === "NotAllowedError"
          ? "لم يكتمل التحقق على هذا الجهاز. حاول مرة أخرى وتابع نافذة الجهاز."
          : message(failure),
      );
      setConfirm(undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button disabled={disabled || busy} onClick={() => void initialize()}>
        {children}
      </Button>
      {open && (
        <Dialog title={title} close={() => !busy && setOpen(false)}>
          <p>{description}</p>
          {error && <ErrorBox>{error}</ErrorBox>}
          {busy && (
            <p role="status">{confirm ? "جارٍ التحقق…" : "جارٍ تجهيز التحقق…"}</p>
          )}
          <div className="actions">
            {confirm ? (
              <Button disabled={busy} onClick={() => void verify()}>
                متابعة التحقق
              </Button>
            ) : (
              error && (
                <Button onClick={() => void initialize()}>إعادة المحاولة</Button>
              )
            )}
            {showSetup && !busy && (
              <a
                className="btn outline"
                href="#passkey"
                onClick={() => setOpen(false)}
              >
                إعداد مفتاح على هذا الجهاز
              </a>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}

export function AttendanceProof({
  endpoint,
  date,
  verified,
  disabled,
  children,
}: {
  endpoint: string;
  date?: string;
  verified: () => Promise<void>;
  disabled?: boolean;
  children: ReactNode;
}) {
  const query = date ? "?date=" + date : "";
  return (
    <PasskeyAction
      title="تأكيد الحضور"
      description="تابع للتحقق بالوجه أو ببصمة الإصبع أو برمز قفل الجهاز. إذا لم تجد مفتاحًا لهذا الموقع، أضف مفتاحًا على هذا الجهاز أولًا."
      showSetup
      disabled={disabled}
      prepare={async () => {
        const challenge = await api<{
          id: string;
          options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
        }>(endpoint + "/options" + query, "POST");
        return async () => {
          const response = await startAuthentication({
            optionsJSON: challenge.options,
          });
          const position = await captureLocation();
          await api(endpoint + query, "POST", {
            id: challenge.id,
            response,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            captured: new Date(position.timestamp).toISOString(),
          });
          await verified();
        };
      }}
    >
      {children}
    </PasskeyAction>
  );
}

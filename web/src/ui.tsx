import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  X,
  ChevronLeft,
  FolderOpen,
  Search,
  AlertCircle,
  Check,
  Plus,
  LoaderCircle,
} from "lucide-react";
import { label, message } from "./model";
export function Button({
  children,
  onClick,
  kind = "primary",
  type = "button",
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: string;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      className={"btn " + kind}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function Badge({
  value,
  text,
}: {
  value: string | null | undefined;
  text?: string;
}) {
  const color =
    value &&
    [
      "present",
      "verified",
      "manual",
      "final",
      "approved",
      "passed",
      "active",
    ].includes(value)
      ? "green"
      : value && ["absent", "cancelled", "rejected"].includes(value)
        ? "red"
        : value &&
            ["pending", "open", "submitted", "returned", "excused"].includes(
              value,
            )
          ? "amber"
          : "grey";
  return (
    <span className={"badge " + color}>
      <i />
      {text ?? label(value)}
    </span>
  );
}
export function PageHead({
  title,
  desc,
  children,
  crumb,
}: {
  title: string;
  desc?: string;
  children?: ReactNode;
  crumb?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        {crumb && (
          <div className="crumb">
            {crumb}
            <ChevronLeft size={14} />
          </div>
        )}
        <h1>{title}</h1>
        {desc && <p>{desc}</p>}
      </div>
      {children && <div className="actions">{children}</div>}
    </header>
  );
}
export function CardHead({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children?: ReactNode;
}) {
  return (
    <div className="card-head">
      <div>
        <h2>{title}</h2>
        {desc && <p>{desc}</p>}
      </div>
      {children}
    </div>
  );
}
export function Empty({
  title = "لا توجد سجلات",
  desc,
  children,
}: {
  title?: string;
  desc?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span>
        <FolderOpen size={25} />
      </span>
      <strong>{title}</strong>
      {desc && <p>{desc}</p>}
      {children}
    </div>
  );
}
export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="errorbox">
      <AlertCircle size={18} />
      {children}
    </div>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = "بحث...",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="search-box">
      <Search size={17} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
export function Table({
  headers,
  children,
}: {
  headers: string[];
  children: ReactNode;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {headers.map((x, i) => (
              <th key={i}>{x}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export function Field({
  label: caption,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={"field " + (wide ? "wide" : "")}>
      <span>{caption}</span>
      {children}
    </label>
  );
}
type Option = { value: string; name: string };
export function Select({
  options,
  value,
  onChange,
  required = false,
  placeholder,
}: {
  options: Option[];
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((x) => (
        <option value={x.value} key={x.value}>
          {x.name}
        </option>
      ))}
    </select>
  );
}
export const options = (rows: { id: string; name: string }[]) =>
  rows.map((x) => ({ value: x.id, name: x.name }));
export function Checks({
  options: rows,
  value,
  onChange,
}: {
  options: Option[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="checks">
      {rows.map((x) => (
        <label key={x.value}>
          <input
            type="checkbox"
            checked={value.includes(x.value)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...value, x.value]
                  : value.filter((v) => v !== x.value),
              )
            }
          />
          {x.name}
        </label>
      ))}
    </div>
  );
}
export function Tabs({
  items,
  value,
  onChange,
}: {
  items: Option[];
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <div className="tabs">
      {items.map((x) => (
        <button
          key={x.value}
          type="button"
          className={value === x.value ? "active" : ""}
          onClick={() => onChange(x.value)}
        >
          {x.name}
        </button>
      ))}
    </div>
  );
}
export function Dialog({
  title,
  close,
  children,
  submit,
  confirm = "حفظ",
  wide = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  submit?: (form: FormData) => Promise<void>;
  confirm?: string;
  wide?: boolean;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!submit) return;
    setError("");
    setBusy(true);
    try {
      await submit(new FormData(event.currentTarget));
      close();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className={wide ? "large" : ""}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="إغلاق"
          onClick={close}
          disabled={busy}
        >
          <X size={21} />
        </button>
      </div>
      <form onSubmit={run}>
        <div className="dialog-body">
          {error && <ErrorBox>{error}</ErrorBox>}
          {children}
        </div>
        {submit && (
          <footer className="dialog-foot">
            <Button kind="outline" onClick={close} disabled={busy}>
              إلغاء
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <LoaderCircle className="spin" size={17} />} {confirm}
            </Button>
          </footer>
        )}
      </form>
    </dialog>
  );
}
export function Add({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button onClick={onClick}>
      <Plus size={17} />
      {children}
    </Button>
  );
}
export function Toast({ children }: { children: ReactNode }) {
  return (
    <div className="toast" role="status">
      <Check size={19} />
      {children}
    </div>
  );
}
export const val = (f: FormData, key: string) =>
  String(f.get(key) ?? "").trim();
export const optional = (f: FormData, key: string) => val(f, key) || null;
export const num = (f: FormData, key: string) =>
  val(f, key) === "" ? null : Number(val(f, key));

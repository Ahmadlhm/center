import { useState } from "react";
import { ArrowLeft, BookOpen, ChevronLeft, Search } from "lucide-react";
import logo from "../../logo.png";
import { Empty } from "./ui";

export type Brand = { name: string; logo: string | null };
export type PublicCenter = Brand & { id: string };
export type DirectoryData = { brand: Brand; centers: PublicCenter[] };
export const centerPath = (id: string) => "/c/" + encodeURIComponent(id);

export async function formLogo(form: FormData) {
  const file = form.get("logo");
  if (!(file instanceof File) || !file.size) return form.has("removeLogo") ? "" : null;
  if (file.size > 300_000) throw new Error("حجم الشعار الأقصى 300 KB.");
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("تعذّرت قراءة الشعار."));
    reader.readAsDataURL(file);
  });
}

export function BrandMark({ brand, general = false }: { brand: Brand; general?: boolean }) {
  const src = brand.logo || (general ? logo : undefined);
  return <span className="logo-tile">{src ? <img src={src} alt="" /> : <BookOpen aria-hidden="true" />}</span>;
}

export function Directory({ directory }: { directory: DirectoryData }) {
  const [query, setQuery] = useState("");
  const centers = directory.centers.filter(c => c.name.includes(query.trim()))
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  return <main className="directory">
    <header className="directory-header"><div>
      <BrandMark brand={directory.brand} general />
      <h1>{directory.brand.name}</h1>
    </div></header>
    <section className="directory-body">
      <h2>اختر مركزك</h2>
      <label className="directory-search"><Search size={19} />
        <input type="search" aria-label="ابحث عن مركز" placeholder="ابحث باسم المركز" value={query} onChange={e => setQuery(e.target.value)} />
      </label>
      <div className="directory-centers">{centers.map(c =>
        <a className="directory-center" key={c.id} href={centerPath(c.id)}>
          <BrandMark brand={c} /><strong>{c.name}</strong><ChevronLeft size={19} />
        </a>)}</div>
      {!centers.length && <Empty title={query.trim() ? "لا توجد مراكز بهذا الاسم" : "لا توجد مراكز نشطة حاليًا"} />}
      <footer><a className="auth-link" href="/#apply">انضمام مركز جديد <ArrowLeft size={15} /></a>
        <a className="auth-link" href="/admin">بوابة مدير المنصة</a></footer>
    </section>
  </main>;
}

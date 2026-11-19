import { useState } from "react";
import { Plus } from "lucide-react";
import type { Span } from "./model";
import { expanded, type Catalog } from "./quran";
import { Button, Field, Select } from "./ui";

export function SpanInputs({
  catalog,
  value,
  onChange,
}: {
  catalog: Catalog;
  value: Span;
  onChange: (value: Span) => void;
}) {
  const surah = catalog.surahs.find((x) => x.number === value.surah);
  const max = Math.max(value.to, surah?.verses ?? 1);
  return (
    <div className="span-fields">
      <Field label="السورة">
        <Select
          options={catalog.surahs.map((x) => ({
            name: x.name,
            value: String(x.number),
          }))}
          value={String(value.surah)}
          onChange={(id) => onChange({ surah: Number(id), from: 1, to: 1 })}
          required
        />
      </Field>
      <Field label="من آية">
        <input
          type="number"
          min="1"
          max={max}
          required
          value={value.from || ""}
          onChange={(e) => onChange({ ...value, from: +e.target.value })}
        />
      </Field>
      <Field label="إلى آية">
        <input
          type="number"
          min="1"
          max={max}
          required
          value={value.to || ""}
          onChange={(e) => onChange({ ...value, to: +e.target.value })}
        />
      </Field>
    </div>
  );
}

export function SpanPicker({
  catalog,
  add,
}: {
  catalog: Catalog;
  add: (ranges: Span[]) => void;
}) {
  const [source, setSource] = useState("ayah");
  const [key, setKey] = useState("");
  const list =
    source === "surah"
      ? catalog.surahs
      : source === "juz"
        ? catalog.juz
        : catalog.pages;
  const pick = () => {
    if (source === "ayah") {
      const first = catalog.surahs[0];
      if (first) add([{ surah: first.number, from: 1, to: 1 }]);
    } else if (source === "surah" || source === "juz" || source === "pages")
      add(expanded(catalog, source, Number(key)));
    setKey("");
  };
  return (
    <div className="actions">
      <Field label="إضافة من">
        <Select
          value={source}
          onChange={(v) => {
            setSource(v);
            setKey("");
          }}
          options={[
            { value: "ayah", name: "نطاق آيات" },
            { value: "surah", name: "سورة كاملة" },
            { value: "juz", name: "جزء كامل" },
            { value: "pages", name: "صفحة" },
          ]}
        />
      </Field>
      {source !== "ayah" && (
        <Field
          label={
            source === "pages"
              ? catalog.mushaf
              : source === "juz"
                ? "الجزء"
                : "السورة"
          }
        >
          <Select
            value={key}
            onChange={setKey}
            placeholder="اختر"
            options={list.map((x) => ({
              value: String(x.number),
              name: x.name,
            }))}
          />
        </Field>
      )}
      <Button
        kind="outline"
        onClick={pick}
        disabled={source !== "ayah" && !key}
      >
        <Plus size={16} />
        إضافة مقطع
      </Button>
    </div>
  );
}

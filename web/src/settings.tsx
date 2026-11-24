import { TemporaryCredentials, type IssuedCredentials } from "./passwords";
import { formLogo } from "./center-directory";
import { levelName } from "./quran";
import { useState } from "react";
import { FolderTree, MapPin, Settings2, UserPlus } from "lucide-react";
import {
  api,
  date,
  fmt,
  latestRulesByDate,
  roleLabel,
  uid,
  unitPath,
  type Context,
  type MeetingType,
  type Period,
  type Rule,
  type Staff,
  type Unit,
} from "./model";
import {
  Add,
  Badge,
  Button,
  CardHead,
  Checks,
  Dialog,
  Empty,
  Field,
  PageHead,
  Select,
  Table,
  Tabs,
  num,
  options,
  val,
} from "./ui";
import { f } from "./learning";
import { Invite } from "./main";
export function Setup({
  c,
  reloadUser,
  initialTab = "structure",
}: {
  c: Context;
  reloadUser: () => Promise<void>;
  initialTab?: string;
}) {
  const [tab, setTab] = useState(initialTab);
  const [modal, setModal] = useState("");
  const [unit, setUnit] = useState<Unit>();
  const [period, setPeriod] = useState<Period>();
  const [selectedRule, setSelectedRule] = useState<Rule>();
  return (
    <>
      <PageHead
        title="إعدادات المركز"
        desc="اضبط هيكل مركزك وسياساته ومواعيده."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "structure", name: "الهيكل والفترات" },
          { value: "rules", name: "قواعد التشغيل" },
          { value: "education", name: "التعليم والتلاوة" },
          { value: "profile", name: "بيانات المركز" },
        ]}
      />
      {tab === "structure" && (
        <>
          <section className="card">
            <CardHead
              title="الهيكل التنظيمي"
              desc="أضف وحدات رئيسية أو فرعية. يمكنك أيضًا إنشاء شعب مباشرة في المركز."
            >
              <Add
                onClick={() => {
                  setUnit(undefined);
                  setModal("unit");
                }}
              >
                إضافة وحدة
              </Add>
            </CardHead>
            {c.people.units.length ? (
              <Table headers={["الوحدة", "التصنيف", "الحالة", ""]}>
                {c.people.units.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <span className="row-link">
                        <span className="mini-icon">
                          <FolderTree size={16} />
                        </span>
                        {unitPath(c.people.units, u.id)}
                      </span>
                    </td>
                    <td>{u.kind}</td>
                    <td>
                      <Badge
                        value={u.active ? "active" : "closed"}
                        text={u.active ? "نشطة" : "مؤرشفة"}
                      />
                    </td>
                    <td>
                      <Button
                        kind="outline"
                        onClick={() => {
                          setUnit(u);
                          setModal("unit");
                        }}
                      >
                        تعديل
                      </Button>
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty title="أضف وحدتك الأولى" />
            )}
          </section>
          <section className="card">
            <CardHead title="الفترات والمواسم">
              <Add
                onClick={() => {
                  setPeriod(undefined);
                  setModal("period");
                }}
              >
                إضافة فترة
              </Add>
            </CardHead>
            {c.people.periods.length ? (
              <Table headers={["الفترة", "البداية", "النهاية", ""]}>
                {c.people.periods.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{date(p.start)}</td>
                    <td>{date(p.end)}</td>
                    <td>
                      <Button
                        kind="outline"
                        onClick={() => {
                          setPeriod(p);
                          setModal("period");
                        }}
                      >
                        تعديل
                      </Button>
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty />
            )}
          </section>
        </>
      )}
      {tab === "rules" && (
        <>
          <section className="card">
            <CardHead title="قواعد التشغيل السارية">
              <Button
                onClick={() => {
                  setSelectedRule(undefined);
                  setModal("rule");
                }}
              >
                <Settings2 size={16} />
                ضبط القواعد
              </Button>
            </CardHead>
            <div className="info-strip">
              <span>
                أقصى عدد شعب للطالب <b>{fmt(c.people.rule.groupLimit)}</b>
              </span>
              <span>
                مهلة الرصد <b>{fmt(c.people.rule.closeHours)} ساعة</b>
              </span>
              <span>
                نطاق الدوام{" "}
                <b>
                  {c.people.rule.latitude === null
                    ? "غير محدد"
                    : fmt(c.people.rule.radius) + " متر"}
                </b>
              </span>
              <span>
                إثبات الدوام{" "}
                <b>{fmt(c.people.rule.openMinutes)} دقيقة قبل البداية</b>
                {" · "}
                <b>{fmt(c.people.rule.lateMinutes)} دقيقة بعد البداية</b>
              </span>
            </div>
            {c.people.rules.length > 0 && (
              <Table
                headers={[
                  "تاريخ السريان",
                  "الحد الأقصى للشعب",
                  "مهلة الرصد",
                  "يدخل الغياب بعذر",
                  "نافذة الإثبات بعد بداية الدوام",
                  "",
                ]}
              >
                {latestRulesByDate(c.people.rules).map((r) => (
                  <tr key={r.effective}>
                    <td>
                      {r.effective.startsWith("0001")
                        ? "الإعداد الأولي"
                        : date(r.effective)}
                      {r.effective === c.people.rule.effective && (
                        <>
                          {" "}
                          <Badge value="active" text="سارية" />
                        </>
                      )}
                    </td>
                    <td>{r.groupLimit}</td>
                    <td>{r.closeHours} ساعة</td>
                    <td>{r.countExcused ? "نعم" : "لا"}</td>
                    <td>{fmt(r.lateMinutes)} دقيقة</td>
                    <td>
                      {r.effective >= c.people.today && (
                        <Button
                          kind="outline"
                          onClick={() => {
                            setSelectedRule(r);
                            setModal("rule");
                          }}
                        >
                          تعديل
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </section>
          <section className="card">
            <CardHead title="لائحة المركز">
              <Add onClick={() => setModal("policy")}>إضافة تعليمات</Add>
            </CardHead>
            {c.people.policies.length ? (
              <Table headers={["تاريخ السريان", "التعليمات"]}>
                {c.people.policies.map((p) => (
                  <tr key={p.effective}>
                    <td>{date(p.effective)}</td>
                    <td>{p.text}</td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty />
            )}
          </section>
        </>
      )}
      {tab === "education" && (
        <section className="card">
          <CardHead title="مستويات التلاوة وأنواع اللقاء">
            <Button onClick={() => setModal("education")}>
              تعديل الإعدادات
            </Button>
          </CardHead>
          <div className="info-strip">
            {c.education.settings.levels.map((x) => (
              <b key={x}>{levelName(c.catalog, x)}</b>
            ))}
          </div>
          <Table headers={["نوع اللقاء", "يُطلب درس", "تُطلب متابعة التسميع"]}>
            {c.education.settings.types.map((t) => (
              <tr key={t.key}>
                <td>{t.name}</td>
                <td>{t.lesson ? "نعم" : "لا"}</td>
                <td>{t.practice ? "نعم" : "لا"}</td>
              </tr>
            ))}
          </Table>
        </section>
      )}
      {tab === "profile" && (
        <section className="card">
          <CardHead title={c.center.name} desc={c.center.timeZone}>
            <Button onClick={() => setModal("profile")}>
              تعديل بيانات المركز
            </Button>
          </CardHead>
        </section>
      )}
      {modal === "unit" && (
        <UnitForm c={c} item={unit} close={() => setModal("")} />
      )}
      {modal === "period" && (
        <Dialog
          title={period ? "تعديل الفترة" : "إضافة فترة"}
          close={() => setModal("")}
          submit={async (form) => {
            await api(f(c, "/people/periods/" + (period?.id ?? uid())), "PUT", {
              name: val(form, "name"),
              start: val(form, "start"),
              end: val(form, "end"),
            });
            await c.refresh();
            c.notify("حُفظت الفترة");
          }}
        >
          <div className="form-grid">
            <Field label="اسم الفترة" wide>
              <input name="name" defaultValue={period?.name} required />
            </Field>
            <Field label="البداية">
              <input
                type="date"
                name="start"
                defaultValue={period?.start ?? c.people.today}
                required
              />
            </Field>
            <Field label="النهاية">
              <input
                type="date"
                name="end"
                defaultValue={period?.end ?? ""}
                required
              />
            </Field>
          </div>
        </Dialog>
      )}
      {modal === "rule" && (
        <RuleForm c={c} selected={selectedRule} close={() => setModal("")} />
      )}
      {modal === "policy" && (
        <Dialog
          title="لائحة المركز"
          close={() => setModal("")}
          submit={async (form) => {
            await api(f(c, "/people/policy"), "POST", {
              text: val(form, "text"),
              effective: val(form, "effective"),
            });
            await c.refresh();
            c.notify("حُفظت التعليمات");
          }}
        >
          <Field label="تاريخ السريان">
            <input
              type="date"
              name="effective"
              defaultValue={c.people.today}
              required
            />
          </Field>
          <Field label="التعليمات">
            <textarea name="text" required />
          </Field>
        </Dialog>
      )}
      {modal === "education" && (
        <EducationSettings c={c} close={() => setModal("")} />
      )}
      {modal === "profile" && (
        <Dialog
          title="بيانات المركز"
          close={() => setModal("")}
          submit={async (form) => {
            const logo = await formLogo(form);
            await api(f(c, "/identity/profile"), "PUT", {
              name: val(form, "name"),
              timeZone: val(form, "timeZone"),
              logo,
              mapUrl: val(form, "mapUrl"),
            });
            await reloadUser();
            await c.refresh();
            c.notify("حُدّث المركز");
          }}
        >
          <Field label="اسم المركز">
            <input name="name" required defaultValue={c.center.name} />
          </Field>
          <Field label="المنطقة الزمنية">
            <input
              name="timeZone"
              dir="ltr"
              required
              defaultValue={c.center.timeZone}
              placeholder="Asia/Amman"
            />
          </Field>
          <Field label="رابط موقع المركز">
            <input
              name="mapUrl"
              type="url"
              dir="ltr"
              defaultValue={c.center.mapUrl ?? ""}
              placeholder="https://..."
            />
          </Field>
          <Field label="صورة المركز">
            <input name="logo" type="file" accept="image/png,image/jpeg" />
          </Field>
          {c.center.logo !== "" && (
            <label className="check-line">
              <input type="checkbox" name="removeLogo" />
              إزالة الشعار الحالي
            </label>
          )}
        </Dialog>
      )}
    </>
  );
}
function UnitForm({
  c,
  item,
  close,
}: {
  c: Context;
  item?: Unit;
  close: () => void;
}) {
  const [parent, setParent] = useState(item?.parent ?? "");
  const kinds = c.catalog.unitKinds;
  const initialKind = item?.kind ?? kinds[0] ?? "";
  const [kind, setKind] = useState(initialKind);
  const [customKind, setCustomKind] = useState(!kinds.includes(initialKind));
  return (
    <Dialog
      title={item ? "تعديل الوحدة" : "إضافة وحدة تنظيمية"}
      close={close}
      submit={async (form) => {
        await api(f(c, "/people/units/" + (item?.id ?? uid())), "PUT", {
          name: val(form, "name"),
          kind,
          parent: parent || null,
          active: !form.has("inactive"),
        });
        await c.refresh();
        c.notify("حُفظت الوحدة");
      }}
    >
      <Field label="اسم الوحدة">
        <input name="name" defaultValue={item?.name} required />
      </Field>
      <Field label="تسمية المستوى">
        <Select
          options={[
            ...kinds.map((name) => ({ value: name, name })),
            { value: "__custom__", name: "تسمية أخرى" },
          ]}
          value={customKind ? "__custom__" : kind}
          onChange={(value) => {
            setCustomKind(value === "__custom__");
            setKind(value === "__custom__" ? "" : value);
          }}
        />
      </Field>
      {customKind && (
        <Field label="التسمية المخصصة">
          <input value={kind} onChange={(event) => setKind(event.target.value)} required />
        </Field>
      )}
      {
        <Field label="الوحدة الأصل">
          <Select
            value={parent}
            onChange={setParent}
            options={c.people.units
              .filter((x) => x.active && x.id !== item?.id)
              .map((x) => ({
                value: x.id,
                name: unitPath(c.people.units, x.id),
              }))}
            placeholder="وحدة رئيسية"
          />
        </Field>
      }
      {item && (
        <label className="check-line">
          <input
            name="inactive"
            type="checkbox"
            defaultChecked={!item.active}
          />
          أرشفة الوحدة
        </label>
      )}
    </Dialog>
  );
}
function RuleForm({
  c,
  selected,
  close,
}: {
  c: Context;
  selected?: Rule;
  close: () => void;
}) {
  const { today } = c.people;
  const rule = selected ?? c.people.rule;
  const [lat, setLat] = useState(rule.latitude?.toString() ?? "");
  const [lon, setLon] = useState(rule.longitude?.toString() ?? "");
  return (
    <Dialog
      title={selected ? "تعديل قواعد التشغيل" : "ضبط قواعد التشغيل"}
      close={close}
      wide
      submit={async (form) => {
        await api(f(c, "/people/rules"), "POST", {
          effective: selected?.effective ?? val(form, "effective"),
          groupLimit: num(form, "groupLimit"),
          countExcused: form.has("countExcused"),
          closeHours: num(form, "closeHours"),
          openMinutes: num(form, "openMinutes"),
          lateMinutes: num(form, "lateMinutes"),
          latitude: lat ? Number(lat) : null,
          longitude: lon ? Number(lon) : null,
          radius: num(form, "radius"),
          accuracy: num(form, "accuracy"),
          allowAttendanceReview: form.has("review"),
        });
        await c.refresh();
        c.notify("حُفظت قواعد التشغيل");
      }}
    >
      <label className="check-line">
        <input
          type="checkbox"
          name="review"
          defaultChecked={rule.allowAttendanceReview}
        />
        السماح بطلب مراجعة إثبات الحضور
      </label>
      <div className="form-grid">
        <Field label="تاريخ السريان">
          <input
            name="effective"
            type="date"
            defaultValue={selected?.effective ?? today}
            readOnly={selected !== undefined}
            min={today}
            required
          />
        </Field>
        <Field label="أقصى عدد شعب للطالب">
          <input
            name="groupLimit"
            type="number"
            required
            min="1"
            max="30"
            defaultValue={rule.groupLimit}
          />
        </Field>
        <Field label="مهلة الرصد بالساعات">
          <input
            name="closeHours"
            type="number"
            required
            min="1"
            max="720"
            defaultValue={rule.closeHours}
          />
        </Field>
        <Field label="نافذة الإثبات قبل الموعد بالدقائق">
          <input
            name="openMinutes"
            type="number"
            required
            min="0"
            max="120"
            defaultValue={rule.openMinutes}
          />
        </Field>
        <Field label="نافذة الإثبات بعد الموعد بالدقائق">
          <input
            name="lateMinutes"
            type="number"
            required
            min="0"
            max="720"
            defaultValue={rule.lateMinutes}
          />
        </Field>
        <label className="check-line">
          <input
            name="countExcused"
            type="checkbox"
            defaultChecked={rule.countExcused}
          />
          احسب الغياب بعذر في نسبة الحضور
        </label>
        <Field label="خط العرض">
          <input
            type="number"
            step="any"
            min="-90"
            max="90"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
          />
        </Field>
        <Field label="خط الطول">
          <input
            type="number"
            step="any"
            min="-180"
            max="180"
            value={lon}
            onChange={(e) => setLon(e.target.value)}
          />
        </Field>
        <Field label="نصف قطر النطاق (متر)">
          <input
            name="radius"
            type="number"
            required
            min="10"
            max="10000"
            defaultValue={rule.radius}
          />
        </Field>
        <Field label="الحد الأقصى لعدم دقة الموقع (متر)">
          <input
            name="accuracy"
            type="number"
            required
            min="5"
            max="1000"
            defaultValue={rule.accuracy}
          />
        </Field>
      </div>
      <Button
        kind="outline"
        onClick={() =>
          navigator.geolocation?.getCurrentPosition(
            (p) => {
              setLat(p.coords.latitude.toFixed(6));
              setLon(p.coords.longitude.toFixed(6));
            },
            () => c.notify("تعذّر قراءة موقع الجهاز."),
            { enableHighAccuracy: true },
          )
        }
      >
        <MapPin size={17} />
        استخدام موقعي الحالي
      </Button>
    </Dialog>
  );
}
function EducationSettings({ c, close }: { c: Context; close: () => void }) {
  const [types, setTypes] = useState<MeetingType[]>(c.education.settings.types);
  const set = (key: string, patch: Partial<MeetingType>) =>
    setTypes(types.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  return (
    <Dialog
      title="التعليم والتلاوة"
      close={close}
      wide
      submit={async (form) => {
        await api(f(c, "/education/settings"), "PUT", {
          levels: val(form, "levels")
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          types,
        });
        await c.refresh();
        c.notify("حُفظت إعدادات التعليم");
      }}
    >
      <Field label="مستويات التلاوة، كل مستوى في سطر">
        <textarea
          name="levels"
          rows={5}
          defaultValue={c.education.settings.levels.join("\n")}
          required
        />
      </Field>
      {types.map((t) => (
        <div className="reading-edit" key={t.key}>
          <Field label="اسم نوع اللقاء">
            <input
              value={t.name}
              onChange={(e) => set(t.key, { name: e.target.value })}
              required
            />
          </Field>
          <div className="actions">
            <label className="check-line">
              <input
                type="checkbox"
                checked={t.lesson}
                onChange={(e) => set(t.key, { lesson: e.target.checked })}
              />
              درس مطلوب
            </label>
            <label className="check-line">
              <input
                type="checkbox"
                checked={t.practice}
                onChange={(e) => set(t.key, { practice: e.target.checked })}
              />
              متابعة التسميع
            </label>
            <Button
              kind="ghost"
              onClick={() => setTypes(types.filter((x) => x.key !== t.key))}
            >
              إزالة
            </Button>
          </div>
        </div>
      ))}
      <Button
        kind="outline"
        onClick={() =>
          setTypes([
            ...types,
            { key: uid(), name: "", lesson: true, practice: false },
          ])
        }
      >
        إضافة نوع لقاء
      </Button>
    </Dialog>
  );
}
export function StaffPage({ c }: { c: Context }) {
  const [invite, setInvite] = useState(false);
  const [token, setToken] = useState("");
  const [credentials, setCredentials] = useState<IssuedCredentials>();
  const [reset, setReset] = useState<Staff>();
  const [clearKeys, setClearKeys] = useState<Staff>();
  const [activeStaff, setActiveStaff] = useState<Staff>();
  const [roles, setRoles] = useState<string[]>([]);
  const [units, setUnits] = useState<string[]>([]);
  return (
    <>
      <PageHead
        title="حسابات الموظفين"
        desc="إضافة حسابات للمدير والمعلّمين وتحديد صلاحياتهم."
      >
        <Button
          onClick={() => {
            setActiveStaff(undefined);
            setRoles(["teacher"]);
            setUnits([]);
            setInvite(true);
          }}
        >
          <UserPlus size={17} />
          إضافة حساب
        </Button>
      </PageHead>
      <div className="card">
        <Table headers={["الموظف", "الدور", "الوحدات المسندة", "الحالة", ""]}>
          {c.staff.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{s.roles.map((x) => roleLabel([x])).join("، ")}</td>
              <td>
                {s.units.map((x) => unitPath(c.people.units, x)).join("، ") ||
                  "—"}
              </td>
              <td>
                <Badge
                  value={s.active ? "active" : "closed"}
                  text={s.active ? "نشط" : "معطّل"}
                />
              </td>
              <td>
                {s.id !== c.user.id && (c.user.platform || !s.roles.includes("center-config")) && (
                  <Button
                    kind="outline"
                    onClick={() => {
                      setActiveStaff(s);
                      setRoles(s.roles);
                      setUnits(s.units);
                      setInvite(true);
                    }}
                  >
                    تعديل
                  </Button>
                )}
                {s.active && s.accountManageable !== false && (
                  <Button kind="outline" onClick={() => setReset(s)}>
                    كلمة مرور مؤقتة
                  </Button>
                )}
                {s.active && s.accountManageable !== false && (
                  <Button kind="outline" onClick={() => setClearKeys(s)}>
                    إبطال وسائل إثبات الحضور
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </div>
      {invite && (
        <Dialog
          title={activeStaff ? "صلاحيات " + activeStaff.name : "إضافة حساب موظف"}
          close={() => setInvite(false)}
          submit={async (form) => {
            if (activeStaff) {
              await api(f(c, "/identity/staff/" + activeStaff.id), "PUT", {
                name: val(form, "name"),
                roles,
                units,
                active: form.has("active"),
              });
              await c.refresh();
              c.notify("حُدّث الموظف");
            } else {
              const r = await api<IssuedCredentials>(
                f(c, "/identity/staff/invite"),
                "POST",
                {
                  name: val(form, "name"),
                  email: val(form, "email"),
                  roles,
                  units,
                },
              );
              if (r.temporaryPassword) setCredentials(r);
              if (r.token) setToken(r.token);
              await c.refresh();
            }
          }}
        >
          {activeStaff ? (
            <>
              <Field label="اسم الحساب">
                <input name="name" defaultValue={activeStaff.name} required />
              </Field>
              <label className="check-line">
                <input
                  type="checkbox"
                  name="active"
                  defaultChecked={activeStaff.active}
                />
                العضوية نشطة
              </label>
            </>
          ) : (
            <>
              <Field label="اسم الموظف">
                <input name="name" required />
              </Field>
              <Field label="البريد الإلكتروني">
                <input name="email" type="email" dir="ltr" required />
              </Field>
            </>
          )}
          <div className="field">
            <span>الصلاحيات</span>
            <Checks
              value={roles}
              onChange={setRoles}
              options={(c.user.platform ? ["center-config", "admin", "manager", "teacher"] : ["admin", "manager", "teacher"]).map((x) => ({
                value: x,
                name: roleLabel([x]),
              }))}
            />
          </div>
          {roles.includes("manager") && (
            <div className="field">
              <span>الوحدات المسندة إلى المدير</span>
              <Checks
                value={units}
                onChange={setUnits}
                options={c.people.units
                  .filter((x) => x.active)
                  .map((x) => ({
                    value: x.id,
                    name: unitPath(c.people.units, x.id),
                  }))}
              />
            </div>
          )}
        </Dialog>
      )}
      {token && <Invite token={token} close={() => setToken("")} />}
      {credentials && (
        <TemporaryCredentials
          info={credentials}
          close={() => setCredentials(undefined)}
        />
      )}
      {clearKeys && (
        <Dialog
          title={"إبطال وسائل إثبات حضور " + clearKeys.name}
          close={() => setClearKeys(undefined)}
          submit={async () => {
            await api(
              f(c, "/identity/staff/" + clearKeys.id + "/passkeys"),
              "DELETE",
            );
            c.notify("أُبطلت وسائل إثبات الحضور");
          }}
          confirm="إبطال وسائل التحقق"
        >
          <p>يُسجّل الموظف دخوله من جديد ويعيد تفعيل إثبات الحضور على جهازه.</p>
        </Dialog>
      )}
      {reset && (
        <Dialog
          title={"كلمة مرور مؤقتة لـ " + reset.name}
          close={() => setReset(undefined)}
          submit={async () => {
            const result = await api<IssuedCredentials>(
              f(c, "/identity/staff/" + reset.id + "/temporary"),
              "POST",
            );
            setCredentials(result);
          }}
          confirm="إصدار كلمة مرور"
        >
          <p>
            تنتهي الجلسات الحالية ويغيّر صاحب الحساب كلمة المرور عند دخوله
            القادم.
          </p>
        </Dialog>
      )}
    </>
  );
}

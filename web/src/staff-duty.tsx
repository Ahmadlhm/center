import { useEffect, useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { Fingerprint, MapPin } from "lucide-react";
import { captureLocation } from "./device";
import {
  api,
  base,
  clock,
  days,
  message,
  type CheckIn,
  type Context,
} from "./model";
import {
  Badge,
  Button,
  CardHead,
  Checks,
  Dialog,
  Empty,
  ErrorBox,
  Field,
  PageHead,
  Table,
  val,
} from "./ui";

type Shift = {
  employee: string;
  effective: string;
  days: number[];
  from: string;
  to: string;
  active: boolean;
};
type Duty = {
  id: string;
  employee: string;
  name: string;
  date: string;
  scheduled: boolean;
  shift: Shift | null;
  checkIn: CheckIn | null;
};
type DutyList = { date: string; mapUrl?: string | null; items: Duty[] };

export function StaffDuty({
  c,
  configuration = false,
}: {
  c: Context;
  configuration?: boolean;
}) {
  const [date, setDate] = useState(c.people.today);
  const [list, setList] = useState<DutyList>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [selection, setSelection] = useState<{
    item: Duty;
    action: "shift" | "request" | "review";
  }>();
  const [scheduleDays, setScheduleDays] = useState<string[]>([]);
  const path = base(c.center) + "/work";
  const route = path + "/duties" + (configuration ? "/configuration" : "");
  const refresh = () => api<DutyList>(route + "?date=" + date).then(setList);
  useEffect(() => {
    void refresh().catch((e) => setError(message(e)));
  }, [c.center.id, date]);
  async function check(item: Duty) {
    setPending(true);
    setError("");
    try {
      const position = await captureLocation();
      const start = path + "/checkins/" + item.id;
      const query = "?date=" + item.date;
      const challenge = await api<{
        id: string;
        options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
      }>(start + "/options" + query, "POST");
      const response = await startAuthentication({
        optionsJSON: challenge.options,
      });
      await api(start + query, "POST", {
        id: challenge.id,
        response,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        captured: new Date(position.timestamp).toISOString(),
      });
      await refresh();
      c.notify("أُثبت الدوام");
    } catch (error) {
      setError(message(error));
    } finally {
      setPending(false);
    }
  }
  const canReview = (item: Duty) =>
    configuration ||
    (c.center.roles.includes("admin") && c.user.id !== item.employee);
  return (
    <>
      <PageHead
        title={configuration ? "إعداد دوام الموظفين" : "دوام الموظفين"}
        desc={
          configuration
            ? "اضبط أيام الدوام وساعات حضوره لكل حساب في المركز."
            : "أثبت حضورك في نطاق المركز باستخدام مفتاح مرور الجهاز."
        }
      >
        {!configuration && list?.mapUrl && (
          <a
            className="btn outline"
            href={list.mapUrl}
            target="_blank"
            rel="noreferrer"
          >
            <MapPin size={16} />
            موقع المركز
          </a>
        )}
      </PageHead>
      {error && <ErrorBox>{error}</ErrorBox>}
      <section className="card">
        <CardHead title="الدوام في التاريخ المحدد">
          <input
            type="date"
            aria-label="تاريخ الدوام"
            value={date}
            onChange={(e) => setDate(e.target.value || c.people.today)}
          />
        </CardHead>
        {!list?.items.length ? (
          <Empty />
        ) : (
          <Table headers={["الموظف", "الجدول", "الحالة", ""]}>
            {list.items.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>
                  {item.scheduled && item.shift
                    ? clock(item.shift.from) + " – " + clock(item.shift.to)
                    : "لا يوجد دوام مجدول"}
                </td>
                <td>
                  <Badge value={item.checkIn?.state} />
                </td>
                <td>
                  <div className="actions">
                    {configuration && (
                      <Button
                        kind="outline"
                        onClick={() => {
                          setScheduleDays(item.shift?.days.map(String) ?? []);
                          setSelection({ item, action: "shift" });
                        }}
                      >
                        تعديل الجدول
                      </Button>
                    )}
                    {!configuration &&
                      item.employee === c.user.id &&
                      item.scheduled &&
                      item.date === c.people.today &&
                      item.checkIn?.state !== "verified" && (
                        <Button
                          disabled={pending}
                          onClick={() => void check(item)}
                        >
                          <Fingerprint size={16} />
                          إثبات الحضور
                        </Button>
                      )}
                    {!configuration &&
                      item.employee === c.user.id &&
                      item.scheduled &&
                      item.date <= c.people.today &&
                      (!item.checkIn || item.checkIn.state === "pending") &&
                      c.people.rule.allowAttendanceReview && (
                        <Button
                          kind="outline"
                          onClick={() =>
                            setSelection({ item, action: "request" })
                          }
                        >
                          طلب مراجعة
                        </Button>
                      )}
                    {canReview(item) &&
                      (item.checkIn || item.scheduled) &&
                      item.date <= c.people.today && (
                        <Button
                          kind="outline"
                          onClick={() =>
                            setSelection({ item, action: "review" })
                          }
                        >
                          مراجعة الدوام
                        </Button>
                      )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>
      {selection && (
        <Dialog
          title={
            selection.action === "shift"
              ? "جدول دوام " + selection.item.name
              : "مراجعة الدوام"
          }
          close={() => setSelection(undefined)}
          submit={async (form) => {
            const { item, action } = selection;
            if (action === "shift")
              await api(route + "/" + item.employee, "PUT", {
                effective: val(form, "effective"),
                from: val(form, "from"),
                to: val(form, "to"),
                days: scheduleDays.map(Number),
                active: form.has("active"),
              });
            else {
              const target = configuration
                ? route + "/" + item.id + "/review"
                : path + "/checkins/" + item.id + "/review";
              await api(target + "?date=" + item.date, "POST", {
                teacher: item.employee,
                state: action === "request" ? "pending" : val(form, "state"),
                reason: val(form, "reason"),
              });
            }
            await refresh();
            c.notify("حُفظ التعديل");
          }}
        >
          {selection.action === "shift" ? (
            <>
              <Field label="تاريخ السريان">
                <input
                  name="effective"
                  type="date"
                  min={c.people.today}
                  defaultValue={c.people.today}
                  required
                />
              </Field>
              <div className="form-grid">
                <Field label="بداية الدوام">
                  <input
                    name="from"
                    type="time"
                    defaultValue={clock(selection.item.shift?.from ?? "08:00")}
                    required
                  />
                </Field>
                <Field label="نهاية الدوام">
                  <input
                    name="to"
                    type="time"
                    defaultValue={clock(selection.item.shift?.to ?? "15:00")}
                    required
                  />
                </Field>
              </div>
              <Checks
                options={days.map((name, i) => ({ name, value: String(i) }))}
                value={scheduleDays}
                onChange={setScheduleDays}
              />
              <label className="check-line">
                <input
                  type="checkbox"
                  name="active"
                  defaultChecked={selection.item.shift?.active ?? true}
                />
                الجدول نشط
              </label>
            </>
          ) : (
            <>
              {selection.action === "review" && (
                <Field label="القرار">
                  <select name="state">
                    <option value="manual">اعتماد الحضور</option>
                    <option value="absent">غياب</option>
                  </select>
                </Field>
              )}
              <Field label="السبب">
                <textarea name="reason" required />
              </Field>
            </>
          )}
        </Dialog>
      )}
    </>
  );
}

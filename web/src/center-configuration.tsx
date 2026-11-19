import { useCallback, useEffect, useState } from "react";
import {
  api,
  base,
  message,
  type Center,
  type Context,
  type Education,
  type People,
  type Session,
  type Staff,
} from "./model";
import type { Catalog } from "./quran";
import { Setup, StaffPage } from "./settings";
import { Contests } from "./programs";
import { Groups } from "./learning";
import { StaffDuty } from "./staff-duty";
import { Empty, ErrorBox, Tabs, Toast } from "./ui";

export function CenterConfiguration({
  center,
  user,
  catalog,
  reload,
}: {
  center: Center;
  user: Session;
  catalog: Catalog;
  reload: () => Promise<void>;
}) {
  const [tab, setTab] = useState("settings");
  const [data, setData] =
    useState<Pick<Context, "people" | "education" | "staff">>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const endpoint = base(center);
  const refresh = useCallback(async () => {
    const [people, teaching, staff] = await Promise.all([
      api<Omit<People, "students" | "enrollments">>(
        endpoint + "/people/configuration",
      ),
      api<Pick<Education, "settings" | "competitions">>(
        endpoint + "/education/configuration",
      ),
      api<Staff[]>(endpoint + "/identity/staff/configuration"),
    ]);
    setData({
      people: { ...people, students: [], enrollments: [] },
      education: {
        ...teaching,
        meetings: [],
        courses: [],
        commissions: [],
        entries: [],
        followUps: [],
      },
      staff,
    });
    setError("");
  }, [endpoint]);
  useEffect(() => {
    void refresh().catch((error) => setError(message(error)));
  }, [refresh]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  if (!data)
    return error ? (
      <ErrorBox>{error}</ErrorBox>
    ) : (
      <Empty title="جارٍ تحميل الإعدادات…" />
    );
  const c: Context = {
    ...data,
    center: { ...center, roles: ["admin"], units: [] },
    user,
    catalog,
    work: { tasks: [], checkIns: [] },
    refresh,
    notify: setNotice,
  };
  return (
    <>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "settings", name: "الهيكل والموقع" },
          { value: "groups", name: "الشعب" },
          { value: "staff", name: "الحسابات والصلاحيات" },
          { value: "duties", name: "إعدادات دوام الموظفين" },
          { value: "contests", name: "المسابقات والفئات" },
        ]}
      />
      {error && <ErrorBox>{error}</ErrorBox>}
      {tab === "settings" && <Setup c={c} reloadUser={reload} />}
      {tab === "groups" && <Groups c={c} configuration />}
      {tab === "staff" && <StaffPage c={c} />}
      {tab === "duties" && <StaffDuty c={c} configuration />}
      {tab === "contests" && <Contests c={c} configuration />}
      {notice && <Toast>{notice}</Toast>}
    </>
  );
}

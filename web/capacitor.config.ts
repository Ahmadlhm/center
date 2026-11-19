import type { CapacitorConfig } from "@capacitor/cli";

const appUrl = process.env.CENTER_APP_URL;
if (appUrl && new URL(appUrl).protocol !== "https:") {
  throw new Error("CENTER_APP_URL must use HTTPS.");
}
const config: CapacitorConfig = {
  appId: "org.qurancenters.staff",
  appName: "Quran Centers",
  webDir: "dist",
  ...(appUrl ? { server: { url: appUrl, cleartext: false } } : {}),
};
export default config;

import type { CapacitorConfig } from "@capacitor/cli";

const appUrl = new URL(process.env.CENTER_APP_URL || "https://centers.men");
if (
  appUrl.protocol !== "https:" ||
  appUrl.username ||
  appUrl.password ||
  appUrl.pathname !== "/" ||
  appUrl.search ||
  appUrl.hash
) {
  throw new Error("CENTER_APP_URL must be an HTTPS origin without a path.");
}
const config: CapacitorConfig = {
  appId: "org.qurancenters.staff",
  appName: "Quran Centers",
  webDir: "dist",
  server: { url: appUrl.origin, cleartext: false },
};
export default config;

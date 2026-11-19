import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";

export async function captureLocation() {
  const options = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };
  if (Capacitor.isNativePlatform()) {
    await Geolocation.requestPermissions({ permissions: ["location"] });
    return Geolocation.getCurrentPosition(options);
  }
  if (!navigator.geolocation)
    throw new Error("الموقع غير متاح على هذا الجهاز.");
  return new Promise<GeolocationPosition>((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(
      resolve,
      () => reject(new Error("تعذّر الحصول على الموقع. تأكّد من أذونات الموقع.")),
      options,
    ),
  );
}

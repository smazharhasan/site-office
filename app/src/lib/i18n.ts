import { I18nManager } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const UR: Record<string, string> = {
  "Site Office": "سائٹ آفس", "Sign in": "سائن ان", "Phone or email": "فون یا ای میل", "Send code": "کوڈ بھیجیں", "Code": "کوڈ", "Verify": "تصدیق",
  "Attendance": "حاضری", "Release material": "سامان جاری کریں", "Receive goods": "سامان وصول کریں", "Water tanker": "پانی کا ٹینکر", "Stock count": "اسٹاک گنتی",
  "Daily log": "روزانہ رپورٹ", "Register yourself": "اپنی رجسٹریشن", "Pending uploads": "زیر التوا اپ لوڈ", "Scan the worker's badge": "مزدور کا بیج اسکین کریں",
  "Take the worker's photo": "مزدور کی تصویر لیں", "Take photo": "تصویر لیں", "Retake": "دوبارہ", "Save": "محفوظ کریں", "Cancel": "منسوخ", "Next": "اگلا",
  "Quantity": "مقدار", "Item": "سامان", "Authorised by": "منظور کنندہ", "Area / activity": "جگہ / کام", "Bill photo (required)": "بل کی تصویر (لازمی)",
  "Getting your location…": "مقام معلوم کیا جا رہا ہے…", "Location is fake (mock GPS). Turn off mock location apps.": "جعلی جی پی ایس۔ موک لوکیشن ایپ بند کریں۔",
  "This phone is waiting for the owner's approval.": "یہ فون مالک کی منظوری کا منتظر ہے۔", "Saved": "محفوظ ہو گیا", "Flagged for the owner": "مالک کے لیے نشان زد",
  "Verified": "تصدیق شدہ", "Check in": "آمد", "Check out": "روانگی", "Weather": "موسم", "Work done today": "آج کا کام", "Plan for tomorrow": "کل کا منصوبہ",
  "Staff present": "موجود عملہ", "Power": "بجلی", "Notes": "نوٹس", "Gallons": "گیلن", "Tanker no.": "ٹینکر نمبر", "Counted": "گنتی", "Vendor / shop": "دکان",
  "Language": "زبان", "Stock & consumption": "اسٹاک اور کھپت", "Review & approve": "جائزہ اور منظوری", "People register": "افراد کا رجسٹر", "Team & logins": "ٹیم اور لاگ ان", "Set up your project": "اپنا پروجیکٹ بنائیں", "Email": "ای میل", "Password": "پاس ورڈ", "Projects": "پروجیکٹس", "Sign out": "سائن آؤٹ",
};
let lang: "en" | "ur" = "en";
export const t = (s: string) => (lang === "ur" ? UR[s] ?? s : s);
export const getLang = () => lang;
export async function loadLang() { const v = await AsyncStorage.getItem("lang"); lang = v === "ur" ? "ur" : "en"; I18nManager.allowRTL(true); }
export async function setLang(v: "en" | "ur") { lang = v; await AsyncStorage.setItem("lang", v); I18nManager.forceRTL(v === "ur"); }

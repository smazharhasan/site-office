import { I18nManager } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DICT from "./ur.json";

// Simple Urdu for the field screens. Same dictionary and rules as the full Site Office:
// whole-text lookup, numbers/dates/amounts kept as values, and combined labels split into known parts.
const PHONE: Record<string, string> = {
  "Site Office": "سائٹ آفس", "Phone or email": "فون یا ای میل", "Send code": "کوڈ بھیجیں", "Code": "کوڈ", "Verify": "تصدیق کریں",
  "Release material": "سامان جاری کریں", "Receive goods": "سامان وصول کریں", "Water tanker": "پانی کا ٹینکر", "Stock count": "اسٹاک کی گنتی",
  "Daily log": "روزانہ رپورٹ", "Pending uploads": "باقی اپ لوڈ", "Scan the worker's badge": "مزدور کا کارڈ اسکین کریں",
  "Take the worker's photo": "مزدور کی تصویر لیں", "Take photo": "تصویر لیں", "Retake": "دوبارہ لیں", "Next": "اگلا",
  "Quantity": "مقدار", "Authorised by": "اجازت دینے والا", "Area / activity": "جگہ / کام", "Bill photo (required)": "بل کی تصویر (ضروری)",
  "Getting your location…": "آپ کی لوکیشن معلوم ہو رہی ہے…", "Location is fake (mock GPS). Turn off mock location apps.": "لوکیشن جعلی ہے۔ جعلی لوکیشن والی ایپ بند کریں۔",
  "This phone is waiting for the owner's approval.": "یہ فون مالک کی منظوری کا منتظر ہے۔", "Flagged for the owner": "مالک کے لیے مشکوک لگا دیا",
  "Check in": "آمد", "Check out": "روانگی", "Work done today": "آج کا کام", "Staff present": "موجود عملہ", "Gallons": "گیلن", "Tanker no.": "ٹینکر نمبر",
  "Counted": "گنتی", "Vendor / shop": "دکان", "Language": "زبان", "Stock & consumption": "اسٹاک اور استعمال", "Review & approve": "جانچ اور منظوری",
  "People register": "لوگوں کا رجسٹر", "Team & logins": "ٹیم اور لاگ ان", "Set up your project": "اپنا پروجیکٹ بنائیں", "Projects": "پروجیکٹ",
  "Registered and Active": "رجسٹرڈ اور فعال", "Verified labour on site today (from attendance)": "آج سائٹ پر تصدیق شدہ مزدور (حاضری سے)",
  "No internet connection": "انٹرنیٹ نہیں ہے",
  "The full Site Office needs internet. The field screens (attendance, receiving, stock) still work offline and send later.": "مکمل سائٹ آفس کے لیے انٹرنیٹ ضروری ہے۔ فیلڈ اسکرینیں (حاضری، وصولی، اسٹاک) انٹرنیٹ کے بغیر بھی چلتی ہیں اور بعد میں بھیج دیتی ہیں۔",
  "Everyone using the site app must be registered with full details. The owner's side verifies your record before you can record anything.": "سائٹ ایپ استعمال کرنے والے ہر شخص کی پوری رجسٹریشن ضروری ہے۔ کچھ درج کرنے سے پہلے مالک کی طرف سے آپ کا ریکارڈ جانچا جائے گا۔",
  "Only {0} {1} in store.": "اسٹور میں صرف {0} {1} ہے۔",
  "The store keeper is you (your registered record). Time, GPS, phone and your name are stored with the photo and cannot be edited later.": "اسٹور کیپر آپ ہیں (آپ کا رجسٹرڈ ریکارڈ)۔ وقت، جی پی ایس، فون اور آپ کا نام تصویر کے ساتھ محفوظ ہوتا ہے اور بعد میں بدلا نہیں جا سکتا۔",
  "One project per site. You become its owner and can add staff logins afterwards.": "ہر سائٹ کا ایک پروجیکٹ۔ آپ اس کے مالک ہوں گے اور بعد میں عملے کے لاگ ان بنا سکتے ہیں۔",
  "Site location — photos taken outside it are refused": "سائٹ کی لوکیشن — اس سے باہر لی گئی تصویر قبول نہیں",
  "Tools out": "باہر گئے اوزار", "Add a login": "لاگ ان بنائیں", "Camera permission is needed.": "کیمرے کی اجازت ضروری ہے۔", "Allow camera": "کیمرے کی اجازت دیں",
  "Full Site Office": "مکمل سائٹ آفس", "Field screens (camera & GPS checked)": "فیلڈ اسکرینیں (کیمرہ اور جی پی ایس جانچ)",
  "Dashboard, progress, schedule, payments, budget, procurement, quality, snags, checklists": "ڈیش بورڈ، پیش رفت، شیڈول، ادائیگیاں، بجٹ، خریداری، کوالٹی، خرابیاں، چیک لسٹ",
};
const URX: Record<string, string> = { ...(DICT as Record<string, string>), ...PHONE };
const MON: Record<string, string> = { Jan: "جنوری", Feb: "فروری", Mar: "مارچ", Apr: "اپریل", May: "مئی", Jun: "جون", Jul: "جولائی", Aug: "اگست", Sep: "ستمبر", Sept: "ستمبر", Oct: "اکتوبر", Nov: "نومبر", Dec: "دسمبر" };
const MRE = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)";
const TOK = new RegExp(`\\b\\d{1,2} ${MRE} \\d{2,4}\\b|\\b${MRE} \\d{2}\\b|Rs\\s?[−-]?[\\d,]+(?:\\.\\d+)?|[−-]?\\d[\\d,]*(?:\\.\\d+)?\\s?lac\\b|[−+-]?\\d[\\d,]*(?:\\.\\d+)?`, "g");
const val = (v: string) => /^Rs/.test(v) ? v.replace(/^Rs\s?/, "") + " روپے" : / ?lac$/.test(v) ? v.replace(/ ?lac$/, "") + " لاکھ" : v.replace(new RegExp(MRE), (m) => MON[m] || m);
function dict(k: string): string | null {
  if (URX[k] != null) return URX[k];
  const pm = k.match(/^(.+?)([:.])$/); if (pm && URX[pm[1]] != null) return URX[pm[1]] + (pm[2] === "." ? "۔" : ":");
  const ids: string[] = []; const k0 = k.replace(/\{(\d+)\}/g, (_m, i) => { let j = ids.indexOf(i); if (j < 0) { ids.push(i); j = ids.length - 1; } return "{" + j + "}"; });
  const v = URX[k0]; return v == null ? null : v.replace(/\{(\d+)\}/g, (_m, j) => "{" + ids[+j] + "}");
}
function key(k: string, depth = 0): string | null {
  const hit = dict(k); if (hit != null) return hit; if (depth > 3 || !/[A-Za-z]{2}/.test(k)) return null; let m: RegExpMatchArray | null;
  if ((m = k.match(/^New (.+)$/))) { const x = key(m[1], depth + 1); if (x) return "نیا: " + x; }
  if ((m = k.match(/^\+ (.+)$/))) { const x = key(m[1], depth + 1); if (x) return "+ " + x; }
  if ((m = k.match(/^(.+?) \(([^()]+)\)$/))) { const a = key(m[1], depth + 1); if (a) return `${a} (${key(m[2], depth + 1) || m[2]})`; }
  const sents = k.split(/(?<=[.!?:])\s+(?=[A-Z])/); if (sents.length > 1) { const tr = sents.map((s) => key(s, depth + 1)); if (tr.some(Boolean)) return tr.map((x, i) => x || sents[i]).join(" "); }
  for (const sep of [" · ", ": ", " — ", "; ", ", "]) { if (!k.includes(sep)) continue; const parts = k.split(sep); const tr = parts.map((p) => (!p.trim() || !/[A-Za-z]{2}/.test(p) ? p : key(p.trim(), depth + 1)));
    if (tr.some((x, i) => x && x !== parts[i])) return tr.map((x, i) => (x == null ? parts[i] : x)).join(sep === ", " ? "، " : sep); }
  return null;
}
export function urText(s: string): string | null {
  if (!s || !/[A-Za-z]{2}/.test(s)) return null; const vals: string[] = [];
  const k = s.replace(/\s+/g, " ").trim().replace(TOK, (m) => { vals.push(m); return "{" + (vals.length - 1) + "}"; });
  const tr = key(k); if (tr == null) return null;
  return tr.replace(/\{(\d+)\}/g, (m, i) => (vals[+i] != null ? val(vals[+i]) : m));
}
let lang: "en" | "ur" = "en";
export const t = (s: string) => (lang === "ur" ? urText(s) ?? s : s);
export const getLang = () => lang;
// the full Site Office keeps its choice under "v31.lang"; the phone app shares the same key on web
export async function loadLang() { const v = (await AsyncStorage.getItem("lang")) || (await AsyncStorage.getItem("v31.lang")); lang = v === "ur" ? "ur" : "en"; I18nManager.allowRTL(true); }
export async function setLang(v: "en" | "ur") { lang = v; await AsyncStorage.setItem("lang", v); await AsyncStorage.setItem("v31.lang", v); I18nManager.forceRTL(v === "ur"); }

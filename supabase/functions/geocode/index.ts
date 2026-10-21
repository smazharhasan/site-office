// POST /geocode { lat, lng } → { address } — a readable address for a GPS point (OpenStreetMap), cached.
import { admin, caller, handler, HttpError, json } from "../_shared/common.ts";

Deno.serve(handler(async (req) => {
  await caller(req);
  const b = await req.json().catch(() => ({}));
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new HttpError(400, "Bad location");
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`; const db = admin();
  const { data: hit } = await db.from("geo_cache").select("address").eq("key", key).maybeSingle();
  if (hit) return json({ address: hit.address, cached: true });
  const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=en`, { headers: { "User-Agent": "Mimaar construction site office (smazharhasan.github.io/site-office)" } });
  if (!r.ok) throw new HttpError(502, "Address lookup failed");
  const d = await r.json(); const a = d.address || {};
  const parts = [a.house_number && a.road ? `${a.house_number} ${a.road}` : a.road, a.neighbourhood || a.quarter, a.suburb || a.residential, a.city_district, a.city || a.town || a.village || a.county]
    .filter(Boolean).filter((x, i, arr) => arr.indexOf(x) === i);
  const address = (parts.length ? parts.join(", ") : String(d.display_name || "").split(",").slice(0, 4).join(",")).slice(0, 140);
  if (address) await db.from("geo_cache").upsert({ key, address });
  return json({ address });
}));

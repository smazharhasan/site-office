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
  const UA = { "User-Agent": "Mimaar construction site office (https://smazharhasan.github.io/site-office/)", "Accept": "application/json" };
  const tidy = (parts: unknown[]) => parts.filter(Boolean).map(String).filter((x, i, arr) => arr.indexOf(x) === i).join(", ").slice(0, 140);
  let address = ""; const tried: string[] = [];
  try { // 1. OpenStreetMap Nominatim
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=en`, { headers: UA });
    tried.push("osm " + r.status);
    if (r.ok) { const d = await r.json(); const a = d.address || {}; address = tidy([a.house_number && a.road ? `${a.house_number} ${a.road}` : a.road, a.neighbourhood || a.quarter, a.suburb || a.residential, a.city_district, a.city || a.town || a.village || a.county]) || String(d.display_name || "").split(",").slice(0, 4).join(","); }
  } catch (e) { tried.push("osm err"); }
  if (!address) try { // 2. Photon (OpenStreetMap data)
    const r = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&lang=en`, { headers: UA }); tried.push("photon " + r.status);
    if (r.ok) { const d = await r.json(); const p = (d.features && d.features[0] && d.features[0].properties) || {}; address = tidy([p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street || p.name, p.district, p.locality, p.city || p.county]); }
  } catch (e) { tried.push("photon err"); }
  if (!address) try { // 3. BigDataCloud
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`, { headers: UA }); tried.push("bdc " + r.status);
    if (r.ok) { const d = await r.json(); address = tidy([d.locality, d.city, d.principalSubdivision]); }
  } catch (e) { tried.push("bdc err"); }
  if (!address) throw new HttpError(502, "Address lookup failed: " + tried.join(", "));
  if (address) await db.from("geo_cache").upsert({ key, address });
  return json({ address });
}));

// GET /weather?project_id=…  Current weather at the site from Open-Meteo (no API key).
import { admin, caller, handler, HttpError, json, membership } from "../_shared/common.ts";

const CODES: Record<number, string> = { 0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Fog", 51: "Drizzle", 53: "Drizzle", 55: "Drizzle", 61: "Rain", 63: "Rain", 65: "Heavy rain", 80: "Showers", 81: "Showers", 82: "Heavy showers", 95: "Thunderstorm" };

Deno.serve(handler(async (req) => {
  const user = await caller(req);
  const projectId = new URL(req.url).searchParams.get("project_id") || "";
  await membership(projectId, user.id);
  const { data: p } = await admin().from("projects").select("site_lat, site_lng, timezone").eq("id", projectId).single();
  if (!p?.site_lat) throw new HttpError(400, "Set the site location in the project first");
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.site_lat}&longitude=${p.site_lng}&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,wind_speed_10m,weather_code&daily=temperature_2m_max,precipitation_probability_max&forecast_days=2&timezone=${encodeURIComponent(p.timezone)}`;
  const r = await fetch(url);
  if (!r.ok) throw new HttpError(502, "Weather service unavailable");
  const w = await r.json(); const c = w.current || {};
  const tempC = c.temperature_2m;
  return json({
    source: "Open-Meteo", at: c.time, temp_c: tempC, feels_c: c.apparent_temperature, humidity: c.relative_humidity_2m,
    rain_mm: c.precipitation, wind_kmh: c.wind_speed_10m, phrase: CODES[c.weather_code] ?? `Code ${c.weather_code}`,
    tomorrow_max_c: w.daily?.temperature_2m_max?.[1], tomorrow_rain_pct: w.daily?.precipitation_probability_max?.[1],
    advice: tempC >= 38 ? "Very hot: pour concrete early morning, cure 3+ times today, water and shade for workers." : (c.precipitation > 0 ? "Rain: protect fresh concrete and cement stock; postpone slab pours." : null),
  });
}));

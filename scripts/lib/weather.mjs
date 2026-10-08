// Node-side Open-Meteo Archive API adapter (Phase 4 prediction features).
// Contract: docs/API.md §3.2. Daily precipitation_sum (mm) and
// temperature_2m_mean (°C). Archive lags reality by ~5 days (ERA5) — the
// service's feature builder tolerates missing recent days, so we simply
// fetch up to `end` and let known days be used.
//
// Responses are cached under .cache/ (git-ignored): the series is immutable
// history, so a second backtest run never re-downloads it.

import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ARCHIVE_API = "https://archive-api.open-meteo.com/v1/archive";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Returns { time: string[], rain_mm: (number|null)[], temp_mean_c: (number|null)[] } */
export async function fetchArchiveWeather(lat, lon, startDate, endDate) {
  // ERA5 archive lags reality by ~5 days — clamp so a "today" end date
  // doesn't 400, and let the service's feature builder skip missing days.
  const todayMinus6 = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
  const end = endDate > todayMinus6 ? todayMinus6 : endDate;
  const cachePath = resolve(`.cache/archive-${lat}-${lon}-${end}.json`);
  if (existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, "utf8"));
  }
  const url =
    `${ARCHIVE_API}?latitude=${lat}&longitude=${lon}` +
    `&start_date=${startDate}&end_date=${end}` +
    `&daily=precipitation_sum,temperature_2m_mean`;
  let lastError;
  for (const delay of [0, 3000, 8000]) {
    if (delay) await sleep(delay);
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const out = {
        time: data.daily.time,
        rain_mm: data.daily.precipitation_sum,
        temp_mean_c: data.daily.temperature_2m_mean,
      };
      mkdirSync(".cache", { recursive: true });
      writeFileSync(cachePath, JSON.stringify(out));
      return out;
    }
    const body = await res.text();
    lastError = new Error(
      `Archive API ${res.status} for ${lat},${lon} ${startDate}..${end}: ${body.slice(0, 200)}`,
    );
    if (res.status === 400) break;
  }
  throw lastError;
}

/** Shape the archive response into the service's additive weather_series field. */
export function toWeatherSeries(archive) {
  return archive.time.map((date, i) => ({
    date,
    rain_mm: archive.rain_mm[i] ?? 0,
    temp_mean_c: archive.temp_mean_c[i] ?? 0,
  }));
}

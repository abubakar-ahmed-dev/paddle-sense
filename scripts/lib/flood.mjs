// Node-side mirror of src/lib/flood.ts fetchDischargeRange for CLI scripts.
// Keep in sync with the TS adapter; covered indirectly by backfill fixture checks.

const FLOOD_API = "https://flood-api.open-meteo.com/v1/flood";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchDischargeRange(lat, lon, startDate, endDate) {
  const url =
    `${FLOOD_API}?latitude=${lat}&longitude=${lon}` +
    `&daily=river_discharge&start_date=${startDate}&end_date=${endDate}`;
  // Transient 400/429s observed under rapid successive calls — retry with backoff.
  let lastError;
  for (const delay of [0, 3000, 8000]) {
    if (delay) await sleep(delay);
    const res = await fetch(url);
    // NOTE: do not set a custom User-Agent here — the Flood API's edge
    // returns an S3 "list-type" 400 for non-standard UAs (observed 2026-10-08).
    if (res.ok) {
      const data = await res.json();
      return { time: data.daily.time, discharge: data.daily.river_discharge };
    }
    const body = await res.text();
    lastError = new Error(
      `Flood API ${res.status} for ${lat},${lon} ${startDate}..${endDate}: ${body.slice(0, 200)} [final url: ${res.url}]`,
    );
    if (res.status === 400) break; // permanent — wrong params, don't retry
  }
  throw lastError;
}

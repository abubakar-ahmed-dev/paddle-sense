export type DischargeSeries = {
  time: string[];
  /** m³/s, null where GloFAS has no value */
  discharge: (number | null)[];
};

const FLOOD_API = "https://flood-api.open-meteo.com/v1/flood";

export async function fetchDischarge(
  lat: number,
  lon: number,
  pastDays = 7,
  forecastDays = 7,
): Promise<DischargeSeries> {
  const url =
    `${FLOOD_API}?latitude=${lat}&longitude=${lon}` +
    `&daily=river_discharge&past_days=${pastDays}&forecast_days=${forecastDays}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Flood API ${res.status} for ${lat},${lon}`);
  }
  const data = (await res.json()) as {
    daily: { time: string[]; river_discharge: (number | null)[] };
  };
  return { time: data.daily.time, discharge: data.daily.river_discharge };
}

export function currentDischarge(series: DischargeSeries): number | null {
  const today = new Date().toISOString().slice(0, 10);
  const i = series.time.findIndex((t) => t >= today);
  const idx = i === -1 ? series.time.length - 1 : i;
  return series.discharge[idx] ?? null;
}

/** Weekly min–max of a range of days, as a plain-language band. */
export function weekBand(series: DischargeSeries): [number, number] | null {
  const vals = series.discharge.filter((v): v is number => v !== null);
  if (vals.length === 0) return null;
  return [Math.min(...vals), Math.max(...vals)];
}

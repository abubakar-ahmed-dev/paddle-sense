"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DischargeSeries } from "@/lib/flood";

/** Past days solid, forecast days hatched by a dashed reference line. */
export default function RiverChart({
  series,
  today,
}: {
  series: DischargeSeries;
  today: string;
}) {
  const data = series.time.map((t, i) => ({
    date: t.slice(5),
    discharge: series.discharge[i],
    forecast: t >= today ? series.discharge[i] : undefined,
  }));
  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id="q-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#64748b" }} />
          <YAxis
            width={44}
            tick={{ fontSize: 10, fill: "#64748b" }}
            tickFormatter={(v: number) => (v >= 1000 ? `${v / 1000}k` : `${v}`)}
          />
          <Tooltip
            contentStyle={{
              background: "#0f172a",
              border: "1px solid #1e293b",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value) => [`${value} m³/s`, "discharge"]}
          />
          <Area
            type="monotone"
            dataKey="discharge"
            stroke="#38bdf8"
            strokeWidth={2}
            fill="url(#q-fill)"
            connectNulls
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

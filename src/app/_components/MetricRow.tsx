/**
 * Per-river retrodiction metrics (UX_SPEC §4.3 item 2): model_version ·
 * MAE · band coverage. Coverage below 70% renders the attention chip
 * "experimental" (PRD §12, API.md §1.2 note) — the miss is published,
 * never hidden.
 */

function fmt(n: number): string {
  if (n >= 100) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function MetricRow({
  modelVersion,
  mae,
  coverage,
  day1,
  day7,
}: {
  modelVersion: string;
  mae: number | null;
  coverage: number | null;
  /** Per-horizon forecast decay (P75-6) — rendered when the backtest stored it */
  day1?: { mae: number | null; coverage: number | null };
  day7?: { mae: number | null; coverage: number | null };
}) {
  const experimental = coverage !== null && coverage < 0.7;
  return (
    <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-xs text-silt-dim">Model</dt>
        <dd className="font-mono text-silt">{modelVersion}</dd>
      </div>
      <div>
        <dt className="text-xs text-silt-dim">Mean absolute error</dt>
        <dd className="font-mono text-silt">
          {mae === null ? "not yet verified" : `${fmt(mae)} m³/s`}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-silt-dim">Band coverage</dt>
        <dd className="font-mono text-silt">
          {coverage === null ? (
            "not yet verified"
          ) : (
            <>
              {(coverage * 100).toFixed(1)}%{" "}
              {experimental && (
                <span className="ml-1 rounded-full border border-attention/40 px-2 py-0.5 text-[11px] font-medium text-attention">
                  experimental
                </span>
              )}
            </>
          )}
        </dd>
      </div>
      {(day1 || day7) && (
        <div className="col-span-2 sm:col-span-3">
          <dt className="text-xs text-silt-dim">Forecast decay (per horizon)</dt>
          <dd className="font-mono text-xs text-silt-dim">
            {day1 && (
              <>
                day 1 · mae {day1.mae === null ? "—" : fmt(day1.mae)} · coverage{" "}
                {day1.coverage === null ? "—" : `${(day1.coverage * 100).toFixed(0)}%`}
              </>
            )}
            {day1 && day7 && " · "}
            {day7 && (
              <>
                day 7 · mae {day7.mae === null ? "—" : fmt(day7.mae)} · coverage{" "}
                {day7.coverage === null ? "—" : `${(day7.coverage * 100).toFixed(0)}%`}
              </>
            )}
          </dd>
        </div>
      )}
    </dl>
  );
}

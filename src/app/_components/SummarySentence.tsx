type StoredSummary = {
  text: string;
  statusWord: string;
  generatedBy: string;
  cycleDate: string;
};

/**
 * Dashboard card item 4 (UX_SPEC §4.1): the cached Gemma sentence with its
 * provenance line, or the deterministic fallback rendered silently — the
 * site never depends on the model, and a fallback never announces itself
 * as an error (states matrix §7).
 */
export default function SummarySentence({
  summary,
  fallback,
}: {
  summary: StoredSummary | null;
  fallback: string;
}) {
  if (!summary) return <p className="mt-3 text-sm">{fallback}</p>;
  return (
    <div className="mt-3">
      <p className="text-sm">{summary.text}</p>
      <p className="mt-1 font-mono text-xs text-silt-dim">
        summary · {summary.generatedBy} · cycle {summary.cycleDate}
      </p>
    </div>
  );
}

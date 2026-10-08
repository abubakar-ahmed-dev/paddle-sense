export default function EmptyState({
  what,
  why,
}: {
  what: string;
  why?: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-stone-edge p-6 text-center">
      <p className="text-sm font-medium text-silt">{what}</p>
      {why && <p className="mt-1 text-xs text-silt-dim">{why}</p>}
    </div>
  );
}

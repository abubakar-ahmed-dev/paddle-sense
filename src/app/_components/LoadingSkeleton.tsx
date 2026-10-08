/** Card-shaped shimmer used by route loading.tsx files. */
export default function LoadingSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading river data"
      className="animate-pulse rounded-2xl border border-stone-edge bg-stone/60 p-5"
    >
      <div className="h-5 w-1/3 rounded bg-stone-edge" />
      <div className="mt-3 h-3 w-2/3 rounded bg-stone-edge" />
      <div className="mt-4 h-40 rounded bg-stone-edge/60" />
    </div>
  );
}

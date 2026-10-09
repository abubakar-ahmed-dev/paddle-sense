import type { NoteItem } from "@/lib/db";
import EmptyState from "@/app/_components/EmptyState";

/**
 * River-page access & notes list (UX_SPEC §4.2 item 5): each item = text +
 * `source link · fetched date`. Kind is labeled in words (never color alone).
 * Empty state is honest — no filler.
 */

const KIND_LABELS: Record<string, string> = {
  range: "range candidate",
  access: "access",
  closure: "closure",
  operator: "operator",
  reference: "reference",
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export default function NotesList({ notes }: { notes: NoteItem[] }) {
  if (notes.length === 0) {
    return (
      <EmptyState
        what="No access notes yet"
        why="Weekly scout searches have not found a usable source for this stretch yet — nothing is shown rather than guessed."
      />
    );
  }
  return (
    <ul className="mt-3 space-y-3">
      {notes.map((n) => (
        <li key={`${n.url}-${n.text}`} className="text-sm leading-relaxed">
          <span className="mr-2 rounded-full border border-stone-edge px-2 py-0.5 text-[11px] text-silt-dim">
            {KIND_LABELS[n.kind] ?? n.kind}
          </span>
          {n.text}
          <span className="mt-1 block text-xs text-silt-dim">
            <a
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ochre hover:text-ochre-deep"
            >
              {n.sourceTitle || new URL(n.url).hostname}
            </a>{" "}
            · fetched {fmtDate(n.fetchedAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}

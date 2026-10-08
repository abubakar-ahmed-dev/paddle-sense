export type ProvenanceItem = {
  label: string;
  url?: string;
  asOf?: string;
};

/**
 * Provenance is structural (NFR-2): anything derived from an external source
 * renders through this footer with its origin and fetch date.
 */
export default function ProvenanceFooter({ items }: { items: ProvenanceItem[] }) {
  return (
    <p className="font-mono text-xs text-silt-dim">
      {items.map((item, i) => (
        <span key={i}>
          {i > 0 && " · "}
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-stone-edge underline-offset-2 hover:text-ochre"
            >
              {item.label}
            </a>
          ) : (
            item.label
          )}
          {item.asOf && ` · ${item.asOf}`}
        </span>
      ))}
    </p>
  );
}

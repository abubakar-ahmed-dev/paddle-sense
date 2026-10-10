import type { FeatureExtractionPipeline } from "@xenova/transformers";

/**
 * Local note embeddings (Phase 7b / P75-3): all-MiniLM-L6-v2, 384-dim — the
 * exact dimension the `notes.embedding vector(384)` column and its HNSW
 * index were created for in 001_init.
 *
 * The model downloads once (~30 MB) on first use and is cached by the
 * library; after that it runs on CPU with no API key. Used by the scout at
 * note-insert time and by the semantic-search route. Tests inject fake
 * vectors — the real model never runs in CI (TESTING.md §1).
 */

export const EMBED_DIM = 384;

/** Injectable embedder — tests pass fake vectors (TESTING.md §1). */
export type EmbedFn = (text: string) => Promise<number[]>;

type Extractor = FeatureExtractionPipeline;
let pipelinePromise: Promise<Extractor> | null = null;

function loadPipeline(): Promise<Extractor> {
  if (!pipelinePromise) {
    pipelinePromise = import("@xenova/transformers").then(
      (tf) =>
        tf.pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2") as Promise<Extractor>,
    );
  }
  return pipelinePromise;
}

/** Mean-pooled, L2-normalized embedding — HNSW's expected shape. */
export async function embedText(text: string): Promise<number[]> {
  const extractor = await loadPipeline();
  const out = await extractor(text, { pooling: "mean", normalize: true });
  const vec = Array.from(out.data as Float32Array);
  if (vec.length !== EMBED_DIM) {
    throw new Error(`embedding dim ${vec.length} ≠ ${EMBED_DIM}`);
  }
  return vec;
}

/** pgvector accepts a literal string form: '[0.1,0.2,…]' */
export function toVectorLiteral(vec: number[]): string {
  if (vec.length !== EMBED_DIM) throw new Error(`embedding dim ${vec.length} ≠ ${EMBED_DIM}`);
  return `[${vec.join(",")}]`;
}

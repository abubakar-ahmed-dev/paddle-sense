import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    // Integration files share one throwaway Postgres (scripts/test-db.mjs);
    // parallel files raced on shared rows (newestObservedDate max). One file
    // at a time keeps those invariants deterministic, and every file cleans
    // up exactly the rows it adds (see watcher.test.ts afterAll).
    fileParallelism: false,
  },
  coverage: {
    provider: "v8",
    include: ["src/**/*.ts", "src/**/*.tsx", "workers/**/*.ts"],
    // tests never count toward coverage; workers/workflows.ts is excluded
    // because its tests (Temporal ephemeral server) cannot start under the
    // V8 coverage instrumentation on Windows — `npm test` still runs them.
    exclude: ["tests/**", "workers/workflows.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

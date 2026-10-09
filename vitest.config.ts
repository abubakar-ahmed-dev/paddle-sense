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
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

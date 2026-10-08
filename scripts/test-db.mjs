#!/usr/bin/env node
// Spins up an ephemeral Postgres container, runs the DB integration tests
// against it, tears it down. Requires Docker.
// Usage: npm run test:db

import { execSync } from "node:child_process";
import net from "node:net";

const NAME = "ps-test-pg";
const PORT = 54329;
const url = `postgres://postgres:test@localhost:${PORT}/postgres`;

function hostPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForHostPort(attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    if (await hostPortOpen(PORT)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`host port ${PORT} never opened (WSL2 forward delay?)`);
}

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: "pipe", ...opts });
}

function dockerUp() {
  try {
    sh(`docker inspect ${NAME}`);
    sh(`docker rm -f ${NAME}`); // stale container from a crashed run
  } catch {
    /* not running — fine */
  }
  sh(
    `docker run -d --name ${NAME} -e POSTGRES_PASSWORD=test -p ${PORT}:5432 pgvector/pgvector:pg17`,
  );
}

function waitForPostgres(attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    try {
      const out = sh(`docker exec ${NAME} pg_isready -U postgres`).toString();
      if (out.includes("accepting connections")) return;
    } catch {
      /* not ready yet */
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error("test Postgres did not become ready in 30s");
}

let code = 0;
try {
  dockerUp();
  waitForPostgres();
  await waitForHostPort();
  const env = { ...process.env, DATABASE_TEST_URL: url };
  execSync(`npx vitest run tests/integration`, {
    stdio: "inherit",
    env,
  });
} catch (e) {
  code = 1;
  if (e.status) code = e.status;
  console.error("test:db failed");
} finally {
  try {
    sh(`docker rm -f ${NAME}`);
  } catch {
    /* already gone */
  }
}
process.exit(code);

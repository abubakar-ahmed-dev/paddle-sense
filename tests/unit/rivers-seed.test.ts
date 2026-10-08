import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RIVERS } from "@/lib/rivers";

/**
 * scripts/rivers.json (the DB seed source) must mirror src/lib/rivers.ts
 * exactly — config drift between the two would silently change what the
 * database serves versus what the UI config says.
 */
const seeded = JSON.parse(
  readFileSync(resolve(process.cwd(), "scripts/rivers.json"), "utf8"),
) as Array<Record<string, unknown>>;

function fromConfig(r: (typeof RIVERS)[number]) {
  return {
    id: r.id,
    name: r.name,
    stretch: r.stretch,
    cell_lat: r.cell.lat,
    cell_lon: r.cell.lon,
    cell_elevation: r.cellElevation,
    runnable_lo: r.runnableRange?.[0] ?? null,
    runnable_hi: r.runnableRange?.[1] ?? null,
    range_state: r.rangeState,
    honesty_note: r.note,
  };
}

describe("rivers seed parity", () => {
  it("scripts/rivers.json mirrors src/lib/rivers.ts exactly", () => {
    expect(seeded).toEqual(RIVERS.map(fromConfig));
  });

  it("invariant R3: exactly one not_a_paddling_river (Malir honesty check)", () => {
    const honestyChecks = RIVERS.filter(
      (r) => r.rangeState === "not_a_paddling_river",
    );
    expect(honestyChecks).toHaveLength(1);
    expect(honestyChecks[0].id).toBe("malir-karachi");
  });

  it("no river is 'verified' without bounds (invariant R1, config side)", () => {
    for (const r of RIVERS) {
      if (r.rangeState === "verified") {
        expect(r.runnableRange).not.toBeNull();
      } else {
        expect(r.runnableRange).toBeNull();
      }
    }
  });
});

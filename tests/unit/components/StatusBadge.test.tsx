import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import StatusBadge from "@/app/_components/StatusBadge";
import type { Status } from "@/lib/status";

/** Exact copy map from UX_SPEC §6 — badges are contract, not style. */
const EXPECTED: Record<Status, string> = {
  in_range: "In runnable range",
  dry: "Below runnable — dry",
  high_water_dangerous: "HIGH WATER — do not go",
  range_unverified: "Range not yet verified",
  not_a_paddling_river: "Not a paddling river",
  no_data: "No data",
};

describe("StatusBadge", () => {
  for (const [status, label] of Object.entries(EXPECTED)) {
    it(`renders the contract copy for ${status}`, () => {
      render(<StatusBadge status={status as Status} />);
      const badge = screen.getByText(label);
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute("data-status", status);
    });
  }

  it("never contains the banned token 'safe' in any badge", () => {
    for (const label of Object.values(EXPECTED)) {
      expect(label.toLowerCase()).not.toContain("safe");
    }
  });
});

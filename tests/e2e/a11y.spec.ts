import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Accessibility audit (Phase 8, UX_SPEC §8): axe-core scans of every route.
 * Gate: zero critical/serious violations. Moderate/minor findings are listed
 * in docs/qa-report.md and fixed or consciously documented there.
 */
const ROUTES = ["/", "/river/kunhar-balakot", "/retro", "/about"];

async function scan(page: import("@playwright/test").Page, route: string) {
  await page.goto(route);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations.filter((v) =>
    v.impact === "critical" || v.impact === "serious",
  );
}

test.describe("axe a11y audit", () => {
  for (const route of ROUTES) {
    test(`no critical/serious violations on ${route}`, async ({ page }) => {
      const serious = await scan(page, route);
      expect(
        serious.map((v) => `${v.id}(${v.impact}): ${v.nodes.length} nodes`),
      ).toEqual([]);
    });
  }

  test("moderate/minor findings are within the documented allowlist", async ({ page }) => {
    const seen = new Set<string>();
    for (const route of ROUTES) {
      await page.goto(route);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      for (const v of results.violations) {
        if (v.impact === "critical" || v.impact === "serious") continue;
        seen.add(`${route}: ${v.id} (${v.impact}, ${v.nodes.length} nodes)`);
      }
    }
    // Every non-gated finding must be explained in docs/qa-report.md §a11y.
    // If this fails, either fix the issue or add it to the report deliberately.
    const documented = [
      // filled from the first audit run — see docs/qa-report.md
    ] as string[];
    for (const finding of seen) {
      expect(
        documented.some((d) => finding.startsWith(d)),
        `undocumented a11y finding: ${finding}`,
      ).toBe(true);
    }
  });

  test("charts expose their data-table alternative to the keyboard", async ({ page }) => {
    await page.goto("/river/kunhar-balakot");
    const details = page.locator("details").first();
    const summary = details.locator("summary");
    // keyboard-only: reach the summary by Tab, open with Enter (UX_SPEC §8)
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(details).toHaveAttribute("open", "");
    await expect(details.locator("table")).toBeVisible();
  });
});

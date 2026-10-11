import { test, expect } from "@playwright/test";

/**
 * Honesty sweep (Phase 8): the product's language rules, executable.
 * UX_SPEC §6 bans safe/safely/danger-free/guaranteed in UI copy; §6 danger
 * copy is verbatim; provenance (NFR-2) must carry source + date. The /about
 * page is the one deliberate exception — it names the banned words inside
 * its "What we refuse to claim" explainer, so the sweep asserts that the
 * refusal section is their ONLY occurrence.
 */
const BANNED = /safe|danger[\s-]*free|guaranteed/i;

const ROUTES = [
  "/",
  "/river/indus-besham",
  "/river/kunhar-balakot",
  "/river/swat-mingora",
  "/river/malir-karachi",
  "/retro",
];

test.describe("honesty sweep", () => {
  for (const route of ROUTES) {
    test(`no banned safety words on ${route}`, async ({ page }) => {
      await page.goto(route);
      const text = await page.locator("body").innerText();
      expect(BANNED.test(text), `banned token on ${route}`).toBe(false);
    });
  }

  for (const river of ["indus-besham", "kunhar-balakot", "swat-mingora", "malir-karachi"]) {
    test(`/river/${river}: provenance carries source and date`, async ({ page }) => {
      await page.goto(`/river/${river}`);
      const footer = page.getByText(/GloFAS cell/).first();
      await expect(footer).toBeVisible();
      await expect(footer).toContainText(/\d{4}-\d{2}-\d{2}/);
    });
  }

  test("/about: banned words appear ONLY inside the refusal explainer", async ({ page }) => {
    await page.goto("/about");
    const body = await page.locator("body").innerText();
    const refusal = await page
      .locator("section")
      .filter({ hasText: "What we refuse to claim" })
      .innerText();
    // the explainer itself names the banned words — that is the refusal copy
    expect(BANNED.test(refusal)).toBe(true);
    // nowhere else on the page may they appear
    expect(BANNED.test(body.replace(refusal, ""))).toBe(false);
  });

  test("status is conveyed by text; danger copy is verbatim", async ({ page }) => {
    await page.goto("/");
    const badges = page.locator("section [data-status]");
    await expect(badges).toHaveCount(4);
    for (let i = 0; i < await badges.count(); i++) {
      const badge = badges.nth(i);
      const label = (await badge.innerText()).trim();
      // never color alone (UX_SPEC §8): a badge must say something
      expect(label.length).toBeGreaterThan(0);
      // §6 danger copy verbatim when (and only when) high water renders
      if ((await badge.getAttribute("data-status")) === "high_water_dangerous") {
        expect(label).toBe("HIGH WATER — do not go");
      }
    }
  });

  test("dashboard: every river card carries provenance with a date", async ({ page }) => {
    await page.goto("/");
    const cards = page.locator("section").filter({ hasText: /GloFAS cell/ });
    await expect(cards).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      // scope to the mono provenance footer — chart-table date cells also match
      await expect(
        cards
          .nth(i)
          .locator("p.font-mono")
          .filter({ hasText: /\d{4}-\d{2}-\d{2}/ })
          .first(),
      ).toBeVisible();
    }
  });
});

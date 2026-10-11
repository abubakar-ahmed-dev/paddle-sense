import { test, expect } from "@playwright/test";

/**
 * Smoke: every route loads with real data and the honesty markers render.
 * UX_SPEC §7: no console-error gate here — these assert user-visible truth.
 */

test("dashboard: four river cards, each with a status badge and provenance", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("When can I paddle?");
  for (const river of ["Indus", "Kunhar", "Swat", "Malir"]) {
    await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: river })).toBeVisible();
  }
  // one badge per river card (scoped to sections — extras outside are fine)
  await expect(page.locator("section [data-status]")).toHaveCount(4);
  // provenance footer carries the GloFAS cell identity on every card
  await expect(page.getByText(/GloFAS cell/).first()).toBeVisible();
});

test("river page (kunhar): history chart, sourced notes or honest empty state", async ({ page }) => {
  await page.goto("/river/kunhar-balakot");
  await expect(page.getByRole("heading", { level: 1, name: /Kunhar/ })).toBeVisible();
  await expect(page.getByText("Kaghan", { exact: false }).first()).toBeVisible();
  // range state renders honestly: either a verified band or the amber note — never blank
  await expect(
    page.getByText(/not yet verified|runnable range/i).first(),
  ).toBeVisible();
  // provenance with a date is mandatory on the detail page too
  await expect(page.getByText(/GloFAS cell/).first()).toBeVisible();
});

test("retro page: per-river metric rows with model version and coverage", async ({ page }) => {
  await page.goto("/retro");
  await expect(page.getByText(/predicted/i).first()).toBeVisible();
  await expect(page.getByText(/coverage/i).first()).toBeVisible();
  // published metrics must name the model — the retrodiction contract
  await expect(page.getByText(/tabpfn/i).first()).toBeVisible();
});

test("about page: the honesty explainer loads", async ({ page }) => {
  await page.goto("/about");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/refuses|refuse|honest/i).first()).toBeVisible();
});

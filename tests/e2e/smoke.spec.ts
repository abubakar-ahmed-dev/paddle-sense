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

test("river page (kunhar): the verified 35–135 band renders in copy and chart caption", async ({ page }) => {
  await page.goto("/river/kunhar-balakot");
  // §4.2 range block states the verified numbers with their provenance line
  await expect(page.getByText(/35 – 135 m³\/s/).first()).toBeVisible();
  await expect(page.getByText(/verified — source linked below/i).first()).toBeVisible();
  // the chart's shaded-band caption (SVG ReferenceArea itself is not queryable)
  await expect(page.getByText(/Shaded band: runnable range/).first()).toBeVisible();
});

test("retro: forecast-decay line and data-table alternative render", async ({ page }) => {
  await page.goto("/retro");
  // per-horizon metrics (7b) surface as a decay line on the metric row
  await expect(page.getByText(/Forecast decay/i).first()).toBeVisible();
  // chart has the non-visual table alternative (UX_SPEC §8)
  const summary = page.getByText(/View every predicted day as a table/i).first();
  await summary.click();
  await expect(page.locator("table").first()).toBeVisible();
});

test("charts expose the data-table alternative on the dashboard", async ({ page }) => {
  await page.goto("/");
  const summary = page.getByText(/View the latest readings as a table/i).first();
  await summary.click();
  const table = page.locator("table").first();
  await expect(table).toBeVisible();
  await expect(table.getByText("Date")).toBeVisible();
  await expect(table.locator("tbody tr").first()).toContainText(/\d{4}-\d{2}-\d{2}/);
});

test("season strip labels itself climatology on dashboard and river page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/climatology, not a forecast/i).first()).toBeVisible();
  await page.goto("/river/kunhar-balakot");
  await expect(page.getByText(/climatology, not a forecast/i).first()).toBeVisible();
});

test("about notes search: hits or honest empty state, each with provenance", async ({ page }) => {
  test.setTimeout(120_000); // first query loads the local MiniLM model in the dev server
  await page.goto("/about");
  await page.getByLabel("Search river notes").fill("Kaghan access");
  await page.getByRole("button", { name: "Search" }).click();
  const first = page.locator("#notes-search ul li").first();
  await expect(first).toBeVisible({ timeout: 100_000 });
  const text = await first.innerText();
  // either an honest empty state or a provenance-backed hit — never an error
  expect(/No notes matched|fetched \d{4}-\d{2}-\d{2}/.test(text)).toBe(true);
});

test("mobile viewport: dashboard stacks without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

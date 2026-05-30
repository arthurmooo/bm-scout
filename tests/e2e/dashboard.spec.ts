import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("la console expose les decisions Romu et les actions feedback", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "BM Scout" })).toBeVisible();
  await expect(page.getByText("production_not_ready")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Prochaine meilleure action" })).toBeVisible();

  for (const label of ["Bon lead", "Angle OK", "Générique", "RDV", "Mauvais", "Négatif"]) {
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }

  for (const label of ["Core", "Exploration", "Daily Brief", "Learning"]) {
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }

  const bonLeadButton = page.locator("button").filter({ hasText: "Bon lead" });
  await bonLeadButton.click();
  await expect(bonLeadButton).toContainText(/OK|Erreur/);

  await mkdir("artifacts/browser-smoke", { recursive: true });
  await page.screenshot({
    path: "artifacts/browser-smoke/playwright-dashboard-feedback-actions.png",
    fullPage: false
  });
});

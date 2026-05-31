import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("la console expose les decisions Romu et les actions feedback", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "BM Scout" })).toBeVisible();
  await expect(page.getByText("production_not_ready")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Prochaine meilleure action" })).toBeVisible();

  for (const label of ["Utilisé", "Bon lead", "Angle OK", "Générique", "RDV", "Mauvais", "Négatif"]) {
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }

  await page.getByText("Décisions", { exact: true }).click();
  for (const label of ["Surveiller", "Relancer QC", "Sans réponse", "Positif", "Mauvais contact", "Timing", "Douleur OK", "Douleur non", "Exclure"]) {
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }

  for (const label of ["Core", "Exploration", "Daily Brief", "Learning", "Contrôle DNC", "Relances"]) {
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

test("la page login expose le garde interne Supabase sans claims client", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Accès interne" })).toBeVisible();
  await expect(page.getByLabel("Email interne")).toBeVisible();
  await expect(page.getByRole("button", { name: "Envoyer le lien" })).toBeVisible();
  await expect(page.getByText("Mode démo local actif")).toBeVisible();
});

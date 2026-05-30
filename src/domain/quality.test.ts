import { describe, expect, it } from "vitest";
import { weakCandidates } from "./fixtures";
import { evaluateLead, isSpecificOutreach } from "./quality";
import { runScoutMission, seedFeedbacks } from "./scout-engine";

describe("quality gates", () => {
  it("bloque un message generique et un lead hors ICP", () => {
    const weakLead = evaluateLead(weakCandidates[0]);

    expect(weakLead.qualityDecision).toBe("blocked");
    expect(weakLead.verdict).toBe("reject");
    expect(isSpecificOutreach(weakLead)).toBe(false);
  });

  it("ne cree pas de message direct en exploration", () => {
    const run = runScoutMission("exploration", { feedbacks: seedFeedbacks() });

    expect(run.leads.length).toBeGreaterThan(0);
    expect(run.leads.every((lead) => lead.outreach.coldEmail.toLowerCase().includes("brouillon blo"))).toBe(true);
  });

  it("garde au moins un compte Core validable pour Romu", () => {
    const run = runScoutMission("core", { feedbacks: seedFeedbacks() });

    expect(run.leads.filter((lead) => lead.mode === "core").length).toBeGreaterThanOrEqual(2);
    expect(run.leads.some((lead) => lead.verdict === "validate" && lead.qualityDecision === "pass")).toBe(true);
  });

  it("produit des apprentissages exploitables a partir des feedbacks", () => {
    const run = runScoutMission("core", { feedbacks: seedFeedbacks() });

    expect(run.lessons.length).toBeGreaterThanOrEqual(3);
    expect(run.lessons.some((lesson) => lesson.recommendation.toLowerCase().includes("do-not-contact"))).toBe(true);
  });
});

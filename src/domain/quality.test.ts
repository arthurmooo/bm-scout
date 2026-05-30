import { describe, expect, it } from "vitest";
import { weakCandidates } from "./fixtures";
import { evaluateLead, isSpecificOutreach } from "./quality";
import { runScoutMission, seedFeedbacks } from "./scout-engine";
import type { ScoutLead } from "./types";

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

  it("bloque deterministiquement un lead marque do-not-contact avant generation de message", () => {
    const run = runScoutMission("core", { feedbacks: seedFeedbacks() });
    const blocked = run.rejected.find((lead) => lead.id === "core-eight-advisory");

    expect(blocked?.qualityDecision).toBe("blocked");
    expect(blocked?.outreach.coldEmail.toLowerCase()).toContain("do-not-contact");
    expect(run.leads.some((lead) => lead.id === "core-eight-advisory")).toBe(false);
  });

  it("bloque un insight observe sans preuve reliee", () => {
    const source = runScoutMission("core").leads[0];
    const invalid: ScoutLead = {
      ...source,
      insights: {
        observed: [{ text: "Signal sans preuve", evidenceId: "missing-evidence" }],
        inferred: source.painHypotheses,
        uncertain: []
      }
    };

    const evaluated = evaluateLead(invalid);

    expect(evaluated.qualityDecision).toBe("blocked");
    expect(evaluated.qualityGates.find((gate) => gate.code === "observed_evidence")?.passed).toBe(false);
  });
});

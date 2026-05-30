import { describe, expect, it } from "vitest";
import { applyFeedbackMemory, buildFeedbackMemory } from "./feedback-memory";
import { coreCandidates, weakCandidates } from "./fixtures";
import { evaluateLead, isSpecificOutreach } from "./quality";
import { runScoutMission, seedFeedbacks } from "./scout-engine";
import type { FeedbackEvent, ScoutLead } from "./types";

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

  it("penalise causalement un secteur mal note par Romu", () => {
    const clone: ScoutLead = {
      ...coreCandidates[2],
      id: "core-in-extenso-copy",
      company: "Cabinet Finance Ops Test",
      score: 70
    };
    const feedbacks: FeedbackEvent[] = [
      {
        id: "fb-sector-bad",
        leadId: "core-in-extenso",
        kind: "bad_lead",
        note: "Mauvais secteur et douleur faible.",
        createdAt: new Date().toISOString()
      }
    ];

    const memory = buildFeedbackMemory(feedbacks, [...coreCandidates, clone]);
    const evaluated = applyFeedbackMemory([clone], memory);

    expect(evaluated[0].score).toBeLessThan(clone.score);
    expect(evaluated[0].scoreJustification.toLowerCase()).toContain("mémoire romu");
  });

  it("ne remet pas un lead deja rejete sans justification nouvelle", () => {
    const feedbacks: FeedbackEvent[] = [
      {
        id: "fb-reject-inextenso",
        leadId: "core-in-extenso",
        kind: "bad_lead",
        note: "À exclure : mauvais secteur pour cette semaine.",
        createdAt: new Date().toISOString()
      }
    ];

    const run = runScoutMission("core", { feedbacks });

    expect(run.leads.some((lead) => lead.id === "core-in-extenso")).toBe(false);
    expect(run.rejected.find((lead) => lead.id === "core-in-extenso")?.rejectionReason).toContain("Lead déjà rejeté");
  });

  it("renforce un angle valide et regenere un message trop generique", () => {
    const run = runScoutMission("core", { feedbacks: seedFeedbacks() });
    const cambon = run.leads.find((lead) => lead.id === "core-cambon");

    expect(cambon).toBeDefined();
    if (!cambon) throw new Error("Cambon doit rester en shortlist Core.");
    expect(cambon.scoreJustification.toLowerCase()).toContain("angle validé romu");
    expect(cambon.nextAction.toLowerCase()).toContain("angle validé romu");
    expect(cambon.outreach.coldEmail).toContain("J'ai relevé un signal public précis");
    expect(cambon.outreach.coldEmail).toContain(cambon.observedSignals[0]);
  });
});

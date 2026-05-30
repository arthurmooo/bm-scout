import type { FeedbackEvent, LearningLesson, ScoutLead, StructuredInsights } from "./types";

const genericTokens = ["comme la vôtre", "avec l'ia", "automatiser votre business", "solution clé en main", "plateforme saas"];
const enrichmentGateCodes = new Set(["contact", "specificity"]);
const generatedGateCodes = new Set(["evidence", "observed_evidence", "message_specificity", "do_not_contact"]);

export function evaluateLead(lead: ScoutLead): ScoutLead {
  const candidate = leadHasDoNotContact(lead) ? blockDoNotContact(lead) : lead;
  const insights = candidate.insights ?? deriveStructuredInsights(candidate);
  const gates = [
    ...candidate.qualityGates.filter((gate) => !generatedGateCodes.has(gate.code)),
    {
      code: "evidence",
      passed: candidate.evidence.length > 0 || candidate.verdict === "reject",
      reason: candidate.evidence.length > 0 ? "Preuves présentes." : "Aucune preuve exploitable."
    },
    {
      code: "observed_evidence",
      passed: hasSourcedObservedInsights(candidate, insights) || candidate.verdict === "reject",
      reason: hasSourcedObservedInsights(candidate, insights)
        ? "Chaque insight observé est relié à une preuve."
        : "Insight observé sans evidence_id exploitable."
    },
    {
      code: "message_specificity",
      passed: isSpecificOutreach(candidate),
      reason: isSpecificOutreach(candidate) ? "Message ou blocage suffisamment spécifique." : "Message générique ou non relié à un signal."
    },
    {
      code: "do_not_contact",
      passed: !leadHasDoNotContact(candidate),
      reason: leadHasDoNotContact(candidate) ? "Contact, domaine ou entreprise marqué do-not-contact." : "Aucun blocage do-not-contact."
    }
  ];
  const failedGates = gates.filter((gate) => !gate.passed);
  const hasBlocker = failedGates.some((gate) => !enrichmentGateCodes.has(gate.code));
  const needsEnrichment = failedGates.length > 0 && !hasBlocker;
  return {
    ...candidate,
    insights,
    qualityDecision: hasBlocker ? "blocked" : needsEnrichment ? "needs_enrichment" : candidate.qualityDecision,
    verdict: hasBlocker && candidate.verdict === "validate" ? "enrich" : candidate.verdict,
    qualityGates: gates
  };
}

export function markLeadDoNotContact(lead: ScoutLead, reason = "Do-not-contact issu de la mémoire Romu."): ScoutLead {
  return blockDoNotContact({
    ...lead,
    personas: lead.personas.length
      ? lead.personas.map((persona, index) => (index === 0 ? { ...persona, doNotContact: true } : persona))
      : [{ role: "Contact non précisé", reason, contactConfidence: "uncertain", doNotContact: true }],
    rejectionReason: reason
  });
}

export function isSpecificOutreach(lead: ScoutLead): boolean {
  const body = lead.outreach.coldEmail.toLowerCase();
  if (body.includes("brouillon bloqué") || body.includes("brouillon bloque")) return true;
  if (!body.includes("bm automation")) return false;
  if (!body.includes("si vous ne souhaitez pas")) return false;
  if (!body.includes("?")) return false;
  if (genericTokens.some((token) => body.includes(token))) return false;
  if (body.includes(lead.company.toLowerCase())) return true;
  return lead.observedSignals.some((signal) =>
    signal
      .toLowerCase()
      .split(/[\s,.'’/-]+/)
      .filter((word) => word.length > 5)
      .some((word) => body.includes(word))
  );
}

export function deriveStructuredInsights(lead: ScoutLead): StructuredInsights {
  return {
    observed: lead.observedSignals.map((signal, index) => ({
      text: signal,
      evidenceId: lead.evidence[index]?.id ?? lead.evidence[index]?.url ?? ""
    })),
    inferred: lead.painHypotheses,
    uncertain: lead.personas.some((persona) => persona.contactConfidence !== "confirmed")
      ? ["Décideur exact et email nominatif à confirmer avant toute relance."]
      : []
  };
}

function hasSourcedObservedInsights(lead: ScoutLead, insights: StructuredInsights): boolean {
  if (!insights.observed.length) return false;
  const evidenceKeys = new Set(lead.evidence.flatMap((proof) => [proof.id, proof.url]).filter(Boolean));
  return insights.observed.every((observed) => observed.evidenceId.trim() && evidenceKeys.has(observed.evidenceId));
}

function leadHasDoNotContact(lead: ScoutLead): boolean {
  return lead.personas.some((persona) => persona.doNotContact);
}

function blockDoNotContact(lead: ScoutLead): ScoutLead {
  return {
    ...lead,
    verdict: "reject",
    qualityDecision: "blocked",
    outreach: {
      coldEmail: "Brouillon bloqué : do-not-contact.",
      followUp: "Brouillon bloqué : do-not-contact.",
      linkedin: "Brouillon bloqué : do-not-contact."
    },
    rejectionReason: lead.rejectionReason ?? "Do-not-contact.",
    nextAction: "Bloqué do-not-contact : aucune relance autorisée."
  };
}

export function buildLearning(feedbacks: FeedbackEvent[], leads: ScoutLead[]): LearningLesson[] {
  const doNotContact = feedbacks.filter((feedback) => feedback.kind === "do_not_contact").length;
  const goodAngles = feedbacks.filter((feedback) => feedback.kind === "good_angle").length;
  const generic = feedbacks.filter((feedback) => feedback.kind === "generic_message").length;
  const positive = feedbacks.filter((feedback) => feedback.kind === "positive_outcome").length;
  const coreWins = leads.filter((lead) => lead.mode === "core" && lead.qualityDecision === "pass").length;
  return [
    {
      id: "lesson-core-first",
      lesson: `Les comptes Core avec signaux deal/document obtiennent le meilleur niveau de confiance (${coreWins} prêts ou presque prêts).`,
      recommendation: "Limiter la semaine suivante aux comptes M&A/finance ops avec deux sources minimum.",
      source: "runs + feedback Romu",
      confidence: 0.86
    },
    {
      id: "lesson-angle",
      lesson: goodAngles > 0 ? "Les angles centrés sur une tâche entre outils sont mieux notés que les messages IA." : "Aucun angle validé : garder tous les messages en enrichissement.",
      recommendation: "Faire commencer les messages par un fait public puis une hypothèse prudente de tâche grise.",
      source: "feedback message",
      confidence: 0.82
    },
    {
      id: "lesson-qc",
      lesson: generic > 0 ? "Le QC doit bloquer les formulations IA/génériques avant affichage." : "Le QC n'a pas détecté de message générique cette semaine.",
      recommendation: "Conserver le gate anti-générique bloquant avant toute copie.",
      source: "quality control",
      confidence: 0.9
    },
    {
      id: "lesson-optout",
      lesson: doNotContact > 0 ? "Un contact marqué do-not-contact doit bloquer toute relance et tout nouveau brouillon." : "Aucun opt-out simulé hors run qualité.",
      recommendation: "Faire passer le statut do-not-contact avant les recommandations de relance.",
      source: "feedback/outcomes",
      confidence: 0.95
    },
    {
      id: "lesson-outcome",
      lesson: positive > 0 ? "Les réponses positives viennent des messages courts ancrés dans un signal observé." : "Pas assez d'outcomes positifs pour élargir la cible.",
      recommendation: "Ne pas augmenter le volume tant que la qualité par compte n'est pas stable.",
      source: "outcomes",
      confidence: 0.74
    }
  ].slice(0, 5);
}

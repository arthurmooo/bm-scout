import type { FeedbackEvent, LearningLesson, ScoutLead } from "./types";

const genericTokens = ["comme la vôtre", "avec l'ia", "automatiser votre business", "solution clé en main", "plateforme saas"];
const enrichmentGateCodes = new Set(["contact", "specificity"]);

export function evaluateLead(lead: ScoutLead): ScoutLead {
  const gates = [
    ...lead.qualityGates,
    {
      code: "evidence",
      passed: lead.evidence.length > 0 || lead.verdict === "reject",
      reason: lead.evidence.length > 0 ? "Preuves présentes." : "Aucune preuve exploitable."
    },
    {
      code: "message_specificity",
      passed: isSpecificOutreach(lead),
      reason: isSpecificOutreach(lead) ? "Message ou blocage suffisamment spécifique." : "Message générique ou non relié à un signal."
    }
  ];
  const failedGates = gates.filter((gate) => !gate.passed);
  const hasBlocker = failedGates.some((gate) => !enrichmentGateCodes.has(gate.code));
  const needsEnrichment = failedGates.length > 0 && !hasBlocker;
  return {
    ...lead,
    qualityDecision: hasBlocker ? "blocked" : needsEnrichment ? "needs_enrichment" : lead.qualityDecision,
    verdict: hasBlocker && lead.verdict === "validate" ? "enrich" : lead.verdict,
    qualityGates: gates
  };
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

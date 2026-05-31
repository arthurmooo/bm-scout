import { evaluateLead, markLeadDoNotContact } from "./quality";
import type { FeedbackEvent, ScoutLead } from "./types";

const negativeSectorKeywords = ["mauvais secteur", "hors icp", "trop petit", "douleur faible", "pas assez source", "pas assez sourcé"];
const positiveSectorKeywords = ["tres bon", "très bon", "bon secteur", "bon timing", "bon contact", "fort potentiel"];
const messageRewriteKeywords = [
  "trop generique",
  "trop générique",
  "a raccourcir",
  "à raccourcir",
  "mauvais angle",
  "trop ia",
  "trop commercial",
  "pas assez direct"
];
const angleKeywords = [
  "deal-by-deal",
  "deal",
  "document",
  "documents",
  "reporting",
  "relance",
  "relances",
  "data room",
  "dataroom",
  "q&a",
  "pipeline",
  "crm",
  "collecte"
];

export interface FeedbackMemory {
  doNotContactLeadIds: Set<string>;
  rejectedLeadIds: Set<string>;
  leadBlockReasons: Map<string, string>;
  segmentScoreDeltas: Map<string, number>;
  preferredAngles: string[];
  genericMessageFeedback: boolean;
}

export function buildFeedbackMemory(feedbacks: FeedbackEvent[], knownLeads: ScoutLead[]): FeedbackMemory {
  const leadsById = new Map(knownLeads.map((lead) => [lead.id, lead]));
  const memory: FeedbackMemory = {
    doNotContactLeadIds: new Set(),
    rejectedLeadIds: new Set(),
    leadBlockReasons: new Map(),
    segmentScoreDeltas: new Map(),
    preferredAngles: [],
    genericMessageFeedback: false
  };

  for (const feedback of feedbacks) {
    const note = normalize(feedback.note);
    const lead = leadsById.get(feedback.leadId);

    if (feedback.kind === "do_not_contact") {
      memory.doNotContactLeadIds.add(feedback.leadId);
      memory.leadBlockReasons.set(feedback.leadId, "Do-not-contact issu du feedback Romu.");
    }

    if (feedback.kind === "bad_lead" || feedback.kind === "negative_outcome" || note.includes("a exclure") || note.includes("à exclure")) {
      memory.rejectedLeadIds.add(feedback.leadId);
      memory.leadBlockReasons.set(
        feedback.leadId,
        feedback.kind === "negative_outcome"
          ? "Outcome négatif Romu : ne pas relancer sans preuve nouvelle et accord explicite."
          : "Lead déjà rejeté par Romu : ne pas le remettre sans enrichissement explicite."
      );
    }

    if (lead && (feedback.kind === "bad_lead" || feedback.kind === "negative_outcome" || negativeSectorKeywords.some((keyword) => note.includes(keyword)))) {
      incrementSegmentDelta(memory.segmentScoreDeltas, lead.segment, -18);
    }

    if (lead && (feedback.kind === "good_lead" || feedback.kind === "positive_outcome" || positiveSectorKeywords.some((keyword) => note.includes(keyword)))) {
      incrementSegmentDelta(memory.segmentScoreDeltas, lead.segment, 6);
    }

    if (feedback.kind === "good_angle") {
      memory.preferredAngles.push(...extractAngles(feedback.note));
    }

    if (feedback.kind === "generic_message" || messageRewriteKeywords.some((keyword) => note.includes(keyword))) {
      memory.genericMessageFeedback = true;
    }
  }

  memory.preferredAngles = Array.from(new Set(memory.preferredAngles));
  return memory;
}

export function applyFeedbackMemory(leads: ScoutLead[], memory: FeedbackMemory): ScoutLead[] {
  return leads.map((lead) => {
    if (memory.doNotContactLeadIds.has(lead.id)) {
      return markLeadDoNotContact(lead, memory.leadBlockReasons.get(lead.id));
    }

    if (memory.rejectedLeadIds.has(lead.id)) {
      return rejectFromFeedback(lead, memory.leadBlockReasons.get(lead.id));
    }

    const scoreAdjusted = applySegmentScore(lead, memory.segmentScoreDeltas.get(lead.segment) ?? 0);
    const angleAdjusted = applyPreferredAngles(scoreAdjusted, memory.preferredAngles);
    const messageAdjusted = memory.genericMessageFeedback ? rewriteMessageFromEvidence(angleAdjusted) : angleAdjusted;

    return evaluateLead(messageAdjusted);
  });
}

function applySegmentScore(lead: ScoutLead, delta: number): ScoutLead {
  if (delta === 0) return lead;
  const score = clampScore(lead.score + delta);
  const direction = delta > 0 ? "bonus" : "pénalité";
  return {
    ...lead,
    score,
    scoreJustification: `${lead.scoreJustification} Mémoire Romu : ${direction} segment ${lead.segment} (${delta > 0 ? "+" : ""}${delta}).`,
    nextAction:
      delta < 0
        ? `${lead.nextAction} Vérifier que ce segment mérite encore l'attention avant enrichissement.`
        : `${lead.nextAction} Segment renforcé par feedback Romu.`
  };
}

function applyPreferredAngles(lead: ScoutLead, preferredAngles: string[]): ScoutLead {
  const matchedAngles = preferredAngles.filter((angle) => leadMatchesAngle(lead, angle));
  if (!matchedAngles.length) return lead;
  const angle = matchedAngles[0];
  return {
    ...lead,
    score: clampScore(lead.score + 5),
    scoreJustification: `${lead.scoreJustification} Angle validé Romu renforcé : ${angle}.`,
    nextAction: `${lead.nextAction} Réutiliser l'angle validé Romu : ${angle}.`
  };
}

function rewriteMessageFromEvidence(lead: ScoutLead): ScoutLead {
  if (lead.outreach.coldEmail.toLowerCase().includes("brouillon blo")) return lead;
  const observed = lead.observedSignals[0] ?? lead.evidence[0]?.observedFact;
  if (!observed) return lead;

  return {
    ...lead,
    outreach: {
      ...lead.outreach,
      coldEmail: `Bonjour,\n\nJ'ai relevé un signal public précis chez ${lead.company} : ${observed}\n\nJe suis Arthur de BM Automation. Hypothèse prudente : une partie du suivi associé repasse encore entre emails, fichiers, documents ou reporting existants.\n\nEst-ce utile de vérifier un seul workflow concret, sans remplacer vos outils ? Si vous ne souhaitez pas être recontacté, dites-le simplement.`
    },
    scoreJustification: `${lead.scoreJustification} Mémoire Romu : message régénéré après feedback anti-générique.`
  };
}

function rejectFromFeedback(lead: ScoutLead, reason = "Lead rejeté par feedback Romu."): ScoutLead {
  return {
    ...lead,
    verdict: "reject",
    qualityDecision: "blocked",
    score: Math.min(lead.score, 15),
    outreach: {
      coldEmail: "Brouillon bloqué : lead déjà rejeté par Romu.",
      followUp: "Brouillon bloqué : lead déjà rejeté par Romu.",
      linkedin: "Brouillon bloqué : lead déjà rejeté par Romu."
    },
    qualityGates: [
      ...lead.qualityGates.filter((gate) => gate.code !== "feedback_memory"),
      { code: "feedback_memory", passed: false, reason }
    ],
    nextAction: "Ne pas remettre ce lead dans la shortlist sans preuve nouvelle et justification explicite.",
    rejectionReason: reason
  };
}

function leadMatchesAngle(lead: ScoutLead, angle: string): boolean {
  const haystack = normalize(
    [
      lead.segment,
      lead.scoreJustification,
      lead.deepCard,
      lead.nextAction,
      ...lead.observedSignals,
      ...lead.painHypotheses,
      lead.outreach.coldEmail
    ].join(" ")
  );
  return haystack.includes(normalize(angle));
}

function extractAngles(note: string): string[] {
  const normalized = normalize(note);
  const explicit = angleKeywords.filter((keyword) => normalized.includes(keyword));
  if (explicit.length) return explicit;
  return note
    .split(/[,.;/]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 6)
    .slice(0, 2);
}

function incrementSegmentDelta(deltas: Map<string, number>, segment: string, delta: number): void {
  deltas.set(segment, clampDelta((deltas.get(segment) ?? 0) + delta));
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}

function clampDelta(delta: number): number {
  return Math.max(-35, Math.min(18, delta));
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

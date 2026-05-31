import { analyzeRunnerSteps, type RunnerRuntimeEvidence, type RunnerStepEvidence } from "./readiness-evidence";

export interface FeedbackLoopScenarioCompany {
  externalId: string;
  name: string;
  website: string;
  segment: string;
  feedbacks: Array<{ kind: "good_lead" | "bad_lead" | "generic_message" | "good_angle" | "do_not_contact"; note: string }>;
  outcomes?: Array<{ outcome: "interested" | "not_now" | "not_relevant" | "meeting_booked" | "negative" | "no_response"; note: string }>;
  doNotContactReason?: string;
}

export interface FeedbackLoopEvidenceAnalysis {
  status: "pass" | "fail";
  blockers: string[];
  runtime: RunnerRuntimeEvidence;
}

export interface FeedbackLoopLesson {
  lesson?: string;
  recommendation?: string;
  source?: string;
}

export const FEEDBACK_LOOP_SCENARIO_COMPANIES: FeedbackLoopScenarioCompany[] = [
  {
    externalId: "bm-feedback-proof-cambon",
    name: "Cambon Partners",
    website: "https://www.cambonpartners.com",
    segment: "Conseil M&A",
    feedbacks: [
      {
        kind: "good_lead",
        note: "Feedback Romu : très bon lead Core, fort potentiel, bon secteur M&A."
      },
      {
        kind: "good_angle",
        note: "Feedback Romu : très bon angle deal-by-deal, documents et reporting."
      },
      {
        kind: "generic_message",
        note: "Feedback Romu : message trop générique, repartir d'un signal observé précis."
      }
    ]
  },
  {
    externalId: "bm-feedback-proof-inextenso",
    name: "In Extenso",
    website: "https://www.inextenso.fr",
    segment: "Expertise comptable",
    feedbacks: [
      {
        kind: "bad_lead",
        note: "Feedback Romu : mauvais lead pour cette semaine, douleur faible et mauvais secteur prioritaire."
      }
    ],
    outcomes: [
      {
        outcome: "negative",
        note: "Outcome Romu : réponse négative, ne pas remettre ce compte sans preuve nouvelle."
      }
    ]
  },
  {
    externalId: "bm-feedback-proof-lefebvre-dalloz",
    name: "Lefebvre Dalloz Compétences",
    website: "https://formation.lefebvre-dalloz.fr",
    segment: "Formation B2B",
    feedbacks: [
      {
        kind: "do_not_contact",
        note: "Feedback Romu : do-not-contact actif pour ce compte."
      }
    ],
    doNotContactReason: "Preuve feedback loop BM Scout : do-not-contact actif, aucune relance autorisée."
  }
];

export function feedbackLoopScenarioSeeds(companies = FEEDBACK_LOOP_SCENARIO_COMPANIES) {
  return companies.map((company) => ({
    company: company.name,
    website: company.website,
    segment: company.segment,
    region: "fr"
  }));
}

export function feedbackLoopWorkerEnv(companies = FEEDBACK_LOOP_SCENARIO_COMPANIES): Record<string, string> {
  return {
    BM_SCOUT_PROVIDER: "configured",
    BM_SCOUT_EVIDENCE_PURPOSE: "feedback_loop",
    BM_SCOUT_REAL_SEEDS: JSON.stringify(feedbackLoopScenarioSeeds(companies)),
    BM_SCOUT_FETCH_TIMEOUT_SECONDS: process.env.BM_SCOUT_FETCH_TIMEOUT_SECONDS ?? "8",
    BM_SCOUT_AGENT_MAX_TURNS: process.env.BM_SCOUT_AGENT_MAX_TURNS ?? "6"
  };
}

export function analyzeFeedbackLoopEvidence(
  steps: RunnerStepEvidence[],
  currentCodeRevision: string,
  lessons: FeedbackLoopLesson[] = []
): FeedbackLoopEvidenceAnalysis {
  const runtime = analyzeRunnerSteps(steps, currentCodeRevision);
  const blockers = [
    ...(runtime.source !== "supabase" ? ["Mémoire feedback non chargée depuis Supabase."] : []),
    ...(runtime.feedbackEventCount < 3 ? ["Moins de 3 feedbacks/outcomes Supabase chargés."] : []),
    ...(runtime.doNotContactEventCount < 1 ? ["Aucun do-not-contact Supabase chargé."] : []),
    ...(runtime.feedbackImpactCount < 1 ? ["Aucun impact feedback structuré mesuré."] : []),
    ...(!runtime.persistComplete ? ["Run non persisté via Supabase RPC."] : []),
    ...(!runtime.runtimeMetadataComplete ? ["Métadonnées runtime incomplètes."] : []),
    ...(!runtime.runtimeRevisionMatchesCurrent ? ["Révision runtime différente du code courant ou worktree dirty."] : []),
    ...(!hasCausalFeedbackEffect(runtime) ? ["Aucun effet causal score/message/blocage/angle mesuré."] : []),
    ...(!feedbackLoopLearningUsesFeedback(lessons)
      ? ["Learning Agent sans synthèse 3-5 apprentissages exploitant feedback Romu et do-not-contact."]
      : [])
  ];
  return {
    status: blockers.length ? "fail" : "pass",
    blockers,
    runtime
  };
}

export function feedbackLoopLearningUsesFeedback(lessons: FeedbackLoopLesson[]): boolean {
  if (lessons.length < 3 || lessons.length > 5) return false;
  const text = lessons
    .flatMap((lesson) => [lesson.lesson, lesson.recommendation, lesson.source])
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return text.includes("feedback romu") && text.includes("do-not-contact");
}

function hasCausalFeedbackEffect(runtime: RunnerRuntimeEvidence): boolean {
  return (
    runtime.feedbackScoreChangedCount > 0 ||
    runtime.feedbackBlockedCount > 0 ||
    runtime.feedbackMessageRegeneratedCount > 0 ||
    runtime.feedbackAngleReinforcedCount > 0
  );
}

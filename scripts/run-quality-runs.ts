import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { runScoutMission, seedFeedbacks } from "../src/domain/scout-engine";
import type { ScoutLead, ScoutRun } from "../src/domain/types";
import {
  analyzeAgentTaskCronArtifact,
  analyzeRunnerSteps,
  analyzeSupabaseRuntimeArtifact,
  codeRevisionMatchesCurrent,
  type AgentTaskCronArtifactEvidence,
  type RunnerStepEvidence,
  type SupabaseRuntimeArtifactEvidence
} from "../src/server/readiness-evidence";
import { getScoutSnapshot } from "../src/server/scout-repository";
import { createServerSupabaseClient } from "../src/server/supabase";
import { verifySupabasePersistenceDedupe } from "../src/server/supabase-runtime-verification";

type RunVerdict = "pass" | "fail";
type ProductReadiness = "pilot_candidate" | "production_not_ready";

const execFileAsync = promisify(execFile);

interface EvaluatedRun {
  name: string;
  run: ScoutRun;
  score: number;
  verdict: RunVerdict;
  blockers: string[];
}

const feedbacks = seedFeedbacks();
const evaluatedRuns: EvaluatedRun[] = [
  evaluateRun("Run 1 - Core BM", runScoutMission("core", { feedbacks })),
  evaluateRun("Run 2 - Exploration", runScoutMission("exploration", { feedbacks })),
  evaluateRun("Run 3 - Feedback & Learning", runScoutMission("core", { feedbacks })),
  evaluateRun("Run 4 - Anti-generique / QC negatif", runScoutMission("exploration", { includeWeak: true, feedbacks }))
];

const globalBlockers = evaluatedRuns.flatMap((item) => item.blockers);
const globalScore = Math.round(
  evaluatedRuns.reduce((sum, item) => sum + item.score, 0) / evaluatedRuns.length
);
const fixtureVerdict: RunVerdict = globalBlockers.length === 0 && globalScore >= 85 ? "pass" : "fail";
const currentCodeRevision = await resolveCurrentCodeRevision();
const realRunnerEvidence = await loadRealRunnerEvidence(currentCodeRevision);
const feedbackLoopEvidence = await loadFeedbackLoopEvidence(currentCodeRevision);
const cliPersistEvidence = await loadCliPersistEvidence();
const cronEvidence = await loadAgentTaskCronEvidence(currentCodeRevision);
const supabaseConsoleEvidence = await loadSupabaseConsoleEvidence(currentCodeRevision);
const providerComparisonEvidence = await loadProviderComparisonEvidence(currentCodeRevision);
const readinessMode = process.argv.includes("--readiness");
const productBlockers = buildProductBlockers(
  realRunnerEvidence,
  feedbackLoopEvidence,
  cliPersistEvidence,
  cronEvidence,
  supabaseConsoleEvidence,
  providerComparisonEvidence
);
const productReadiness: ProductReadiness = productBlockers.length === 0 ? "pilot_candidate" : "production_not_ready";

const report = renderReport(
  evaluatedRuns,
  globalScore,
  fixtureVerdict,
  globalBlockers,
  realRunnerEvidence,
  feedbackLoopEvidence,
  cliPersistEvidence,
  cronEvidence,
  supabaseConsoleEvidence,
  providerComparisonEvidence,
  currentCodeRevision
);
const artifactsDir = join(process.cwd(), "artifacts", "quality-runs");
await mkdir(artifactsDir, { recursive: true });
await writeFile(join(artifactsDir, "latest-report.md"), report, "utf8");
await writeFile(
  join(artifactsDir, "latest-report.json"),
  JSON.stringify(
    {
      globalScore,
      fixtureVerdict,
      productReadiness,
      productBlockers,
      realRunnerEvidence,
      feedbackLoopEvidence,
      cliPersistEvidence,
      cronEvidence,
      supabaseConsoleEvidence,
      providerComparisonEvidence,
      currentCodeRevision,
      readinessMode,
      runs: evaluatedRuns
    },
    null,
    2
  ),
  "utf8"
);

if (fixtureVerdict === "fail") {
  console.error(report);
  process.exit(1);
}

if (readinessMode && productReadiness !== "pilot_candidate") {
  console.error(report);
  process.exit(1);
}

console.log(report);

function evaluateRun(name: string, run: ScoutRun): EvaluatedRun {
  const blockers = [
    ...runLevelBlockers(name, run),
    ...run.leads.flatMap((lead) => leadBlockers(lead)),
    ...run.rejected.flatMap((lead) => rejectedLeadBlockers(lead))
  ];
  const score = Math.max(0, 100 - blockers.length * 12);
  return {
    name,
    run,
    score,
    verdict: blockers.length === 0 && score >= 80 ? "pass" : "fail",
    blockers
  };
}

function runLevelBlockers(name: string, run: ScoutRun): string[] {
  const blockers: string[] = [];
  const lowerName = name.toLowerCase();
  const retainedCore = run.leads.filter((lead) => lead.mode === "core");

  if (lowerName.includes("core bm")) {
    if (retainedCore.length < 2) blockers.push("Core BM: moins de deux comptes Core actionnables.");
    if (!retainedCore.some((lead) => lead.verdict === "validate")) {
      blockers.push("Core BM: aucun compte validable pour Romu.");
    }
    if (!retainedCore.some(hasCompleteCoreOutput)) {
      blockers.push("Core BM: aucun output complet avec fiche, personas, messages et QC.");
    }
  }

  if (lowerName.includes("exploration")) {
    if (!run.leads.length) blockers.push("Exploration: aucune shortlist actionnable.");
    if (run.leads.some((lead) => lead.mode !== "exploration")) {
      blockers.push("Exploration: shortlist polluee par un compte Core.");
    }
  }

  if (lowerName.includes("feedback")) {
    if (run.lessons.length < 3 || run.lessons.length > 5) {
      blockers.push("Feedback & Learning: la synthese doit contenir 3 a 5 apprentissages.");
    }
    if (!run.lessons.some((lesson) => lesson.recommendation.toLowerCase().includes("do-not-contact"))) {
      blockers.push("Feedback & Learning: do-not-contact non pris en compte.");
    }
  }

  if (lowerName.includes("qc negatif")) {
    if (!run.rejected.some((lead) => lead.id.startsWith("weak-"))) {
      blockers.push("QC negatif: le cas faible injecte n'est pas bloque.");
    }
  }

  return blockers;
}

function leadBlockers(lead: ScoutLead): string[] {
  const blockers: string[] = [];
  if (!lead.evidence.length) blockers.push(`${lead.company}: aucune source publique.`);
  if (!lead.observedSignals.length) blockers.push(`${lead.company}: aucun signal observe.`);
  if (!hasSourcedObservedInsights(lead)) blockers.push(`${lead.company}: insight observe sans evidence_id source.`);
  if (!lead.painHypotheses.length) blockers.push(`${lead.company}: aucune hypothese prudente.`);
  if (!lead.scoreJustification.trim()) blockers.push(`${lead.company}: score non justifie.`);
  for (const persona of lead.personas) {
    if (persona.email && !persona.emailSourceUrl) blockers.push(`${lead.company}: email public sans URL source.`);
    if (persona.emailStatus === "usable" && (!persona.email || !persona.emailSourceUrl)) {
      blockers.push(`${lead.company}: email utilisable sans adresse ou source.`);
    }
    if (persona.emailType === "unknown" && persona.emailStatus === "usable") {
      blockers.push(`${lead.company}: email inconnu marqué utilisable.`);
    }
    if (persona.emailType === "probable_pattern" && persona.emailStatus !== "verify") {
      blockers.push(`${lead.company}: email pattern probable non marque a verifier.`);
    }
  }
  if (lead.mode === "exploration" && !lead.outreach.coldEmail.toLowerCase().includes("brouillon blo")) {
    blockers.push(`${lead.company}: Exploration ne doit pas produire de message direct.`);
  }
  if (lead.qualityDecision === "blocked" && lead.verdict !== "reject") {
    blockers.push(`${lead.company}: lead bloque encore dans la shortlist.`);
  }
  if (messageLooksGeneric(lead.outreach.coldEmail)) {
    blockers.push(`${lead.company}: message generique.`);
  }
  return blockers;
}

function hasCompleteCoreOutput(lead: ScoutLead): boolean {
  return Boolean(
    lead.shortCard.trim() &&
      lead.deepCard.trim() &&
      lead.personas.length &&
      lead.outreach.coldEmail.trim() &&
      lead.outreach.followUp.trim() &&
      lead.outreach.linkedin.trim() &&
      lead.qualityGates.length &&
      lead.qualityDecision
  );
}

function rejectedLeadBlockers(lead: ScoutLead): string[] {
  const blockers: string[] = [];
  if (lead.qualityDecision !== "blocked" && lead.verdict !== "reject") {
    blockers.push(`${lead.company}: cas faible non bloque.`);
  }
  if (!lead.rejectionReason && lead.verdict === "reject") {
    blockers.push(`${lead.company}: rejet sans raison.`);
  }
  return blockers;
}

function hasSourcedObservedInsights(lead: ScoutLead): boolean {
  const insights = lead.insights ?? {
    observed: lead.observedSignals.map((signal, index) => ({
      text: signal,
      evidenceId: lead.evidence[index]?.id ?? lead.evidence[index]?.url ?? ""
    })),
    inferred: lead.painHypotheses,
    uncertain: []
  };
  const evidenceKeys = new Set(lead.evidence.flatMap((proof) => [proof.id, proof.url]).filter(Boolean));
  return insights.observed.length > 0 && insights.observed.every((item) => item.evidenceId && evidenceKeys.has(item.evidenceId));
}

function messageLooksGeneric(message: string): boolean {
  const value = message.toLowerCase();
  if (value.includes("brouillon blo")) return false;
  return (
    value.includes("comme la votre") ||
    value.includes("comme la vôtre") ||
    value.includes("avec l'ia") ||
    value.includes("automatiser votre business")
  );
}

function renderReport(
  runs: EvaluatedRun[],
  globalScore: number,
  fixtureVerdict: RunVerdict,
  blockers: string[],
  realEvidence: RealRunnerEvidence[],
  feedbackEvidence: FeedbackLoopEvidence | null,
  persistEvidence: CliPersistEvidence | null,
  cronEvidence: AgentTaskCronEvidence | null,
  consoleEvidence: SupabaseConsoleEvidence,
  providerEvidence: ProviderComparisonEvidence | null,
  currentRevision: string
): string {
  const lines = [
    "# Rapport qualite BM Scout - socle fixture",
    "",
    `Decision produit BM Scout V1 : ${productReadiness}`,
    `Verdict socle fixture : ${fixtureVerdict === "pass" ? "ok" : "pas ok"}`,
    `Score socle fixture : ${globalScore}/100`,
    "",
    readinessMode
      ? "Ce rapport valide le socle fixture et les preuves runtime disponibles."
      : "Ce rapport valide uniquement les fixtures locales et affiche les preuves runtime disponibles.",
    `Révision code courante : ${currentRevision}`,
    "",
    "## Blockers produit restants",
    "",
    ...productBlockers.map((blocker) => `- ${blocker}`),
    "",
    "## Evidence runner reel",
    "",
    ...(realEvidence.length
      ? realEvidence.map(
          (item) =>
            [
              `- ${item.name} : ${item.verdict}`,
              `trace : ${item.traceId}`,
              `scannés : ${item.scannedCount}`,
              `leads retenus : ${item.keptCount}`,
              `rejetes : ${item.rejectedCount}`,
              `lessons : ${item.lessonCount}`,
              `mémoire : ${item.memorySource}`,
              `provider runtime : ${item.runtimeProvider}`,
              `feedbacks mémoire : ${item.feedbackEventCount}`,
              `DNC mémoire : ${item.doNotContactEventCount}`,
              `impacts feedback : ${item.feedbackImpactCount}`,
              `score : ${item.feedbackScoreChangedCount}`,
              `bloqués : ${item.feedbackBlockedCount}`,
              `message régénéré : ${item.feedbackMessageRegeneratedCount}`,
              `angle renforcé : ${item.feedbackAngleReinforcedCount}`,
              `persist artefact : ${item.persistComplete ? "oui" : "non"}`,
              `feedback learning : ${item.learningUsesFeedback ? "oui" : "non"}`,
              `runtime metadata : ${item.runtimeMetadataComplete ? "oui" : "non"}`,
              `modèle : ${item.runtimeModel}`,
              `révision : ${item.runtimeCodeRevision}`,
              `révision courante : ${item.runtimeRevisionMatchesCurrent ? "oui" : "non"}`,
              `durée : ${item.runtimeDurationMs}ms`
            ].join("; ")
        )
      : ["- Aucun artefact réel détecté dans `artifacts/agent-worker-real/`."]),
    "",
    "## Evidence feedback loop Supabase",
    "",
    feedbackEvidence
      ? [
          `- Feedback loop : ${feedbackEvidence.verdict}`,
          `trace : ${feedbackEvidence.traceId ?? "aucune"}`,
          `provider runtime : ${feedbackEvidence.runtimeProvider}`,
          `impacts : ${feedbackEvidence.feedbackImpactCount}`,
          `score : ${feedbackEvidence.feedbackScoreChangedCount}`,
          `bloqués : ${feedbackEvidence.feedbackBlockedCount}`,
          `DNC bloqués : ${feedbackEvidence.feedbackDncBlockedCount}`,
          `message régénéré : ${feedbackEvidence.feedbackMessageRegeneratedCount}`,
          `angle renforcé : ${feedbackEvidence.feedbackAngleReinforcedCount}`,
          `lessons : ${feedbackEvidence.lessonCount}`,
          `learning feedback : ${feedbackEvidence.learningUsesFeedback ? "oui" : "non"}`,
          `runtime metadata : ${feedbackEvidence.runtimeMetadataComplete ? "oui" : "non"}`,
          `révision : ${feedbackEvidence.codeRevision}`,
          `révision courante : ${feedbackEvidence.runtimeRevisionMatchesCurrent ? "oui" : "non"}`
        ].join("; ")
      : "- Aucune preuve `feedback:evidence` détectée dans `artifacts/feedback-loop/`.",
    ...(feedbackEvidence?.blockers.length ? feedbackEvidence.blockers.map((blocker) => `- Blocker feedback loop : ${blocker}`) : []),
    "",
    "## Evidence Supabase runtime",
    "",
    persistEvidence
      ? `- CLI --persist : ${persistEvidence.verdict}; trace : ${persistEvidence.traceId}; artefact : ${persistEvidence.sourceFile}; persist artefact : ${persistEvidence.persistComplete ? "oui" : "non"}`
      : "- CLI --persist : aucune preuve locale.",
    cronEvidence
      ? `- Cron agent_tasks : ${cronEvidence.verdict}; source : ${cronEvidence.source}; mode : ${cronEvidence.mode}; artefact : ${cronEvidence.sourceFile}; due : ${cronEvidence.dueCount}; processed : ${cronEvidence.processedCount}; completed : ${cronEvidence.completedCount}; révision : ${cronEvidence.codeRevision}; révision courante : ${cronEvidence.runtimeRevisionMatchesCurrent ? "oui" : "non"}`
      : "- Cron agent_tasks : aucune preuve GitHub Actions.",
    ...(cronEvidence?.blockers.length ? cronEvidence.blockers.map((blocker) => `- Blocker cron : ${blocker}`) : []),
    `- Console serveur Supabase : ${consoleEvidence.verdict}; source : ${consoleEvidence.source}; artefact : ${consoleEvidence.sourceFile ?? "live"}; runs : ${consoleEvidence.runCount}; leads : ${consoleEvidence.leadCount}; rejetes : ${consoleEvidence.rejectedCount}; lessons : ${consoleEvidence.lessonCount}`,
    `- Console runtime : metadata ${consoleEvidence.runtimeMetadataComplete ? "oui" : "non"}; révision ${consoleEvidence.codeRevision}; révision courante ${consoleEvidence.runtimeRevisionMatchesCurrent ? "oui" : "non"}; actions : ${consoleEvidence.actionEventCount}`,
    `- Supabase RPC dedupe : ${consoleEvidence.persistenceDedupeVerified ? "oui" : "non"}; companies : ${consoleEvidence.persistenceDedupeCompanyCount}; mode conservé : ${consoleEvidence.persistenceDedupeRetainedMode ?? "absent"}; run steps merged : ${consoleEvidence.persistenceDedupeRunStepCount}; cleanup companies/runs : ${consoleEvidence.persistenceDedupeCleanupRemainingCompanies}/${consoleEvidence.persistenceDedupeCleanupRemainingRuns}`,
    consoleEvidence.traces.length ? `- Traces console : ${consoleEvidence.traces.join(", ")}` : "- Traces console : aucune.",
    ...(consoleEvidence.error ? [`- Erreur console : ${consoleEvidence.error}`] : []),
    ...(consoleEvidence.blockers.length ? consoleEvidence.blockers.map((blocker) => `- Blocker console : ${blocker}`) : []),
    "",
    "## Evidence providers reels",
    "",
    ...(providerEvidence
      ? [
          `- Comparaison : ${providerEvidence.verdict}; provider recommandé : ${providerEvidence.recommendedDefault ?? "aucun"}; volumes PRD : ${providerEvidence.prdVolumeProven ? "oui" : "non"}`,
          `- Comparaison runtime : metadata ${providerEvidence.runtimeMetadataComplete ? "oui" : "non"}; révision ${providerEvidence.codeRevision}; révision courante ${providerEvidence.runtimeRevisionMatchesCurrent ? "oui" : "non"}`,
          `- Providers testés : ${providerEvidence.providers.join(", ")}`,
          `- Modes testés : ${providerEvidence.modes.join(", ")}`,
          ...(providerEvidence.blockers.length ? providerEvidence.blockers.map((blocker) => `- Blocker provider : ${blocker}`) : ["- Blocker provider : aucun"])
        ]
      : ["- Aucune comparaison provider détectée dans `artifacts/provider-comparison/latest-comparison.json`."]),
    "",
    "## Synthese des runs",
    "",
    ...runs.flatMap((item) => [
      `### ${item.name}`,
      "",
      `- Verdict : ${item.verdict}`,
      `- Score : ${item.score}/100`,
      `- Comptes retenus : ${item.run.keptCount}`,
      `- Comptes ecartes : ${item.run.rejectedCount}`,
      `- Trace : ${item.run.traceId}`,
      `- Blockers : ${item.blockers.length ? item.blockers.join("; ") : "aucun"}`,
      ""
    ]),
    "## Exemples d'outputs",
    "",
    ...runs
      .flatMap((item) => item.run.leads)
      .slice(0, 3)
      .flatMap((lead) => [
        `### ${lead.company}`,
        "",
        `- Signal : ${lead.observedSignals[0] ?? "absent"}`,
        `- Hypothese : ${lead.painHypotheses[0] ?? "absente"}`,
        `- Score : ${lead.score} - ${lead.scoreJustification}`,
        `- Action : ${lead.nextAction}`,
        `- QC : ${lead.qualityDecision}`,
        ""
      ]),
    "## Blockers globaux",
    "",
    blockers.length ? blockers.map((blocker) => `- ${blocker}`).join("\n") : "- Aucun blocker.",
    "",
    "## Limites restantes",
    "",
    "- Les fixtures locales restent utiles comme harnais rapide, mais ne suffisent jamais seules a declarer le produit pret.",
    "- Les runners OpenAI Agents SDK Core et Exploration sont verifies via artefacts reels quand les preuves sont presentes.",
    "- Supabase sert de memoire runtime pour runs, feedbacks, outcomes, do-not-contact, QC, learning et run steps.",
    "- La persistance worker passe par la RPC transactionnelle `scout_persist_mission_output`, avec email confidence et Observé/Inféré/Incertain.",
    "- La validation humaine d'Arthur/Romu reste obligatoire sur les messages et la qualite commerciale."
  ];
  return lines.join("\n");
}

interface RealRunnerEvidence {
  name: string;
  verdict: RunVerdict;
  traceId: string;
  mode: "core" | "exploration";
  keptCount: number;
  scannedCount: number;
  rejectedCount: number;
  lessonCount: number;
  finalDecision: "ready" | "not_ready";
  sourceFile: string;
  learningUsesFeedback: boolean;
  memorySource: string;
  runtimeProvider: string;
  feedbackEventCount: number;
  doNotContactEventCount: number;
  feedbackImpactCount: number;
  feedbackScoreChangedCount: number;
  feedbackBlockedCount: number;
  feedbackDncBlockedCount: number;
  feedbackMessageRegeneratedCount: number;
  feedbackAngleReinforcedCount: number;
  feedbackSegmentDeltaCount: number;
  persistComplete: boolean;
  runtimeMetadataComplete: boolean;
  runtimeRevisionMatchesCurrent: boolean;
  runtimeCodeRevision: string;
  runtimeDurationMs: number;
  runtimeModel: string;
}

async function loadRealRunnerEvidence(currentRevision: string): Promise<RealRunnerEvidence[]> {
  const targets = [
    { name: "Core reel Supabase persist", file: "latest-real-core-supabase-persist.json" },
    { name: "Exploration reelle Supabase persist", file: "latest-real-exploration-supabase-persist.json" },
    { name: "Core reel", file: "latest-real-core.json" },
    { name: "Exploration reelle", file: "latest-real-exploration.json" }
  ];
  const evidence: RealRunnerEvidence[] = [];
  for (const target of targets) {
    const path = join(process.cwd(), "artifacts", "agent-worker-real", target.file);
    if (!existsSync(path)) continue;
    const payload = JSON.parse(await readFile(path, "utf8")) as {
      verdict?: RunVerdict;
      output?: {
        trace_id?: string;
        mode?: "core" | "exploration";
        kept_count?: number;
        scanned_count?: number;
        rejected_count?: number;
        lessons?: { lesson?: string; recommendation?: string; source?: string }[];
        final_decision?: "ready" | "not_ready";
        run_steps?: RunnerStepEvidence[];
      };
    };
    if (!payload.output?.trace_id) continue;
    const lessons = payload.output.lessons ?? [];
    const lessonCount = lessons.length;
    const memory = analyzeRunnerSteps(payload.output.run_steps ?? [], currentRevision);
    evidence.push({
      name: target.name,
      verdict: payload.verdict === "pass" ? "pass" : "fail",
      traceId: payload.output.trace_id,
      mode: payload.output.mode ?? (target.name.toLowerCase().includes("exploration") ? "exploration" : "core"),
      keptCount: payload.output.kept_count ?? 0,
      scannedCount: payload.output.scanned_count ?? 0,
      rejectedCount: payload.output.rejected_count ?? 0,
      lessonCount,
      finalDecision: payload.output.final_decision ?? "not_ready",
      sourceFile: target.file,
      learningUsesFeedback: learningUsesFeedback(lessons),
      memorySource: memory.source,
      runtimeProvider: memory.runtimeProvider,
      feedbackEventCount: memory.feedbackEventCount,
      doNotContactEventCount: memory.doNotContactEventCount,
      feedbackImpactCount: memory.feedbackImpactCount,
      feedbackScoreChangedCount: memory.feedbackScoreChangedCount,
      feedbackBlockedCount: memory.feedbackBlockedCount,
      feedbackDncBlockedCount: memory.feedbackDncBlockedCount,
      feedbackMessageRegeneratedCount: memory.feedbackMessageRegeneratedCount,
      feedbackAngleReinforcedCount: memory.feedbackAngleReinforcedCount,
      feedbackSegmentDeltaCount: memory.feedbackSegmentDeltaCount,
      persistComplete: memory.persistComplete,
      runtimeMetadataComplete: memory.runtimeMetadataComplete,
      runtimeRevisionMatchesCurrent: memory.runtimeRevisionMatchesCurrent,
      runtimeCodeRevision: memory.runtimeCodeRevision,
      runtimeDurationMs: memory.runtimeDurationMs,
      runtimeModel: memory.runtimeModel
    });
  }
  return evidence;
}

function learningUsesFeedback(lessons: { lesson?: string; recommendation?: string; source?: string }[]): boolean {
  if (lessons.length < 3 || lessons.length > 5) return false;
  const text = lessons
    .flatMap((lesson) => [lesson.lesson, lesson.recommendation, lesson.source])
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return text.includes("feedback romu") && text.includes("do-not-contact");
}

interface FeedbackLoopEvidence {
  verdict: RunVerdict;
  sourceFile: string;
  traceId: string | null;
  runtimeProvider: string;
  feedbackImpactCount: number;
  feedbackScoreChangedCount: number;
  feedbackBlockedCount: number;
  feedbackDncBlockedCount: number;
  feedbackMessageRegeneratedCount: number;
  feedbackAngleReinforcedCount: number;
  lessonCount: number;
  learningUsesFeedback: boolean;
  blockers: string[];
  codeRevision: string;
  runtimeMetadataComplete: boolean;
  runtimeRevisionMatchesCurrent: boolean;
}

async function loadFeedbackLoopEvidence(currentRevision: string): Promise<FeedbackLoopEvidence | null> {
  const sourceFile = "latest-feedback-loop.json";
  const path = join(process.cwd(), "artifacts", "feedback-loop", sourceFile);
  if (!existsSync(path)) return null;
  const payload = JSON.parse(await readFile(path, "utf8")) as {
    status?: RunVerdict;
    generated_at?: string;
    code_revision?: string;
    trace_id?: string | null;
    runtime_provider?: string;
    feedback_impact_count?: number;
    feedback_score_changed_count?: number;
    feedback_blocked_count?: number;
    feedback_dnc_blocked_count?: number;
    feedback_message_regenerated_count?: number;
    feedback_angle_reinforced_count?: number;
    lesson_count?: number;
    learning_uses_feedback?: boolean;
    blockers?: string[];
  };
  const codeRevision = typeof payload.code_revision === "string" ? payload.code_revision.trim() : "";
  const runtimeProvider = typeof payload.runtime_provider === "string" ? payload.runtime_provider.trim() : "";
  const runtimeMetadataComplete = Boolean(payload.generated_at && codeRevision && runtimeProvider && runtimeProvider !== "unknown" && payload.trace_id);
  return {
    verdict: payload.status === "pass" ? "pass" : "fail",
    sourceFile,
    traceId: payload.trace_id ?? null,
    runtimeProvider: runtimeProvider || "unknown",
    feedbackImpactCount: numberValue(payload.feedback_impact_count),
    feedbackScoreChangedCount: numberValue(payload.feedback_score_changed_count),
    feedbackBlockedCount: numberValue(payload.feedback_blocked_count),
    feedbackDncBlockedCount: numberValue(payload.feedback_dnc_blocked_count),
    feedbackMessageRegeneratedCount: numberValue(payload.feedback_message_regenerated_count),
    feedbackAngleReinforcedCount: numberValue(payload.feedback_angle_reinforced_count),
    lessonCount: numberValue(payload.lesson_count),
    learningUsesFeedback: Boolean(payload.learning_uses_feedback),
    blockers: payload.blockers ?? [],
    codeRevision: codeRevision || "unknown",
    runtimeMetadataComplete,
    runtimeRevisionMatchesCurrent: runtimeMetadataComplete && codeRevisionMatchesCurrent(codeRevision, currentRevision)
  };
}

interface CliPersistEvidence {
  verdict: RunVerdict;
  traceId: string;
  sourceFile: string;
  persistComplete: boolean;
}

async function loadCliPersistEvidence(): Promise<CliPersistEvidence | null> {
  const sourceFile = "latest-cli-persist-offline.json";
  const path = join(process.cwd(), "artifacts", "agent-worker-real", sourceFile);
  if (!existsSync(path)) return null;
  const payload = JSON.parse(await readFile(path, "utf8")) as {
    verdict?: RunVerdict;
    output?: { trace_id?: string; run_steps?: RunnerStepEvidence[] };
  };
  if (!payload.output?.trace_id) return null;
  return {
    verdict: payload.verdict === "pass" ? "pass" : "fail",
    traceId: payload.output.trace_id,
    sourceFile,
    persistComplete: analyzeRunnerSteps(payload.output.run_steps ?? [], "unknown").persistComplete
  };
}

interface AgentTaskCronEvidence {
  verdict: RunVerdict;
  sourceFile: string;
  source: string;
  mode: string;
  dueCount: number;
  processedCount: number;
  completedCount: number;
  blockedCount: number;
  failedCount: number;
  recoveredCount: number;
  traceIds: string[];
  blockers: string[];
  runtimeMetadataComplete: boolean;
  runtimeRevisionMatchesCurrent: boolean;
  codeRevision: string;
  error?: string;
}

async function loadAgentTaskCronEvidence(currentRevision: string): Promise<AgentTaskCronEvidence | null> {
  const sourceFile = "latest-ci-run.json";
  const path = join(process.cwd(), "artifacts", "agent-tasks", sourceFile);
  if (!existsSync(path)) return null;
  try {
    const payload = JSON.parse(await readFile(path, "utf8")) as AgentTaskCronArtifactEvidence;
    const analysis = analyzeAgentTaskCronArtifact(payload, currentRevision);
    return {
      verdict: analysis.verdict,
      sourceFile,
      source: analysis.source,
      mode: analysis.mode,
      dueCount: numberValue(payload.dueCount),
      processedCount: numberValue(payload.processedCount),
      completedCount: numberValue(payload.completedCount),
      blockedCount: numberValue(payload.blockedCount),
      failedCount: numberValue(payload.failedCount),
      recoveredCount: numberValue(payload.recoveredCount),
      traceIds: analysis.traceIds,
      blockers: analysis.blockers,
      runtimeMetadataComplete: analysis.runtimeMetadataComplete,
      runtimeRevisionMatchesCurrent: analysis.runtimeRevisionMatchesCurrent,
      codeRevision: analysis.codeRevision,
      error: payload.error
    };
  } catch (error) {
    return {
      verdict: "fail",
      sourceFile,
      source: "artifact",
      mode: "unknown",
      dueCount: 0,
      processedCount: 0,
      completedCount: 0,
      blockedCount: 0,
      failedCount: 0,
      recoveredCount: 0,
      traceIds: [],
      blockers: [],
      runtimeMetadataComplete: false,
      runtimeRevisionMatchesCurrent: false,
      codeRevision: "unknown",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

interface SupabaseConsoleEvidence {
  verdict: RunVerdict;
  source: "live" | "artifact" | "missing";
  sourceFile?: string;
  runCount: number;
  leadCount: number;
  rejectedCount: number;
  lessonCount: number;
  taskCount: number;
  feedbackCount: number;
  outcomeCount: number;
  dncCount: number;
  runStepCount: number;
  actionEventCount: number;
  persistenceDedupeVerified: boolean;
  persistenceDedupeCompanyCount: number;
  persistenceDedupeRetainedMode: string | null;
  persistenceDedupeRunStepCount: number;
  persistenceDedupeCleanupRemainingCompanies: number;
  persistenceDedupeCleanupRemainingRuns: number;
  traces: string[];
  blockers: string[];
  runtimeMetadataComplete: boolean;
  runtimeRevisionMatchesCurrent: boolean;
  codeRevision: string;
  error?: string;
}

interface ProviderComparisonEvidence {
  verdict: RunVerdict;
  providers: string[];
  modes: string[];
  recommendedDefault: string | null;
  prdVolumeProven: boolean;
  blockers: string[];
  sourceFile: string;
  codeRevision: string;
  runtimeMetadataComplete: boolean;
  runtimeRevisionMatchesCurrent: boolean;
}

async function loadProviderComparisonEvidence(currentRevision: string): Promise<ProviderComparisonEvidence | null> {
  const sourceFile = "latest-comparison.json";
  const path = join(process.cwd(), "artifacts", "provider-comparison", sourceFile);
  if (!existsSync(path)) return null;
  const payload = JSON.parse(await readFile(path, "utf8")) as {
    verdict?: RunVerdict;
    providers?: string[];
    modes?: string[];
    recommended_default?: string | null;
    prd_volume_proven?: boolean;
    blockers?: string[];
    code_revision?: string;
    generated_at?: string;
    python_version?: string;
    openai_sdk_version?: string;
  };
  const codeRevision = typeof payload.code_revision === "string" ? payload.code_revision.trim() : "";
  const openaiSdkVersion = typeof payload.openai_sdk_version === "string" ? payload.openai_sdk_version.trim() : "";
  const runtimeMetadataComplete = Boolean(payload.generated_at && payload.python_version && openaiSdkVersion && openaiSdkVersion !== "unknown" && codeRevision);
  return {
    verdict: payload.verdict === "pass" ? "pass" : "fail",
    providers: payload.providers ?? [],
    modes: payload.modes ?? [],
    recommendedDefault: payload.recommended_default ?? null,
    prdVolumeProven: Boolean(payload.prd_volume_proven),
    blockers: payload.blockers ?? [],
    sourceFile,
    codeRevision: codeRevision || "unknown",
    runtimeMetadataComplete,
    runtimeRevisionMatchesCurrent: runtimeMetadataComplete && codeRevisionMatchesCurrent(codeRevision, currentRevision)
  };
}

async function loadSupabaseConsoleEvidence(currentRevision: string): Promise<SupabaseConsoleEvidence> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const artifact = await loadSupabaseRuntimeArtifact(currentRevision);
    if (artifact) return artifact;
    return {
      verdict: "fail",
      source: "missing",
      runCount: 0,
      leadCount: 0,
      rejectedCount: 0,
      lessonCount: 0,
      taskCount: 0,
      feedbackCount: 0,
      outcomeCount: 0,
      dncCount: 0,
      runStepCount: 0,
      actionEventCount: 0,
      persistenceDedupeVerified: false,
      persistenceDedupeCompanyCount: 0,
      persistenceDedupeRetainedMode: null,
      persistenceDedupeRunStepCount: 0,
      persistenceDedupeCleanupRemainingCompanies: 0,
      persistenceDedupeCleanupRemainingRuns: 0,
      traces: [],
      blockers: [],
      runtimeMetadataComplete: false,
      runtimeRevisionMatchesCurrent: false,
      codeRevision: "unknown",
      error: "NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquante"
    };
  }

  try {
    const snapshot = await getScoutSnapshot();
    const client = createServerSupabaseClient();
    if (!client) throw new Error("Client Supabase serveur indisponible malgré les variables requises.");
    const [taskCount, feedbackCount, outcomeCount, dncCount, runStepCount, actionEventCount] = await Promise.all([
      tableCount(client, "scout_agent_tasks"),
      tableCount(client, "scout_feedback"),
      tableCount(client, "scout_outcomes"),
      tableCount(client, "scout_do_not_contact"),
      tableCount(client, "scout_run_steps"),
      tableCount(client, "scout_action_events")
    ]);
    const leadCount = snapshot.runs.reduce((sum, run) => sum + run.leads.length, 0);
    const rejectedCount = snapshot.runs.reduce((sum, run) => sum + run.rejected.length, 0);
    const lessonCount = snapshot.lessons.length;
    const traces = snapshot.runs.map((run) => run.traceId).filter(Boolean);
    const persistenceDedupe = await verifySupabasePersistenceDedupe(client);
    const payload: SupabaseRuntimeArtifactEvidence = {
      status:
        snapshot.runs.length > 0 &&
        Boolean(snapshot.primaryLead) &&
        leadCount > 0 &&
        rejectedCount > 0 &&
        lessonCount >= 3 &&
        taskCount > 0 &&
        feedbackCount > 0 &&
        outcomeCount > 0 &&
        dncCount > 0 &&
        runStepCount > 0 &&
        actionEventCount > 0 &&
        persistenceDedupe.verified &&
        traces.length > 0
          ? "pass"
          : "fail",
      source: "supabase_live",
      generated_at: new Date().toISOString(),
      code_revision: currentRevision,
      runCount: snapshot.runs.length,
      leadCount,
      rejectedCount,
      lessonCount,
      taskCount,
      feedbackCount,
      outcomeCount,
      dncCount,
      runStepCount,
      actionEventCount,
      persistenceDedupeVerified: persistenceDedupe.verified,
      persistenceDedupeCompanyCount: persistenceDedupe.companyCount,
      persistenceDedupeRetainedMode: persistenceDedupe.retainedMode,
      persistenceDedupeRunStepCount: persistenceDedupe.mergedRunStepCount,
      persistenceDedupeCleanupRemainingCompanies: persistenceDedupe.cleanupRemainingCompanies,
      persistenceDedupeCleanupRemainingRuns: persistenceDedupe.cleanupRemainingRuns,
      persistenceDedupeTraceIds: persistenceDedupe.traceIds,
      traces,
      blockers: [
        ...(snapshot.runs.length < 1 ? ["Aucun run Supabase lisible par la console."] : []),
        ...(!snapshot.primaryLead ? ["Aucun lead prioritaire lisible par la console."] : []),
        ...(leadCount < 1 ? ["Aucun lead actionnable lisible par la console."] : []),
        ...(rejectedCount < 1 ? ["Aucun rejet/QC visible dans la console."] : []),
        ...(lessonCount < 3 ? ["Moins de 3 apprentissages visibles dans la console."] : []),
        ...(taskCount < 1 ? ["Aucune tâche agent_tasks persistée."] : []),
        ...(feedbackCount < 1 ? ["Aucun feedback Romu persisté."] : []),
        ...(outcomeCount < 1 ? ["Aucun outcome persisté."] : []),
        ...(dncCount < 1 ? ["Aucun do-not-contact persisté."] : []),
        ...(runStepCount < 1 ? ["Aucun run step agentique persisté."] : []),
        ...(actionEventCount < 1 ? ["Aucune trace d'action Romu persistée."] : []),
        ...persistenceDedupe.blockers,
        ...(traces.length < 1 ? ["Aucune trace de run Supabase disponible."] : [])
      ]
    };
    const analysis = analyzeSupabaseRuntimeArtifact(payload, currentRevision);
    return {
      verdict: analysis.verdict,
      source: "live",
      runCount: snapshot.runs.length,
      leadCount,
      rejectedCount,
      lessonCount,
      taskCount,
      feedbackCount,
      outcomeCount,
      dncCount,
      runStepCount,
      actionEventCount,
      persistenceDedupeVerified: persistenceDedupe.verified,
      persistenceDedupeCompanyCount: persistenceDedupe.companyCount,
      persistenceDedupeRetainedMode: persistenceDedupe.retainedMode,
      persistenceDedupeRunStepCount: persistenceDedupe.mergedRunStepCount,
      persistenceDedupeCleanupRemainingCompanies: persistenceDedupe.cleanupRemainingCompanies,
      persistenceDedupeCleanupRemainingRuns: persistenceDedupe.cleanupRemainingRuns,
      traces,
      blockers: analysis.blockers,
      runtimeMetadataComplete: analysis.runtimeMetadataComplete,
      runtimeRevisionMatchesCurrent: analysis.runtimeRevisionMatchesCurrent,
      codeRevision: analysis.codeRevision
    };
  } catch (error) {
    return {
      verdict: "fail",
      source: "live",
      runCount: 0,
      leadCount: 0,
      rejectedCount: 0,
      lessonCount: 0,
      taskCount: 0,
      feedbackCount: 0,
      outcomeCount: 0,
      dncCount: 0,
      runStepCount: 0,
      actionEventCount: 0,
      persistenceDedupeVerified: false,
      persistenceDedupeCompanyCount: 0,
      persistenceDedupeRetainedMode: null,
      persistenceDedupeRunStepCount: 0,
      persistenceDedupeCleanupRemainingCompanies: 0,
      persistenceDedupeCleanupRemainingRuns: 0,
      traces: [],
      blockers: [],
      runtimeMetadataComplete: false,
      runtimeRevisionMatchesCurrent: false,
      codeRevision: currentRevision,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function loadSupabaseRuntimeArtifact(currentRevision: string): Promise<SupabaseConsoleEvidence | null> {
  const sourceFile = "latest-verify.json";
  const path = join(process.cwd(), "artifacts", "supabase-runtime", sourceFile);
  if (!existsSync(path)) return null;
  try {
    const payload = JSON.parse(await readFile(path, "utf8")) as SupabaseRuntimeArtifactEvidence;
    const analysis = analyzeSupabaseRuntimeArtifact(payload, currentRevision);
    return {
      verdict: analysis.verdict,
      source: "artifact",
      sourceFile,
      runCount: numberValue(payload.runCount),
      leadCount: numberValue(payload.leadCount),
      rejectedCount: numberValue(payload.rejectedCount),
      lessonCount: numberValue(payload.lessonCount),
      taskCount: numberValue(payload.taskCount),
      feedbackCount: numberValue(payload.feedbackCount),
      outcomeCount: numberValue(payload.outcomeCount),
      dncCount: numberValue(payload.dncCount),
      runStepCount: numberValue(payload.runStepCount),
      actionEventCount: numberValue(payload.actionEventCount),
      persistenceDedupeVerified: payload.persistenceDedupeVerified === true,
      persistenceDedupeCompanyCount: numberValue(payload.persistenceDedupeCompanyCount),
      persistenceDedupeRetainedMode: typeof payload.persistenceDedupeRetainedMode === "string" ? payload.persistenceDedupeRetainedMode : null,
      persistenceDedupeRunStepCount: numberValue(payload.persistenceDedupeRunStepCount),
      persistenceDedupeCleanupRemainingCompanies: numberValue(payload.persistenceDedupeCleanupRemainingCompanies),
      persistenceDedupeCleanupRemainingRuns: numberValue(payload.persistenceDedupeCleanupRemainingRuns),
      traces: analysis.traces,
      blockers: analysis.blockers,
      runtimeMetadataComplete: analysis.runtimeMetadataComplete,
      runtimeRevisionMatchesCurrent: analysis.runtimeRevisionMatchesCurrent,
      codeRevision: analysis.codeRevision,
      error: payload.error
    };
  } catch (error) {
    return {
      verdict: "fail",
      source: "artifact",
      sourceFile,
      runCount: 0,
      leadCount: 0,
      rejectedCount: 0,
      lessonCount: 0,
      taskCount: 0,
      feedbackCount: 0,
      outcomeCount: 0,
      dncCount: 0,
      runStepCount: 0,
      actionEventCount: 0,
      persistenceDedupeVerified: false,
      persistenceDedupeCompanyCount: 0,
      persistenceDedupeRetainedMode: null,
      persistenceDedupeRunStepCount: 0,
      persistenceDedupeCleanupRemainingCompanies: 0,
      persistenceDedupeCleanupRemainingRuns: 0,
      traces: [],
      blockers: [],
      runtimeMetadataComplete: false,
      runtimeRevisionMatchesCurrent: false,
      codeRevision: "unknown",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function resolveCurrentCodeRevision(): Promise<string> {
  const configured = process.env.BM_SCOUT_CODE_REVISION ?? process.env.GITHUB_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA;
  if (configured?.trim()) return configured.trim();
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      timeout: 2000
    });
    const revision = stdout.trim();
    if (!revision) return "unknown";
    const { stdout: status } = await execFileAsync("git", ["status", "--porcelain"], {
      cwd: process.cwd(),
      timeout: 2000
    });
    return status.trim() ? `${revision}-dirty` : revision;
  } catch {
    return "unknown";
  }
}

function buildProductBlockers(
  realEvidence: RealRunnerEvidence[],
  feedbackEvidence: FeedbackLoopEvidence | null,
  persistEvidence: CliPersistEvidence | null,
  cronEvidence: AgentTaskCronEvidence | null,
  consoleEvidence: SupabaseConsoleEvidence,
  providerEvidence: ProviderComparisonEvidence | null
): string[] {
  const blockers: string[] = [];
  const eligibleRealEvidence = realEvidence.filter(
    (item) => item.verdict === "pass" && item.runtimeMetadataComplete && item.runtimeRevisionMatchesCurrent
  );
  const eligibleOperationalEvidence = eligibleRealEvidence.filter((item) => isOperationalResearchProvider(item.runtimeProvider));
  const hasCore = eligibleOperationalEvidence.some((item) => item.mode === "core" && item.finalDecision === "ready");
  const hasExploration = eligibleOperationalEvidence.some((item) => item.mode === "exploration" && item.finalDecision === "ready");
  const hasCoreVolume = eligibleOperationalEvidence.some((item) => item.mode === "core" && item.scannedCount >= 15);
  const hasExplorationVolume = eligibleOperationalEvidence.some((item) => item.mode === "exploration" && item.scannedCount >= 100);
  const hasSupabaseCore = eligibleOperationalEvidence.some((item) => item.mode === "core" && item.sourceFile.includes("supabase-persist"));
  const hasSupabaseExploration = eligibleOperationalEvidence.some((item) => item.mode === "exploration" && item.sourceFile.includes("supabase-persist"));
  const feedbackEvidenceEligible = Boolean(
    feedbackEvidence?.verdict === "pass" &&
      feedbackEvidence.runtimeMetadataComplete &&
      feedbackEvidence.runtimeRevisionMatchesCurrent &&
      feedbackEvidence.learningUsesFeedback &&
      feedbackEvidence.feedbackImpactCount > 0 &&
      hasCausalFeedbackEvidence(feedbackEvidence)
  );
  const hasLearningFromFeedback =
    feedbackEvidenceEligible ||
    eligibleRealEvidence.some(
      (item) =>
        item.mode === "core" &&
        item.sourceFile.includes("supabase-persist") &&
        item.memorySource === "supabase" &&
        item.feedbackEventCount > 0 &&
        item.doNotContactEventCount > 0 &&
        item.feedbackImpactCount > 0 &&
        (item.feedbackScoreChangedCount > 0 ||
          item.feedbackBlockedCount > 0 ||
          item.feedbackMessageRegeneratedCount > 0 ||
          item.feedbackAngleReinforcedCount > 0) &&
        item.learningUsesFeedback
    );
  const cronEligible = Boolean(cronEvidence?.verdict === "pass" && cronEvidence.runtimeMetadataComplete && cronEvidence.runtimeRevisionMatchesCurrent);
  if (!cronEligible) {
    blockers.push("production_not_ready: le runner agent_tasks et le cron GitHub Actions existent, mais aucun run CI avec secrets ne les prouve encore.");
  }
  if (cronEvidence?.verdict === "pass" && !cronEvidence.runtimeMetadataComplete) {
    blockers.push("Cron agent_tasks sans métadonnées GitHub Actions/secrets/runtime auditables.");
  }
  if (cronEvidence?.verdict === "pass" && cronEvidence.runtimeMetadataComplete && !cronEvidence.runtimeRevisionMatchesCurrent) {
    blockers.push(`Cron agent_tasks généré par la révision ${cronEvidence.codeRevision}, différente du code courant.`);
  }
  const providerModes = new Set(providerEvidence?.modes ?? []);
  const hasFullProviderScope = providerModes.has("core") && providerModes.has("exploration");
  const providerRuntimeEligible = Boolean(providerEvidence?.runtimeMetadataComplete && providerEvidence.runtimeRevisionMatchesCurrent);
  if (
    !providerEvidence ||
    providerEvidence.verdict !== "pass" ||
    !providerRuntimeEligible ||
    !providerEvidence.recommendedDefault ||
    !providerEvidence.prdVolumeProven ||
    !hasFullProviderScope
  ) {
    blockers.push("production_not_ready: aucun provider réel ne prouve encore Core + Exploration à volume PRD.");
  }
  if (providerEvidence?.verdict === "pass" && !providerEvidence.runtimeMetadataComplete) {
    blockers.push("Comparaison provider réelle sans métadonnées runtime auditables.");
  }
  if (providerEvidence?.verdict === "pass" && providerEvidence.runtimeMetadataComplete && !providerEvidence.runtimeRevisionMatchesCurrent) {
    blockers.push(`Comparaison provider générée par la révision ${providerEvidence.codeRevision}, différente du code courant.`);
  }

  if (!hasCore || !hasExploration) {
    blockers.push("Runs OpenAI Agents SDK réels Core et Exploration incomplets avec provider marché non configuré.");
  }
  if (!hasCoreVolume || !hasExplorationVolume) {
    blockers.push("Runs OpenAI Agents SDK réels sans volumes PRD prouvés par provider marché : Core >= 15 scannés et Exploration >= 100 scannés requis.");
  }
  for (const evidence of realEvidence.filter((item) => item.verdict === "pass" && !item.runtimeMetadataComplete)) {
    blockers.push(`Run ${evidence.traceId} sans métadonnées runtime auditables.`);
  }
  for (const evidence of realEvidence.filter((item) => item.verdict === "pass" && item.runtimeMetadataComplete && !item.runtimeRevisionMatchesCurrent)) {
    blockers.push(`Run ${evidence.traceId} généré par la révision ${evidence.runtimeCodeRevision}, différente du code courant.`);
  }
  if (!hasSupabaseCore || !hasSupabaseExploration || realEvidence.some((item) => item.sourceFile.includes("supabase-persist") && !item.persistComplete)) {
    blockers.push("Runs Agents SDK réels non prouvés avec persistance Supabase et provider marché.");
  }
  if (feedbackEvidence?.verdict === "pass" && !feedbackEvidence.runtimeMetadataComplete) {
    blockers.push("Preuve feedback:evidence sans métadonnées runtime auditables.");
  }
  if (feedbackEvidence?.verdict === "pass" && feedbackEvidence.runtimeMetadataComplete && !feedbackEvidence.runtimeRevisionMatchesCurrent) {
    blockers.push(`Preuve feedback:evidence générée par la révision ${feedbackEvidence.codeRevision}, différente du code courant.`);
  }
  if (feedbackEvidence?.verdict === "pass" && (!feedbackEvidence.learningUsesFeedback || !hasCausalFeedbackEvidence(feedbackEvidence))) {
    blockers.push("Preuve feedback:evidence sans learning exploitable ou effet causal score/message/blocage/angle.");
  }
  if (!hasLearningFromFeedback) {
    blockers.push("Learning Agent non prouvé avec feedbacks/outcomes Supabase, do-not-contact et impact causal structuré sur lead/message/score.");
  }
  for (const evidence of realEvidence.filter((item) => item.sourceFile.includes("supabase-persist"))) {
    if (!consoleEvidence.traces.includes(evidence.traceId)) {
      blockers.push(`Run ${evidence.traceId} absent de la console Supabase serveur.`);
    }
  }
  if (!persistEvidence || persistEvidence.verdict !== "pass" || !persistEvidence.persistComplete) {
    blockers.push("CLI `--persist` non prouvée avec la RPC Supabase.");
  } else if (!consoleEvidence.traces.includes(persistEvidence.traceId)) {
    blockers.push(`Run CLI --persist ${persistEvidence.traceId} absent de la console Supabase serveur.`);
  }
  if (consoleEvidence.verdict !== "pass") {
    blockers.push(`Console Supabase serveur non prouvée${consoleEvidence.error ? ` : ${consoleEvidence.error}` : "."}`);
  }
  if (consoleEvidence.verdict === "pass" && !consoleEvidence.runtimeMetadataComplete) {
    blockers.push("Console Supabase serveur sans métadonnées runtime auditables.");
  }
  if (consoleEvidence.verdict === "pass" && consoleEvidence.runtimeMetadataComplete && !consoleEvidence.runtimeRevisionMatchesCurrent) {
    blockers.push(`Console Supabase serveur prouvée par la révision ${consoleEvidence.codeRevision}, différente du code courant.`);
  }
  if (!consoleEvidence.persistenceDedupeVerified) {
    blockers.push("RPC Supabase `scout_persist_mission_output` non prouvée avec fusion domaine, priorité Core et cleanup reproductible.");
  }
  return blockers;
}

function hasCausalFeedbackEvidence(evidence: FeedbackLoopEvidence): boolean {
  return (
    evidence.feedbackScoreChangedCount > 0 ||
    evidence.feedbackBlockedCount > 0 ||
    evidence.feedbackMessageRegeneratedCount > 0 ||
    evidence.feedbackAngleReinforcedCount > 0
  );
}

function isOperationalResearchProvider(provider: string): boolean {
  return ["openai_web", "serpapi", "web"].includes(provider.trim().toLowerCase());
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function tableCount(client: NonNullable<ReturnType<typeof createServerSupabaseClient>>, table: string): Promise<number> {
  const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`Comptage ${table} impossible: ${error.message}`);
  return count ?? 0;
}

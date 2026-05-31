import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { runScoutMission, seedFeedbacks } from "../src/domain/scout-engine";
import type { ScoutLead, ScoutRun } from "../src/domain/types";
import { analyzeRunnerSteps, type RunnerStepEvidence } from "../src/server/readiness-evidence";
import { getScoutSnapshot } from "../src/server/scout-repository";

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
const cliPersistEvidence = await loadCliPersistEvidence();
const supabaseConsoleEvidence = await loadSupabaseConsoleEvidence();
const providerComparisonEvidence = await loadProviderComparisonEvidence();
const readinessMode = process.argv.includes("--readiness");
const productBlockers = buildProductBlockers(realRunnerEvidence, cliPersistEvidence, supabaseConsoleEvidence, providerComparisonEvidence);
const productReadiness: ProductReadiness = productBlockers.length === 0 ? "pilot_candidate" : "production_not_ready";

const report = renderReport(
  evaluatedRuns,
  globalScore,
  fixtureVerdict,
  globalBlockers,
  realRunnerEvidence,
  cliPersistEvidence,
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
      cliPersistEvidence,
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
  persistEvidence: CliPersistEvidence | null,
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
              `leads retenus : ${item.keptCount}`,
              `rejetes : ${item.rejectedCount}`,
              `lessons : ${item.lessonCount}`,
              `mémoire : ${item.memorySource}`,
              `DNC mémoire : ${item.doNotContactEventCount}`,
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
    "## Evidence Supabase runtime",
    "",
    persistEvidence
      ? `- CLI --persist : ${persistEvidence.verdict}; trace : ${persistEvidence.traceId}; artefact : ${persistEvidence.sourceFile}; persist artefact : ${persistEvidence.persistComplete ? "oui" : "non"}`
      : "- CLI --persist : aucune preuve locale.",
    `- Console serveur Supabase : ${consoleEvidence.verdict}; runs : ${consoleEvidence.runCount}; leads : ${consoleEvidence.leadCount}; rejetes : ${consoleEvidence.rejectedCount}; lessons : ${consoleEvidence.lessonCount}`,
    consoleEvidence.traces.length ? `- Traces console : ${consoleEvidence.traces.join(", ")}` : "- Traces console : aucune.",
    ...(consoleEvidence.error ? [`- Erreur console : ${consoleEvidence.error}`] : []),
    "",
    "## Evidence providers reels",
    "",
    ...(providerEvidence
      ? [
          `- Comparaison : ${providerEvidence.verdict}; provider recommandé : ${providerEvidence.recommendedDefault ?? "aucun"}; volumes PRD : ${providerEvidence.prdVolumeProven ? "oui" : "non"}`,
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
  rejectedCount: number;
  lessonCount: number;
  finalDecision: "ready" | "not_ready";
  sourceFile: string;
  learningUsesFeedback: boolean;
  memorySource: string;
  doNotContactEventCount: number;
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
      rejectedCount: payload.output.rejected_count ?? 0,
      lessonCount,
      finalDecision: payload.output.final_decision ?? "not_ready",
      sourceFile: target.file,
      learningUsesFeedback: learningUsesFeedback(lessons),
      memorySource: memory.source,
      doNotContactEventCount: memory.doNotContactEventCount,
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

interface SupabaseConsoleEvidence {
  verdict: RunVerdict;
  runCount: number;
  leadCount: number;
  rejectedCount: number;
  lessonCount: number;
  traces: string[];
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
}

async function loadProviderComparisonEvidence(): Promise<ProviderComparisonEvidence | null> {
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
  };
  return {
    verdict: payload.verdict === "pass" ? "pass" : "fail",
    providers: payload.providers ?? [],
    modes: payload.modes ?? [],
    recommendedDefault: payload.recommended_default ?? null,
    prdVolumeProven: Boolean(payload.prd_volume_proven),
    blockers: payload.blockers ?? [],
    sourceFile
  };
}

async function loadSupabaseConsoleEvidence(): Promise<SupabaseConsoleEvidence> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      verdict: "fail",
      runCount: 0,
      leadCount: 0,
      rejectedCount: 0,
      lessonCount: 0,
      traces: [],
      error: "NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquante"
    };
  }

  try {
    const snapshot = await getScoutSnapshot();
    const leadCount = snapshot.runs.reduce((sum, run) => sum + run.leads.length, 0);
    const rejectedCount = snapshot.runs.reduce((sum, run) => sum + run.rejected.length, 0);
    const lessonCount = snapshot.lessons.length;
    const pass = snapshot.runs.length > 0 && Boolean(snapshot.primaryLead) && leadCount > 0 && rejectedCount > 0 && lessonCount >= 3;
    return {
      verdict: pass ? "pass" : "fail",
      runCount: snapshot.runs.length,
      leadCount,
      rejectedCount,
      lessonCount,
      traces: snapshot.runs.map((run) => run.traceId)
    };
  } catch (error) {
    return {
      verdict: "fail",
      runCount: 0,
      leadCount: 0,
      rejectedCount: 0,
      lessonCount: 0,
      traces: [],
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
  persistEvidence: CliPersistEvidence | null,
  consoleEvidence: SupabaseConsoleEvidence,
  providerEvidence: ProviderComparisonEvidence | null
): string[] {
  const blockers: string[] = [];
  const eligibleRealEvidence = realEvidence.filter(
    (item) => item.verdict === "pass" && item.runtimeMetadataComplete && item.runtimeRevisionMatchesCurrent
  );
  const hasCore = eligibleRealEvidence.some((item) => item.mode === "core" && item.finalDecision === "ready");
  const hasExploration = eligibleRealEvidence.some((item) => item.mode === "exploration" && item.finalDecision === "ready");
  const hasSupabaseCore = eligibleRealEvidence.some((item) => item.mode === "core" && item.sourceFile.includes("supabase-persist"));
  const hasSupabaseExploration = eligibleRealEvidence.some((item) => item.mode === "exploration" && item.sourceFile.includes("supabase-persist"));
  const hasLearningFromFeedback = eligibleRealEvidence.some(
    (item) =>
      item.mode === "core" &&
      item.sourceFile.includes("supabase-persist") &&
      item.memorySource === "supabase" &&
      item.doNotContactEventCount > 0 &&
      item.learningUsesFeedback
  );
  blockers.push("production_not_ready: le runner agent_tasks et le cron GitHub Actions existent, mais aucun run CI avec secrets ne les prouve encore.");
  const providerModes = new Set(providerEvidence?.modes ?? []);
  const hasFullProviderScope = providerModes.has("core") && providerModes.has("exploration");
  if (
    !providerEvidence ||
    providerEvidence.verdict !== "pass" ||
    !providerEvidence.recommendedDefault ||
    !providerEvidence.prdVolumeProven ||
    !hasFullProviderScope
  ) {
    blockers.push("production_not_ready: aucun provider réel ne prouve encore Core + Exploration à volume PRD.");
  }

  if (!hasCore || !hasExploration) {
    blockers.push("Runs OpenAI Agents SDK réels Core et Exploration incomplets.");
  }
  for (const evidence of realEvidence.filter((item) => item.verdict === "pass" && !item.runtimeMetadataComplete)) {
    blockers.push(`Run ${evidence.traceId} sans métadonnées runtime auditables.`);
  }
  for (const evidence of realEvidence.filter((item) => item.verdict === "pass" && item.runtimeMetadataComplete && !item.runtimeRevisionMatchesCurrent)) {
    blockers.push(`Run ${evidence.traceId} généré par la révision ${evidence.runtimeCodeRevision}, différente du code courant.`);
  }
  if (!hasSupabaseCore || !hasSupabaseExploration || realEvidence.some((item) => item.sourceFile.includes("supabase-persist") && !item.persistComplete)) {
    blockers.push("Runs Agents SDK réels non prouvés avec persistance Supabase.");
  }
  if (!hasLearningFromFeedback) {
    blockers.push("Learning Agent non prouvé avec feedbacks/outcomes Supabase et do-not-contact.");
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
  return blockers;
}

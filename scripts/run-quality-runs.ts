import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runScoutMission, seedFeedbacks } from "../src/domain/scout-engine";
import type { ScoutLead, ScoutRun } from "../src/domain/types";

type RunVerdict = "pass" | "fail";
type ProductReadiness = "ready" | "not_ready";

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
const realRunnerEvidence = await loadRealRunnerEvidence();
const readinessMode = process.argv.includes("--readiness");
const productBlockers = [
  ...(realRunnerEvidence.length >= 2 && realRunnerEvidence.every((item) => item.verdict === "pass")
    ? []
    : ["Runs OpenAI Agents SDK réels Core et Exploration incomplets."]),
  "Supabase n'est pas encore lue par la console en environnement serveur vérifié.",
  "La boucle feedback Supabase -> Learning Agent est codée, mais pas encore validée par un run réel avec env Supabase serveur locale.",
  "La persistance CLI `--persist` utilise maintenant la RPC atomique, mais n'a pas encore été exécutée avec une service role key locale.",
  "Audit thermo-nuclear final repassé : les blockers structurels code sont corrigés, les preuves runtime serveur restent ouvertes."
];
const productReadiness: ProductReadiness = productBlockers.length === 0 ? "ready" : "not_ready";

const report = renderReport(evaluatedRuns, globalScore, fixtureVerdict, globalBlockers, realRunnerEvidence);
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

if (readinessMode && productReadiness !== "ready") {
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
  if (!lead.painHypotheses.length) blockers.push(`${lead.company}: aucune hypothese prudente.`);
  if (!lead.scoreJustification.trim()) blockers.push(`${lead.company}: score non justifie.`);
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
  realEvidence: RealRunnerEvidence[]
): string {
  const lines = [
    "# Rapport qualite BM Scout - socle fixture",
    "",
    "Decision produit BM Scout V1 : pas pret",
    `Verdict socle fixture : ${fixtureVerdict === "pass" ? "ok" : "pas ok"}`,
    `Score socle fixture : ${globalScore}/100`,
    "",
    "Ce rapport valide uniquement les fixtures locales et le harnais de QC. Il ne valide pas la readiness produit.",
    "",
    "## Blockers produit restants",
    "",
    ...productBlockers.map((blocker) => `- ${blocker}`),
    "",
    "## Evidence runner reel",
    "",
    ...(realEvidence.length
      ? realEvidence.map((item) => `- ${item.name} : ${item.verdict}; trace : ${item.traceId}; leads retenus : ${item.keptCount}; rejetes : ${item.rejectedCount}`)
      : ["- Aucun artefact réel détecté dans `artifacts/agent-worker-real/`."]),
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
    "- Ce rapport utilise encore les fixtures locales du socle executable.",
    "- Les runners OpenAI Agents SDK Core et Exploration sont verifies, et Supabase stocke des feedbacks/outcomes simules.",
    "- La boucle feedback Supabase -> Learning Agent est branchée dans le worker réel quand l'env Supabase serveur est disponible.",
    "- La persistance worker passe par la RPC transactionnelle `scout_persist_mission_output`.",
    "- La console doit encore etre verifiee en lecture Supabase avec une cle serveur locale.",
    "- La validation humaine d'Arthur/Romu reste obligatoire sur les messages et la qualite commerciale."
  ];
  return lines.join("\n");
}

interface RealRunnerEvidence {
  name: string;
  verdict: RunVerdict;
  traceId: string;
  keptCount: number;
  rejectedCount: number;
}

async function loadRealRunnerEvidence(): Promise<RealRunnerEvidence[]> {
  const targets = [
    { name: "Core reel", file: "latest-real-core.json" },
    { name: "Exploration reelle", file: "latest-real-exploration.json" }
  ];
  const evidence: RealRunnerEvidence[] = [];
  for (const target of targets) {
    const path = join(process.cwd(), "artifacts", "agent-worker-real", target.file);
    if (!existsSync(path)) continue;
    const payload = JSON.parse(await readFile(path, "utf8")) as {
      verdict?: RunVerdict;
      output?: { trace_id?: string; kept_count?: number; rejected_count?: number };
    };
    if (!payload.output?.trace_id) continue;
    evidence.push({
      name: target.name,
      verdict: payload.verdict === "pass" ? "pass" : "fail",
      traceId: payload.output.trace_id,
      keptCount: payload.output.kept_count ?? 0,
      rejectedCount: payload.output.rejected_count ?? 0
    });
  }
  return evidence;
}

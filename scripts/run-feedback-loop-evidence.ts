import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  FEEDBACK_LOOP_SCENARIO_COMPANIES,
  analyzeFeedbackLoopEvidence,
  feedbackLoopLearningUsesFeedback,
  feedbackLoopWorkerEnv,
  type FeedbackLoopScenarioCompany
} from "../src/server/feedback-loop-evidence";
import { runWorkerCliForEvidence } from "../src/server/agent-task-runner";
import { createServerSupabaseClient } from "../src/server/supabase";
import { loadLocalEnvFiles } from "../src/server/runtime-env";

const execFileAsync = promisify(execFile);
loadLocalEnvFiles();

const artifactDir = join(process.cwd(), "artifacts", "feedback-loop");
const artifactPath = join(artifactDir, "latest-feedback-loop.json");

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = await runFeedbackLoopEvidence();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === "pass" ? 0 : 1);
}

export async function runFeedbackLoopEvidence() {
  const currentRevision = await resolveCurrentCodeRevision();
  const envBlockers = missingEnvBlockers();
  if (envBlockers.length) {
    return writeArtifact({
      status: "fail" as const,
      generated_at: new Date().toISOString(),
      code_revision: currentRevision,
      seeded_companies: [],
      worker_evidence_file: null,
      trace_id: null,
      runtime_provider: "unknown",
      feedback_impact_count: 0,
      feedback_score_changed_count: 0,
      feedback_blocked_count: 0,
      feedback_dnc_blocked_count: 0,
      dnc_pre_generation_blocked_count: 0,
      feedback_pre_generation_rejected_count: 0,
      feedback_message_regenerated_count: 0,
      feedback_angle_reinforced_count: 0,
      lesson_count: 0,
      learning_uses_feedback: false,
      blockers: envBlockers
    });
  }

  const client = createServerSupabaseClient();
  if (!client) {
    return writeArtifact({
      status: "fail" as const,
      generated_at: new Date().toISOString(),
      code_revision: currentRevision,
      seeded_companies: [],
      worker_evidence_file: null,
      trace_id: null,
      runtime_provider: "unknown",
      feedback_impact_count: 0,
      feedback_score_changed_count: 0,
      feedback_blocked_count: 0,
      feedback_dnc_blocked_count: 0,
      dnc_pre_generation_blocked_count: 0,
      feedback_pre_generation_rejected_count: 0,
      feedback_message_regenerated_count: 0,
      feedback_angle_reinforced_count: 0,
      lesson_count: 0,
      learning_uses_feedback: false,
      blockers: ["Client Supabase serveur indisponible."]
    });
  }

  const seededCompanies = await seedFeedbackLoopMemory(client);
  const worker = await runWorkerCliForEvidence("core", {
    real: true,
    persist: true,
    artifactsDir: "artifacts/agent-worker-real",
    evidenceDir: "artifacts/feedback-loop",
    env: feedbackLoopWorkerEnv()
  });
  const workerSteps = worker.parsed?.output?.run_steps ?? [];
  const lessons = worker.parsed?.output?.lessons ?? [];
  const analysis = analyzeFeedbackLoopEvidence(workerSteps, currentRevision, lessons);
  const workerBlockers = [
    ...(worker.code !== 0 ? [`Worker feedback loop sorti avec code ${worker.code ?? "inconnu"}.`] : []),
    ...(worker.parsed?.verdict !== "pass" ? ["Worker feedback loop sans verdict pass."] : []),
    ...(worker.parsed?.blockers ?? []),
    ...analysis.blockers
  ];

  return writeArtifact({
    status: workerBlockers.length ? ("fail" as const) : ("pass" as const),
    generated_at: new Date().toISOString(),
    code_revision: currentRevision,
    seeded_companies: seededCompanies,
    worker_evidence_file: worker.evidenceFile ?? null,
    trace_id: worker.parsed?.output?.trace_id ?? null,
    runtime_provider: analysis.runtime.runtimeProvider,
    feedback_impact_count: analysis.runtime.feedbackImpactCount,
    feedback_score_changed_count: analysis.runtime.feedbackScoreChangedCount,
    feedback_blocked_count: analysis.runtime.feedbackBlockedCount,
    feedback_dnc_blocked_count: analysis.runtime.feedbackDncBlockedCount,
    dnc_pre_generation_blocked_count: analysis.runtime.dncPreGenerationBlockedCount,
    feedback_pre_generation_rejected_count: analysis.runtime.feedbackPreGenerationRejectedCount,
    feedback_message_regenerated_count: analysis.runtime.feedbackMessageRegeneratedCount,
    feedback_angle_reinforced_count: analysis.runtime.feedbackAngleReinforcedCount,
    lesson_count: lessons.length,
    learning_uses_feedback: feedbackLoopLearningUsesFeedback(lessons),
    blockers: workerBlockers
  });
}

async function seedFeedbackLoopMemory(client: NonNullable<ReturnType<typeof createServerSupabaseClient>>) {
  const seeded: Array<{ external_id: string; company_id: string; name: string }> = [];
  for (const company of FEEDBACK_LOOP_SCENARIO_COMPANIES) {
    const companyId = await upsertScenarioCompany(client, company);
    for (const feedback of company.feedbacks) {
      await upsertFeedback(client, companyId, feedback.kind, feedback.note);
    }
    for (const outcome of company.outcomes ?? []) {
      await upsertOutcome(client, companyId, outcome.outcome, outcome.note);
    }
    if (company.doNotContactReason) {
      await upsertDoNotContact(client, companyId, company.doNotContactReason);
    }
    seeded.push({ external_id: company.externalId, company_id: companyId, name: company.name });
  }
  return seeded;
}

async function upsertScenarioCompany(
  client: NonNullable<ReturnType<typeof createServerSupabaseClient>>,
  company: FeedbackLoopScenarioCompany
): Promise<string> {
  const payload = {
    external_id: company.externalId,
    name: company.name,
    website: company.website,
    mode: "core",
    segment: company.segment,
    score: 50,
    verdict: "watch",
    quality_decision: "needs_enrichment",
    observed_signals: [`Compte témoin feedback loop BM Scout : ${company.name}.`],
    pain_hypotheses: ["Hypothèse témoin : mesurer l'effet de la mémoire Romu sur le run suivant."],
    score_justification: "Ligne témoin créée pour preuve feedback loop, pas pour qualification commerciale.",
    next_action: "Utiliser uniquement comme preuve de mémoire feedback Supabase."
  };
  const { data: existing, error: readError } = await client
    .from("scout_companies")
    .select("id")
    .eq("external_id", company.externalId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (readError) throw new Error(`Lecture company scénario impossible: ${readError.message}`);
  if (existing?.id) {
    const { error } = await client.from("scout_companies").update(payload).eq("id", existing.id);
    if (error) throw new Error(`Mise à jour company scénario impossible: ${error.message}`);
    return existing.id;
  }
  const { data, error } = await client.from("scout_companies").insert(payload).select("id").single();
  if (error) throw new Error(`Insertion company scénario impossible: ${error.message}`);
  return data.id;
}

async function upsertFeedback(
  client: NonNullable<ReturnType<typeof createServerSupabaseClient>>,
  companyId: string,
  kind: string,
  note: string
): Promise<void> {
  const payload = { company_id: companyId, kind, note, created_at: new Date().toISOString() };
  const { data: existing, error: readError } = await client
    .from("scout_feedback")
    .select("id")
    .eq("company_id", companyId)
    .eq("kind", kind)
    .eq("note", note)
    .limit(1)
    .maybeSingle();
  if (readError) throw new Error(`Lecture feedback scénario impossible: ${readError.message}`);
  const { error } = existing?.id
    ? await client.from("scout_feedback").update(payload).eq("id", existing.id)
    : await client.from("scout_feedback").insert(payload);
  if (error) throw new Error(`Écriture feedback scénario impossible: ${error.message}`);
}

async function upsertOutcome(
  client: NonNullable<ReturnType<typeof createServerSupabaseClient>>,
  companyId: string,
  outcome: string,
  note: string
): Promise<void> {
  const payload = { company_id: companyId, outcome, note, occurred_at: new Date().toISOString() };
  const { data: existing, error: readError } = await client
    .from("scout_outcomes")
    .select("id")
    .eq("company_id", companyId)
    .eq("outcome", outcome)
    .eq("note", note)
    .limit(1)
    .maybeSingle();
  if (readError) throw new Error(`Lecture outcome scénario impossible: ${readError.message}`);
  const { error } = existing?.id
    ? await client.from("scout_outcomes").update(payload).eq("id", existing.id)
    : await client.from("scout_outcomes").insert(payload);
  if (error) throw new Error(`Écriture outcome scénario impossible: ${error.message}`);
}

async function upsertDoNotContact(
  client: NonNullable<ReturnType<typeof createServerSupabaseClient>>,
  companyId: string,
  reason: string
): Promise<void> {
  const payload = { scope: "company", company_id: companyId, source: "feedback", reason, created_at: new Date().toISOString() };
  const { data: existing, error: readError } = await client
    .from("scout_do_not_contact")
    .select("id")
    .eq("company_id", companyId)
    .eq("scope", "company")
    .eq("reason", reason)
    .limit(1)
    .maybeSingle();
  if (readError) throw new Error(`Lecture do-not-contact scénario impossible: ${readError.message}`);
  const { error } = existing?.id
    ? await client.from("scout_do_not_contact").update(payload).eq("id", existing.id)
    : await client.from("scout_do_not_contact").insert(payload);
  if (error) throw new Error(`Écriture do-not-contact scénario impossible: ${error.message}`);
}

function missingEnvBlockers(): string[] {
  return [
    ...(!process.env.NEXT_PUBLIC_SUPABASE_URL ? ["NEXT_PUBLIC_SUPABASE_URL requis pour seeder la mémoire Supabase."] : []),
    ...(!process.env.SUPABASE_SERVICE_ROLE_KEY ? ["SUPABASE_SERVICE_ROLE_KEY requis pour seeder la mémoire Supabase."] : []),
    ...(!process.env.OPENAI_API_KEY ? ["OPENAI_API_KEY requis pour lancer le worker Agents SDK réel."] : [])
  ];
}

async function writeArtifact<T extends { status: "pass" | "fail"; blockers: string[] }>(payload: T): Promise<T> {
  await mkdir(artifactDir, { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
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

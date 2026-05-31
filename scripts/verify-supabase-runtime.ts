import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { getScoutSnapshot } from "../src/server/scout-repository";
import { createServerSupabaseClient } from "../src/server/supabase";

const execFileAsync = promisify(execFile);
const requiredEnv = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

interface SupabaseRuntimeVerificationArtifact {
  status: "pass" | "fail";
  generated_at: string;
  source: "missing_env" | "supabase_live" | "supabase_error";
  code_revision: string;
  blockers: string[];
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
  traces: string[];
  primaryLead?: string;
  error?: string;
}

const baseArtifact = {
  generated_at: new Date().toISOString(),
  code_revision: await resolveCurrentCodeRevision()
};

try {
  const missing = requiredEnv.filter((name) => !process.env[name]);

  if (missing.length) {
    await exitWithArtifact(
      {
        ...emptyArtifact("fail", "missing_env", [`Variables serveur manquantes: ${missing.join(", ")}`]),
        ...baseArtifact
      },
      2
    );
  }

  const snapshot = await getScoutSnapshot();
  const client = createServerSupabaseClient();
  if (!client) {
    await exitWithArtifact(
      {
        ...emptyArtifact("fail", "supabase_error", ["Client Supabase serveur indisponible malgré les variables requises."]),
        ...baseArtifact
      },
      2
    );
  }
  const supabaseClient = client!;

  const [taskCount, feedbackCount, outcomeCount, dncCount, runStepCount, actionEventCount] = await Promise.all([
    tableCount(supabaseClient, "scout_agent_tasks"),
    tableCount(supabaseClient, "scout_feedback"),
    tableCount(supabaseClient, "scout_outcomes"),
    tableCount(supabaseClient, "scout_do_not_contact"),
    tableCount(supabaseClient, "scout_run_steps"),
    tableCount(supabaseClient, "scout_action_events")
  ]);
  const runCount = snapshot.runs.length;
  const leadCount = snapshot.runs.reduce((sum, run) => sum + run.leads.length, 0);
  const rejectedCount = snapshot.runs.reduce((sum, run) => sum + run.rejected.length, 0);
  const lessonCount = snapshot.lessons.length;
  const traces = snapshot.runs.map((run) => run.traceId).filter(Boolean);

  const blockers: string[] = [];

  if (runCount < 1) blockers.push("Aucun run Supabase lisible par la console.");
  if (!snapshot.primaryLead) blockers.push("Aucun lead prioritaire lisible par la console.");
  if (leadCount < 1) blockers.push("Aucun lead actionnable lisible par la console.");
  if (rejectedCount < 1) blockers.push("Aucun rejet/QC visible dans la console.");
  if (lessonCount < 3) blockers.push("Moins de 3 apprentissages visibles dans la console.");
  if (taskCount < 1) blockers.push("Aucune tâche agent_tasks persistée.");
  if (feedbackCount < 1) blockers.push("Aucun feedback Romu persisté.");
  if (outcomeCount < 1) blockers.push("Aucun outcome persisté.");
  if (dncCount < 1) blockers.push("Aucun do-not-contact persisté.");
  if (runStepCount < 1) blockers.push("Aucun run step agentique persisté.");
  if (actionEventCount < 1) blockers.push("Aucune trace d'action Romu persistée.");
  if (!traces.length) blockers.push("Aucune trace de run Supabase disponible.");

  const artifact: SupabaseRuntimeVerificationArtifact = {
    status: blockers.length ? "fail" : "pass",
    source: "supabase_live",
    ...baseArtifact,
    blockers,
    primaryLead: snapshot.primaryLead?.company,
    runCount,
    leadCount,
    rejectedCount,
    lessonCount,
    taskCount,
    feedbackCount,
    outcomeCount,
    dncCount,
    runStepCount,
    actionEventCount,
    traces
  };

  await exitWithArtifact(artifact, blockers.length ? 1 : 0);
} catch (error) {
  await exitWithArtifact(
    {
      ...emptyArtifact("fail", "supabase_error", ["Vérification Supabase runtime impossible."]),
      ...baseArtifact,
      error: error instanceof Error ? error.message : String(error)
    },
    1
  );
}

async function exitWithArtifact(artifact: SupabaseRuntimeVerificationArtifact, code: number): Promise<never> {
  const output = JSON.stringify(artifact, null, 2);
  await writeArtifact(output);
  if (code === 0) {
    console.log(output);
  } else {
    console.error(output);
  }
  process.exit(code);
}

function emptyArtifact(
  status: "pass" | "fail",
  source: SupabaseRuntimeVerificationArtifact["source"],
  blockers: string[]
): SupabaseRuntimeVerificationArtifact {
  return {
    status,
    generated_at: new Date().toISOString(),
    source,
    code_revision: "unknown",
    blockers,
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
    traces: []
  };
}

async function writeArtifact(output: string): Promise<void> {
  const artifactsDir = join(process.cwd(), "artifacts", "supabase-runtime");
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(join(artifactsDir, "latest-verify.json"), output, "utf8");
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

async function tableCount(client: NonNullable<ReturnType<typeof createServerSupabaseClient>>, table: string): Promise<number> {
  const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`Comptage ${table} impossible: ${error.message}`);
  return count ?? 0;
}

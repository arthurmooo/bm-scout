import { getScoutSnapshot } from "../src/server/scout-repository";
import { createServerSupabaseClient } from "../src/server/supabase";

const requiredEnv = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = requiredEnv.filter((name) => !process.env[name]);

if (missing.length) {
  console.error(`Variables serveur manquantes: ${missing.join(", ")}`);
  process.exit(2);
}

const snapshot = await getScoutSnapshot();
const client = createServerSupabaseClient();
if (!client) {
  console.error("Client Supabase serveur indisponible malgré les variables requises.");
  process.exit(2);
}

const [taskCount, feedbackCount, outcomeCount, dncCount, runStepCount, actionEventCount] = await Promise.all([
  tableCount(client, "scout_agent_tasks"),
  tableCount(client, "scout_feedback"),
  tableCount(client, "scout_outcomes"),
  tableCount(client, "scout_do_not_contact"),
  tableCount(client, "scout_run_steps"),
  tableCount(client, "scout_action_events")
]);
const runCount = snapshot.runs.length;
const leadCount = snapshot.runs.reduce((sum, run) => sum + run.leads.length, 0);
const rejectedCount = snapshot.runs.reduce((sum, run) => sum + run.rejected.length, 0);
const lessonCount = snapshot.lessons.length;

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

const primaryLead = snapshot.primaryLead;

if (blockers.length || !primaryLead) {
  console.error(
    JSON.stringify(
      {
        status: "fail",
        blockers,
        runCount,
        leadCount,
        rejectedCount,
        lessonCount,
        taskCount,
        feedbackCount,
        outcomeCount,
        dncCount,
        runStepCount,
        actionEventCount
      },
      null,
      2
    )
  );
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "pass",
      primaryLead: primaryLead.company,
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
      traces: snapshot.runs.map((run) => run.traceId)
    },
    null,
    2
  )
);

async function tableCount(client: NonNullable<ReturnType<typeof createServerSupabaseClient>>, table: string): Promise<number> {
  const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`Comptage ${table} impossible: ${error.message}`);
  return count ?? 0;
}

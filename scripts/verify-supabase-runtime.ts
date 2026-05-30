import { getScoutSnapshot } from "../src/server/scout-repository";

const requiredEnv = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = requiredEnv.filter((name) => !process.env[name]);

if (missing.length) {
  console.error(`Variables serveur manquantes: ${missing.join(", ")}`);
  process.exit(2);
}

const snapshot = await getScoutSnapshot();
const runCount = snapshot.runs.length;
const leadCount = snapshot.runs.reduce((sum, run) => sum + run.leads.length, 0);
const rejectedCount = snapshot.runs.reduce((sum, run) => sum + run.rejected.length, 0);
const lessonCount = snapshot.lessons.length;

const blockers: string[] = [];

if (runCount < 1) blockers.push("Aucun run Supabase lisible par la console.");
if (!snapshot.primaryLead) blockers.push("Aucun lead prioritaire lisible par la console.");
if (leadCount < 1) blockers.push("Aucun lead actionnable lisible par la console.");
if (rejectedCount < 1) blockers.push("Aucun rejet/QC visible dans la console.");
if (lessonCount < 1) blockers.push("Aucun apprentissage visible dans la console.");

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
        lessonCount
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
      traces: snapshot.runs.map((run) => run.traceId)
    },
    null,
    2
  )
);

import { runWorkerCliForEvidence } from "../src/server/agent-task-runner";

const args = new Set(process.argv.slice(2));
const mode = readMode();
const real = args.has("--real");
const offline = args.has("--offline");
const persist = args.has("--persist");
const includeWeak = args.has("--include-weak");

if (!real && !offline) {
  console.error(JSON.stringify({ ok: false, message: "Choisir explicitement --real ou --offline." }, null, 2));
  process.exit(1);
}

const result = await runWorkerCliForEvidence(mode, {
  real,
  persist,
  includeWeak,
  artifactsDir: "artifacts/agent-worker-real"
});

const ok = result.code === 0 && result.parsed?.verdict === "pass";
console.log(
  JSON.stringify(
    {
      ok,
      mode,
      real,
      persist,
      includeWeak,
      evidenceFile: result.evidenceFile ?? null,
      verdict: result.parsed?.verdict ?? null,
      blockers: result.parsed?.blockers ?? [],
      traceId: result.parsed?.output.trace_id ?? null,
      keptCount: result.parsed?.output.kept_count ?? 0,
      rejectedCount: result.parsed?.output.rejected_count ?? 0,
      error: ok ? null : [result.stderr, result.stdout].filter(Boolean).join("\n").slice(0, 4000)
    },
    null,
    2
  )
);

process.exit(ok ? 0 : 1);

function readMode(): "core" | "exploration" {
  const value = process.argv.find((arg) => arg.startsWith("--mode="))?.split("=")[1] ?? "core";
  if (value === "core" || value === "exploration") return value;
  console.error(JSON.stringify({ ok: false, message: "--mode doit valoir core ou exploration." }, null, 2));
  process.exit(1);
}

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

describe("github readiness workflows", () => {
  it("exécute toute la chaîne de preuves readiness et upload les artefacts", () => {
    const workflow = readFileSync(join(root, ".github", "workflows", "bm-scout-readiness.yml"), "utf8");

    for (const command of [
      "npm run openai:preflight",
      "npm run provider:compare",
      "npm run feedback:evidence",
      "npm run worker:real:core:persist",
      "npm run worker:real:exploration:persist",
      "npm run agent:cron:evidence -- --mode=real --limit=10 --stale-minutes=90 --all-p0",
      "npm run verify:supabase",
      "npm run quality:readiness"
    ]) {
      expect(workflow).toContain(command);
    }

    expect(workflow).toContain("NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}");
    expect(workflow).toContain("SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}");
    expect(workflow).toContain("OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}");
    expect(workflow).toContain("SERPAPI_API_KEY: ${{ secrets.SERPAPI_API_KEY }}");
    expect(workflow).toContain("id: openai_preflight");
    expect(workflow).toContain('echo "available=true" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain("steps.openai_preflight.outputs.available == 'true'");
    expect(workflow).toContain("inputs.provider == 'serpapi' || inputs.provider == 'web'");
    expect(workflow.match(/continue-on-error: true/g)?.length).toBeGreaterThanOrEqual(4);
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).toContain("bm-scout-readiness-evidence");
    expect(workflow).toContain("artifacts/quality-runs/*.md");
    expect(workflow).toContain("artifacts/openai-runtime/*.json");
  });

  it("exécute une CI statique sans secrets sur PR et branches codex", () => {
    const workflow = readFileSync(join(root, ".github", "workflows", "bm-scout-static.yml"), "utf8");

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain('"codex/**"');
    expect(workflow).toContain("npm run test");
    expect(workflow).toContain("npm run typecheck");
    expect(workflow).toContain("npm run lint");
    expect(workflow).toContain("npm run worker:test");
    expect(workflow).toContain("npm run build");
    expect(workflow).not.toContain("secrets.");
  });

  it("ne lance pas le cron agent_tasks réel sans preflight OpenAI disponible", () => {
    const workflow = readFileSync(join(root, ".github", "workflows", "bm-scout-agent-tasks.yml"), "utf8");
    const blockerScript = readFileSync(join(root, "scripts", "write-agent-task-openai-blocker.ts"), "utf8");

    expect(workflow).toContain("npm run openai:preflight");
    expect(workflow).toContain("id: openai_preflight");
    expect(workflow).toContain("gpt-4.1-mini");
    expect(workflow).toContain("BM_SCOUT_WORKER_TIMEOUT_MS");
    expect(workflow).toContain('steps.openai_preflight.outputs.available');
    expect(workflow).toContain('if [ "$MODE" = "real" ]');
    expect(workflow).toContain('!= "true"');
    expect(workflow).toContain("npm run agent:tasks:openai-blocker");
    expect(workflow).toContain("artifacts/openai-runtime/*.json");
    expect(workflow).toContain('npm run agent:cron:evidence -- --mode="$MODE" --limit=10 --stale-minutes=90');
    expect(blockerScript).toContain("latest-ci-run.json");
    expect(blockerScript).toContain("OpenAI preflight échoué");
    expect(blockerScript).toContain("agent_tasks real non lancé");
    expect(blockerScript).toContain("weekly_core_research");
    expect(blockerScript).toContain("weekly_exploration_scan");
  });

  it("force les six routines P0 dans le mode cron de readiness", () => {
    const script = readFileSync(join(root, "scripts", "run-agent-task-cron-evidence.ts"), "utf8");

    expect(script).toContain("createScheduledTasks");
    expect(script).toContain('args.includes("--all-p0")');
    expect(script).toContain("ALL_P0_BACKFILL_HOURS");
    expect(script).toContain("scheduleNow");
    expect(script).toContain("{ force: allP0 }");
    expect(script).toContain("processScheduledAgentTasks");
    expect(script).toContain("taskId");
    expect(script).toContain("scoped: allP0");
    expect(script).toContain('scheduleScope: allP0 ? "all_p0" : "due"');
  });
});

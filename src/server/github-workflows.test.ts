import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

describe("github readiness workflows", () => {
  it("exécute toute la chaîne de preuves readiness et upload les artefacts", () => {
    const workflow = readFileSync(join(root, ".github", "workflows", "bm-scout-readiness.yml"), "utf8");

    for (const command of [
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
    expect(workflow.match(/continue-on-error: true/g)?.length).toBeGreaterThanOrEqual(5);
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).toContain("bm-scout-readiness-evidence");
    expect(workflow).toContain("artifacts/quality-runs/*.md");
  });

  it("force les six routines P0 dans le mode cron de readiness", () => {
    const script = readFileSync(join(root, "scripts", "run-agent-task-cron-evidence.ts"), "utf8");

    expect(script).toContain("createScheduledTasks");
    expect(script).toContain('args.includes("--all-p0")');
    expect(script).toContain('scheduleScope: allP0 ? "all_p0" : "due"');
  });
});

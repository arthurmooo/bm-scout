import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migrationsDir = join(root, "supabase", "migrations");

describe("supabase security posture", () => {
  it("restreint les policies BM Scout aux roles internes app_metadata", () => {
    const migration = readMigration("restrict_internal_rls_policies");

    expect(migration).toContain("public.scout_is_internal_user()");
    expect(migration).toContain("auth.jwt()) -> 'app_metadata'");
    expect(migration).toContain("bm_scout_role");
    expect(migration).toContain("bm_scout_roles");
    expect(migration).not.toContain("raw_user_meta_data");
    expect(migration).not.toContain("user_metadata");
    expect(migration).not.toMatch(/using\s*\(\s*true\s*\)/i);
    expect(migration).not.toMatch(/with check\s*\(\s*true\s*\)/i);
  });

  it("remplace les anciennes policies authenticated trop larges", () => {
    const migration = readMigration("restrict_internal_rls_policies");

    for (const policy of [
      "internal read scout runs",
      "internal read scout companies",
      "internal read scout messages",
      "internal create feedback",
      "internal update companies",
      "internal read scout agent tasks",
      "internal create scout action events"
    ]) {
      expect(migration).toContain(`drop policy if exists "${policy}"`);
    }
  });

  it("ne reference pas la service role key dans le code client", () => {
    const clientFiles = [
      join(root, "src", "ui", "ScoutActionButton.tsx"),
      join(root, "src", "ui", "ScoutDashboard.tsx"),
      join(root, "app", "page.tsx")
    ];

    for (const file of clientFiles) {
      expect(readFileSync(file, "utf8")).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    }
  });

  it("ferme les fonctions security definer exposees en RPC publique", () => {
    const migration = readMigration("close_security_definer_rpc_exposure");

    expect(migration).toContain("security invoker");
    expect(migration).toContain("revoke execute on function public.rls_auto_enable() from public, anon, authenticated");
    expect(migration).toContain("revoke execute on function public.scout_is_do_not_contact(text, text, uuid, uuid) from public, anon");
    expect(migration).toContain("grant execute on function public.scout_is_do_not_contact(text, text, uuid, uuid) to authenticated, service_role");
  });

  it("empeche les doublons de taches agentiques actives cote base", () => {
    const migration = readMigration("agent_tasks_active_dedupe");

    expect(migration).toContain("create unique index if not exists scout_agent_tasks_active_type_schedule_uniq");
    expect(migration).toContain("on public.scout_agent_tasks (type, scheduled_for)");
    expect(migration).toContain("where status in ('queued', 'running')");
  });

  it("indexe les cles etrangeres de persistance et d'audit", () => {
    const migration = readMigration("scout_fk_covering_indexes");

    for (const indexName of [
      "scout_action_events_message_id_idx",
      "scout_agent_tasks_result_run_id_idx",
      "scout_evidence_created_by_run_id_idx",
      "scout_messages_created_by_run_id_idx",
      "scout_learning_lessons_source_run_id_idx",
      "scout_scores_created_by_run_id_idx"
    ]) {
      expect(migration).toContain(`create index if not exists ${indexName}`);
    }
  });

  it("hard-gate les messages apres outcome negatif cote base", () => {
    const migration = readMigration("block_messages_after_negative_outcome");

    expect(migration).toContain("public.scout_prevent_blocking_outcome_message()");
    expect(migration).toContain("Negative outcome gate");
    expect(migration).toContain("outcome.outcome = 'negative'");
    expect(migration).toContain("create trigger scout_messages_prevent_blocking_outcome");
    expect(migration).toContain("public.scout_block_messages_after_negative_outcome()");
    expect(migration).toContain("create trigger scout_outcomes_block_messages");
    expect(migration).toContain("set status = 'blocked'");
  });

  it("autorise les actions manuelles pour les routines DNC et relances", () => {
    const migration = readMigration("scout_manual_dnc_followup_routines");

    expect(migration).toContain("alter type public.scout_action_type add value if not exists 'launch_dnc_check'");
    expect(migration).toContain("alter type public.scout_action_type add value if not exists 'launch_followup_review'");
  });

  it("fusionne les companies persistées par external_id ou domaine en priorisant Core", () => {
    const migration = readMigration("scout_company_persistence_dedupe");

    expect(migration).toContain("create index if not exists scout_companies_domain_idx");
    expect(migration).toContain("where external_id = lead->>'id'");
    expect(migration).toContain("where domain = lead_domain");
    expect(migration).toContain("company_dedupe_decision := 'merged_existing'");
    expect(migration).toContain("'dedupe_decision', company_dedupe_decision");
    expect(migration).toContain("update public.scout_companies as existing");
    expect(migration).toContain("when existing.mode = 'core'::public.scout_mode then existing.mode");
    expect(migration).toContain("when existing.mode = 'core'::public.scout_mode and lead_mode = 'exploration'::public.scout_mode then existing.verdict");
    expect(migration).toContain("as signals(signal)");
    expect(migration).toContain("as hypotheses(hypothesis)");
    expect(migration).toContain("latest_run_id = run_id");
  });
});

function readMigration(name: string): string {
  const file = readdirSync(migrationsDir).find((candidate) => candidate.endsWith(`${name}.sql`));
  if (!file) throw new Error(`Migration introuvable: ${name}`);
  return readFileSync(join(migrationsDir, file), "utf8");
}

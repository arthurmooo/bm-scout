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

  it("bloque les messages existants quand une cible devient do-not-contact", () => {
    const migration = readMigration("scout_dnc_blocks_existing_messages");

    expect(migration).toContain("create or replace function public.scout_block_messages_for_dnc()");
    expect(migration).toContain("after insert or update of normalized_email_hash, normalized_domain, company_id, contact_id");
    expect(migration).toContain("on public.scout_do_not_contact");
    expect(migration).toContain("set status = 'blocked'");
    expect(migration).toContain("messages.company_id = new.company_id");
    expect(migration).toContain("messages.contact_id = new.contact_id");
    expect(migration).toContain("companies.domain = lower(trim(new.normalized_domain))");
    expect(migration).toContain("contacts.email_hash = new.normalized_email_hash");
    expect(migration).toContain("create trigger scout_contacts_block_existing_dnc_messages");
    expect(migration).toContain("after insert or update of email, company_id, do_not_contact");
    expect(migration).toContain("new.do_not_contact is true");
    expect(migration).toContain("create trigger scout_companies_block_existing_dnc_messages");
    expect(migration).toContain("after insert or update of website");
    expect(migration).toContain("revoke execute on function public.scout_block_messages_for_dnc() from public, anon, authenticated");
    expect(migration).toContain("revoke execute on function public.scout_block_contact_messages_if_dnc() from public, anon, authenticated");
    expect(migration).toContain("revoke execute on function public.scout_block_company_messages_if_dnc() from public, anon, authenticated");
    expect(migration).not.toContain("security definer");
  });

  it("rend les cibles do-not-contact uniques cote base par scope", () => {
    const migration = readMigration("scout_dnc_scope_uniqueness");

    expect(migration).toContain("row_number() over (partition by company_id");
    expect(migration).toContain("row_number() over (partition by normalized_domain");
    expect(migration).toContain("row_number() over (partition by contact_id");
    expect(migration).toContain("row_number() over (partition by normalized_email_hash");
    expect(migration).toContain("duplicate.duplicate_rank > 1");
    for (const indexName of [
      "scout_dnc_company_unique",
      "scout_dnc_domain_unique",
      "scout_dnc_contact_unique",
      "scout_dnc_contact_email_hash_unique"
    ]) {
      expect(migration).toContain(`create unique index if not exists ${indexName}`);
    }
    expect(migration).toContain("where scope = 'company'::public.scout_dnc_scope");
    expect(migration).toContain("where scope = 'domain'::public.scout_dnc_scope");
    expect(migration).toContain("where scope = 'contact'::public.scout_dnc_scope");
  });

  it("autorise les actions manuelles pour les routines DNC et relances", () => {
    const migration = readMigration("scout_manual_dnc_followup_routines");

    expect(migration).toContain("alter type public.scout_action_type add value if not exists 'launch_dnc_check'");
    expect(migration).toContain("alter type public.scout_action_type add value if not exists 'launch_followup_review'");
  });

  it("distingue message utilise manuellement d'un statut d'envoi ou d'approbation", () => {
    const migration = readMigration("scout_message_used_manually_status");

    expect(migration).toContain("alter type public.scout_message_status add value if not exists 'used_manually'");
    expect(migration).toContain("it is not an automatic send state");
  });

  it("interdit le statut approved cote base pour garantir zero envoi automatique", () => {
    const migration = readMigration("scout_messages_no_approved_state");

    expect(migration).toContain("where status = 'approved'::public.scout_message_status");
    expect(migration).toContain("set status = 'used_manually'::public.scout_message_status");
    expect(migration).toContain("add constraint scout_messages_no_approved_state");
    expect(migration).toContain("check (status <> 'approved'::public.scout_message_status)");
    expect(migration).toContain("ne peut pas approuver ou envoyer automatiquement");
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

  it("prouve la fusion domaine via verify:supabase avec cleanup des lignes temporaires", () => {
    const verifier = readFileSync(join(root, "src", "server", "supabase-runtime-verification.ts"), "utf8");
    const runtimeScript = readFileSync(join(root, "scripts", "verify-supabase-runtime.ts"), "utf8");

    expect(verifier).toContain('client.rpc("scout_persist_mission_output"');
    expect(verifier).toContain('"core"');
    expect(verifier).toContain('"exploration"');
    expect(verifier).toContain("dedupe_decision");
    expect(verifier).toContain("merged_existing");
    expect(verifier).toContain("retainedMode !== \"core\"");
    expect(verifier).toContain('client.from("scout_companies").delete().eq("domain", domain)');
    expect(verifier).toContain('client.from("scout_runs").delete().in("id", allRunIds)');
    expect(runtimeScript).toContain("persistenceDedupeVerified");
    expect(runtimeScript).toContain("verifySupabasePersistenceDedupe");
    expect(verifier).toContain("verifySupabaseComplianceGates");
    expect(verifier).toContain("assertApprovedMessageBlocked");
    expect(verifier).toContain("assertDuplicateDncBlocked");
    expect(runtimeScript).toContain("complianceGatesVerified");
    expect(runtimeScript).toContain("noApprovedMessageConstraint");
    expect(runtimeScript).toContain("dncUniqueEmailHash");
  });
});

function readMigration(name: string): string {
  const file = readdirSync(migrationsDir).find((candidate) => candidate.endsWith(`${name}.sql`));
  if (!file) throw new Error(`Migration introuvable: ${name}`);
  return readFileSync(join(migrationsDir, file), "utf8");
}

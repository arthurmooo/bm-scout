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
});

function readMigration(name: string): string {
  const file = readdirSync(migrationsDir).find((candidate) => candidate.endsWith(`${name}.sql`));
  if (!file) throw new Error(`Migration introuvable: ${name}`);
  return readFileSync(join(migrationsDir, file), "utf8");
}

export type ScoutAuthMode = "auto" | "demo" | "internal";

export type SupabasePublicConfig = {
  url: string;
  publishableKey: string;
};

export function getScoutAuthMode(): ScoutAuthMode {
  const mode = process.env.BM_SCOUT_AUTH_MODE?.trim().toLowerCase();
  if (mode === "demo" || mode === "internal") return mode;
  return "auto";
}

export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  const url = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const publishableKey =
    cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ?? cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

export function shouldUseDemoAuthFallback(): boolean {
  const mode = getScoutAuthMode();
  if (mode === "demo") return true;
  if (mode === "internal") return false;
  return !getSupabasePublicConfig();
}

function cleanEnv(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getBmScoutRolesFromClaims, type ClaimsLike, type InternalRole } from "./auth-policy";
import { getScoutAuthMode, getSupabasePublicConfig, shouldUseDemoAuthFallback } from "./supabase-auth-config";

export type InternalAuthState =
  | { mode: "demo_unconfigured"; authConfigured: false; reason: string }
  | { mode: "authenticated"; authConfigured: true; email: string | null; roles: InternalRole[] }
  | { mode: "unauthenticated"; authConfigured: true; reason: string }
  | { mode: "forbidden"; authConfigured: true; email: string | null; reason: string };

export async function createSupabaseAuthServerClient() {
  const config = getSupabasePublicConfig();
  if (!config) return null;

  const cookieStore = await cookies();

  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot mutate cookies; the Next proxy refreshes them before render.
        }
      }
    }
  });
}

export async function getInternalAuthState(): Promise<InternalAuthState> {
  if (shouldUseDemoAuthFallback()) {
    return {
      mode: "demo_unconfigured",
      authConfigured: false,
      reason: "Supabase Auth non configurée : mode démo local explicite."
    };
  }

  const supabase = await createSupabaseAuthServerClient();
  if (!supabase) {
    return {
      mode: "unauthenticated",
      authConfigured: true,
      reason:
        getScoutAuthMode() === "internal"
          ? "Supabase Auth obligatoire mais NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY est absent."
          : "Supabase Auth non disponible."
    };
  }

  const { data, error } = await supabase.auth.getClaims();
  const claims = (data?.claims ?? null) as ClaimsLike | null;

  if (error || !claims) {
    return {
      mode: "unauthenticated",
      authConfigured: true,
      reason: error?.message ?? "Session Supabase absente."
    };
  }

  const roles = getBmScoutRolesFromClaims(claims);
  if (!roles.length) {
    return {
      mode: "forbidden",
      authConfigured: true,
      email: getEmailFromClaims(claims),
      reason: "Compte authentifié sans rôle BM Scout dans app_metadata."
    };
  }

  return {
    mode: "authenticated",
    authConfigured: true,
    email: getEmailFromClaims(claims),
    roles
  };
}

function getEmailFromClaims(claims: ClaimsLike): string | null {
  return typeof claims.email === "string" ? claims.email : null;
}

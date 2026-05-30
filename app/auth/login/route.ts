import { NextResponse } from "next/server";
import { createSupabaseAuthServerClient } from "@/server/supabase-auth";
import { getSupabasePublicConfig, shouldUseDemoAuthFallback } from "@/server/supabase-auth-config";

export async function POST(request: Request) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!email) return redirectToLogin(request, "missing_email");
  if (shouldUseDemoAuthFallback() || !getSupabasePublicConfig()) return redirectToLogin(request, "auth_not_configured");

  const supabase = await createSupabaseAuthServerClient();
  if (!supabase) return redirectToLogin(request, "auth_not_configured");

  const origin = new URL(request.url).origin;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
      shouldCreateUser: false
    }
  });

  if (error) return redirectToLogin(request, "callback_error");
  return redirectToLogin(request, "sent");
}

function redirectToLogin(request: Request, status: string) {
  const url = new URL(`/login?status=${encodeURIComponent(status)}`, request.url);
  return NextResponse.redirect(url, { status: 303 });
}

import { NextResponse } from "next/server";
import { createSupabaseAuthServerClient } from "@/server/supabase-auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return redirectToLogin(request, "missing_code");

  const supabase = await createSupabaseAuthServerClient();
  if (!supabase) return redirectToLogin(request, "auth_not_configured");

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return redirectToLogin(request, "callback_error");

  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}

function redirectToLogin(request: Request, status: string) {
  const url = new URL(`/login?status=${encodeURIComponent(status)}`, request.url);
  return NextResponse.redirect(url, { status: 303 });
}

import { NextResponse } from "next/server";
import { createSupabaseAuthServerClient } from "@/server/supabase-auth";

export async function POST(request: Request) {
  const supabase = await createSupabaseAuthServerClient();
  await supabase?.auth.signOut();
  return NextResponse.redirect(new URL("/login?status=signed_out", request.url), { status: 303 });
}

import { NextResponse } from "next/server";
import { recordScoutAction } from "@/server/scout-actions";
import { scoutActionSchema } from "@/server/scout-action-schema";
import { getInternalAuthState } from "@/server/supabase-auth";

export async function POST(request: Request) {
  const auth = await getInternalAuthState();
  if (auth.mode === "unauthenticated") {
    return NextResponse.json({ ok: false, message: "Connexion interne requise." }, { status: 401 });
  }
  if (auth.mode === "forbidden") {
    return NextResponse.json({ ok: false, message: auth.reason }, { status: 403 });
  }

  const parsed = scoutActionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Action invalide.", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await recordScoutAction(parsed.data);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, persisted: false, message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

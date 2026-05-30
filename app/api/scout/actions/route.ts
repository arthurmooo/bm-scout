import { NextResponse } from "next/server";
import { z } from "zod";
import { recordScoutAction } from "@/server/scout-actions";

const actionSchema = z.object({
  action: z.enum([
    "validate_lead",
    "reject_lead",
    "watch_lead",
    "exclude_lead",
    "request_enrichment",
    "rerun_qc",
    "copy_email",
    "copy_follow_up",
    "copy_linkedin",
    "mark_message_used",
    "add_do_not_contact",
    "launch_core",
    "launch_exploration",
    "launch_daily_brief",
    "launch_learning_review"
  ]),
  leadId: z.string().min(1).optional(),
  note: z.string().max(600).optional(),
  reason: z.string().max(300).optional()
});

export async function POST(request: Request) {
  const parsed = actionSchema.safeParse(await request.json());
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

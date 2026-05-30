import { describe, expect, it, vi } from "vitest";
import { recordScoutAction } from "./scout-actions";

const { calls } = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; op: string; payload?: unknown }>
}));

vi.mock("./supabase", () => ({
  createServerSupabaseClient: () => ({
    from: (table: string) => fakeTable(table)
  })
}));

describe("scout actions", () => {
  it("persiste une validation lead et trace l'action", async () => {
    calls.length = 0;

    const result = await recordScoutAction({ action: "validate_lead", leadId: "core-cambon" });

    expect(result.ok).toBe(true);
    expect(calls).toContainEqual({ table: "scout_companies", op: "update", payload: { verdict: "validate" } });
    expect(calls.some((call) => call.table === "scout_action_events" && call.op === "insert")).toBe(true);
  });

  it("met une routine Core en file via agent_tasks", async () => {
    calls.length = 0;

    const result = await recordScoutAction({ action: "launch_core" });

    expect(result.ok).toBe(true);
    expect(calls.some((call) => call.table === "scout_agent_tasks" && call.op === "insert")).toBe(true);
  });

  it("ajoute un do-not-contact et bloque le lead", async () => {
    calls.length = 0;

    const result = await recordScoutAction({ action: "add_do_not_contact", leadId: "core-cambon" });

    expect(result.ok).toBe(true);
    expect(calls.some((call) => call.table === "scout_do_not_contact" && call.op === "insert")).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.table === "scout_feedback" &&
          call.op === "insert" &&
          JSON.stringify(call.payload).includes("do_not_contact")
      )
    ).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.table === "scout_companies" &&
          call.op === "update" &&
          JSON.stringify(call.payload).includes("blocked")
      )
    ).toBe(true);
  });

  it("enregistre un feedback bon angle dans scout_feedback", async () => {
    calls.length = 0;

    const result = await recordScoutAction({
      action: "feedback_good_angle",
      leadId: "core-cambon",
      note: "Très bon angle reporting deal-by-deal."
    });

    expect(result.ok).toBe(true);
    expect(calls).toContainEqual({
      table: "scout_feedback",
      op: "insert",
      payload: {
        company_id: "company-1",
        kind: "good_angle",
        note: "Très bon angle reporting deal-by-deal."
      }
    });
  });

  it("rejette les messages quand Romu signale un message trop generique", async () => {
    calls.length = 0;

    const result = await recordScoutAction({
      action: "feedback_generic_message",
      leadId: "core-cambon",
      note: "Message trop générique."
    });

    expect(result.ok).toBe(true);
    expect(calls).toContainEqual({
      table: "scout_feedback",
      op: "insert",
      payload: {
        company_id: "company-1",
        kind: "generic_message",
        note: "Message trop générique."
      }
    });
    expect(calls).toContainEqual({ table: "scout_messages", op: "update", payload: { status: "rejected" } });
  });

  it("persiste un outcome RDV pris", async () => {
    calls.length = 0;

    const result = await recordScoutAction({
      action: "outcome_meeting_booked",
      leadId: "core-cambon",
      note: "RDV pris avec le bon sponsor."
    });

    expect(result.ok).toBe(true);
    expect(calls).toContainEqual({
      table: "scout_outcomes",
      op: "insert",
      payload: {
        company_id: "company-1",
        outcome: "meeting_booked",
        note: "RDV pris avec le bon sponsor."
      }
    });
    expect(calls).toContainEqual({ table: "scout_companies", op: "update", payload: { verdict: "validate" } });
  });

  it("marque les messages comme utilises sans envoi automatique", async () => {
    calls.length = 0;

    const result = await recordScoutAction({ action: "mark_message_used", leadId: "core-cambon" });

    expect(result.ok).toBe(true);
    expect(calls).toContainEqual({ table: "scout_messages", op: "update", payload: { status: "approved" } });
    expect(calls.some((call) => JSON.stringify(call.payload).includes("sent"))).toBe(false);
  });
});

function fakeTable(table: string) {
  const chain = {
    error: null,
    data: table === "scout_companies" ? { id: "company-1" } : null,
    select: () => chain,
    or: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => ({ data: { id: "company-1" }, error: null }),
    eq: () => chain,
    neq: () => chain,
    insert: (payload: unknown) => {
      calls.push({ table, op: "insert", payload });
      return chain;
    },
    update: (payload: unknown) => {
      calls.push({ table, op: "update", payload });
      return chain;
    }
  };
  return chain;
}

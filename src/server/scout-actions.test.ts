import { describe, expect, it, vi } from "vitest";
import { recordScoutAction } from "./scout-actions";

const { calls } = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; op: string; payload?: unknown }>
}));

const { state } = vi.hoisted(() => ({
  state: {
    dnc: false,
    messageStatus: "proposed",
    messageBody: "Bonjour, message spécifique."
  }
}));

vi.mock("./supabase", () => ({
  createServerSupabaseClient: () => ({
    from: (table: string) => fakeTable(table),
    rpc: (fn: string, payload: unknown) => {
      calls.push({ table: `rpc:${fn}`, op: "rpc", payload });
      return { data: state.dnc, error: null };
    }
  })
}));

describe("scout actions", () => {
  it("persiste une validation lead et trace l'action", async () => {
    reset();

    const result = await recordScoutAction({ action: "validate_lead", leadId: "core-cambon" });

    expect(result.ok).toBe(true);
    expect(calls).toContainEqual({ table: "scout_companies", op: "update", payload: { verdict: "validate" } });
    expect(calls.some((call) => call.table === "scout_action_events" && call.op === "insert")).toBe(true);
  });

  it("met une routine Core en file via agent_tasks", async () => {
    reset();

    const result = await recordScoutAction({ action: "launch_core" });

    expect(result.ok).toBe(true);
    expect(calls.some((call) => call.table === "scout_agent_tasks" && call.op === "insert")).toBe(true);
  });

  it("ajoute un do-not-contact et bloque le lead", async () => {
    reset();

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
    reset();

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
    reset();

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
    reset();

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
    reset();

    const result = await recordScoutAction({ action: "mark_message_used", leadId: "core-cambon" });

    expect(result.ok).toBe(true);
    expect(calls).toContainEqual({ table: "scout_messages", op: "update", payload: { status: "approved" } });
    expect(calls.some((call) => JSON.stringify(call.payload).includes("sent"))).toBe(false);
  });

  it("bloque la copie de message si la cible est do-not-contact", async () => {
    reset();
    state.dnc = true;

    const result = await recordScoutAction({ action: "copy_email", leadId: "core-cambon" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("do-not-contact");
    expect(calls).toContainEqual({
      table: "rpc:scout_is_do_not_contact",
      op: "rpc",
      payload: {
        input_email: "romu@example.com",
        input_domain: "example.com",
        input_company_id: "company-1",
        input_contact_id: "contact-1"
      }
    });
    expect(calls).not.toContainEqual({ table: "scout_messages", op: "update", payload: { status: "copied" } });
    expect(
      calls.some(
        (call) =>
          call.table === "scout_action_events" &&
          call.op === "insert" &&
          JSON.stringify(call.payload).includes("Copie bloquée")
      )
    ).toBe(true);
  });

  it("bloque la copie d'un brouillon QC bloque", async () => {
    reset();
    state.messageStatus = "blocked";
    state.messageBody = "Brouillon bloqué : signal insuffisant.";

    const result = await recordScoutAction({ action: "copy_email", leadId: "core-cambon" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Quality Control");
    expect(calls.some((call) => call.table === "rpc:scout_is_do_not_contact")).toBe(false);
    expect(calls).not.toContainEqual({ table: "scout_messages", op: "update", payload: { status: "copied" } });
  });
});

function reset() {
  calls.length = 0;
  state.dnc = false;
  state.messageStatus = "proposed";
  state.messageBody = "Bonjour, message spécifique.";
}

function fakeTable(table: string) {
  const chain = {
    error: null,
    data: table === "scout_companies" ? { id: "company-1" } : null,
    select: () => chain,
    or: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => ({ data: singleRow(table), error: null }),
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

function singleRow(table: string) {
  if (table === "scout_messages") {
    return {
      id: "message-1",
      status: state.messageStatus,
      body: state.messageBody,
      contact_id: "contact-1",
      scout_contacts: { email: "romu@example.com" },
      scout_companies: { domain: "example.com" }
    };
  }
  return { id: "company-1", domain: "example.com" };
}

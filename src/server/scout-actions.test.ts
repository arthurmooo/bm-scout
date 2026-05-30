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
          call.table === "scout_companies" &&
          call.op === "update" &&
          JSON.stringify(call.payload).includes("blocked")
      )
    ).toBe(true);
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

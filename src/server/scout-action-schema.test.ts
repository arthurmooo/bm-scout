import { describe, expect, it } from "vitest";
import { LEAD_ACTION_TYPES } from "../domain/types";
import { scoutActionSchema } from "./scout-action-schema";

describe("scout action schema", () => {
  it("accepte toutes les actions canoniques exposées par la console", () => {
    for (const action of LEAD_ACTION_TYPES) {
      expect(scoutActionSchema.safeParse({ action }).success, action).toBe(true);
    }
  });

  it("accepte les routines P0 DNC et relances affichées dans l'UI", () => {
    expect(scoutActionSchema.parse({ action: "launch_dnc_check" }).action).toBe("launch_dnc_check");
    expect(scoutActionSchema.parse({ action: "launch_followup_review" }).action).toBe("launch_followup_review");
  });
});

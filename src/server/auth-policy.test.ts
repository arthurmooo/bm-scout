import { describe, expect, it } from "vitest";
import { getBmScoutRolesFromClaims, isInternalBmScoutUser } from "./auth-policy";

describe("BM Scout auth policy", () => {
  it("accepte un role interne app_metadata explicite", () => {
    const claims = { app_metadata: { bm_scout_role: "romu" } };

    expect(getBmScoutRolesFromClaims(claims)).toEqual(["romu"]);
    expect(isInternalBmScoutUser(claims)).toBe(true);
  });

  it("accepte une liste de roles internes app_metadata", () => {
    const claims = { app_metadata: { bm_scout_roles: ["arthur", "worker", "unknown"] } };

    expect(getBmScoutRolesFromClaims(claims)).toEqual(["arthur", "worker"]);
  });

  it("accepte le flag bm_scout_access uniquement depuis app_metadata", () => {
    expect(isInternalBmScoutUser({ app_metadata: { bm_scout_access: true } })).toBe(true);
    expect(isInternalBmScoutUser({ app_metadata: { bm_scout_access: "yes" } })).toBe(true);
  });

  it("ignore les metadata modifiables par l'utilisateur", () => {
    const claims = {
      user_metadata: { bm_scout_role: "admin", bm_scout_access: true },
      raw_user_meta_data: { bm_scout_role: "arthur" }
    };

    expect(getBmScoutRolesFromClaims(claims)).toEqual([]);
    expect(isInternalBmScoutUser(claims)).toBe(false);
  });
});

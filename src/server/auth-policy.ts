export type InternalRole = "admin" | "arthur" | "romu" | "worker" | "internal";

export type ClaimsLike = Record<string, unknown>;

const allowedRoles = new Set<InternalRole>(["admin", "arthur", "romu", "worker", "internal"]);

export function getBmScoutRolesFromClaims(claims: ClaimsLike | null | undefined): InternalRole[] {
  const appMetadata = asRecord(claims?.app_metadata);
  if (!appMetadata) return [];

  const roles = new Set<InternalRole>();
  addRole(roles, appMetadata.bm_scout_role);
  addRoles(roles, appMetadata.bm_scout_roles);

  if (isTruthyAccess(appMetadata.bm_scout_access)) {
    roles.add("internal");
  }

  return Array.from(roles);
}

export function isInternalBmScoutUser(claims: ClaimsLike | null | undefined): boolean {
  return getBmScoutRolesFromClaims(claims).length > 0;
}

function addRoles(target: Set<InternalRole>, value: unknown) {
  if (Array.isArray(value)) {
    for (const role of value) addRole(target, role);
    return;
  }

  if (typeof value === "string") {
    for (const role of value.split(",")) addRole(target, role);
  }
}

function addRole(target: Set<InternalRole>, value: unknown) {
  if (typeof value !== "string") return;
  const normalized = value.trim().toLowerCase();
  if (allowedRoles.has(normalized as InternalRole)) {
    target.add(normalized as InternalRole);
  }
}

function isTruthyAccess(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "y", "on"].includes(value.trim().toLowerCase());
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

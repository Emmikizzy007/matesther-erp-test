/**
 * Matesther people model: ONE person record, MANY roles.
 *
 * Real Matesther examples this must support:
 *   - Cutter + Inspection Officer + Tailor/Sewer
 *   - Cutter + Project Supervisor
 *   - Tailor + Inspector
 *   - Weaver/Taper (production support) helping a Tailor
 *   - Security, Sales, Directors, IT/admin/office and management who are paid
 *     but never do production work
 *
 * Rules kept here (pure functions, safe to import in the browser):
 *  1. A person is never duplicated just because they have several roles.
 *  2. Production work requires a production/support role that matches the stage.
 *  3. Non-production staff are never assignable to a production stage.
 *  4. Holding an inspection role changes NOTHING about self-inspection: nobody
 *     approves their own submitted work. That is enforced server-side in
 *     src/lib/authz.ts + the inspection API, never in the browser.
 */

export const ROLE_KINDS = ["PRODUCTION", "SUPPORT", "INSPECTION", "NON_PRODUCTION"] as const;
export type RoleKind = (typeof ROLE_KINDS)[number];

export const STAFF_TYPES = ["PRODUCTION", "SUPPORT", "NON_PRODUCTION"] as const;
export type StaffType = (typeof STAFF_TYPES)[number];

export interface WorkerRole {
  role: string;
  kind: RoleKind;
  isPrimary?: boolean;
}

export interface RolePerson {
  specialty?: string | null;
  staffType?: string | null;
  isInspector?: boolean | null;
}

/** Roles that carry out a production stage. */
export const PRODUCTION_ROLES = [
  "Cutter",
  "Tailor",
  "Sewer",
  "Monogrammer",
  "Embroiderer",
  "Buttonhole",
  "Button Tacking",
  "Ironer",
  "Packer",
  "Delivery",
] as const;

/** Production support: they help a Tailor/other stage (weaving, taping, ...). */
export const SUPPORT_ROLES = ["Weaver", "Taper", "Trimmer", "Helper"] as const;

/** Inspection / quality assurance roles. */
export const INSPECTION_ROLES = ["Inspection Officer", "Quality Officer"] as const;

/** Salaried people who are not production workers at all. */
export const NON_PRODUCTION_ROLES = [
  "Security",
  "Sales",
  "Director",
  "Management",
  "Administration",
  "IT",
  "Accounts",
  "Office Assistant",
  "Cleaner",
  "Driver",
  "Support Staff",
] as const;

export const ALL_KNOWN_ROLES: { role: string; kind: RoleKind }[] = [
  ...PRODUCTION_ROLES.map((role) => ({ role, kind: "PRODUCTION" as RoleKind })),
  ...SUPPORT_ROLES.map((role) => ({ role, kind: "SUPPORT" as RoleKind })),
  ...INSPECTION_ROLES.map((role) => ({ role, kind: "INSPECTION" as RoleKind })),
  ...NON_PRODUCTION_ROLES.map((role) => ({ role, kind: "NON_PRODUCTION" as RoleKind })),
];

/**
 * Which roles may carry out each production stage.
 * A role named exactly like the stage (e.g. "Buttonhole") always matches.
 * Support roles may take the finishing stages they actually help with.
 */
export const STAGE_ROLES: Record<string, string[]> = {
  CUTTING: ["Cutter"],
  SEWING: ["Tailor", "Sewer", "Weaver", "Taper", "Trimmer", "Helper"],
  MONOGRAMMING: ["Monogrammer", "Embroiderer", "Weaver"],
  BUTTONHOLE: ["Buttonhole", "Buttonholer"],
  BUTTON_TACKING: ["Button Tacking", "Button Tacker"],
  IRONING: ["Ironer", "Helper"],
  PACKING: ["Packer", "Helper"],
  DELIVERY: ["Packer", "Delivery", "Helper"],
};

/** Stage -> the role label shown on assignments and in the UI. */
export function stageRoleLabel(stage: string): string {
  return STAGE_ROLES[stage]?.[0] ?? stage.replaceAll("_", " ");
}

export function normalizeRole(role: string | null | undefined): string {
  return String(role ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function knownKind(role: string): RoleKind {
  const key = normalizeRole(role);
  const match = ALL_KNOWN_ROLES.find((entry) => normalizeRole(entry.role) === key);
  return match?.kind ?? "PRODUCTION";
}

export function normalizeKind(kind: unknown, role: string): RoleKind {
  const value = String(kind ?? "").toUpperCase();
  return (ROLE_KINDS as readonly string[]).includes(value) ? (value as RoleKind) : knownKind(role);
}

/** Does this role cover this production stage? */
export function roleMatchesStage(role: string | null | undefined, stage: string): boolean {
  const value = normalizeRole(role);
  if (!value) return false;
  const accepted = [...(STAGE_ROLES[stage] ?? []), stage];
  return accepted.some((entry) => normalizeRole(entry) === value);
}

/** One record's complete role list: explicit roles plus the legacy single specialty. */
export function deriveRoles(person: RolePerson, roles: WorkerRole[] = []): WorkerRole[] {
  const list: WorkerRole[] = [];
  const seen = new Set<string>();
  const add = (role: string, kind: RoleKind, isPrimary = false) => {
    const clean = String(role ?? "").trim().slice(0, 60);
    const key = normalizeRole(clean);
    if (!key || seen.has(key)) return;
    seen.add(key);
    list.push({ role: clean, kind, isPrimary });
  };
  for (const row of roles) add(row.role, normalizeKind(row.kind, row.role), !!row.isPrimary);
  // Existing records only have a single specialty. Keep it valid and visible
  // without forcing re-entry of every worker's role list.
  if (person.specialty) add(person.specialty, knownKind(person.specialty), list.length === 0);
  if (person.isInspector && !list.some((row) => row.kind === "INSPECTION")) {
    add("Inspection Officer", "INSPECTION");
  }
  if (!list.some((row) => row.isPrimary) && list.length > 0) list[0].isPrimary = true;
  return list;
}

/** Highest level of work a person's roles allow. Never trusted from the browser. */
export function staffTypeFor(roles: WorkerRole[]): StaffType {
  if (roles.some((row) => row.kind === "PRODUCTION")) return "PRODUCTION";
  if (roles.some((row) => row.kind === "SUPPORT")) return "SUPPORT";
  return "NON_PRODUCTION";
}

export function isProductionRole(role: WorkerRole): boolean {
  return role.kind === "PRODUCTION" || role.kind === "SUPPORT";
}

/** Roles that can be given work at this stage (empty for non-production staff). */
export function eligibleRolesForStage(person: RolePerson, roles: WorkerRole[], stage: string): WorkerRole[] {
  const all = deriveRoles(person, roles);
  if (staffTypeFor(all) === "NON_PRODUCTION") return [];
  return all.filter((row) => isProductionRole(row) && roleMatchesStage(row.role, stage));
}

export function canWorkStage(person: RolePerson, roles: WorkerRole[], stage: string): boolean {
  return eligibleRolesForStage(person, roles, stage).length > 0;
}

/** The role label snapshotted onto a production assignment. */
export function roleLabelForStage(person: RolePerson, roles: WorkerRole[], stage: string): string | null {
  return eligibleRolesForStage(person, roles, stage)[0]?.role ?? null;
}

export function isInspectionPerson(person: RolePerson, roles: WorkerRole[] = []): boolean {
  return !!person.isInspector || deriveRoles(person, roles).some((row) => row.kind === "INSPECTION");
}

export function roleLabels(person: RolePerson, roles: WorkerRole[] = []): string[] {
  return deriveRoles(person, roles).map((row) => row.role);
}

export function staffTypeLabel(staffType: string | null | undefined): string {
  if (staffType === "SUPPORT") return "Production support";
  if (staffType === "NON_PRODUCTION") return "Non-production staff";
  return "Production worker";
}

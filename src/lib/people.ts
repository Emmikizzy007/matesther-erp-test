import { db } from "@/db";
import { workerRoles } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  ALL_KNOWN_ROLES,
  deriveRoles,
  normalizeKind,
  normalizeRole,
  staffTypeFor,
  type RoleKind,
  type StaffType,
  type WorkerRole,
} from "@/lib/worker-roles";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Every person's saved roles, keyed by worker id. One query for list screens. */
export async function loadWorkerRoles(): Promise<Map<number, WorkerRole[]>> {
  const rows = await db.select().from(workerRoles);
  return groupRoles(rows);
}

export function groupRoles(
  rows: { workerId: number; role: string; kind: string; isPrimary: boolean }[]
): Map<number, WorkerRole[]> {
  const map = new Map<number, WorkerRole[]>();
  for (const row of rows) {
    const list = map.get(row.workerId) ?? [];
    list.push({ role: row.role, kind: normalizeKind(row.kind, row.role), isPrimary: row.isPrimary });
    map.set(row.workerId, list);
  }
  return map;
}

export interface SavedRoleSet {
  roles: WorkerRole[];
  specialty: string;
  staffType: StaffType;
  isInspector: boolean;
}

/**
 * Clean a role set coming from the browser: trim, drop blanks and duplicates.
 * The kind is re-derived from the role catalogue server-side so a client can
 * never promote a security guard into a Cutter by editing a request body.
 */
export function cleanRoles(input: unknown): WorkerRole[] {
  if (!Array.isArray(input)) return [];
  const list: WorkerRole[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const role = typeof raw === "string" ? raw : String((raw as { role?: unknown })?.role ?? "");
    const clean = role.trim().slice(0, 60);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // The catalogue is authoritative: a browser can never reclassify "Security"
    // as production work. Only unknown custom roles trust the stated kind.
    const known = ALL_KNOWN_ROLES.find((entry) => normalizeRole(entry.role) === normalizeRole(clean));
    const kind = known ? known.kind : normalizeKind((raw as { kind?: unknown })?.kind, clean);
    list.push({ role: clean, kind, isPrimary: false });
  }
  if (list.length > 0) {
    const wanted = (Array.isArray(input) ? input : []).find((raw) => (raw as { isPrimary?: unknown })?.isPrimary) as
      | { role?: unknown }
      | undefined;
    const primaryName = wanted ? String(wanted.role ?? "").trim().toLowerCase() : "";
    const index = Math.max(0, list.findIndex((row) => row.role.toLowerCase() === primaryName));
    list[index].isPrimary = true;
  }
  return list;
}

/**
 * Who this person is, in terms of work: their roles, their primary role label
 * (kept in workers.specialty for older screens and reports) and the legacy
 * is_inspector flag.
 */
export function describeRoles(
  roles: WorkerRole[],
  fallback: { specialty?: string | null; jobTitle?: string | null }
): SavedRoleSet {
  const primary = roles.find((row) => row.isPrimary) ?? roles[0];
  const productionPrimary = roles.find((row) => row.kind === "PRODUCTION") ?? roles.find((row) => row.kind === "SUPPORT");
  const fromProfile = String(fallback.specialty ?? "").trim();
  const specialty = productionPrimary?.role ?? primary?.role ?? fromProfile;
  return {
    roles,
    specialty: (specialty || String(fallback.jobTitle ?? "").trim() || "Staff").slice(0, 60),
    staffType: staffTypeFor(roles),
    isInspector: roles.some((row) => row.kind === "INSPECTION"),
  };
}

/** Replace a person's roles. Runs inside the caller's transaction. */
export async function replaceWorkerRoles(tx: Tx, workerId: number, roles: WorkerRole[]) {
  await tx.delete(workerRoles).where(eq(workerRoles.workerId, workerId));
  if (roles.length === 0) return;
  await tx.insert(workerRoles).values(
    roles.map((row) => ({
      workerId,
      role: row.role.slice(0, 60),
      kind: row.kind as RoleKind,
      isPrimary: !!row.isPrimary,
    }))
  );
}

/** Roles for one person, with the legacy specialty folded back in. */
export function rolesFor(
  person: { id: number; specialty?: string | null; staffType?: string | null; isInspector?: boolean | null },
  map: Map<number, WorkerRole[]>
): WorkerRole[] {
  return deriveRoles(person, map.get(person.id) ?? []);
}

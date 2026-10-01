import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workers, users, productionOperations, productionBatches, orders, customers, stageInspections, workerPayments, workerOvertime } from "@/db/schema";
import { guard, getSessionUser, OWNER, STAFF } from "@/lib/authz";
import { inspectionEarnings } from "@/lib/job-pay";
import { cleanRoles, describeRoles, loadWorkerRoles, replaceWorkerRoles } from "@/lib/people";
import { deriveRoles, normalizeKind, type WorkerRole } from "@/lib/worker-roles";

export async function GET(req: Request) {
  const denied = await guard(req, STAFF);
  if (denied) return denied;
  try {
    const isManager = (await getSessionUser(req))?.role === "PRODUCTION_MANAGER";
    const query = new URL(req.url).searchParams;
    const [people, operations, inspections, payRows, overtimeRows, roleMap] = await Promise.all([
      db.select().from(workers), db.select().from(productionOperations), db.select().from(stageInspections),
      db.select().from(workerPayments), db.select().from(workerOvertime), loadWorkerRoles(),
    ]);
    // Payroll, earnings and bank details never reach a Project Manager.
    const personView = (person: typeof workers.$inferSelect, roles: WorkerRole[]) => isManager
      ? { id: person.id, name: person.name, phone: person.phone, specialty: person.specialty, status: person.status,
          paymentType: person.paymentType, isInspector: person.isInspector, staffType: person.staffType,
          department: person.department, jobTitle: person.jobTitle, roles, createdAt: person.createdAt }
      : { ...person, roles };
    const expanded = people.map((person) => {
      const mine = operations.filter((op) => op.workerId === person.id);
      const byId = new Map(mine.map((op) => [op.id, op]));
      const approved = mine.reduce((sum, op) => sum + op.quantityApproved, 0);
      const roles = deriveRoles(person, roleMap.get(person.id) ?? []);
      const earned = person.paymentType === "PER_PIECE"
        ? inspections.reduce((sum, check) => {
            const op = byId.get(check.productionOperationId);
            return op ? sum + inspectionEarnings(check, op, person) : sum;
          }, 0)
        : person.paymentType === "MONTHLY" ? person.paymentRate : 0;
      return {
        ...personView(person, roles),
        currentTasks: mine.filter((op) => ["IN_PROGRESS", "SUBMITTED"].includes(op.status)).length,
        assigned: mine.reduce((sum, op) => sum + op.quantityReceived, 0),
        completed: mine.reduce((sum, op) => sum + op.quantityCompleted, 0),
        rejected: mine.reduce((sum, op) => sum + op.quantityRejected, 0),
        approved,
        hasHistory: mine.length > 0 || payRows.some((p) => p.workerId === person.id) || overtimeRows.some((p) => p.workerId === person.id),
        ...(!isManager ? { earnings: earned } : {}),
      };
    });
    const id = Number(query.get("id"));
    if (query.get("id")) {
      const profile = expanded.find((person) => person.id === id);
      if (!profile) return NextResponse.json({ error: "Worker not found." }, { status: 404 });
      const [batches, orderRows, schools] = await Promise.all([
        db.select().from(productionBatches), db.select().from(orders), db.select().from(customers),
      ]);
      const batchMap = new Map(batches.map((batch) => [batch.id, batch]));
      const orderMap = new Map(orderRows.map((order) => [order.id, order]));
      const schoolMap = new Map(schools.map((school) => [school.id, school]));
      const history = operations.filter((op) => op.workerId === id).map((op) => {
        const batch = batchMap.get(op.productionBatchId);
        const order = batch ? orderMap.get(batch.orderId) : undefined;
        return {
          ...op, ...(!isManager ? {} : { pieceRate: undefined }),
          batchNumber: batch?.batchNumber ?? "-", size: batch?.size ?? null, color: batch?.color ?? null,
          orderId: order?.id, orderNumber: order?.orderNumber ?? "-",
          customer: schoolMap.get(order?.customerId ?? -1)?.name ?? "-",
        };
      });
      return NextResponse.json({ ...profile, history }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const list = query.get("showArchived") === "1" ? expanded : expanded.filter((person) => person.status === "ACTIVE");
    return NextResponse.json(list, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Workers load failed", error);
    return NextResponse.json({ error: "Unable to load workers." }, { status: 500 });
  }
}

type WorkerInput = {
  name: string;
  phone: string | null;
  roles: WorkerRole[];
  specialty: string;
  staffType: string;
  isInspector: boolean;
  department: string | null;
  jobTitle: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  paymentType: string;
  paymentRate: number;
};

/** Shared validation for adding and editing a person. Roles decide their work. */
function readWorker(body: Record<string, unknown>, existing?: typeof workers.$inferSelect): WorkerInput | { error: string } {
  const name = String(body.name ?? existing?.name ?? "").trim();
  if (!name) return { error: "Worker name is required." };
  const savedRoles = cleanRoles(body.roles ?? []);
  const legacySpecialty = String(body.specialty ?? existing?.specialty ?? "").trim();
  // Older clients only send a single specialty: keep them working by treating
  // it as one production role instead of silently dropping the person's work.
  const roles = savedRoles.length || !legacySpecialty
    ? savedRoles
    : [{ role: legacySpecialty, kind: normalizeKind(undefined, legacySpecialty), isPrimary: true } as WorkerRole];
  const described = describeRoles(roles, {
    specialty: body.specialty !== undefined ? String(body.specialty) : existing?.specialty,
    jobTitle: body.jobTitle !== undefined ? String(body.jobTitle) : existing?.jobTitle,
  });
  const paymentType = ["PER_PIECE", "MONTHLY", "DAILY"].includes(String(body.paymentType))
    ? String(body.paymentType)
    : existing?.paymentType ?? "PER_PIECE";
  const rate = Number(body.paymentRate ?? existing?.paymentRate ?? 0);
  if (!Number.isSafeInteger(rate) || rate < 0)
    return { error: "Enter a valid pay amount (a whole number of naira)." };
  if (paymentType === "MONTHLY" && rate < 1)
    return { error: "Enter the monthly salary for this member of staff." };
  if (paymentType === "PER_PIECE") {
    if (described.staffType === "NON_PRODUCTION")
      return { error: "Per-piece pay needs a production role. Security, sales, office and management staff are paid a salary or daily rate." };
    if (rate < 1) return { error: "Enter the agreed amount per piece for this worker." };
  }
  const text = (value: unknown, max: number) => {
    const clean = String(value ?? "").trim();
    return clean ? clean.slice(0, max) : null;
  };
  return {
    name,
    phone: text(body.phone, 40),
    roles: described.roles,
    specialty: described.specialty,
    staffType: described.staffType,
    // Inspection cannot be granted to a person who does not have the role.
    isInspector: described.isInspector || (roles.length === 0 && !!body.isInspector),
    department: text(body.department, 60),
    jobTitle: text(body.jobTitle, 60),
    bankName: text(body.bankName, 80),
    bankAccountName: text(body.bankAccountName, 80),
    bankAccountNumber: text(body.bankAccountNumber, 40),
    paymentType,
    paymentRate: rate,
  };
}

export async function POST(req: Request) {
  const denied = await guard(req, OWNER);
  if (denied) return denied;
  try {
    const body = await req.json();
    const input = readWorker(body);
    if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });
    const created = await db.transaction(async (tx) => {
      const [person] = await tx.insert(workers).values({
        organizationId: 1, name: input.name, phone: input.phone,
        specialty: input.specialty, staffType: input.staffType, department: input.department, jobTitle: input.jobTitle,
        bankName: input.bankName, bankAccountName: input.bankAccountName, bankAccountNumber: input.bankAccountNumber,
        paymentType: input.paymentType, paymentRate: input.paymentRate,
        status: "ACTIVE", isInspector: input.isInspector,
      }).returning();
      await replaceWorkerRoles(tx, person.id, input.roles);
      return person;
    });
    return NextResponse.json({ ...created, roles: input.roles }, { status: 201 });
  } catch (error) {
    console.error("Worker creation failed", error);
    return NextResponse.json({ error: "Unable to add this worker." }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const denied = await guard(req, OWNER);
  if (denied) return denied;
  try {
    const body = await req.json();
    const id = Number(body.id);
    if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "Select a worker." }, { status: 400 });
    const [existing] = await db.select().from(workers).where(eq(workers.id, id)).limit(1);
    if (!existing) return NextResponse.json({ error: "Worker not found." }, { status: 404 });
    const roleMap = await loadWorkerRoles();
    const currentRoles = deriveRoles(existing, roleMap.get(id) ?? []);
    const input = readWorker(
      { ...body, roles: body.roles === undefined ? currentRoles : body.roles },
      existing
    );
    if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });
    const status = body.status === "INACTIVE" ? "INACTIVE" : body.status === "ACTIVE" ? "ACTIVE" : existing.status;
    const updated = await db.transaction(async (tx) => {
      const [person] = await tx.update(workers).set({
        name: input.name,
        phone: input.phone,
        specialty: input.specialty,
        staffType: input.staffType,
        department: input.department,
        jobTitle: input.jobTitle,
        bankName: input.bankName,
        bankAccountName: input.bankAccountName,
        bankAccountNumber: input.bankAccountNumber,
        paymentType: input.paymentType,
        paymentRate: input.paymentRate,
        isInspector: input.isInspector,
        status,
        archivedAt: status === "INACTIVE" ? existing.archivedAt ?? new Date() : null,
      }).where(eq(workers.id, id)).returning();
      await replaceWorkerRoles(tx, id, input.roles);
      return person;
    });
    return NextResponse.json({ ...updated, roles: input.roles });
  } catch (error) {
    console.error("Worker update failed", error);
    return NextResponse.json({ error: "Unable to update this worker." }, { status: 500 });
  }
}

/** Hard-delete only unused people; archive anyone with a production/payroll trail. */
export async function DELETE(req: Request) {
  const denied = await guard(req, OWNER);
  if (denied) return denied;
  try {
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "Select a worker." }, { status: 400 });
    const [person] = await db.select().from(workers).where(eq(workers.id, id)).limit(1);
    if (!person) return NextResponse.json({ error: "Worker not found." }, { status: 404 });
    const [jobs, wages, overtime] = await Promise.all([
      db.select({ id: productionOperations.id }).from(productionOperations).where(eq(productionOperations.workerId, id)).limit(1),
      db.select({ id: workerPayments.id }).from(workerPayments).where(eq(workerPayments.workerId, id)).limit(1),
      db.select({ id: workerOvertime.id }).from(workerOvertime).where(eq(workerOvertime.workerId, id)).limit(1),
    ]);
    const archived = jobs.length > 0 || wages.length > 0 || overtime.length > 0;
    await db.transaction(async (tx) => {
      await tx.update(users).set({ status: "INACTIVE" }).where(eq(users.workerId, id));
      if (archived) await tx.update(workers).set({ status: "INACTIVE", archivedAt: person.archivedAt ?? new Date() }).where(eq(workers.id, id));
      else await tx.delete(workers).where(eq(workers.id, id));
    });
    return NextResponse.json({ ok: true, archived, message: archived
      ? "Worker archived. Production and pay history remain available under Show archived. Any linked login was disabled."
      : "Unused worker deleted. Any linked login was disabled." });
  } catch (error) {
    console.error("Worker removal failed", error);
    return NextResponse.json({ error: "Unable to remove this worker." }, { status: 500 });
  }
}

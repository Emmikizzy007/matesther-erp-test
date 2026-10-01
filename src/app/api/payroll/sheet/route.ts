import { NextResponse } from "next/server";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { guard, getSessionUser, OWNER } from "@/lib/authz";
import { payrollSheet, currentMonth } from "@/lib/payroll";

export const dynamic = "force-dynamic";

/**
 * GET /api/payroll/sheet?month=YYYY-MM
 *
 * Owner-only data for the printable monthly bank payment sheet.
 * Project Managers and Workers are refused outright - wages, balances and bank
 * account numbers must never leave the Owner's screens.
 */
export async function GET(req: Request) {
  const denied = await guard(req, OWNER);
  if (denied) return denied;
  try {
    const month = new URL(req.url).searchParams.get("month") || currentMonth();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
      return NextResponse.json({ error: "Choose a valid month (YYYY-MM)." }, { status: 400 });
    const [sheet, orgRows, user] = await Promise.all([
      payrollSheet(month),
      db.select().from(organizations).where(eq(organizations.id, 1)).limit(1),
      getSessionUser(req),
    ]);
    return NextResponse.json(
      {
        ...sheet,
        preparedBy: user?.name ?? null,
        generatedAt: new Date().toISOString(),
        business: orgRows[0]
          ? { name: orgRows[0].name, address: orgRows[0].address, phone: orgRows[0].phone, email: orgRows[0].email }
          : null,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("Payroll sheet failed", error);
    return NextResponse.json({ error: "Unable to build the payment sheet." }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { deliveries, payments } from "@/db/schema";
import { guard, OWNER } from "@/lib/authz";
import { createDocumentToken, isShareDocumentType, sharePath, SHARE_LINK_DAYS } from "@/lib/doc-links";

export const dynamic = "force-dynamic";

/**
 * POST /api/documents/share  { type: "receipt" | "delivery", id }
 *
 * Owner-only. Creates a signed, expiring link for a CUSTOMER document so it can
 * be sent over WhatsApp. Payroll and internal financial documents are not
 * shareable by design - only payment receipts and delivery sheets are allowed.
 */
export async function POST(req: Request) {
  const denied = await guard(req, OWNER);
  if (denied) return denied;
  try {
    const body = await req.json();
    const type = body.type;
    const id = Number(body.id);
    if (!isShareDocumentType(type) || !Number.isSafeInteger(id) || id < 1)
      return NextResponse.json({ error: "Choose a customer document to share." }, { status: 400 });

    if (type === "receipt") {
      const [payment] = await db.select({ id: payments.id }).from(payments).where(eq(payments.id, id)).limit(1);
      if (!payment) return NextResponse.json({ error: "That payment receipt could not be found." }, { status: 404 });
    } else {
      const [delivery] = await db.select({ id: deliveries.id }).from(deliveries).where(eq(deliveries.id, id)).limit(1);
      if (!delivery) return NextResponse.json({ error: "That delivery sheet could not be found." }, { status: 404 });
    }

    const { token, expiresAt } = createDocumentToken(type, id);
    return NextResponse.json(
      {
        type,
        id,
        path: sharePath(token),
        expiresAt,
        expiresInDays: SHARE_LINK_DAYS,
        note: "Anyone with this link can view the customer document until it expires. It never contains payroll or internal cost information.",
      },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Document share failed", error);
    return NextResponse.json({ error: "Could not create a share link for this document." }, { status: 500 });
  }
}

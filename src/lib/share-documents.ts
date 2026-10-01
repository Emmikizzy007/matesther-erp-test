import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  customers,
  deliveries,
  deliveryLines,
  orderItems,
  orders,
  organizations,
  payments,
  products,
} from "@/db/schema";
import type { LetterBusiness } from "@/components/documents/Letterhead";

/**
 * Customer-facing projections for WhatsApp-shared documents.
 *
 * These are deliberately built as explicit whitelists: no worker wages, no
 * internal costs, no profitability and no other customer's records can leak in
 * even if the internal tables grow new columns later.
 */

export interface SharedReceipt {
  kind: "receipt";
  reference: string;
  receiptNo: string;
  payment: { amount: number; date: string; method: string; reference: string | null };
  order: { orderNumber: string; orderDate: string; totalAmount: number; paidToDate: number; balanceBefore: number; balanceAfter: number };
  items: { description: string; quantity: number; unitPrice: number; total: number }[];
  customer: { name: string; contactPerson: string | null; address: string | null } | null;
  business: LetterBusiness | null;
  expiresAt: Date;
}

export interface SharedDelivery {
  kind: "delivery";
  reference: string;
  delivery: { deliveryNumber: string; deliveryDate: string; deliveredQuantity: number; recipient: string | null; deliveryAddress: string | null; status: string };
  lines: { description: string; size: string | null; quantity: number }[];
  order: { orderNumber: string; orderDate: string };
  customer: { name: string; contactPerson: string | null; address: string | null } | null;
  business: LetterBusiness | null;
  expiresAt: Date;
}

export type SharedDocument = SharedReceipt | SharedDelivery;

async function business(): Promise<LetterBusiness | null> {
  const [org] = await db
    .select({ name: organizations.name, phone: organizations.phone, email: organizations.email, address: organizations.address })
    .from(organizations)
    .where(eq(organizations.id, 1))
    .limit(1);
  return org ?? null;
}

/** Payment receipt for the customer - never any internal cost or payroll data. */
export async function loadSharedReceipt(paymentId: number, expiresAt: Date): Promise<SharedReceipt | null> {
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (!payment) return null;
  const [order] = await db.select().from(orders).where(eq(orders.id, payment.orderId)).limit(1);
  if (!order) return null;
  const [customerRows, itemRows, allPayments, productRows, businessRow] = await Promise.all([
    order.customerId ? db.select().from(customers).where(eq(customers.id, order.customerId)).limit(1) : Promise.resolve([]),
    db.select().from(orderItems).where(eq(orderItems.orderId, order.id)),
    db.select().from(payments).where(eq(payments.orderId, order.id)).orderBy(asc(payments.paymentDate), asc(payments.id)),
    db.select().from(products),
    business(),
  ]);
  const productNames = new Map(productRows.map((row) => [row.id, row.name]));
  const paidBefore = allPayments
    .filter((row) => row.paymentDate < payment.paymentDate || (row.paymentDate === payment.paymentDate && row.id < payment.id))
    .reduce((sum, row) => sum + row.amount, 0);
  const balanceBefore = order.totalAmount - paidBefore;
  const customer = customerRows[0];
  return {
    kind: "receipt",
    reference: `MTH-REC-${String(payment.id).padStart(4, "0")}`,
    receiptNo: `MTH-REC-${String(payment.id).padStart(4, "0")}`,
    payment: { amount: payment.amount, date: payment.paymentDate, method: payment.paymentMethod, reference: payment.reference },
    order: {
      orderNumber: order.orderNumber,
      orderDate: order.orderDate,
      totalAmount: order.totalAmount,
      paidToDate: paidBefore + payment.amount,
      balanceBefore,
      balanceAfter: balanceBefore - payment.amount,
    },
    items: itemRows.map((item) => ({
      description: item.productId ? productNames.get(item.productId) ?? "Uniform item" : "Uniform item",
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.totalPrice,
    })),
    customer: customer
      ? { name: customer.name, contactPerson: customer.contactPerson, address: customer.address }
      : null,
    business: businessRow,
    expiresAt,
  };
}

/** Delivery sheet for the customer - garments handed over, nothing internal. */
export async function loadSharedDelivery(deliveryId: number, expiresAt: Date): Promise<SharedDelivery | null> {
  const [delivery] = await db.select().from(deliveries).where(eq(deliveries.id, deliveryId)).limit(1);
  if (!delivery) return null;
  const [order] = await db.select().from(orders).where(eq(orders.id, delivery.orderId)).limit(1);
  if (!order) return null;
  const [customerRows, lines, businessRow] = await Promise.all([
    order.customerId ? db.select().from(customers).where(eq(customers.id, order.customerId)).limit(1) : Promise.resolve([]),
    db.select().from(deliveryLines).where(eq(deliveryLines.deliveryId, deliveryId)).orderBy(asc(deliveryLines.id)),
    business(),
  ]);
  const customer = customerRows[0];
  const fallbackLines = lines.length
    ? lines
    : [{ description: "Garments delivered", size: null, quantity: delivery.deliveredQuantity }];
  return {
    kind: "delivery",
    reference: `MTH-DLV-${String(delivery.id).padStart(4, "0")}`,
    delivery: {
      deliveryNumber: `MTH-DLV-${String(delivery.id).padStart(4, "0")}`,
      deliveryDate: delivery.deliveryDate,
      deliveredQuantity: delivery.deliveredQuantity,
      recipient: delivery.recipient,
      deliveryAddress: delivery.deliveryAddress,
      status: delivery.status,
    },
    lines: fallbackLines.map((line) => ({ description: line.description, size: line.size, quantity: line.quantity })),
    order: { orderNumber: order.orderNumber, orderDate: order.orderDate },
    customer: customer
      ? { name: customer.name, contactPerson: customer.contactPerson, address: customer.address }
      : null,
    business: businessRow,
    expiresAt,
  };
}

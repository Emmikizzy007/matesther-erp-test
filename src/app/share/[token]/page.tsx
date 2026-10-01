import Link from "next/link";
import type { Metadata } from "next";
import { Letterhead } from "@/components/documents/Letterhead";
import { PrintButton } from "@/components/documents/PrintButton";
import { loadSharedDelivery, loadSharedReceipt } from "@/lib/share-documents";
import { verifyDocumentToken } from "@/lib/doc-links";
import { fmtDate, naira } from "@/lib/format";

/** Shared customer documents must never be indexed by search engines. */
export const metadata: Metadata = {
  title: "Matesther document",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function SharedDocumentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const verified = verifyDocumentToken(decodeURIComponent(token ?? ""));

  if (!verified) {
    return (
      <main className="document-page flex min-h-screen items-center justify-center bg-[#f2f3ee] p-6">
        <div className="max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-bold text-slate-900">This link has expired</h1>
          <p className="mt-2 text-sm text-slate-600">
            Matesther document links are private and time limited. Please ask Matesther Enterprises for a fresh link to this receipt or delivery sheet.
          </p>
          <p className="mt-4 text-xs text-slate-400">Matesther Enterprises • perfecting the right stitches</p>
        </div>
      </main>
    );
  }

  const document = verified.type === "receipt"
    ? await loadSharedReceipt(verified.id, verified.expiresAt)
    : await loadSharedDelivery(verified.id, verified.expiresAt);

  if (!document) {
    return (
      <main className="document-page flex min-h-screen items-center justify-center bg-[#f2f3ee] p-6">
        <div className="max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-bold text-slate-900">Document not found</h1>
          <p className="mt-2 text-sm text-slate-600">This document may have been removed. Please contact Matesther Enterprises.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="document-page min-h-screen bg-[#f2f3ee] px-3 py-6 sm:px-6">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
        <p className="text-slate-600">
          Shared by <strong>Matesther Enterprises</strong>. This link is private and expires {fmtDate(document.expiresAt)}.
        </p>
        <div className="flex items-center gap-2">
          <PrintButton />
          <Link href="/login" className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100">
            Matesther staff sign in
          </Link>
        </div>
      </div>

      {document.kind === "receipt" ? (
        <Letterhead
          business={document.business}
          ourRef={document.reference}
          yourRef={document.order.orderNumber}
          date={fmtDate(document.payment.date)}
          title="Customer Payment Receipt"
          subtitle={`${document.customer?.name ?? "Customer"} • Order ${document.order.orderNumber}`}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#987048]">Received from</p>
              <p className="mt-1 font-semibold text-[#282b25]">{document.customer?.name ?? "Customer"}</p>
              {document.customer?.contactPerson && <p>Attention: {document.customer.contactPerson}</p>}
              <p className="text-[#5a6056]">{document.customer?.address || "Address not recorded"}</p>
            </div>
            <div className="sm:text-right">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#987048]">Payment</p>
              <p className="mt-1">Date: <strong>{fmtDate(document.payment.date)}</strong></p>
              <p>Method: <strong>{document.payment.method}</strong></p>
              {document.payment.reference && <p>Reference: <strong>{document.payment.reference}</strong></p>}
            </div>
          </div>

          <h3 className="letter-section-title">Uniforms covered by this order</h3>
          <table className="letter-table">
            <thead><tr><th>Garment</th><th className="text-right">Qty</th><th className="text-right">Unit price</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {document.items.map((item, index) => (
                <tr key={`${item.description}-${index}`}>
                  <td>{item.description}</td>
                  <td className="text-right">{item.quantity.toLocaleString()}</td>
                  <td className="text-right">{naira(item.unitPrice)}</td>
                  <td className="text-right">{naira(item.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3}>Order total</td><td className="text-right">{naira(document.order.totalAmount)}</td></tr></tfoot>
          </table>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="letter-total-box"><p className="text-[11px] uppercase text-[#6b7a52]">Amount received</p><p className="text-lg font-bold">{naira(document.payment.amount)}</p></div>
            <div className="letter-total-box"><p className="text-[11px] uppercase text-[#6b7a52]">Paid to date</p><p className="text-lg font-bold">{naira(document.order.paidToDate)}</p></div>
            <div className="letter-total-box"><p className="text-[11px] uppercase text-[#6b7a52]">Balance after payment</p><p className="text-lg font-bold">{naira(document.order.balanceAfter)}</p></div>
          </div>

          <p className="mt-6 text-xs text-[#5a6056]">
            Thank you for your payment. This receipt was issued electronically by Matesther Enterprises and can be printed or saved as a PDF.
          </p>
        </Letterhead>
      ) : (
        <Letterhead
          business={document.business}
          ourRef={document.reference}
          yourRef={document.order.orderNumber}
          date={fmtDate(document.delivery.deliveryDate)}
          title="School Uniform Delivery Sheet"
          subtitle={`${document.customer?.name ?? "Customer"} • Order ${document.order.orderNumber}`}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#987048]">Delivered to</p>
              <p className="mt-1 font-semibold text-[#282b25]">{document.customer?.name ?? "Customer"}</p>
              {document.customer?.contactPerson && <p>Attention: {document.customer.contactPerson}</p>}
              <p className="text-[#5a6056]">{document.delivery.deliveryAddress || document.customer?.address || "Address not recorded"}</p>
            </div>
            <div className="sm:text-right">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#987048]">Consignment</p>
              <p className="mt-1">Delivery date: <strong>{fmtDate(document.delivery.deliveryDate)}</strong></p>
              <p>Status: <strong>{document.delivery.status === "PARTIAL" ? "Part delivery" : document.delivery.status === "DELIVERED" ? "Delivered" : document.delivery.status}</strong></p>
              {document.delivery.recipient && <p>Received by: <strong>{document.delivery.recipient}</strong></p>}
            </div>
          </div>

          <h3 className="letter-section-title">Details of uniforms handed over</h3>
          <table className="letter-table">
            <thead><tr><th>Garment / school uniform</th><th>Size</th><th className="text-right">Quantity</th></tr></thead>
            <tbody>
              {document.lines.map((line, index) => (
                <tr key={`${line.description}-${line.size ?? ""}-${index}`}>
                  <td>{line.description}</td>
                  <td>{line.size || "Assorted"}</td>
                  <td className="text-right">{line.quantity.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={2}>Total handed over on this delivery</td><td className="text-right">{document.delivery.deliveredQuantity.toLocaleString()} pcs</td></tr></tfoot>
          </table>

          <div className="letter-signatures">
            <div>
              <p>Delivered by (Matesther)</p>
              <span className="letter-signature-line" />
              <p className="letter-signature-name">&nbsp;</p>
            </div>
            <div>
              <p>Received by (school / customer)</p>
              <span className="letter-signature-line" />
              <p className="letter-signature-name">{document.delivery.recipient ?? "Name, signature & date"}</p>
            </div>
          </div>
        </Letterhead>
      )}
    </main>
  );
}

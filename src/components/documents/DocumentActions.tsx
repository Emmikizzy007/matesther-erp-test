"use client";

import { useState } from "react";
import { ArrowLeft, Copy, Link2, Mail, MessageCircle, Printer, Share2 } from "lucide-react";

/**
 * Actions for a customer-facing document (payment receipt or delivery sheet).
 *
 * WhatsApp is the channel Matesther actually uses with schools, so the primary
 * action opens a wa.me chat with the message ready to send. When a secure
 * expiring link is available the message carries that link; otherwise it
 * carries the written details and the recipient is asked to print the
 * letterheaded copy. Payroll and internal financial pages never use this
 * component.
 */
export function DocumentActions({
  title,
  filename,
  customerEmail,
  customerPhone,
  message,
  shareType,
  shareId,
}: {
  title: string;
  filename: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  message: string;
  /** Customer document type the server may issue a signed, expiring link for. */
  shareType?: "receipt" | "delivery";
  shareId?: number;
}) {
  const [feedback, setFeedback] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const subject = encodeURIComponent(title);
  const body = encodeURIComponent(message);

  /** Signed link, created on demand by the Owner-only API. */
  async function secureLink(): Promise<string | null> {
    if (link) return link;
    if (!shareType || !shareId) return null;
    try {
      const response = await fetch("/api/documents/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: shareType, id: shareId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create a link.");
      const url = new URL(data.path as string, window.location.origin).toString();
      setLink(url);
      return url;
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not create a share link.");
      return null;
    }
  }

  async function whatsapp() {
    setBusy(true);
    setFeedback("");
    const url = await secureLink();
    const text = url
      ? `${message}\n\nView the document: ${url}\n\nThe link is private, expires on its own and can be opened on any phone.`
      : `${message}\n\n(Print or Save as PDF, then attach the letterheaded copy.)`;
    const digits = String(customerPhone ?? "").replace(/[^\d]/g, "");
    const target = digits.length >= 10 ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(target, "_blank", "noopener,noreferrer");
    setFeedback(digits.length >= 10
      ? "WhatsApp is open with the message ready to send."
      : "WhatsApp is open. Choose the customer's chat, then send the prepared message.");
    setBusy(false);
  }

  async function copyLink() {
    setBusy(true);
    setFeedback("");
    const url = await secureLink();
    if (!url) { setBusy(false); return; }
    try {
      await navigator.clipboard.writeText(url);
      setFeedback("Private document link copied. It expires on its own and contains no salary information.");
    } catch {
      window.prompt("Copy this private document link:", url);
    }
    setBusy(false);
  }

  async function share() {
    try {
      const url = await secureLink();
      const text = url ? `${message}\n\n${url}` : message;
      if (typeof navigator.share === "function") {
        await navigator.share({ title, text });
        setFeedback("Details shared. To send the letterheaded PDF, save it with Print / Save as PDF.");
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setFeedback("Details copied. You can paste them into WhatsApp or an email.");
      } else {
        setFeedback("Use Print / Save as PDF, then attach the file when sending it.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFeedback("Could not share from this browser. Try Print / Save as PDF.");
    }
  }

  return (
    <div className="document-actions no-print mx-auto mb-5 max-w-[210mm] rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => history.back()} className="mr-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <button type="button" onClick={whatsapp} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-[#128C7E] px-3 py-2 text-sm font-semibold text-white hover:bg-[#0e6e63] disabled:opacity-60">
          <MessageCircle className="h-4 w-4" /> Send on WhatsApp
        </button>
        {(shareType && shareId) && (
          <button type="button" onClick={copyLink} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            <Link2 className="h-4 w-4" /> Copy customer link
          </button>
        )}
        {customerEmail && (
          <a href={`mailto:${encodeURIComponent(customerEmail)}?subject=${subject}&body=${body}`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <Mail className="h-4 w-4" /> Email details
          </a>
        )}
        <button type="button" onClick={share} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          {typeof navigator !== "undefined" && typeof navigator.share === "function" ? <Share2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Share details
        </button>
        <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-matesther-800 px-3 py-2 text-sm font-semibold text-white hover:bg-matesther-900">
          <Printer className="h-4 w-4" /> Print / Save as PDF
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        For the letterheaded {filename}, choose Print / Save as PDF and attach the saved file, or send the private customer link from WhatsApp.
        The link expires by itself and never contains staff pay or company financial information.
      </p>
      {feedback && <p className="mt-2 text-xs font-semibold text-matesther-700" role="status">{feedback}</p>}
    </div>
  );
}

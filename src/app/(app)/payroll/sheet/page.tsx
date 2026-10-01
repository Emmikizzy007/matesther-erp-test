"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Printer, ShieldAlert } from "lucide-react";
import { Loading, PageHeader, inputCls, Btn } from "@/components/ui";
import { Letterhead, type LetterBusiness } from "@/components/documents/Letterhead";
import { naira, fmtDate } from "@/lib/format";
import { useAuth } from "@/lib/auth";

type SheetRow = {
  workerId: number; name: string; roles: string[]; staffType: string; department: string | null;
  jobTitle: string | null; paymentType: string; pieces: number; basic: number; piecework: number;
  overtime: number; due: number; paid: number; balance: number; status: "PAID" | "PART" | "UNPAID";
  bankName: string | null; bankAccountName: string | null; bankAccountNumber: string | null;
};
type Sheet = {
  month: string; label: string; rows: SheetRow[];
  totals: { staff: number; basic: number; piecework: number; overtime: number; due: number; paid: number; balance: number };
  preparedBy: string | null; generatedAt: string; business: LetterBusiness | null;
};

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function shiftMonth(key: string, delta: number) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * MATESTHER monthly bank payment sheet - Owner only.
 * Print or Save as PDF, then send the file to the bank. There is deliberately
 * no share link here: wages, balances and account numbers stay in the Owner's
 * hands and are never exposed on a public URL.
 */
export default function BankPaymentSheetPage() {
  const { user } = useAuth();
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [error, setError] = useState("");
  const isOwner = user?.role === "OWNER";

  useEffect(() => {
    if (!isOwner) return;
    let active = true;
    setError("");
    fetch(`/api/payroll/sheet?month=${month}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not build the payment sheet.");
        return data as Sheet;
      })
      .then((data) => { if (active) setSheet(data); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not build the payment sheet."); });
    return () => { active = false; };
  }, [month, isOwner]);

  if (!isOwner) {
    return (
      <div>
        <PageHeader title="Monthly Bank Payment Sheet" />
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <p>This sheet contains salaries, balances and bank account numbers. It is available to the Owner account only.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="document-page">
      <div className="no-print mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <PageHeader title="Monthly Bank Payment Sheet" subtitle="Owner-only printable schedule of what Matesther is paying this month - print or Save as PDF, then send it to the bank." />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-slate-600">
            Month
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value || month)} className={`${inputCls} mt-1`} />
          </label>
          <Btn variant="secondary" onClick={() => setMonth((current) => shiftMonth(current, -1))}>Previous</Btn>
          <Btn variant="secondary" onClick={() => setMonth((current) => shiftMonth(current, 1))}>Next</Btn>
          <Btn onClick={() => window.print()}><Printer className="h-4 w-4" /> Print / Save as PDF</Btn>
        </div>
      </div>
      <div className="no-print mb-4">
        <Link href="/payroll" className="inline-flex items-center gap-1.5 text-sm font-semibold text-matesther-700 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back to worker payments
        </Link>
      </div>

      {error && <div className="no-print rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">{error}</div>}
      {!error && !sheet && <div className="no-print"><Loading /></div>}

      {sheet && (
        <Letterhead
          business={sheet.business}
          ourRef={`MTH-PAY-${sheet.month}`}
          yourRef="Monthly payroll"
          date={fmtDate(sheet.generatedAt)}
          title="Monthly Staff Payment Schedule"
          subtitle={`Payment period: ${sheet.label}`}
        >
          <div className="letter-summary">
            <div><p className="letter-summary-label">Staff on this sheet</p><p className="letter-summary-value">{sheet.totals.staff}</p></div>
            <div><p className="letter-summary-label">Total payroll due</p><p className="letter-summary-value">{naira(sheet.totals.due)}</p></div>
            <div><p className="letter-summary-label">Already paid</p><p className="letter-summary-value">{naira(sheet.totals.paid)}</p></div>
            <div><p className="letter-summary-label">Balance to pay</p><p className="letter-summary-value">{naira(sheet.totals.balance)}</p></div>
          </div>

          <p className="letter-paragraph">
            Please pay the members of staff listed below for the {sheet.label} payroll period. Only work that was inspected and approved is paid
            as piecework. Salaried and non-production staff are paid their basic salary. Balances are shown against payments already recorded.
          </p>

          <table className="letter-table">
            <thead>
              <tr>
                <th style={{ width: "4%" }}>#</th>
                <th style={{ width: "20%" }}>Staff name</th>
                <th style={{ width: "16%" }}>Role(s)</th>
                <th style={{ width: "10%" }}>Department</th>
                <th style={{ width: "9%" }}>Pay type</th>
                <th className="text-right" style={{ width: "11%" }}>Basic salary</th>
                <th className="text-right" style={{ width: "11%" }}>Piecework</th>
                <th className="text-right" style={{ width: "9%" }}>Overtime</th>
                <th className="text-right" style={{ width: "11%" }}>Total due</th>
                <th className="text-right" style={{ width: "10%" }}>Paid</th>
                <th className="text-right" style={{ width: "10%" }}>Balance</th>
                <th style={{ width: "8%" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row, index) => (
                <tr key={row.workerId}>
                  <td>{index + 1}</td>
                  <td>
                    <strong>{row.name}</strong>
                    {row.bankName || row.bankAccountNumber ? (
                      <span className="block text-[11px] text-[#5b5f66]">
                        {[row.bankName, row.bankAccountName, row.bankAccountNumber].filter(Boolean).join(" • ")}
                      </span>
                    ) : (
                      <span className="block text-[11px] text-[#a8451f]">No bank details recorded</span>
                    )}
                  </td>
                  <td>{row.roles.join(", ") || "-"}{row.jobTitle ? <span className="block text-[11px] text-[#5b5f66]">{row.jobTitle}</span> : null}</td>
                  <td>{row.department || "-"}</td>
                  <td>{row.paymentType === "PER_PIECE" ? "Per piece" : row.paymentType === "MONTHLY" ? "Monthly" : "Daily"}</td>
                  <td className="text-right">{row.basic ? naira(row.basic) : "-"}</td>
                  <td className="text-right">{row.piecework ? <>{naira(row.piecework)}<span className="block text-[11px] text-[#5b5f66]">{row.pieces} approved pcs</span></> : "-"}</td>
                  <td className="text-right">{row.overtime ? naira(row.overtime) : "-"}</td>
                  <td className="text-right"><strong>{naira(row.due)}</strong></td>
                  <td className="text-right">{row.paid ? naira(row.paid) : "-"}</td>
                  <td className="text-right">{naira(row.balance)}</td>
                  <td>{row.status === "PAID" ? "Paid" : row.status === "PART" ? "Part paid" : "Unpaid"}</td>
                </tr>
              ))}
              {sheet.rows.length === 0 && (
                <tr><td colSpan={12}>No staff had earnings or payments recorded for {sheet.label}.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}><strong>Total payroll</strong></td>
                <td className="text-right"><strong>{naira(sheet.totals.basic)}</strong></td>
                <td className="text-right"><strong>{naira(sheet.totals.piecework)}</strong></td>
                <td className="text-right"><strong>{naira(sheet.totals.overtime)}</strong></td>
                <td className="text-right"><strong>{naira(sheet.totals.due)}</strong></td>
                <td className="text-right"><strong>{naira(sheet.totals.paid)}</strong></td>
                <td className="text-right"><strong>{naira(sheet.totals.balance)}</strong></td>
                <td />
              </tr>
            </tfoot>
          </table>

          <div className="letter-signatures">
            <div>
              <p>Prepared by</p>
              <span className="letter-signature-line" />
              <p className="letter-signature-name">{sheet.preparedBy ?? "Matesther Owner"}</p>
            </div>
            <div>
              <p>Approved by (Owner)</p>
              <span className="letter-signature-line" />
              <p className="letter-signature-name">&nbsp;</p>
            </div>
            <div>
              <p>Bank received by</p>
              <span className="letter-signature-line" />
              <p className="letter-signature-name">Name, signature &amp; date</p>
            </div>
          </div>

          <p className="letter-note">
            Reference MTH-PAY-{sheet.month}. Generated {fmtDate(sheet.generatedAt)} from Matesther ERP production and payroll records.
            Piecework is calculated only from inspected and approved work. This document contains confidential payroll information and is
            issued to the bank only.
          </p>
        </Letterhead>
      )}
    </div>
  );
}

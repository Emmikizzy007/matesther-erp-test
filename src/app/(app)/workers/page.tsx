"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Pencil, Phone, Trash2, Archive, RotateCcw } from "lucide-react";
import { Card, PageHeader, Badge, Loading, EmptyState, Modal, Field, inputCls, Btn } from "@/components/ui";
import { naira, fmtDate, stageLabel } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import {
  ALL_KNOWN_ROLES,
  INSPECTION_ROLES,
  NON_PRODUCTION_ROLES,
  PRODUCTION_ROLES,
  SUPPORT_ROLES,
  staffTypeFor,
  staffTypeLabel,
  type RoleKind,
} from "@/lib/worker-roles";

/**
 * One person, many roles. A Cutter who also tailors and inspects keeps ONE
 * record here - never two. Non-production staff (security, sales, office,
 * management) simply have no production role.
 */
const ROLE_GROUPS: { label: string; hint: string; roles: readonly string[]; kind: RoleKind }[] = [
  { label: "Production roles", hint: "Can be given production work at the matching stage", roles: PRODUCTION_ROLES, kind: "PRODUCTION" },
  { label: "Production support", hint: "Help a Tailor or another stage (weaving, taping, trimming)", roles: SUPPORT_ROLES, kind: "SUPPORT" },
  { label: "Inspection", hint: "May inspect work - never their own submitted work", roles: INSPECTION_ROLES, kind: "INSPECTION" },
  { label: "Non-production staff", hint: "Salaried work with no production specialty", roles: NON_PRODUCTION_ROLES, kind: "NON_PRODUCTION" },
];

const emptyForm = {
  name: "", phone: "", roles: [] as string[], primaryRole: "", customRole: "", customKind: "PRODUCTION" as RoleKind,
  department: "", jobTitle: "", paymentType: "PER_PIECE", paymentRate: "", status: "ACTIVE",
  bankName: "", bankAccountName: "", bankAccountNumber: "",
};

function kindOf(role: string): RoleKind {
  return ALL_KNOWN_ROLES.find((entry) => entry.role.toLowerCase() === role.toLowerCase())?.kind ?? "PRODUCTION";
}

function formFromWorker(person: any) {
  const roles: string[] = (person.roles ?? []).map((row: any) => row.role);
  const primary = (person.roles ?? []).find((row: any) => row.isPrimary)?.role ?? roles[0] ?? "";
  return {
    ...emptyForm,
    name: person.name, phone: person.phone || "", roles, primaryRole: primary,
    department: person.department || "", jobTitle: person.jobTitle || "",
    paymentType: person.paymentType, paymentRate: String(person.paymentRate ?? ""), status: person.status,
    bankName: person.bankName || "", bankAccountName: person.bankAccountName || "", bankAccountNumber: person.bankAccountNumber || "",
  };
}

export default function WorkersPage() {
  const { user } = useAuth();
  const isOwner = user?.role === "OWNER";
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [history, setHistory] = useState<any>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    setLoadError("");
    fetch(`/api/workers${showArchived ? "?showArchived=1" : ""}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load workers.");
        setRows(Array.isArray(data) ? data : []);
      })
      .catch((cause) => setLoadError(cause instanceof Error ? cause.message : "Unable to load workers."))
      .finally(() => setLoading(false));
  }
  useEffect(load, [showArchived]);

  async function removeWorker(person: any) {
    const action = person.hasHistory ? "archive" : "permanently delete";
    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} ${person.name}? ${person.hasHistory ? "Production and payroll history will remain available." : "This worker has no production or payroll history."}`)) return;
    try {
      const response = await fetch(`/api/workers?id=${person.id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to remove this worker.");
      await load();
    } catch (cause) { alert(cause instanceof Error ? cause.message : "Unable to remove worker."); }
  }

  async function restoreWorker(person: any) {
    try {
      const response = await fetch("/api/workers", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...person, status: "ACTIVE" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to restore this worker.");
      await load();
      alert("Worker restored. If their login was deactivated, reactivate it under Users.");
    } catch (cause) { alert(cause instanceof Error ? cause.message : "Unable to restore worker."); }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr("");
    try {
      const res = await fetch("/api/workers", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          id: editing?.id,
          // The server re-derives every role kind from its own catalogue.
          roles: form.roles.map((role) => ({ role, kind: kindOf(role), isPrimary: role === form.primaryRole })),
          specialty: form.primaryRole || form.jobTitle || form.department || "Staff",
          paymentRate: Number(form.paymentRate) || 0,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed to save");
      setModal(false);
      load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function openHistory(id: number) {
    setHistoryLoading(true);
    setHistory({ name: "Loading…" });
    try {
      const d = await fetch(`/api/workers?id=${id}`, { cache: "no-store" }).then((r) => r.json());
      setHistory(d);
    } catch {
      setHistory(null);
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Workers"
        subtitle="One record per person, whatever mix of roles they hold - cutters, tailors, monogrammers, production support, inspectors and salaried staff"
        action={<>
          <Btn variant="secondary" onClick={() => setShowArchived((current) => !current)}>{showArchived ? "Active only" : "Show archived"}</Btn>
          {isOwner && <Btn onClick={() => { setEditing(null); setForm({ ...emptyForm }); setErr(""); setModal(true); }}>
            <Plus className="w-4 h-4" /> Add Worker
          </Btn>}
        </>}
      />
      <Card>
        {loading ? <Loading /> : loadError ? <div className="p-5 text-sm text-red-700">{loadError} <button onClick={load} className="font-semibold underline">Try again</button></div> : rows.length === 0 ? <EmptyState title={showArchived ? "No archived workers" : "No active workers"} /> : (
          <div className="overflow-x-auto slim-scroll">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="text-left text-[11px] uppercase text-slate-500 border-b border-slate-100">
                  <th className="px-5 py-3">Worker</th>
                  <th className="px-3 py-3">Roles (one person, many roles)</th>
                  {isOwner && <th className="px-3 py-3">Pay</th>}
                  <th className="px-3 py-3 text-right">Current Tasks</th>
                  <th className="px-3 py-3 text-right">Assigned</th>
                  <th className="px-3 py-3 text-right">Approved</th>
                  <th className="px-3 py-3 text-right">Rejected</th>
                  {isOwner && <th className="px-3 py-3 text-right">Earnings</th>}
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map((w) => (
                  <tr key={w.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <p className="font-semibold">{w.name}</p>
                      <p className="text-xs text-slate-500 flex items-center gap-1"><Phone className="w-3 h-3" />{w.phone || "-"}</p>
                    </td>
                    <td className="px-3 py-3 max-w-[280px]">
                      <div className="flex flex-wrap gap-1">
                        {(w.roles ?? []).map((row: any) => (
                          <span key={row.role} className={`inline-block rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
                            row.kind === "INSPECTION" ? "border-violet-200 bg-violet-50 text-violet-800"
                              : row.kind === "NON_PRODUCTION" ? "border-slate-200 bg-slate-50 text-slate-600"
                                : row.kind === "SUPPORT" ? "border-amber-200 bg-amber-50 text-amber-800"
                                  : "border-matesther-100 bg-matesther-50 text-matesther-800"}`}>
                            {row.role}
                          </span>
                        ))}
                        {(w.roles ?? []).length === 0 && <span className="text-xs text-slate-400">No roles yet</span>}
                      </div>
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">{staffTypeLabel(w.staffType)}</p>
                    </td>
                    {isOwner && <td className="px-3 py-3 text-xs">
                      {w.paymentType.replace("_", " ")}<br />
                      <span className="font-semibold">{w.paymentType === "PER_PIECE" ? "Agreed per job" : naira(w.paymentRate)}</span>
                    </td>}
                    <td className="px-3 py-3 text-right font-bold">{w.currentTasks}</td>
                    <td className="px-3 py-3 text-right">{w.assigned.toLocaleString()}</td>
                    <td className="px-3 py-3 text-right text-matesther-700 font-semibold">{(w.approved ?? w.completed).toLocaleString()}</td>
                    <td className="px-3 py-3 text-right text-red-600">{w.rejected}</td>
                    {isOwner && <td className="px-3 py-3 text-right font-bold text-matesther-700">{naira(w.earnings)}</td>}
                    <td className="px-3 py-3"><Badge status={w.status} /></td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <button onClick={() => openHistory(w.id)} className="text-xs font-semibold text-matesther-700 hover:underline mr-3">History</button>
                      {isOwner && <>
                        <button title={`Edit ${w.name}`} aria-label={`Edit ${w.name}`} onClick={() => {
                          setEditing(w);
                          setForm(formFromWorker(w));
                          setErr(""); setModal(true);
                        }} className="p-1 text-slate-500 hover:text-matesther-700"><Pencil className="w-4 h-4" /></button>
                        {w.status === "ACTIVE" ? <button title={w.hasHistory ? `Archive ${w.name}` : `Delete ${w.name}`} aria-label={w.hasHistory ? `Archive ${w.name}` : `Delete ${w.name}`}
                          onClick={() => void removeWorker(w)} className="p-1 text-slate-500 hover:text-red-700">
                          {w.hasHistory ? <Archive className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
                        </button> : <button title={`Restore ${w.name}`} aria-label={`Restore ${w.name}`} onClick={() => void restoreWorker(w)} className="p-1 text-slate-500 hover:text-matesther-700"><RotateCcw className="w-4 h-4" /></button>}
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? "Edit Worker" : "Add Worker"}>
        <form onSubmit={save} className="grid sm:grid-cols-2 gap-3">
          <Field label="Full name *" className="sm:col-span-2"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="e.g. Mrs. Aisha Bello" /></Field>
          <Field label="Phone"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} placeholder="+234 ..." /></Field>
          <div className="sm:col-span-2 rounded-xl border border-slate-200 p-3">
            <p className="text-sm font-bold text-slate-800">Roles this person holds</p>
            <p className="mt-0.5 text-xs text-slate-500">Tick everything they do. One person can be a Cutter, a Tailor and an Inspector - keep them on this one record instead of creating a second worker.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {ROLE_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{group.label}</p>
                  <p className="mb-1 text-[11px] text-slate-400">{group.hint}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {group.roles.map((role) => {
                      const checked = form.roles.includes(role);
                      return (
                        <label key={role} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                          checked ? "border-matesther-600 bg-matesther-50 text-matesther-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                          <input type="checkbox" className="accent-matesther-700" checked={checked}
                            onChange={(e) => {
                              const roles = e.target.checked ? [...form.roles, role] : form.roles.filter((item) => item !== role);
                              setForm({ ...form, roles, primaryRole: roles.includes(form.primaryRole) ? form.primaryRole : roles[0] ?? "" });
                            }} />
                          {role}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
              <Field label="Other role not listed">
                <input value={form.customRole} onChange={(e) => setForm({ ...form, customRole: e.target.value })} className={inputCls} placeholder="e.g. Sewing Machine Operator" />
              </Field>
              <Field label="Type">
                <select value={form.customKind} onChange={(e) => setForm({ ...form, customKind: e.target.value as RoleKind })} className={inputCls}>
                  <option value="PRODUCTION">Production</option>
                  <option value="SUPPORT">Support</option>
                  <option value="INSPECTION">Inspection</option>
                  <option value="NON_PRODUCTION">Non-production</option>
                </select>
              </Field>
              <Btn variant="secondary" onClick={() => {
                const role = form.customRole.trim();
                if (!role || form.roles.includes(role)) return;
                setForm({ ...form, roles: [...form.roles, role], primaryRole: form.primaryRole || role, customRole: "" });
              }}>Add role</Btn>
            </div>
            <p className="mt-2 text-xs font-semibold text-slate-600">
              This person will be: <span className="text-matesther-800">{staffTypeLabel(staffTypeFor(form.roles.map((role) => ({ role, kind: kindOf(role) }))))}</span>
              {form.roles.some((role) => kindOf(role) === "INSPECTION") && " • inspection role: they can never approve their own work"}
            </p>
          </div>
          {form.roles.length > 1 && (
            <Field label="Primary role (shown on reports)" className="sm:col-span-2">
              <select value={form.primaryRole} onChange={(e) => setForm({ ...form, primaryRole: e.target.value })} className={inputCls}>
                {form.roles.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            </Field>
          )}
          <Field label="Department (optional)"><input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className={inputCls} placeholder="e.g. Tailoring floor, Security" /></Field>
          <Field label="Job title (optional)"><input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} className={inputCls} placeholder="e.g. Security Guard, Sales Officer" /></Field>
          <Field label="Payment type">
            <select value={form.paymentType} onChange={(e) => setForm({ ...form, paymentType: e.target.value })} className={inputCls}>
              <option value="PER_PIECE">Per piece (production)</option>
              <option value="DAILY">Daily</option>
              <option value="MONTHLY">Monthly salary</option>
            </select>
          </Field>
          {form.paymentType === "PER_PIECE" ? <p className="self-end rounded-lg border border-matesther-100 bg-matesther-50 p-2 text-xs text-matesther-800">Agree the price per garment when assigning each production job. This profile does not fix one price for all clothes.</p>
            : <Field label={form.paymentType === "MONTHLY" ? "Monthly salary (₦)" : "Daily rate (₦)"}><input type="number" min="0" value={form.paymentRate} onChange={(e) => setForm({ ...form, paymentRate: e.target.value })} className={inputCls} /></Field>}
          <div className="sm:col-span-2 rounded-xl border border-slate-200 p-3">
            <p className="text-sm font-bold text-slate-800">Bank details (for the monthly bank payment sheet)</p>
            <p className="mt-0.5 text-xs text-slate-500">Owner-only. These appear on the printable payment sheet you send to the bank and are never shown to Project Managers or Workers.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <Field label="Bank"><input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} className={inputCls} placeholder="e.g. GTBank" /></Field>
              <Field label="Account name"><input value={form.bankAccountName} onChange={(e) => setForm({ ...form, bankAccountName: e.target.value })} className={inputCls} /></Field>
              <Field label="Account number"><input value={form.bankAccountNumber} onChange={(e) => setForm({ ...form, bankAccountNumber: e.target.value })} className={inputCls} inputMode="numeric" /></Field>
            </div>
          </div>
          {editing && (
            <Field label="Status" className="sm:col-span-2">
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputCls}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive (archived - history is kept)</option>
              </select>
            </Field>
          )}
          {err && <p className="sm:col-span-2 text-sm text-red-600">{err}</p>}
          <div className="sm:col-span-2 flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setModal(false)}>Cancel</Btn>
            <Btn type="submit" disabled={saving}>{saving ? "Saving…" : "Save Worker"}</Btn>
          </div>
        </form>
      </Modal>

      <Modal open={!!history} onClose={() => setHistory(null)} title={history ? `${history.name} - production history` : ""} wide>
        {historyLoading ? (
          <Loading />
        ) : history && history.history ? (
          <div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-slate-50 rounded-lg p-3 text-center"><p className="text-xs text-slate-500">Assigned</p><p className="font-bold">{history.assigned}</p></div>
              <div className="bg-slate-50 rounded-lg p-3 text-center"><p className="text-xs text-slate-500">Completed</p><p className="font-bold text-matesther-700">{history.completed}</p></div>
              <div className="bg-slate-50 rounded-lg p-3 text-center"><p className="text-xs text-slate-500">Rejected</p><p className="font-bold text-red-600">{history.rejected}</p></div>
            </div>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto slim-scroll">
              {history.history.map((h: any) => (
                <div key={h.id} className="border border-slate-200 rounded-lg p-3 text-sm flex flex-wrap items-center gap-2 justify-between">
                  <div>
                    <p className="font-semibold">{stageLabel(h.stage)} - {h.batchNumber}</p>
                    <p className="text-xs text-slate-500">
                      {isOwner
                        ? <Link href={`/orders/${h.orderId}`} className="text-matesther-700 hover:underline">{h.orderNumber}</Link>
                        : <span className="font-semibold text-matesther-700">{h.orderNumber}</span>} • {h.customer}
                    </p>
                  </div>
                  <div className="text-right text-xs">
                    <Badge status={h.status} />
                    <p className="text-slate-500 mt-1">Rcvd {h.quantityReceived} • Done {h.quantityCompleted} • Rej {h.quantityRejected}</p>
                    <p className="text-slate-400">{h.expectedCompletionDate ? `Expected ${fmtDate(h.expectedCompletionDate)}` : ""}</p>
                  </div>
                </div>
              ))}
              {history.history.length === 0 && <EmptyState title="No production records for this worker yet" />}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

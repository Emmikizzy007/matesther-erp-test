# MATESTHER ERP — continuation notes (this coding session)

This repository is the **safe working copy** (`matesther-erp-test`) of the live
MATESTHER Uniform Manufacturing ERP. Nothing here was rebuilt: the framework,
database, ORM, authentication, document and production systems are the existing
implementation, and this session only continued the unfinished work.

> `PROJECT_CONTEXT.md` was referenced by the hand-over brief but never arrived in
> the sandbox, so the repository itself (code, migrations and `deploy/*.sql`) was
> treated as the technical source of truth.

## What already existed (confirmed by inspection + tests)

- Next.js 16 App Router, React 19, TypeScript, Tailwind v4, PWA (manifest + service worker).
- Drizzle ORM over PostgreSQL (`pg`), migrations `drizzle/0000–0002`, plus the
  hand-written client upgrade `deploy/upgrade-current-client.sql`.
- Server-side cookie sessions (`matesther_session`), CSRF protection, and three
  account roles: `OWNER`, `PRODUCTION_MANAGER`, `WORKER`.
- Orders, order items and sizes, batches per size/colour, the 8-stage production
  workflow, per-job agreed piece rates, inspections with an immutable audit
  trail, rework/rejection, order roll-ups, materials, expenses and reports.
- Payroll accruals from **approved** work only (piecework, monthly salary,
  overtime), worker payments and overtime records.
- Letterheaded receipts and delivery sheets, branding/logo upload.
- Security rules already enforced server-side: cutter-supervisors cannot assign
  cutting work, workers cannot submit another person's job, managers never see
  company finances.

## What this session added

### 1. Multi-role staff and workers (one record, many roles)

- New `worker_roles` table plus `workers.staff_type / department / job_title`
  and optional bank details (`bank_name`, `bank_account_name`,
  `bank_account_number`); `production_operations.role_label` records the role a
  job was worked in.
- Migrations: `drizzle/0003_multi_role_people.sql` (development/versioned) and
  `deploy/upgrade-worker-roles.sql` (**idempotent, additive, run on the client
  Supabase project first**). Both backfill each existing worker's specialty and
  inspector flag into roles; nothing is deleted or rewritten.
- Role catalogue and eligibility live in `src/lib/worker-roles.ts` (pure and
  client-safe): production roles, production support (Weaver, Taper, Trimmer,
  Helper), inspection roles, and non-production staff (Security, Sales,
  Director, Management, Administration, IT, Accounts, Office Assistant, Cleaner,
  Driver, Support Staff).
- Server-authoritative rules: role kinds and `staff_type` are re-derived on the
  server (`src/lib/people.ts`), so a request body can never promote a security
  guard into a cutter; non-production staff are never assignable to a stage.
- Assignments accept any role that covers the stage and snapshot the role used.
- **Separation of duties:** `authz.selfInspectionBlock()` blocks self-inspection
  for every role combination, including Cutter + Tailor + Inspection Officer and
  Owner-linked profiles. The existing cutter-supervisor rules are unchanged and
  now role-aware.
- UI: multi-role picker on Workers (with primary role, department, job title and
  bank details), role chips in the workers list, role-aware worker pickers on
  Assign Production / Active Production / order screens, roles on the worker's
  own profile and job cards.

### 2. Monthly bank payment sheet (Owner only)

- `GET /api/payroll/sheet?month=YYYY-MM` (OWNER guard) builds the bank-ready
  schedule; `src/lib/payroll.ts#payrollSheet()` computes it in one pass.
- Printable page `/payroll/sheet` with month selector, totals (staff, payroll
  due, already paid, balance), per-person basic salary, piecework (approved
  pieces only), overtime, total due, paid, balance, status, bank details and a
  signature block. Print / Save as PDF, then send to the bank.
- Deliberately has **no share link**: Project Managers and Workers receive 403
  from the API and the page refuses non-Owners.

### 3. WhatsApp sharing for customer documents

- `Send on WhatsApp` (wa.me deep link with the customer's number when known),
  `Copy customer link`, plus the existing Web Share, email and Print actions in
  `src/components/documents/DocumentActions.tsx`.
- Signed, expiring (30 day) links created only by the Owner
  (`POST /api/documents/share`) and rendered by the public read-only page
  `/share/[token]` (noindex). Tokens are HMAC-signed; type + id + expiry are
  covered, so ids cannot be guessed and tampered/expired links are refused.
- Public documents are explicit whitelists (`src/lib/share-documents.ts`):
  payment receipts and delivery sheets only — no wages, piece rates, internal
  costs or profitability can leak. Payroll and the bank sheet are not shareable
  at all.
- Recommended: set `DOCUMENT_SHARE_SECRET` in Netlify so share links use their
  own signing key (falls back to `DATABASE_URL` locally).

## Tests (local only — never point at production)

| Test | Covers |
| --- | --- |
| `tests/production-roles.cjs` | existing cutter-supervisor and self-inspection rules (still green) |
| `tests/multi-role-staff.cjs` | one record/many roles, role-based assignment, role labels, My Jobs across roles, self-inspection block, non-production staff, no payroll to managers |
| `tests/bank-payment-sheet.cjs` | sheet totals, salaried staff, bank details, Owner-only access |
| `tests/whatsapp-sharing.cjs` | signed links, rendering, tamper refusal, share-link creation is Owner-only |

Run with the demo database and a local server:
`DATABASE_URL=... npx next dev -H 0.0.0.0 -p 3000` then `node tests/<name>.cjs`.

## Deploy order for the live client

1. Back up the client Supabase project (or confirm the restore plan).
2. Run `deploy/upgrade-worker-roles.sql` in the client Supabase SQL Editor.
3. Push this code to the client repository; let Netlify publish.
4. Optional: add `DOCUMENT_SHARE_SECRET` to Netlify environment variables.
5. Never run `deploy/full-setup.sql` or `deploy/schema-only.sql` against a
   populated client database.

## Suggested next steps

- Capture bank details for existing staff (Workers > edit) so the sheet is
  complete; the sheet flags missing details in amber.
- Consider a dedicated `WEAVING`/`TAPING` production stage if Matesther wants
  support work tracked separately from Sewing.
- Add per-person daily-rate accrual to the sheet if daily-paid staff are used
  (currently daily rates are recorded but the sheet pays salary or piecework).

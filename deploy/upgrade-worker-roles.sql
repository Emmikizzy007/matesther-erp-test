-- MATESTHER: ONE RECORD PER PERSON, MANY ROLES.
-- Additive and safe to re-run on the client Supabase project.
-- It never deletes or rewrites users, workers, orders or production history.
--
-- Apply this BEFORE deploying the matching application code.

BEGIN;

-- Non-production staff (security, sales, directors, IT/admin/office, management)
-- and production support workers (weaver, taper, trimmer, helper) live on the
-- same people table as cutters and tailors - just with different roles.
ALTER TABLE public.workers ADD COLUMN IF NOT EXISTS staff_type text NOT NULL DEFAULT 'PRODUCTION';
ALTER TABLE public.workers ADD COLUMN IF NOT EXISTS department text;
ALTER TABLE public.workers ADD COLUMN IF NOT EXISTS job_title text;

-- Optional bank details used only by the Owner-only monthly payment sheet.
ALTER TABLE public.workers ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE public.workers ADD COLUMN IF NOT EXISTS bank_account_name text;
ALTER TABLE public.workers ADD COLUMN IF NOT EXISTS bank_account_number text;

-- The role a person worked in on a specific job (Cutter, Tailor, Weaver, ...).
ALTER TABLE public.production_operations ADD COLUMN IF NOT EXISTS role_label text;

CREATE TABLE IF NOT EXISTS public.worker_roles (
  id serial PRIMARY KEY,
  worker_id integer NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  role text NOT NULL,
  kind text NOT NULL DEFAULT 'PRODUCTION',
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamp DEFAULT now()
);

DO $roles_upgrade$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'worker_roles_worker_role_unique'
  ) THEN
    CREATE UNIQUE INDEX worker_roles_worker_role_unique ON public.worker_roles (worker_id, role);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'worker_roles_worker_id_idx'
  ) THEN
    CREATE INDEX worker_roles_worker_id_idx ON public.worker_roles (worker_id);
  END IF;
END $roles_upgrade$;

-- Backfill: every existing person keeps their current specialty as their first
-- production role, and current inspectors keep an inspection role. Re-running
-- this only fills gaps; an existing role list is left exactly as it is.
INSERT INTO public.worker_roles (worker_id, role, kind, is_primary)
SELECT worker.id, worker.specialty, 'PRODUCTION', true
FROM public.workers AS worker
WHERE worker.specialty IS NOT NULL
  AND btrim(worker.specialty) <> ''
  AND NOT EXISTS (SELECT 1 FROM public.worker_roles AS role WHERE role.worker_id = worker.id);

-- Preserve the inspector flag on people who already inspect.
INSERT INTO public.worker_roles (worker_id, role, kind, is_primary)
SELECT worker.id, 'Inspection Officer', 'INSPECTION', false
FROM public.workers AS worker
WHERE worker.is_inspector = true
  AND NOT EXISTS (
    SELECT 1 FROM public.worker_roles AS role
    WHERE role.worker_id = worker.id AND role.kind = 'INSPECTION'
  );

-- Keep staff_type truthful for anyone who was recorded as a support or
-- non-production role before this upgrade.
UPDATE public.workers AS worker
SET staff_type = CASE
      WHEN EXISTS (SELECT 1 FROM public.worker_roles r WHERE r.worker_id = worker.id AND r.kind = 'PRODUCTION') THEN 'PRODUCTION'
      WHEN EXISTS (SELECT 1 FROM public.worker_roles r WHERE r.worker_id = worker.id AND r.kind = 'SUPPORT') THEN 'SUPPORT'
      ELSE 'NON_PRODUCTION'
    END
WHERE EXISTS (SELECT 1 FROM public.worker_roles r WHERE r.worker_id = worker.id);

-- Table privileges: this application is the only client of these tables.
ALTER TABLE public.worker_roles ENABLE ROW LEVEL SECURITY;
DO $permissions$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.worker_roles FROM anon;
    REVOKE ALL ON SEQUENCE public.worker_roles_id_seq FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.worker_roles FROM authenticated;
    REVOKE ALL ON SEQUENCE public.worker_roles_id_seq FROM authenticated;
  END IF;
END $permissions$;

COMMIT;

-- Verify without revealing pay data:
SELECT (SELECT count(*) FROM public.workers) AS worker_profiles,
       (SELECT count(*) FROM public.worker_roles) AS role_rows,
       (SELECT count(*) FROM public.workers WHERE staff_type = 'NON_PRODUCTION') AS non_production_staff,
       (SELECT count(*) FROM public.worker_roles WHERE kind = 'INSPECTION') AS inspector_roles;

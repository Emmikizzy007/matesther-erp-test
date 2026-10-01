-- Multi-role people: one worker record, many roles, plus optional bank details.
-- Additive only. Safe to run once on a database created from earlier migrations.
ALTER TABLE "workers" ADD COLUMN "staff_type" text DEFAULT 'PRODUCTION' NOT NULL;--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "department" text;--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "job_title" text;--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "bank_name" text;--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "bank_account_name" text;--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "bank_account_number" text;--> statement-breakpoint
ALTER TABLE "production_operations" ADD COLUMN "role_label" text;--> statement-breakpoint
CREATE TABLE "worker_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"worker_id" integer NOT NULL,
	"role" text NOT NULL,
	"kind" text DEFAULT 'PRODUCTION' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);--> statement-breakpoint
ALTER TABLE "worker_roles" ADD CONSTRAINT "worker_roles_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "worker_roles_worker_role_unique" ON "worker_roles" USING btree ("worker_id","role");--> statement-breakpoint
CREATE INDEX "worker_roles_worker_id_idx" ON "worker_roles" USING btree ("worker_id");--> statement-breakpoint
INSERT INTO "worker_roles" ("worker_id", "role", "kind", "is_primary")
SELECT "id", "specialty", 'PRODUCTION', true FROM "workers"
WHERE btrim("specialty") <> ''
  AND NOT EXISTS (SELECT 1 FROM "worker_roles" r WHERE r."worker_id" = "workers"."id");--> statement-breakpoint
INSERT INTO "worker_roles" ("worker_id", "role", "kind", "is_primary")
SELECT "id", 'Inspection Officer', 'INSPECTION', false FROM "workers"
WHERE "is_inspector" = true
  AND NOT EXISTS (SELECT 1 FROM "worker_roles" r WHERE r."worker_id" = "workers"."id" AND r."kind" = 'INSPECTION');

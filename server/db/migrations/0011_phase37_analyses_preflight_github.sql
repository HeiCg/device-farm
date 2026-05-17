-- Phase 37 Plan 37-00 — analyses + preflight_runs tables + pipeline_runs github_* columns.
--
-- Three schema deltas in one migration (Track A + Track B + Track C substrate):
--   1. pipeline_runs: 6 new github_pr_* columns + partial composite index
--   2. analyses table (Track A — iOS skeleton sink)
--   3. preflight_runs table (Track B — Greenlight scanner output)
--
-- Migration numbered 0011 to follow 0009_sessions and 0010_explorations.

ALTER TABLE "pipeline_runs" ADD COLUMN "github_pr_id" text;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN "github_pr_url" text;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN "github_pr_comment_id" text;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN "github_installation_id" bigint;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN "github_repo_owner" text;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN "github_repo_name" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipeline_runs_github_pr_idx"
  ON "pipeline_runs" ("github_installation_id", "github_pr_id")
  WHERE "github_pr_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analyses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "build_artifact_id" uuid,
  "job_id" uuid,
  "platform" "platform" NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "analyses_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analyses_job_id_idx" ON "analyses"("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analyses_build_artifact_idx" ON "analyses"("build_artifact_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "preflight_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "platform" "platform" NOT NULL,
  "filename" text NOT NULL,
  "file_size_bytes" bigint NOT NULL,
  "rules_version" text NOT NULL,
  "status" text NOT NULL,
  "blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "preflight_runs_created_idx" ON "preflight_runs"("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "preflight_runs_status_idx" ON "preflight_runs"("status");

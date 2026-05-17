CREATE TYPE "public"."artifact_type" AS ENUM('video', 'screenshot', 'memory', 'log');--> statement-breakpoint
CREATE TYPE "public"."automation_status" AS ENUM('not_automated', 'automated', 'can_be_automated', 'cannot_be_automated', 'needs_update');--> statement-breakpoint
CREATE TYPE "public"."device_status" AS ENUM('booting', 'idle', 'allocated', 'running', 'cleanup', 'error', 'offline');--> statement-breakpoint
CREATE TYPE "public"."execution_status" AS ENUM('running', 'completed', 'aborted');--> statement-breakpoint
CREATE TYPE "public"."execution_trigger" AS ENUM('manual', 'automated');--> statement-breakpoint
CREATE TYPE "public"."file_type" AS ENUM('flow', 'config', 'app_file', 'other');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'passed', 'failed', 'cancelled', 'timeout');--> statement-breakpoint
CREATE TYPE "public"."pipeline_run_status" AS ENUM('pending', 'running', 'passed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."pipeline_stage_status" AS ENUM('pending', 'running', 'passed', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."pipeline_stage_type" AS ENUM('script', 'maestro');--> statement-breakpoint
CREATE TYPE "public"."pipeline_trigger_type" AS ENUM('api', 'schedule', 'manual');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('android', 'ios');--> statement-breakpoint
CREATE TYPE "public"."result_status" AS ENUM('passed', 'failed', 'skipped', 'blocked', 'not_run');--> statement-breakpoint
CREATE TYPE "public"."step_result_status" AS ENUM('passed', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."step_status" AS ENUM('running', 'passed', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."test_case_status" AS ENUM('draft', 'active', 'deprecated');--> statement-breakpoint
CREATE TYPE "public"."test_priority" AS ENUM('p0_critical', 'p1_high', 'p2_medium', 'p3_low');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"key_hash" varchar(255) NOT NULL,
	"key_salt" varchar(64) NOT NULL,
	"key_prefix" varchar(12) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"type" "artifact_type" NOT NULL,
	"file_path" varchar(1024) NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"mime_type" varchar(128) NOT NULL,
	"file_size_bytes" bigint,
	"compressed" boolean DEFAULT false NOT NULL,
	"compressed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "platform" NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" "device_status" DEFAULT 'idle' NOT NULL,
	"current_job_id" uuid,
	"emulator_id" varchar(255) NOT NULL,
	"port" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"event_version" integer DEFAULT 1 NOT NULL,
	"correlation_id" uuid NOT NULL,
	"causation_id" uuid,
	"aggregate_type" varchar(64) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" varchar(255) DEFAULT 'system' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"filename" varchar(512) NOT NULL,
	"content" text NOT NULL,
	"file_type" "file_type" DEFAULT 'flow' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"flow_name" varchar(512),
	"command" varchar(1024),
	"status" "step_status" DEFAULT 'running' NOT NULL,
	"duration_ms" integer,
	"error" text,
	"screenshot_path" varchar(1024),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"platform" "platform" NOT NULL,
	"device_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"result_summary" jsonb,
	"maestro_output" text,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"color" varchar(7) DEFAULT '#6b7280' NOT NULL,
	"category" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"trigger_type" "pipeline_trigger_type" NOT NULL,
	"status" "pipeline_run_status" DEFAULT 'pending' NOT NULL,
	"variables" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"source_branch" text,
	"source_commit" text,
	"azure_pr_id" text,
	"azure_pr_url" text,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "pipeline_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"cron_expression" varchar(100) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"variables" jsonb,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pipeline_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"encrypted_value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_secrets_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "pipeline_stage_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage_run_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"matrix_name" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "pipeline_stage_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"stage_name" varchar(255) NOT NULL,
	"stage_index" integer NOT NULL,
	"type" "pipeline_stage_type" DEFAULT 'script' NOT NULL,
	"status" "pipeline_stage_status" DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"logs" text,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"yaml_content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipelines_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "test_case_labels" (
	"test_case_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	CONSTRAINT "test_case_labels_test_case_id_label_id_pk" PRIMARY KEY("test_case_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "test_case_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_case_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"action" text NOT NULL,
	"expected_result" text NOT NULL,
	"test_data" text
);
--> statement-breakpoint
CREATE TABLE "test_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"preconditions" text,
	"priority" "test_priority" DEFAULT 'p2_medium' NOT NULL,
	"status" "test_case_status" DEFAULT 'draft' NOT NULL,
	"automation_status" "automation_status" DEFAULT 'not_automated' NOT NULL,
	"flow_filename" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_execution_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"test_case_id" uuid NOT NULL,
	"status" "result_status" DEFAULT 'not_run' NOT NULL,
	"job_id" uuid,
	"notes" text,
	"executed_by" varchar(255),
	"duration_ms" integer,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "test_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"suite_id" uuid,
	"environment" varchar(255),
	"trigger" "execution_trigger" NOT NULL,
	"status" "execution_status" DEFAULT 'running' NOT NULL,
	"executed_by" varchar(255),
	"job_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "test_step_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_result_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"status" "step_result_status" DEFAULT 'skipped' NOT NULL,
	"actual_result" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "test_suite_cases" (
	"suite_id" uuid NOT NULL,
	"test_case_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "test_suite_cases_suite_id_test_case_id_pk" PRIMARY KEY("suite_id","test_case_id")
);
--> statement-breakpoint
CREATE TABLE "test_suites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_files" ADD CONSTRAINT "job_files_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_steps" ADD CONSTRAINT "job_steps_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_schedules" ADD CONSTRAINT "pipeline_schedules_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stage_jobs" ADD CONSTRAINT "pipeline_stage_jobs_stage_run_id_pipeline_stage_runs_id_fk" FOREIGN KEY ("stage_run_id") REFERENCES "public"."pipeline_stage_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stage_jobs" ADD CONSTRAINT "pipeline_stage_jobs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stage_runs" ADD CONSTRAINT "pipeline_stage_runs_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_case_labels" ADD CONSTRAINT "test_case_labels_test_case_id_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_case_labels" ADD CONSTRAINT "test_case_labels_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_case_steps" ADD CONSTRAINT "test_case_steps_test_case_id_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_execution_results" ADD CONSTRAINT "test_execution_results_execution_id_test_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."test_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_execution_results" ADD CONSTRAINT "test_execution_results_test_case_id_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_execution_results" ADD CONSTRAINT "test_execution_results_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_executions" ADD CONSTRAINT "test_executions_suite_id_test_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."test_suites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_executions" ADD CONSTRAINT "test_executions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_step_results" ADD CONSTRAINT "test_step_results_execution_result_id_test_execution_results_id_fk" FOREIGN KEY ("execution_result_id") REFERENCES "public"."test_execution_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_step_results" ADD CONSTRAINT "test_step_results_step_id_test_case_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."test_case_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_suite_cases" ADD CONSTRAINT "test_suite_cases_suite_id_test_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."test_suites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_suite_cases" ADD CONSTRAINT "test_suite_cases_test_case_id_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."test_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifacts_job_id_idx" ON "artifacts" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "artifacts_created_at_idx" ON "artifacts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "artifacts_type_idx" ON "artifacts" USING btree ("type");--> statement-breakpoint
CREATE INDEX "events_correlation_id_idx" ON "events" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "events_event_type_idx" ON "events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "events_occurred_at_idx" ON "events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "events_aggregate_idx" ON "events" USING btree ("aggregate_type","aggregate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "labels_name_idx" ON "labels" USING btree ("name");--> statement-breakpoint
CREATE INDEX "labels_category_idx" ON "labels" USING btree ("category");--> statement-breakpoint
CREATE INDEX "test_case_labels_label_id_idx" ON "test_case_labels" USING btree ("label_id");--> statement-breakpoint
CREATE INDEX "test_case_steps_case_id_idx" ON "test_case_steps" USING btree ("test_case_id");--> statement-breakpoint
CREATE INDEX "test_cases_status_idx" ON "test_cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "test_cases_priority_idx" ON "test_cases" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "test_cases_automation_status_idx" ON "test_cases" USING btree ("automation_status");--> statement-breakpoint
CREATE INDEX "test_cases_flow_filename_idx" ON "test_cases" USING btree ("flow_filename");--> statement-breakpoint
CREATE INDEX "test_exec_results_execution_id_idx" ON "test_execution_results" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "test_exec_results_case_id_idx" ON "test_execution_results" USING btree ("test_case_id");--> statement-breakpoint
CREATE INDEX "test_exec_results_status_idx" ON "test_execution_results" USING btree ("status");--> statement-breakpoint
CREATE INDEX "test_executions_suite_id_idx" ON "test_executions" USING btree ("suite_id");--> statement-breakpoint
CREATE INDEX "test_executions_status_idx" ON "test_executions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "test_executions_trigger_idx" ON "test_executions" USING btree ("trigger");--> statement-breakpoint
CREATE INDEX "test_executions_job_id_idx" ON "test_executions" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "test_executions_started_at_idx" ON "test_executions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "test_step_results_exec_result_id_idx" ON "test_step_results" USING btree ("execution_result_id");--> statement-breakpoint
CREATE INDEX "test_step_results_step_id_idx" ON "test_step_results" USING btree ("step_id");--> statement-breakpoint
CREATE INDEX "test_suite_cases_case_id_idx" ON "test_suite_cases" USING btree ("test_case_id");
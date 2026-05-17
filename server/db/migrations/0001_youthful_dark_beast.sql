CREATE TABLE "hook_runs" (
	"operation_key" text PRIMARY KEY NOT NULL,
	"hook_name" varchar(255) NOT NULL,
	"event_id" uuid NOT NULL,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" varchar(32) DEFAULT 'running' NOT NULL,
	"exit_code" integer,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE INDEX "hook_runs_hook_name_idx" ON "hook_runs" USING btree ("hook_name");--> statement-breakpoint
CREATE INDEX "hook_runs_event_id_idx" ON "hook_runs" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "hook_runs_triggered_at_idx" ON "hook_runs" USING btree ("triggered_at");
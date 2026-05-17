CREATE TYPE "public"."exploration_status" AS ENUM('queued', 'running', 'complete', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "exploration_screens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"screen_id" text NOT NULL,
	"title" text NOT NULL,
	"screenshot_artifact_id" uuid NOT NULL,
	"phash" varchar(64),
	"elements" jsonb NOT NULL,
	"notes" text,
	"bfs_depth" integer DEFAULT 0 NOT NULL,
	"visited_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exploration_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"from_screen_id" text NOT NULL,
	"to_screen_id" text NOT NULL,
	"action" jsonb NOT NULL,
	"action_hash" varchar(64) NOT NULL,
	"is_back_edge" boolean DEFAULT false NOT NULL,
	"bfs_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "explorations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"app_artifact_id" uuid NOT NULL,
	"bundle_id" text NOT NULL,
	"platform" "platform" NOT NULL,
	"status" "exploration_status" DEFAULT 'queued' NOT NULL,
	"start_screen_id" text,
	"budget_taps" integer DEFAULT 200 NOT NULL,
	"budget_screens" integer DEFAULT 60 NOT NULL,
	"budget_seconds" integer DEFAULT 1800 NOT NULL,
	"config" jsonb NOT NULL,
	"stats" jsonb,
	"owner_api_key_id" uuid,
	"owner_actor" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_message" text
);
--> statement-breakpoint
ALTER TABLE "exploration_screens" ADD CONSTRAINT "exploration_screens_run_id_explorations_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."explorations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exploration_screens" ADD CONSTRAINT "exploration_screens_screenshot_artifact_id_artifacts_id_fk" FOREIGN KEY ("screenshot_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exploration_transitions" ADD CONSTRAINT "exploration_transitions_run_id_explorations_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."explorations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explorations" ADD CONSTRAINT "explorations_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explorations" ADD CONSTRAINT "explorations_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explorations" ADD CONSTRAINT "explorations_app_artifact_id_artifacts_id_fk" FOREIGN KEY ("app_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explorations" ADD CONSTRAINT "explorations_owner_api_key_id_api_keys_id_fk" FOREIGN KEY ("owner_api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exploration_screens_run_screen_idx" ON "exploration_screens" USING btree ("run_id","screen_id");--> statement-breakpoint
CREATE INDEX "exploration_screens_phash_idx" ON "exploration_screens" USING btree ("phash");--> statement-breakpoint
CREATE INDEX "exploration_screens_run_idx" ON "exploration_screens" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exploration_transitions_dedup_idx" ON "exploration_transitions" USING btree ("run_id","from_screen_id","to_screen_id","action_hash");--> statement-breakpoint
CREATE INDEX "exploration_transitions_run_idx" ON "exploration_transitions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "exploration_transitions_from_idx" ON "exploration_transitions" USING btree ("run_id","from_screen_id");--> statement-breakpoint
CREATE INDEX "explorations_device_idx" ON "explorations" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "explorations_session_idx" ON "explorations" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "explorations_status_idx" ON "explorations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "explorations_owner_idx" ON "explorations" USING btree ("owner_api_key_id");--> statement-breakpoint
CREATE INDEX "explorations_created_idx" ON "explorations" USING btree ("created_at");
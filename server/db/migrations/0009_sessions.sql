CREATE TYPE "public"."session_status" AS ENUM('active', 'released', 'expired');--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"owner_api_key_id" uuid,
	"owner_actor" varchar(255),
	"status" "session_status" DEFAULT 'active' NOT NULL,
	"ttl_seconds" integer DEFAULT 600 NOT NULL,
	"lease_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_owner_api_key_id_api_keys_id_fk" FOREIGN KEY ("owner_api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_device_active_idx" ON "sessions" USING btree ("device_id") WHERE "sessions"."status" = 'active';--> statement-breakpoint
CREATE INDEX "sessions_lease_until_idx" ON "sessions" USING btree ("lease_until");--> statement-breakpoint
CREATE INDEX "sessions_status_idx" ON "sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sessions_owner_idx" ON "sessions" USING btree ("owner_api_key_id");
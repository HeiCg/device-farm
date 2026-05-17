ALTER TABLE "artifacts" ADD COLUMN "recording_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_recording_id_idx" ON "artifacts" USING btree ("recording_id");
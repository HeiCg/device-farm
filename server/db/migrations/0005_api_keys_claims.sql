ALTER TABLE "api_keys" ADD COLUMN "claims" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "api_keys" SET "claims" = '{}'::jsonb WHERE "claims" IS NULL;

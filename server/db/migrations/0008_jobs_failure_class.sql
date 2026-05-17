CREATE TYPE "public"."failure_class" AS ENUM('crash', 'timeout', 'cancelled');--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "failure_class" "failure_class";
ALTER TABLE "adjustments" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "signups" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transaction_lines" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transactions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "volunteers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "adjustments" CASCADE;--> statement-breakpoint
DROP TABLE "payments" CASCADE;--> statement-breakpoint
DROP TABLE "signups" CASCADE;--> statement-breakpoint
DROP TABLE "transaction_lines" CASCADE;--> statement-breakpoint
DROP TABLE "transactions" CASCADE;--> statement-breakpoint
DROP TABLE "volunteers" CASCADE;--> statement-breakpoint
ALTER TABLE "members" DROP CONSTRAINT "members_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "provisional";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "active";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "phone";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "email";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "contact_consent";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "contact_consent_note";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "created_by";--> statement-breakpoint
DROP TYPE "public"."adjustment_kind";--> statement-breakpoint
DROP TYPE "public"."payment_status";--> statement-breakpoint
DROP TYPE "public"."transaction_status";
CREATE TYPE "public"."adjustment_kind" AS ENUM('void', 'refund', 'write_off');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'venmo', 'check');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('received', 'pending', 'cleared', 'bounced');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('completed', 'voided');--> statement-breakpoint
CREATE TABLE "adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_id" integer NOT NULL,
	"kind" "adjustment_kind" NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adjustments_amount_negative" CHECK ("adjustments"."amount_cents" < 0)
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_number" text NOT NULL,
	"name" text NOT NULL,
	"provisional" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"phone" text,
	"email" text,
	"contact_consent" boolean DEFAULT false NOT NULL,
	"contact_consent_note" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_id" integer NOT NULL,
	"member_id" integer,
	"method" "payment_method" NOT NULL,
	"amount_cents" integer NOT NULL,
	"reference" text,
	"status" "payment_status" NOT NULL,
	"received_by" integer NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone,
	"cleared_by" integer,
	"settlement_id" text,
	"note" text,
	CONSTRAINT "payments_amount_nonzero" CHECK ("payments"."amount_cents" <> 0)
);
--> statement-breakpoint
CREATE TABLE "transaction_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_id" integer NOT NULL,
	"item_id" integer,
	"item_code" text NOT NULL,
	"item_name" text NOT NULL,
	"station_name" text,
	"unit_price_cents" integer NOT NULL,
	"quantity" integer NOT NULL,
	"line_total_cents" integer NOT NULL,
	"note" text,
	CONSTRAINT "lines_qty_positive" CHECK ("transaction_lines"."quantity" >= 1),
	CONSTRAINT "lines_price_nonneg" CHECK ("transaction_lines"."unit_price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"event_id" integer NOT NULL,
	"member_id" integer,
	"customer_name" text NOT NULL,
	"status" "transaction_status" DEFAULT 'completed' NOT NULL,
	"total_cents" integer NOT NULL,
	"donation_cents" integer DEFAULT 0 NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" integer NOT NULL,
	"device_id" text,
	"sold_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_total_nonneg" CHECK ("transactions"."total_cents" >= 0),
	CONSTRAINT "transactions_donation_nonneg" CHECK ("transactions"."donation_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_cleared_by_users_id_fk" FOREIGN KEY ("cleared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adjustments_transaction_idx" ON "adjustments" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_account_key" ON "members" USING btree ("account_number");--> statement-breakpoint
CREATE INDEX "payments_transaction_idx" ON "payments" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "payments_member_idx" ON "payments" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "lines_transaction_idx" ON "transaction_lines" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "lines_item_idx" ON "transaction_lines" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_client_key" ON "transactions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "transactions_event_idx" ON "transactions" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "transactions_member_idx" ON "transactions" USING btree ("member_id");
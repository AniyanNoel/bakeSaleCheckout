CREATE TABLE "checkout_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"checkout_id" integer NOT NULL,
	"item_id" integer,
	"item_code" text NOT NULL,
	"item_name" text NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"quantity" integer NOT NULL,
	"line_total_cents" integer NOT NULL,
	CONSTRAINT "checkout_lines_qty_positive" CHECK ("checkout_lines"."quantity" >= 1),
	CONSTRAINT "checkout_lines_price_nonneg" CHECK ("checkout_lines"."unit_price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "checkouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"event_id" integer NOT NULL,
	"member_id" integer,
	"account_number" text,
	"customer_name" text NOT NULL,
	"total_cents" integer NOT NULL,
	"payment_method" "payment_method",
	"paid" boolean DEFAULT false NOT NULL,
	"paid_at" timestamp with time zone,
	"note" text,
	"created_by" integer,
	"sold_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkouts_total_nonneg" CHECK ("checkouts"."total_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "checkout_lines" ADD CONSTRAINT "checkout_lines_checkout_id_checkouts_id_fk" FOREIGN KEY ("checkout_id") REFERENCES "public"."checkouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_lines" ADD CONSTRAINT "checkout_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checkout_lines_checkout_idx" ON "checkout_lines" USING btree ("checkout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "checkouts_client_key" ON "checkouts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "checkouts_event_idx" ON "checkouts" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "checkouts_member_idx" ON "checkouts" USING btree ("member_id");
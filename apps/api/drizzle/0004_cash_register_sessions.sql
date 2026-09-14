CREATE TABLE "cash_register_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "business_date" date NOT NULL,
  "status" varchar(10) DEFAULT 'open' NOT NULL,
  "opened_at" timestamp with time zone DEFAULT now() NOT NULL,
  "opened_by_user_id" integer NOT NULL REFERENCES "users"("id"),
  "opening_cash" numeric(12,2) NOT NULL,
  "opening_note" text,
  "closed_at" timestamp with time zone,
  "closed_by_user_id" integer REFERENCES "users"("id"),
  "expected_cash" numeric(12,2),
  "actual_cash" numeric(12,2),
  "difference" numeric(12,2),
  "closing_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cash_register_sessions_status_check" CHECK ("status" in ('open','closed')),
  CONSTRAINT "cash_register_sessions_opening_cash_check" CHECK ("opening_cash" >= 0)
);
CREATE INDEX "cash_register_sessions_business_date_idx" ON "cash_register_sessions" ("business_date");
CREATE UNIQUE INDEX "cash_register_sessions_one_open_idx" ON "cash_register_sessions" ("status") WHERE "status" = 'open';
ALTER TABLE "sales" ADD COLUMN "cash_register_session_id" integer REFERENCES "cash_register_sessions"("id") ON DELETE SET NULL;
CREATE INDEX "sales_cash_register_session_idx" ON "sales" ("cash_register_session_id");

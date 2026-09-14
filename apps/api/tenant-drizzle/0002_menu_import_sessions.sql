CREATE TABLE IF NOT EXISTS "menu_import_sessions" (
  "id" uuid PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "preview" jsonb NOT NULL,
  "result" jsonb,
  "status" varchar(20) NOT NULL DEFAULT 'previewed',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "confirmed_at" timestamptz,
  CONSTRAINT "menu_import_sessions_status_check" CHECK ("status" IN ('previewed','confirmed'))
);
CREATE INDEX IF NOT EXISTS "menu_import_sessions_user_idx" ON "menu_import_sessions"("user_id");

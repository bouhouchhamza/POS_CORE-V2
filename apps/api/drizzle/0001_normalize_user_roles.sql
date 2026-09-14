UPDATE users
SET role = CASE lower(btrim(role))
  WHEN 'patron' THEN 'patron'
  WHEN 'worker' THEN 'worker'
  WHEN 'caissier' THEN 'worker'
  WHEN 'serveur' THEN 'worker'
  ELSE role
END;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE role NOT IN ('patron', 'worker')) THEN
    RAISE EXCEPTION 'Unsupported user roles remain; normalization aborted';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_role_check' AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('patron', 'worker'));
  END IF;
END $$;

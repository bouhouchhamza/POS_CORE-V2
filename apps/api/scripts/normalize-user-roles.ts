import { pool } from "../src/db/index.js";

const client = await pool.connect();
try {
  await client.query("begin");
  const unknown = await client.query(
    "select id, role from users where lower(btrim(role)) not in ('patron','worker','caissier','serveur') order by id",
  );
  if (unknown.rowCount) throw new Error(`Unsupported user roles: ${JSON.stringify(unknown.rows)}`);
  const updated = await client.query(
    "update users set role=case lower(btrim(role)) when 'patron' then 'patron' else 'worker' end where role is distinct from case lower(btrim(role)) when 'patron' then 'patron' else 'worker' end returning id,role",
  );
  await client.query("do $$ begin if not exists (select 1 from pg_constraint where conname='users_role_check' and conrelid='users'::regclass) then alter table users add constraint users_role_check check (role in ('patron','worker')); end if; end $$");
  await client.query("commit");
  const roles = await client.query("select role,count(*)::int as count from users group by role order by role");
  console.log(JSON.stringify({ updated: updated.rows, roles: roles.rows }, null, 2));
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
  await pool.end();
}

import argon2 from "argon2";
import { db, pool } from "./db/index.js";
import { users } from "./db/schema.js";
const email = process.env.ADMIN_EMAIL,
  password = process.env.ADMIN_PASSWORD,
  name = process.env.ADMIN_NAME ?? "Patron";
if (!email || !password || password.length < 1) {
  throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD (1+ character) are required");
}
await db
  .insert(users)
  .values({
    name,
    email,
    password: await argon2.hash(password),
    role: "patron",
    isActive: true,
  })
  .onConflictDoNothing();
await pool.end();

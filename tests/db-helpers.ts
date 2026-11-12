import "dotenv/config";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb, type Db } from "@/db";
import { users } from "@/db/schema";
import type { Actor } from "@/lib/permissions";

/** A fresh, migrated test database. Refuses to run against anything not named *_test. */
export async function freshDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Set TEST_DATABASE_URL to run the database tests.");
  if (!/_test(\?|$)/.test(url)) throw new Error("TEST_DATABASE_URL must point at a database whose name ends in _test.");
  const { db, pool } = createDb(url);
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;`);
  await migrate(db, { migrationsFolder: "./drizzle" });
  return { db, close: () => pool.end() };
}

export async function makeActor(db: Db, role: Actor["role"], email = `${role}@example.test`): Promise<Actor> {
  const [u] = await db.insert(users).values({ name: `Test ${role}`, email, role, passwordHash: "x" }).returning();
  return { id: u.id, role: u.role, name: u.name };
}

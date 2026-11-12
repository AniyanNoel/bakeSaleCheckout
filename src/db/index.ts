import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Either the database or an open transaction. Services accept both. */
export type DbLike = Db | Tx;

export function createDb(connectionString: string): { db: Db; pool: Pool } {
  const pool = new Pool({ connectionString, max: 10 });
  return { db: drizzle(pool, { schema }), pool };
}

// One pool per server process. In development Next.js reloads modules, so the
// pool is kept on globalThis to avoid opening a new one on every edit.
const g = globalThis as unknown as { __bakeSaleDb?: { db: Db; pool: Pool } };

export function getDb(): Db {
  if (!g.__bakeSaleDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
    g.__bakeSaleDb = createDb(url);
  }
  return g.__bakeSaleDb.db;
}

export { schema };

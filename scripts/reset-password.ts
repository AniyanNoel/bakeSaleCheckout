import "dotenv/config";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { createDb } from "../src/db";
import { sessions, users } from "../src/db/schema";

/** npm run reset-password -- you@example.com "new password" */
async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password || password.length < 10) {
    console.error('Usage: npm run reset-password -- you@example.com "a new password of 10+ characters"');
    process.exit(1);
  }
  const { db, pool } = createDb(process.env.DATABASE_URL!);
  const [u] = await db
    .update(users)
    .set({ passwordHash: await bcrypt.hash(password, 12), failedLogins: 0, lockedUntil: null, active: true })
    .where(eq(users.email, email.trim().toLowerCase()))
    .returning({ id: users.id });
  if (!u) {
    console.error(`No login with the email ${email}.`);
    process.exitCode = 1;
  } else {
    await db.delete(sessions).where(eq(sessions.userId, u.id));
    console.log("Password changed. Sign in with the new one.");
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

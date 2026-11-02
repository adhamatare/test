// Creates an admin user, or changes the password of an existing one.
//   npm run create-user -- <username>
// The password is typed at a hidden prompt, or taken from ADMIN_PASSWORD (for scripts). It is never stored in a file.
import readline from "node:readline";
import { hashPassword, MIN_PASSWORD } from "./auth.js";
import { pool } from "./db.js";

const username = (process.argv[2] || "").trim();
if (!username) { console.error("Usage: npm run create-user -- <username>"); process.exit(1); }

function askHidden(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.includes(question)) rl.output.write(s); };   // do not echo what is typed
    rl.question(question, answer => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
}

const password = process.env.ADMIN_PASSWORD || await askHidden(`Password for ${username}: `);
if (password.length < MIN_PASSWORD) { console.error(`Password must be at least ${MIN_PASSWORD} characters.`); process.exit(1); }

const hash = await hashPassword(password);
const { rowCount } = await pool.query("UPDATE users SET password_hash = $2 WHERE lower(username) = lower($1)", [username, hash]);
if (rowCount) {
  await pool.query("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE lower(username) = lower($1))", [username]);
  console.log(`Password changed for ${username}. Old sign-ins were ended.`);
} else {
  await pool.query("INSERT INTO users (username, password_hash) VALUES ($1, $2)", [username, hash]);
  console.log(`User ${username} created.`);
}
await pool.end();

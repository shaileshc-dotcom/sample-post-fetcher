import fs from "fs";
import crypto from "crypto";
const env = fs.readFileSync(".env.local", "utf8");
const m = env.match(/GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="([^"]*)"/);
if (!m) { console.log("❌ key line not found / quotes wrong"); process.exit(1); }
const key = m[1].replace(/\\n/g, "\n");
console.log("starts:", JSON.stringify(key.slice(0, 30)));
console.log("ends:", JSON.stringify(key.slice(-30)));
try { crypto.createPrivateKey(key); console.log("✅ KEY IN .env.local IS VALID"); }
catch (e) { console.log("❌ KEY IN .env.local IS INVALID:", e.message); }
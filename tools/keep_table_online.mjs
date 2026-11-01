// Keeps a seeded table's players "online" so a signed-in DM sees them in Party, like a real session. Each player's presence
// ping (what their browser would send every few seconds) is posted from here, using the character saved by
// tools/seed_test_campaign.py (seven players) or, with --showcase, tools/seed_showcase.py (eight). Ctrl+C to let them "leave".
//   node tools/keep_table_online.mjs [http://127.0.0.1:8860]
//   node tools/keep_table_online.mjs --showcase [base] [--live]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ctxFor } from "../tests/js/_data.mjs";
import { presenceSummary } from "../js/systems/dnd5e/engine/character.js";

const argv = process.argv.slice(2);
const showcase = argv.includes("--showcase");
const base = (argv.find((a) => !a.startsWith("--")) || "http://127.0.0.1:8860").replace(/\/$/, "");
const local = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base);
if (!local && !(showcase && argv.includes("--live"))) { console.error("This only runs against a local test server (or --showcase --live)."); process.exit(1); }

const file = showcase
  ? path.join(os.homedir(), ".pkdnd-showcase", `${new URL(base).hostname}.txt`)
  : path.join(os.homedir(), ".pkdnd-test", path.basename(path.resolve(import.meta.dirname, "..")), "seed-accounts.txt");
const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
const password = lines.find((l) => l.startsWith("password:")).split(":")[1].trim();
const keys = ["aldric", "bea", "cal", "dani", "eli", "fern", "gus", ...(showcase ? ["hana"] : [])];
const [prefix, domain] = showcase ? ["showcase", "showcase.example.com"] : ["seed", "seed.example.com"];
const ctx = ctxFor("2014");

async function api(method, p, body, token) {
  const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return res.json();
}

const players = [];
for (const key of keys) {
  const nid = `${prefix}-${key}`;
  const { token } = await api("POST", "/api/auth/login", { email: `${key}@${domain}`, password, networkId: nid });
  const camp = (await api("GET", `/api/campaigns?networkId=${nid}`, null, token)).campaigns.find((c) => c.name === "The Sundered Crown");
  if (!camp) { console.error(`Run tools/${showcase ? "seed_showcase.py" : "seed_test_campaign.py"} first.`); process.exit(1); }
  const save = (await api("GET", `/api/playersave?id=${nid}&campaignId=${camp.id}`, null, token)).current;
  const name = save.trainer?.name || key;
  players.push({ nid, token, cid: camp.id, name, character: save.systemData.dnd5e.characters[0] });
}

async function ping() {
  await Promise.all(players.map((p) => api("POST", "/api/trainer", { id: p.nid, name: p.name, team: { party: [], pc: [], dnd: presenceSummary(p.character, ctx) }, sprite: "", campaignId: p.cid }, p.token)));
}
await ping();
console.log(`${players.length} players online in The Sundered Crown (${players.map((p) => p.character.name).join(", ")}). Ctrl+C to stop.`);
setInterval(() => ping().catch(() => {}), 8000);

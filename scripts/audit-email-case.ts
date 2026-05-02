/**
 * Read-only audit: scan every collection that owns a user email field
 * (buyers, sellers, admins, teammembers) for two problems.
 *
 *   1. Documents whose stored email is not lowercase.
 *      These were written before pre-save hooks were in place and are the
 *      reason a new sign-up with a lowercase variant could create a
 *      duplicate (the unique index is case-sensitive at the storage layer).
 *
 *   2. Case-insensitive duplicate emails within the same collection.
 *      e.g. one document with "A@x.com" and another with "a@x.com" — both
 *      slipped past the unique index. These need manual merging.
 *
 *   3. Cross-collection collisions (an email that exists as a buyer AND a seller, etc.).
 *      Reported because a single human shouldn't have parallel roles tied to the
 *      same address.
 *
 * Usage from backend/:
 *   npx ts-node --transpile-only scripts/audit-email-case.ts
 *
 * No writes. Safe to run any time.
 */

import * as path from "path";
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const COLLECTIONS = ["buyers", "sellers", "admins", "teammembers"];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set in backend/.env");

  console.log("=== email-case audit ===");

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();

    const perCollectionLowered = new Map<string, Map<string, Array<{ _id: any; email: string }>>>();

    for (const name of COLLECTIONS) {
      const col = db.collection(name);
      const total = await col.countDocuments({});
      const docs = await col
        .find({ email: { $exists: true, $type: "string" } }, { projection: { _id: 1, email: 1 } })
        .toArray();

      const nonLower = docs.filter((d) => typeof d.email === "string" && d.email !== d.email.toLowerCase());

      const byLower = new Map<string, Array<{ _id: any; email: string }>>();
      for (const d of docs) {
        const key = String(d.email).trim().toLowerCase();
        if (!byLower.has(key)) byLower.set(key, []);
        byLower.get(key)!.push({ _id: d._id, email: d.email });
      }
      perCollectionLowered.set(name, byLower);

      const dupGroups = [...byLower.entries()].filter(([, list]) => list.length > 1);

      console.log(`\n[${name}]`);
      console.log(`  total docs:                  ${total}`);
      console.log(`  with email field:            ${docs.length}`);
      console.log(`  stored non-lowercase:        ${nonLower.length}`);
      console.log(`  case-insensitive duplicates: ${dupGroups.length} group(s)`);

      if (nonLower.length > 0) {
        console.log(`  sample non-lowercase (up to 10):`);
        nonLower.slice(0, 10).forEach((d) => {
          console.log(`    _id=${String(d._id)} email="${d.email}"`);
        });
      }

      if (dupGroups.length > 0) {
        console.log(`  duplicate groups (up to 10):`);
        dupGroups.slice(0, 10).forEach(([lower, list]) => {
          console.log(`    "${lower}" -> ${list.length} docs:`);
          list.forEach((d) => console.log(`      _id=${String(d._id)} email="${d.email}"`));
        });
      }
    }

    console.log(`\n[cross-collection]`);
    const allLowered = new Map<string, Array<{ collection: string; _id: any; email: string }>>();
    for (const [name, byLower] of perCollectionLowered.entries()) {
      for (const [lower, list] of byLower.entries()) {
        if (!allLowered.has(lower)) allLowered.set(lower, []);
        for (const d of list) allLowered.get(lower)!.push({ collection: name, _id: d._id, email: d.email });
      }
    }
    const crossHits = [...allLowered.entries()].filter(([, list]) => {
      const collections = new Set(list.map((d) => d.collection));
      return collections.size > 1;
    });
    console.log(`  emails that appear in more than one collection: ${crossHits.length}`);
    if (crossHits.length > 0) {
      console.log(`  showing up to 10:`);
      crossHits.slice(0, 10).forEach(([lower, list]) => {
        const cols = list.map((d) => `${d.collection}(${String(d._id)})`).join(", ");
        console.log(`    "${lower}" -> ${cols}`);
      });
    }

    console.log("\nDone. No writes performed.");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("\nERROR:", err.message || err);
  process.exit(1);
});

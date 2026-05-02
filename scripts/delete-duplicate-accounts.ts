/**
 * Delete one or more duplicate user accounts (buyers / sellers / admins / teammembers)
 * after a pre-flight check for dangling references.
 *
 * Safety:
 *   - Default DRY RUN. No writes without --commit.
 *   - JSON backup of every doc to be deleted, written to scripts/backups/
 *     before any mutation. Restore by inserting the backup back if needed.
 *   - Pre-flight reports references in:
 *       deals.seller         (sellers only — hard block if >0)
 *       teammembers.ownerId  (sellers/buyers — hard block if >0)
 *       emailverifications.userId, activitylogs.userId, revokedtokens.userId
 *         (informational — orphaned but inert; OK to leave)
 *   - --force is required to override a hard block. We do not pass --force
 *     here unless the user explicitly asks.
 *
 * Usage from backend/:
 *
 *   Dry run (the default — prints plan, writes nothing):
 *     npx ts-node --transpile-only scripts/delete-duplicate-accounts.ts \
 *       --collection sellers \
 *       --ids 693077a7c765ebc11a62485a
 *
 *   Commit:
 *     npx ts-node --transpile-only scripts/delete-duplicate-accounts.ts \
 *       --collection sellers \
 *       --ids 693077a7c765ebc11a62485a \
 *       --commit
 */

import * as fs from "fs";
import * as path from "path";
import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const VALID_COLLECTIONS = ["buyers", "sellers", "admins", "teammembers"] as const;
type CollectionName = (typeof VALID_COLLECTIONS)[number];

type Args = {
  collection: CollectionName;
  ids: string[];
  commit: boolean;
  force: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { collection: "" as any, ids: [], commit: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--commit") args.commit = true;
    else if (a === "--force") args.force = true;
    else if (a === "--collection") {
      const v = argv[++i];
      if (!VALID_COLLECTIONS.includes(v as CollectionName)) {
        throw new Error(`--collection must be one of: ${VALID_COLLECTIONS.join(", ")}`);
      }
      args.collection = v as CollectionName;
    } else if (a === "--ids") {
      const v = argv[++i];
      if (!v) throw new Error("--ids requires a comma-separated list");
      args.ids = v.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a.startsWith("--ids=")) {
      args.ids = a.slice("--ids=".length).split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  if (!args.collection) throw new Error("Pass --collection <buyers|sellers|admins|teammembers>");
  if (args.ids.length === 0) throw new Error("Pass --ids <comma-separated ObjectIds>");
  return args;
}

function ensureBackupDir(): string {
  const dir = path.resolve(__dirname, "backups");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set in backend/.env");

  console.log("=== delete-duplicate-accounts ===");
  console.log("Mode:       ", args.commit ? "COMMIT (will write)" : "DRY RUN");
  console.log("Collection: ", args.collection);
  console.log("Target IDs: ", args.ids);
  console.log("Force:      ", args.force);

  const objectIds = args.ids.map((s) => new ObjectId(s));

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();
    const target = db.collection(args.collection);

    const docs = await target.find({ _id: { $in: objectIds } }).toArray();
    if (docs.length !== objectIds.length) {
      const found = new Set(docs.map((d) => String(d._id)));
      const missing = args.ids.filter((id) => !found.has(id));
      console.error(`\nABORT: not all _ids exist in ${args.collection}. Missing:`);
      missing.forEach((m) => console.error("  - " + m));
      process.exit(1);
    }

    console.log("\nDocs found:");
    for (const d of docs) {
      console.log(`  _id=${String(d._id)} email="${d.email}" companyName="${d.companyName ?? ""}"`);
    }

    const refs: Record<string, Record<string, number>> = {};
    let hardBlock = false;
    for (const d of docs) {
      const id = d._id;
      const r: Record<string, number> = {};

      if (args.collection === "sellers") {
        r["deals.seller"] = await db.collection("deals").countDocuments({ seller: id });
        r["teammembers.ownerId(seller)"] = await db
          .collection("teammembers")
          .countDocuments({ ownerId: id, ownerType: "seller" });
        if ((r["deals.seller"] || 0) > 0) hardBlock = true;
        if ((r["teammembers.ownerId(seller)"] || 0) > 0) hardBlock = true;
      }
      if (args.collection === "buyers") {
        r["teammembers.ownerId(buyer)"] = await db
          .collection("teammembers")
          .countDocuments({ ownerId: id, ownerType: "buyer" });
        r["companyprofiles.buyer"] = await db.collection("companyprofiles").countDocuments({ buyer: id });
        if ((r["teammembers.ownerId(buyer)"] || 0) > 0) hardBlock = true;
      }

      r["emailverifications.userId"] = await db.collection("emailverifications").countDocuments({ userId: id });
      r["activitylogs.userId"] = await db.collection("activitylogs").countDocuments({ userId: id });
      r["revokedtokens.userId"] = await db.collection("revokedtokens").countDocuments({ userId: id });

      refs[String(id)] = r;
    }

    console.log("\nReference check (per target doc):");
    for (const [id, r] of Object.entries(refs)) {
      console.log(`  _id=${id}`);
      for (const [k, v] of Object.entries(r)) {
        const flag = v > 0 ? "  <-- has data" : "";
        console.log(`    ${k.padEnd(35)} ${v}${flag}`);
      }
    }

    if (hardBlock && !args.force) {
      console.error(
        "\nABORT: at least one target has hard-blocking references (deals/teammembers/companyprofiles).",
      );
      console.error("Resolve those first (reassign ownership), or re-run with --force to delete anyway.");
      process.exit(1);
    }

    if (!args.commit) {
      console.log("\nDry run complete. Re-run with --commit to delete the listed docs.");
      return;
    }

    const backupDir = ensureBackupDir();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFile = path.join(backupDir, `delete-${args.collection}-${stamp}.json`);
    fs.writeFileSync(
      backupFile,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          collection: args.collection,
          deletedIds: args.ids,
          referencesAtDeletion: refs,
          documents: docs,
        },
        null,
        2,
      ),
    );
    console.log("\nBackup written:", backupFile);

    const result = await target.deleteMany({ _id: { $in: objectIds } });
    console.log("Deleted:", result.deletedCount, "of", objectIds.length);
    console.log("\nDone.");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("\nERROR:", err.message || err);
  process.exit(1);
});

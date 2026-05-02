/**
 * Rollback a backfill-new-industries run by restoring each affected document's
 * industrySectors to its pre-run snapshot.
 *
 * Run from backend/:
 *
 *   Dry run:
 *     npx ts-node --transpile-only scripts/rollback-backfill-industries.ts \
 *       --backup scripts/backups/backfill-<timestamp>.json
 *
 *   Commit:
 *     npx ts-node --transpile-only scripts/rollback-backfill-industries.ts \
 *       --backup scripts/backups/backfill-<timestamp>.json --commit
 *
 * Restores industrySectors verbatim to the array recorded in the backup, using
 * $set. If the document was modified after the backfill (e.g., the buyer added
 * or removed industries themselves), this will overwrite those edits — review
 * the dry-run report before committing.
 */

import * as fs from "fs";
import * as path from "path";
import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

type Args = { backup: string; commit: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { backup: "", commit: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--commit") args.commit = true;
    else if (a === "--backup") {
      const v = argv[++i];
      if (!v) throw new Error("--backup requires a path");
      args.backup = v;
    } else if (a.startsWith("--backup=")) {
      args.backup = a.slice("--backup=".length);
    }
  }
  if (!args.backup) throw new Error("Pass --backup <path-to-backup.json>");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set in backend/.env");

  const backupPath = path.resolve(args.backup);
  if (!fs.existsSync(backupPath)) throw new Error(`Backup not found: ${backupPath}`);
  const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  if (!Array.isArray(backup.documents)) throw new Error("Backup file is missing documents[]");

  console.log("=== rollback-backfill-industries ===");
  console.log("Mode:", args.commit ? "COMMIT (will write)" : "DRY RUN (no writes)");
  console.log("Backup:", backupPath);
  console.log("Documents in backup:", backup.documents.length);

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();
    const col = db.collection("companyprofiles");

    let willRevert = 0;
    let alreadyMatches = 0;
    let missing = 0;
    const plan: Array<{ _id: ObjectId; current: string[]; restore: string[] }> = [];

    for (const entry of backup.documents) {
      const _id = new ObjectId(entry._id);
      const doc = await col.findOne(
        { _id },
        { projection: { "targetCriteria.industrySectors": 1 } }
      );
      if (!doc) {
        missing++;
        continue;
      }
      const current: string[] = (doc.targetCriteria && doc.targetCriteria.industrySectors) || [];
      const restore: string[] = entry.before || [];
      const same =
        current.length === restore.length && current.every((v, i) => v === restore[i]);
      if (same) {
        alreadyMatches++;
        continue;
      }
      willRevert++;
      plan.push({ _id, current, restore });
    }

    console.log("\nReport:");
    console.log("  Already at pre-run state:", alreadyMatches);
    console.log("  Documents missing now:   ", missing);
    console.log("  Would revert:            ", willRevert);
    if (plan.length > 0) {
      console.log("\nFirst 10 to revert:");
      plan.slice(0, 10).forEach((r) => {
        console.log(
          `  profile=${r._id.toString()} current=[${r.current.length}] restore=[${r.restore.length}]`
        );
      });
    }

    if (!args.commit) {
      console.log("\nDry run complete. Re-run with --commit to apply.");
      return;
    }
    if (plan.length === 0) {
      console.log("\nNothing to revert. Done.");
      return;
    }

    let updated = 0;
    for (const r of plan) {
      const res = await col.updateOne(
        { _id: r._id },
        { $set: { "targetCriteria.industrySectors": r.restore } }
      );
      if (res.modifiedCount === 1) updated++;
    }
    console.log("\nReverted:", updated, "of", plan.length, "Done.");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("\nERROR:", err.message || err);
  process.exit(1);
});

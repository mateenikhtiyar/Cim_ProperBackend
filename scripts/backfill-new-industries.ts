/**
 * Backfill new industry names onto every existing buyer's CompanyProfile.targetCriteria.industrySectors.
 *
 * Run from the backend/ directory:
 *
 *   Dry run (default, makes NO changes):
 *     npx ts-node --transpile-only scripts/backfill-new-industries.ts \
 *       --names "Some New Group,Another New Group"
 *
 *   Commit:
 *     npx ts-node --transpile-only scripts/backfill-new-industries.ts \
 *       --names "Some New Group,Another New Group" --commit
 *
 *   Also touch profiles whose industrySectors is empty (default skips them):
 *     ... --include-empty
 *
 * Safety properties:
 *   - Validates every supplied name against the canonical taxonomy in
 *     frontend/lib/industry-data.ts. Unknown name aborts the run.
 *   - Default dry-run: no writes without --commit.
 *   - Pre-write JSON backup of every affected document at scripts/backups/<ts>.json.
 *   - Uses $addToSet so re-running cannot duplicate or revive a removed entry within a single run.
 *   - Skips profiles with empty industrySectors unless --include-empty is passed.
 */

import * as fs from "fs";
import * as path from "path";
import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

type Args = {
  names: string[];
  commit: boolean;
  includeEmpty: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { names: [], commit: false, includeEmpty: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--commit") args.commit = true;
    else if (a === "--include-empty") args.includeEmpty = true;
    else if (a === "--names") {
      const v = argv[++i];
      if (!v) throw new Error("--names requires a value");
      args.names = v.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a.startsWith("--names=")) {
      args.names = a.slice("--names=".length).split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  if (args.names.length === 0) {
    throw new Error("Pass --names \"Name 1,Name 2\" with the new industry names to add.");
  }
  return args;
}

function loadCanonicalNames(): Set<string> {
  const file = path.resolve(__dirname, "..", "..", "frontend", "lib", "industry-data.ts");
  if (!fs.existsSync(file)) {
    throw new Error(`Cannot find taxonomy file at ${file}`);
  }
  const text = fs.readFileSync(file, "utf8");
  const names = new Set<string>();
  const re = /name:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    names.add(m[1]);
  }
  if (names.size === 0) {
    throw new Error("Parsed zero names from industry-data.ts; check the file format.");
  }
  return names;
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

  console.log("=== backfill-new-industries ===");
  console.log("Mode:", args.commit ? "COMMIT (will write)" : "DRY RUN (no writes)");
  console.log("Names to add:", args.names);
  console.log("Include-empty profiles:", args.includeEmpty);

  const canonical = loadCanonicalNames();
  const unknown = args.names.filter((n) => !canonical.has(n));
  if (unknown.length > 0) {
    console.error("\nABORT: the following names are not in frontend/lib/industry-data.ts:");
    unknown.forEach((n) => console.error("  - " + n));
    console.error("Fix the spelling or add the entries to the taxonomy first.");
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();
    const col = db.collection("companyprofiles");

    const filter: any = args.includeEmpty
      ? {}
      : { "targetCriteria.industrySectors": { $exists: true, $ne: [] } };

    const docs = await col
      .find(filter, { projection: { _id: 1, buyer: 1, "targetCriteria.industrySectors": 1 } })
      .toArray();

    let willChange = 0;
    let alreadyHasAll = 0;
    const perDoc: Array<{
      _id: ObjectId;
      buyer: any;
      before: string[];
      add: string[];
    }> = [];

    for (const d of docs) {
      const before: string[] = (d.targetCriteria && d.targetCriteria.industrySectors) || [];
      const beforeSet = new Set(before);
      const add = args.names.filter((n) => !beforeSet.has(n));
      if (add.length === 0) {
        alreadyHasAll++;
        continue;
      }
      willChange++;
      perDoc.push({ _id: d._id as ObjectId, buyer: d.buyer, before, add });
    }

    console.log("\nReport:");
    console.log("  Profiles scanned:        ", docs.length);
    console.log("  Already had every name:  ", alreadyHasAll);
    console.log("  Would update:            ", willChange);
    if (perDoc.length > 0) {
      console.log("\nFirst 10 affected profiles:");
      perDoc.slice(0, 10).forEach((r) => {
        console.log(
          `  profile=${r._id.toString()} buyer=${r.buyer} before=[${r.before.length} items] +add=${JSON.stringify(r.add)}`
        );
      });
    }

    if (!args.commit) {
      console.log("\nDry run complete. Re-run with --commit to apply.");
      return;
    }
    if (perDoc.length === 0) {
      console.log("\nNothing to write. Done.");
      return;
    }

    const backupDir = ensureBackupDir();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFile = path.join(backupDir, `backfill-${stamp}.json`);
    fs.writeFileSync(
      backupFile,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          namesAdded: args.names,
          documents: perDoc.map((r) => ({
            _id: r._id.toString(),
            buyer: r.buyer ? r.buyer.toString?.() ?? r.buyer : null,
            before: r.before,
          })),
        },
        null,
        2
      )
    );
    console.log("\nBackup written:", backupFile);

    const auditFile = path.join(backupDir, `audit-${stamp}.json`);
    const audit: any[] = [];

    let updated = 0;
    for (const r of perDoc) {
      const res = await col.updateOne(
        { _id: r._id },
        { $addToSet: { "targetCriteria.industrySectors": { $each: r.add } } }
      );
      if (res.modifiedCount === 1) {
        updated++;
        audit.push({
          _id: r._id.toString(),
          buyer: r.buyer ? r.buyer.toString?.() ?? r.buyer : null,
          added: r.add,
          before: r.before,
        });
      } else {
        console.warn(`  WARN: profile ${r._id.toString()} not modified (matched=${res.matchedCount})`);
      }
    }

    fs.writeFileSync(auditFile, JSON.stringify(audit, null, 2));
    console.log("\nUpdated:", updated, "of", perDoc.length);
    console.log("Audit written:", auditFile);
    console.log("\nDone.");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("\nERROR:", err.message || err);
  process.exit(1);
});

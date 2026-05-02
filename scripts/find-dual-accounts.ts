/**
 * Read-only analysis: find case-insensitive email duplicates and decide which
 * account to keep based on actual data attached to each document.
 *
 * Scope:
 *   1. Within-collection duplicates (two buyers, two sellers, etc. with the
 *      same email differing only by case). These are the real bugs.
 *   2. Cross-collection collisions are *informational only* — a buyer and a
 *      seller can legitimately share an email (different roles).
 *
 * Decision rule for within-collection duplicates:
 *   keep the document with the higher data score; tie-breaker is "email
 *   stored in correct (lowercase) form". If both score 0 OR both have non-
 *   trivial data and there's no clear winner, mark as MANUAL.
 *
 * Data score is collection-specific:
 *   buyers  : has companyProfileId(+5) + active/pending/rejected deal counts
 *             + profilePicture(+1) + non-default companyName(+2)
 *   sellers : owned deal count(*3 weight) + profilePicture(+1)
 *             + non-default companyName(+2) + phoneNumber(+1) + title(+1)
 *   admins  : mostly tie — flagged MANUAL if found
 *   teammembers: lastLogin is not stored; uses isActive(+2) + permissions
 *             length(+0.1 each)
 *
 * Usage from backend/:
 *   npx ts-node --transpile-only scripts/find-dual-accounts.ts
 *
 * No writes.
 */

import * as path from "path";
import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

type Doc = Record<string, any>;

type Scored = {
  collection: string;
  _id: ObjectId;
  email: string;
  emailIsLower: boolean;
  score: number;
  reasons: string[];
  raw: Doc;
};

function fmt(d: Date | undefined): string {
  if (!d) return "n/a";
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return String(d);
  }
}

async function scoreBuyer(doc: Doc): Promise<{ score: number; reasons: string[] }> {
  let s = 0;
  const r: string[] = [];
  if (doc.companyProfileId) {
    s += 5;
    r.push("hasCompanyProfile(+5)");
  }
  const active = Number(doc.activeDealsCount || 0);
  const pending = Number(doc.pendingDealsCount || 0);
  const rejected = Number(doc.rejectedDealsCount || 0);
  if (active > 0) {
    s += active * 3;
    r.push(`active=${active}(*3)`);
  }
  if (pending > 0) {
    s += pending * 2;
    r.push(`pending=${pending}(*2)`);
  }
  if (rejected > 0) {
    s += rejected;
    r.push(`rejected=${rejected}`);
  }
  if (doc.profilePicture) {
    s += 1;
    r.push("hasPic(+1)");
  }
  if (doc.companyName && doc.companyName !== "Set your company name") {
    s += 2;
    r.push("namedCompany(+2)");
  }
  return { score: s, reasons: r };
}

async function scoreSeller(doc: Doc, dealCount: number): Promise<{ score: number; reasons: string[] }> {
  let s = 0;
  const r: string[] = [];
  if (dealCount > 0) {
    s += dealCount * 3;
    r.push(`deals=${dealCount}(*3)`);
  }
  if (doc.profilePicture) {
    s += 1;
    r.push("hasPic(+1)");
  }
  if (doc.companyName && doc.companyName !== "Set your company name") {
    s += 2;
    r.push("namedCompany(+2)");
  }
  if (doc.phoneNumber) {
    s += 1;
    r.push("phone(+1)");
  }
  if (doc.title) {
    s += 1;
    r.push("title(+1)");
  }
  return { score: s, reasons: r };
}

async function scoreAdmin(_doc: Doc): Promise<{ score: number; reasons: string[] }> {
  return { score: 0, reasons: [] };
}

async function scoreTeamMember(doc: Doc): Promise<{ score: number; reasons: string[] }> {
  let s = 0;
  const r: string[] = [];
  if (doc.isActive) {
    s += 2;
    r.push("active(+2)");
  }
  const perms = Array.isArray(doc.permissions) ? doc.permissions.length : 0;
  if (perms > 0) {
    s += perms * 0.1;
    r.push(`perms=${perms}`);
  }
  return { score: s, reasons: r };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set in backend/.env");

  console.log("=== find-dual-accounts (read-only) ===\n");

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();
    const buyers = db.collection("buyers");
    const sellers = db.collection("sellers");
    const admins = db.collection("admins");
    const teammembers = db.collection("teammembers");
    const deals = db.collection("deals");

    const collections: Record<string, ReturnType<typeof db.collection>> = {
      buyers,
      sellers,
      admins,
      teammembers,
    };

    type Recommendation = {
      keep?: Scored;
      drop: Scored[];
      manual: boolean;
      note?: string;
    };

    const withinReports: Array<{
      collection: string;
      lowerEmail: string;
      docs: Scored[];
      recommendation: Recommendation;
    }> = [];

    for (const [name, col] of Object.entries(collections)) {
      const all = await col
        .find({ email: { $exists: true, $type: "string" } }, { projection: {} })
        .toArray();

      const byLower = new Map<string, Doc[]>();
      for (const d of all) {
        const key = String(d.email).trim().toLowerCase();
        if (!byLower.has(key)) byLower.set(key, []);
        byLower.get(key)!.push(d);
      }

      const dups = [...byLower.entries()].filter(([, list]) => list.length > 1);

      for (const [lowerEmail, list] of dups) {
        const scored: Scored[] = [];
        for (const d of list) {
          let s: { score: number; reasons: string[] };
          if (name === "buyers") s = await scoreBuyer(d);
          else if (name === "sellers") {
            const dealCount = await deals.countDocuments({ seller: d._id });
            s = await scoreSeller(d, dealCount);
          } else if (name === "admins") s = await scoreAdmin(d);
          else s = await scoreTeamMember(d);

          const stored = String(d.email);
          scored.push({
            collection: name,
            _id: d._id as ObjectId,
            email: stored,
            emailIsLower: stored === stored.toLowerCase(),
            score: s.score,
            reasons: s.reasons,
            raw: d,
          });
        }

        scored.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          if (a.emailIsLower !== b.emailIsLower) return a.emailIsLower ? -1 : 1;
          return 0;
        });

        const top = scored[0];
        const second = scored[1];
        let recommendation: Recommendation;
        if (top.score > second.score) {
          recommendation = { keep: top, drop: scored.slice(1), manual: false };
        } else if (top.score === 0 && second.score === 0) {
          if (top.emailIsLower !== second.emailIsLower) {
            recommendation = {
              keep: top,
              drop: scored.slice(1),
              manual: false,
              note: "both empty; kept lowercase-email doc",
            };
          } else {
            recommendation = { drop: scored, manual: true, note: "both empty; cannot pick automatically" };
          }
        } else {
          recommendation = { drop: scored, manual: true, note: "tie on score; needs human" };
        }

        withinReports.push({ collection: name, lowerEmail, docs: scored, recommendation });
      }
    }

    const autos = withinReports.filter((r) => !r.recommendation.manual);
    const manuals = withinReports.filter((r) => r.recommendation.manual);

    console.log("--- WITHIN-COLLECTION DUPLICATES ---\n");
    if (withinReports.length === 0) {
      console.log("None.\n");
    } else {
      console.log(`Total duplicate groups: ${withinReports.length}`);
      console.log(`  auto-decidable:       ${autos.length}`);
      console.log(`  needs manual review:  ${manuals.length}\n`);
    }

    if (autos.length > 0) {
      console.log("== Auto-recommended (clear winner) ==");
      for (const r of autos) {
        const k = r.recommendation.keep!;
        console.log(
          `\n[${r.collection}] "${r.lowerEmail}"  ${r.recommendation.note ? `(${r.recommendation.note})` : ""}`,
        );
        console.log(
          `  KEEP _id=${String(k._id)} email="${k.email}" score=${k.score} created=${fmt(k.raw.createdAt)}  ${k.reasons.join(" ")}`,
        );
        for (const d of r.recommendation.drop) {
          console.log(
            `  DROP _id=${String(d._id)} email="${d.email}" score=${d.score} created=${fmt(d.raw.createdAt)}  ${d.reasons.join(" ")}`,
          );
        }
      }
    }

    if (manuals.length > 0) {
      console.log("\n\n== MANUAL REVIEW NEEDED ==");
      for (const r of manuals) {
        console.log(`\n[${r.collection}] "${r.lowerEmail}"  (${r.recommendation.note})`);
        for (const d of r.docs) {
          console.log(
            `  _id=${String(d._id)} email="${d.email}" score=${d.score} created=${fmt(d.raw.createdAt)}  ${d.reasons.join(" ")}`,
          );
        }
      }
    }

    console.log("\n\n--- CROSS-COLLECTION (informational, NOT proposed for deletion) ---\n");
    const allLowered = new Map<string, Array<{ collection: string; _id: ObjectId; email: string }>>();
    for (const [name, col] of Object.entries(collections)) {
      const docs = await col.find({}, { projection: { _id: 1, email: 1 } }).toArray();
      for (const d of docs) {
        if (typeof d.email !== "string") continue;
        const key = d.email.trim().toLowerCase();
        if (!allLowered.has(key)) allLowered.set(key, []);
        allLowered.get(key)!.push({ collection: name, _id: d._id as ObjectId, email: d.email });
      }
    }
    const crossHits = [...allLowered.entries()].filter(([, list]) => {
      const cols = new Set(list.map((d) => d.collection));
      return cols.size > 1;
    });
    if (crossHits.length === 0) {
      console.log("None.");
    } else {
      console.log(`Found ${crossHits.length} email(s) appearing in more than one collection:`);
      for (const [lower, list] of crossHits) {
        const cols = list.map((d) => `${d.collection}(${String(d._id)})`).join(", ");
        console.log(`  "${lower}" -> ${cols}`);
      }
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

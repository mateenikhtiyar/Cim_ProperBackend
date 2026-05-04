/**
 * Read-only audit: explain why the admin overview shows
 *   "Active Deals Revenue" and "Active Deals EBITDA" as $0
 * while the system clearly has hundreds of deals and billions in totals.
 *
 * The page-level aggregation in deals.service.ts uses { status: 'active' }
 * literally, but the rest of the platform treats "active" as
 * { status: { $nin: ['completed', 'loi'] } }. This script:
 *
 *   1. Counts deals by stored status value.
 *   2. Reports counts under both definitions of "active".
 *   3. Sums trailingRevenueAmount and trailingEBITDAAmount under each
 *      definition, so the user can see what the admin overview WOULD show
 *      if the broader filter were used.
 *   4. For deals with status='active' specifically, reports how many have
 *      financial fields populated, so we can rule out "data is missing"
 *      vs "filter is too narrow".
 *
 * Usage from backend/:
 *   npx ts-node --transpile-only scripts/audit-active-deals-metrics.ts
 *
 * No writes. Safe to run any time.
 */

import * as path from "path";
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

function formatMoney(n: number): string {
  if (!isFinite(n)) return String(n);
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set in backend/.env");

  console.log("=== active-deals-metrics audit ===");

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();
    console.log(`connected to db: ${db.databaseName}`);
    const deals = db.collection("deals");

    const total = await deals.countDocuments({});
    console.log(`total deals in collection: ${total}`);

    // 1. Status distribution
    console.log("\n--- status distribution ---");
    const statusAgg = await deals
      .aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ])
      .toArray();
    for (const row of statusAgg) {
      const label = row._id === null || row._id === undefined ? "(missing)" : String(row._id);
      console.log(`  ${label.padEnd(15)} ${row.count}`);
    }

    // 2. Counts under each candidate "active" definition
    console.log("\n--- 'active' definition comparison ---");
    const strictActive = await deals.countDocuments({ status: "active" });
    const broadActive = await deals.countDocuments({
      status: { $nin: ["completed", "loi"] },
    });
    const acceptedActiveCountAgg = await deals
      .aggregate([
        {
          $match: {
            status: { $nin: ["completed", "loi"] },
            $expr: {
              $gt: [
                {
                  $size: {
                    $filter: {
                      input: { $objectToArray: { $ifNull: ["$invitationStatus", {}] } },
                      as: "item",
                      cond: { $eq: ["$$item.v.response", "accepted"] },
                    },
                  },
                },
                0,
              ],
            },
          },
        },
        { $count: "n" },
      ])
      .toArray();
    const acceptedActiveCount = acceptedActiveCountAgg[0]?.n ?? 0;
    const completed = await deals.countDocuments({ status: "completed" });
    const loi = await deals.countDocuments({ status: "loi" });
    console.log(`  strict (status === 'active'):                          ${strictActive}`);
    console.log(`  broad  (status NOT IN [completed, loi]):               ${broadActive}`);
    console.log(`  real active (NOT completed/loi + >=1 accepted buyer):  ${acceptedActiveCount}`);
    console.log(`  completed:                                              ${completed}`);
    console.log(`  loi:                                                    ${loi}`);

    // 3. Financial sums under each filter
    console.log("\n--- revenue / EBITDA sums ---");
    const sumStage = {
      $group: {
        _id: null,
        revenue: { $sum: { $ifNull: ["$financialDetails.trailingRevenueAmount", 0] } },
        ebitda: { $sum: { $ifNull: ["$financialDetails.trailingEBITDAAmount", 0] } },
        count: { $sum: 1 },
      },
    };

    // Canonical "active deal" definition: NOT completed/loi AND at least one
    // buyer in invitationStatus has response === 'accepted'.
    // Mirrors deals.service.ts findAllAdminOptimized (buyerResponse=accepted branch).
    const acceptedActiveMatch = {
      status: { $nin: ["completed", "loi"] },
      $expr: {
        $gt: [
          {
            $size: {
              $filter: {
                input: { $objectToArray: { $ifNull: ["$invitationStatus", {}] } },
                as: "item",
                cond: { $eq: ["$$item.v.response", "accepted"] },
              },
            },
          },
          0,
        ],
      },
    };

    const [strict] = await deals
      .aggregate([{ $match: { status: "active" } }, sumStage])
      .toArray();
    const [broad] = await deals
      .aggregate([{ $match: { status: { $nin: ["completed", "loi"] } } }, sumStage])
      .toArray();
    const [accepted] = await deals
      .aggregate([{ $match: acceptedActiveMatch }, sumStage])
      .toArray();
    const [all] = await deals.aggregate([sumStage]).toArray();

    const fmtRow = (label: string, r: any) => {
      if (!r) {
        console.log(`  ${label.padEnd(45)} count=    0  rev=        $0  ebitda=        $0`);
        return;
      }
      console.log(
        `  ${label.padEnd(45)} count=${String(r.count).padStart(5)}  rev=${formatMoney(r.revenue).padStart(10)}  ebitda=${formatMoney(r.ebitda).padStart(10)}`,
      );
    };

    fmtRow("admin overview filter (status === 'active')", strict);
    fmtRow("'in pipeline' (NOT IN completed/loi)", broad);
    fmtRow("real active (NOT completed/loi + >=1 accepted)", accepted);
    fmtRow("all deals", all);

    // 4. For status='active' deals, count how many actually have financial fields
    console.log("\n--- financial field population for status='active' ---");
    const activeWithRevenue = await deals.countDocuments({
      status: "active",
      "financialDetails.trailingRevenueAmount": { $gt: 0 },
    });
    const activeWithEbitda = await deals.countDocuments({
      status: "active",
      "financialDetails.trailingEBITDAAmount": { $gt: 0 },
    });
    console.log(`  status='active' with trailingRevenueAmount > 0:  ${activeWithRevenue}`);
    console.log(`  status='active' with trailingEBITDAAmount  > 0:  ${activeWithEbitda}`);

    // 5. Sanity check: same field population among all deals
    const allWithRevenue = await deals.countDocuments({
      "financialDetails.trailingRevenueAmount": { $gt: 0 },
    });
    const allWithEbitda = await deals.countDocuments({
      "financialDetails.trailingEBITDAAmount": { $gt: 0 },
    });
    console.log(`  any status with trailingRevenueAmount > 0:        ${allWithRevenue}`);
    console.log(`  any status with trailingEBITDAAmount  > 0:        ${allWithEbitda}`);

    console.log("\n=== diagnosis ===");
    if (strictActive === 0 && acceptedActiveCount > 0) {
      console.log(
        `Zero deals have literal status === 'active', but ${acceptedActiveCount} deals match the real active definition`,
      );
      console.log(
        "(NOT completed/loi AND at least one accepted buyer). The admin overview's strict filter is the cause",
      );
      console.log(
        "of the $0 figures. Switching the aggregation to the real definition will surface the correct totals.",
      );
    } else if (strictActive > 0 && strict?.revenue === 0) {
      console.log("There ARE status='active' deals but their financial fields are unpopulated.");
    } else {
      console.log("Review the numbers above before deciding on a fix.");
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("audit failed:", err);
  process.exit(1);
});

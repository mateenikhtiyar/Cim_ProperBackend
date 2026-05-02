# Backend Scripts

## Backfill new industries onto every buyer

Use when a new industry name is added to `frontend/lib/industry-data.ts` and the product decision is to opt every existing buyer in by default. Buyers can remove what they don't want from their acquire profile afterwards.

### How it works

Every buyer's industry preferences live in `companyprofiles.targetCriteria.industrySectors` as an array of name strings. This script appends the supplied new names to that array on every existing profile, idempotently.

### Safety

- Validates every name against `frontend/lib/industry-data.ts`. Typos abort the run before any write.
- Default is **dry run**. Nothing is written without `--commit`.
- Skips profiles whose `industrySectors` is empty (incomplete profiles). Override with `--include-empty`.
- Writes a JSON backup of every affected document to `scripts/backups/backfill-<timestamp>.json` before any update. Use it to roll back.
- Uses `$addToSet` so duplicate names are impossible and re-runs are no-ops.
- Writes an audit log to `scripts/backups/audit-<timestamp>.json`.

### Run

From the `backend/` directory.

Dry run:

```
npx ts-node --transpile-only scripts/backfill-new-industries.ts \
  --names "Some New Group,Another New Group"
```

Review the report. When happy, commit:

```
npx ts-node --transpile-only scripts/backfill-new-industries.ts \
  --names "Some New Group,Another New Group" --commit
```

### Rollback

If you need to undo the run, use the backup file the commit produced:

```
npx ts-node --transpile-only scripts/rollback-backfill-industries.ts \
  --backup scripts/backups/backfill-<timestamp>.json
```

Add `--commit` after reviewing the dry-run report. Note: rollback restores `industrySectors` verbatim to the pre-run snapshot, so any edits a buyer made after the backfill will be overwritten. Review the dry-run output for surprises before committing.

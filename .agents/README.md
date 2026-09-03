# Shared Work Ledger

This directory is the repository's machine-readable coordination ledger. Every agent checks in before editing and checks out when its scope is finished.

## Protocol

1. Read every JSON file in `.agents/claims/` whose `status` is `active` or `blocked`.
2. Inspect the named paths plus current Git state before deciding whether work overlaps.
3. Create one claim per task at `.agents/claims/<task-id>.json`. Use a stable, lowercase, hyphenated task ID.
4. Keep `paths` narrow and literal. Use repository-relative paths. List a directory only when responsibility covers that directory.
5. Update the same file when scope or state changes. Never create a second claim for the same task.
6. Set `status` to `completed` at check-out. Record the commit and every verification command with its result.
7. A stale claim is evidence of unfinished work, not an eternal lock. Verify its branch, commit, working tree, plus owner state before resolving it.

## Claim schema

```json
{
  "schema_version": 1,
  "task_id": "short-stable-task-id",
  "agent": "tool-or-agent-identity",
  "summary": "One concrete outcome",
  "status": "active",
  "claimed_at": "2026-09-03T13:00:00Z",
  "updated_at": "2026-09-03T13:00:00Z",
  "paths": ["path/to/file", "path/to/directory/"],
  "symbols": ["OptionalClass.method"],
  "coordination": {
    "depends_on": [],
    "conflicts_with": [],
    "notes": "Known overlap, handoff, or integration decision"
  },
  "completion": {
    "commit": null,
    "checks": []
  }
}
```

Allowed status values are `active`, `blocked`, or `completed`. Times use UTC ISO 8601. `completion.commit` stays `null` until check-out. Each check is a concise string containing the command or inspection plus `passed`, `failed`, or `not_run`.

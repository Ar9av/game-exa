---
name: parallel-qa-orchestra
description: Replaces the serial playtester → gap-checker chain with 4 concurrent QA workers: static analysis (no browser), golden-path scenario runner, dynamic fuzzer, and physics debug validator. Merges all results into a single failure list for the refiner. Cuts QA time from ~2 min to ~30s.
---

# Parallel QA Orchestra — Concurrent Validation

Orchestrates 4 independent QA checks that run simultaneously, each on its own dev-server port. The refiner gets a single merged failure report with every issue in one pass, cutting the number of refine-iterate cycles needed.

## When to use

Replace the sequential `playtester → gap-checker` calls in the main pipeline with a single call to this skill. Use after codesmith and the manifest-auditor + mobile-compat-checker linting passes.

## The 4 workers

| Worker | Browser? | What it catches |
|---|---|---|
| **static** | No | BFS reachability, border holes, jump-arc gaps, spawn collision |
| **golden-path** | Yes (port A) | Boot, walk, jump, attack scenarios; win-condition reachability |
| **fuzzer** | Yes (port B) | Stuck state, spawn-trap, no-progress, out-of-bounds, NaN state |
| **physics-debug** | Yes (port C) | Hitbox misalignment, body offset bugs |

All 4 run concurrently. Total wall-clock time ≈ max(individual times) ≈ 30–45s.

## Output contract

```jsonc
{
  "ts": "<ISO>",
  "ok": false,
  "failCount": 3,
  "workers": {
    "static":       { "ok": true,  "errors": 0, "warnings": 1, "issues": [...] },
    "golden-path":  { "ok": false, "passed": false, "failures": [...] },
    "fuzzer":       { "ok": true,  "issues": [] },
    "physics-debug": { "ok": true, "misalignedCount": 1, "bodies": [...] }
  },
  "merged": [
    { "kind": "border-hole",         "source": "static",  "severity": "error",   "message": "..." },
    { "kind": "screenshot-diff",     "source": "golden",  "severity": "error",   "message": "..." },
    { "kind": "hitbox-misaligned",   "source": "physics", "severity": "warning", "message": "..." }
  ]
}
```

Written to `qa/orchestra-report.json`. Also appended to `state.qa[]` (keeping last 5).

Exit code `0` if `ok`, else `5`.

## Port allocation

Each browser worker gets its own vite dev-server port. The script finds 3 free ports automatically using Node's `net` module before launching workers.

## Integration with the pipeline

Replace steps 7–8 in the gameforge orchestrator:

```
// Before:
playtester → refiner (loop) → playtester (loop)

// After:
manifest-auditor → mobile-compat-checker → parallel-qa-orchestra → refiner (loop) → parallel-qa-orchestra (loop)
```

Max 3 refiner iterations, same as before.

## Process

1. Run `scripts/orchestrate_qa.mjs <project-dir>`
2. Script allocates 3 free ports.
3. Spawns 4 workers concurrently via `Promise.all` + `child_process.spawn`.
4. Collects stdout JSON from each worker as it finishes.
5. Merges into `orchestra-report.json`.
6. Exits with combined pass/fail.

## Scripts

- `scripts/orchestrate_qa.mjs <project-dir> [--no-physics]` — run all 4 workers. `--no-physics` skips the physics-debug worker (faster, loses hitbox checks).

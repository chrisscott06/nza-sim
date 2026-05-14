# Batch Progress — Brief 27 Cleanup + Brief 28 + Brief 29

**Current state:** `running`
**Last update:** 2026-05-14
**Resumed after halt 1.** Halt resolved by Chris's runtime verification: the prop-name bug is real and is distinct from the `4f4f3a5` race condition (the race fix unblocked `ready`, which then exposed the prop-name mismatch as the next downstream failure). Brief 27 cleanup Part 1 proceeds as written, with the small refinement that `mode="envelope-gains"` is also dropped (not a prop the consumer accepts).

---

## Pre-flight check results (run 2026-05-14)

| Check | Result | Notes |
|---|---|---|
| State 1 Live isolation | ✅ 40/40 byte-identical | Bridgewater baseline 224,587 bytes |
| State 1 EP isolation | ✅ 41/41 byte-identical (40 assembler + 1 end-to-end) | Required `$env:ENERGYPLUS_DIR = "C:\EnergyPlusV26-1-0"` — `nza_engine/config.py:17` defaults to a macOS path and is not Windows-aware |
| State 2 Live isolation | ✅ 21/21 byte-identical | Bridgewater baseline 165,637 bytes |
| State 2 EP isolation | ✅ 21/21 byte-identical (assembler only — script does not include end-to-end check parallel to Brief 27's State-1 addition) | Same env-var requirement |
| Frontend build | ✅ Clean (12.79s, 3166 modules, 2 chunk-size warnings only) | No errors. Pre-existing warning about chunk size > 500 kB. |
| Git working tree clean | ⚠ Not clean | Orchestration setup + audit deliverables uncommitted. See halt report for the file list. |
| `current.md` points at `27_cleanup.md` | ✅ Yes | Updated this session |

All four state-isolation regressions pass. Build is clean. The working-tree-clean check is the only pre-flight that didn't pass — and it's not pass-failing because of uncertainty about *whether* to commit the orchestration setup yet (see halt report).

---

## Brief 27 Cleanup

| Part | Status | Start | End | Commit | Notes |
|------|--------|-------|-----|--------|-------|
| 1. Heat Balance prop bug fix | **complete** | 2026-05-14 | 2026-05-14 | `d281a16` | One-line rename `balance=` → `liveData=` on `HeatBalanceView.jsx:45`. Shape contract holds (`instantCalc.js` returns `annual.totals` + `metadata.gia_m2` matching what `HeatBalance.jsx` reads at lines 535-543). No transform needed per Chris's "rename is the complete fix if shape matches" guidance. All 4 isolation regressions still byte-identical (40/40 + 41/41 EP + 21/21 + 21/21). Build clean (10.99s). |
| 2. Divergence doc correction | **complete** | 2026-05-14 | 2026-05-14 | `8dc1909` | Four inline `[CORRECTED 2026-05-14]` annotation blocks added to `docs/state_1_engine_divergence_investigation.md`: top-of-doc summary, solar 38%/50 GWh correction with per-facade table, 23.5% conduction artefact explanation, Resolution-section update with the new May 2026 batch structure. Original content preserved per brief's "annotation over strikethrough" guidance. |
| **Brief 27 cleanup close-out** | **complete** | 2026-05-14 | 2026-05-14 | (next commit) | Full regression suite green post-cleanup: State 1 Live 40/40, State 1 EP 41/41, State 2 Live 21/21, State 2 EP 21/21. Build 11.01s clean. STATUS.md updated. `current.md` updated to point at `active/28_prereq_free_running_ep.md`. Brief file archived to `docs/briefs/archive/27_cleanup_COMPLETED.md`. Confidence: 10/10 (two narrowly-scoped fixes, no design decisions). |

## Brief 28 Prereq Free-running EP

| Part | Status | Start | End | Commit | Notes |
|------|--------|-------|-----|--------|-------|
| 1. Verify assembler envelope-only mode | queued | — | — | — | |
| 2. Run + persist free-running EP | queued | — | — | — | |
| 3. Update engine_agreement script | queued | — | — | — | |
| 4. Re-scope check | queued | — | — | — | |

## Brief 28a Visible Polish

| Part | Status | Start | End | Commit | Notes |
|------|--------|-------|-----|--------|-------|
| 1. Static / Dynamic rename | queued | — | — | — | |
| 2. kWh/m²·yr live readouts | queued | — | — | — | |
| 3. Canvas tab restructure | queued | — | — | — | |
| 4. Pavlo component port | queued | — | — | — | |
| 5. Load shape + engine toggle | queued | — | — | — | |
| 6. Pavlo pattern roll-out | queued | — | — | — | |
| 7. Close-out | queued | — | — | — | |

## Brief 28b Physics Overhaul

| Part | Status | Start | End | Commit | Notes |
|------|--------|-------|-----|--------|-------|
| 0. Premise re-validation | queued | — | — | — | |
| 1. Contract update | queued | — | — | — | |
| 2. Solar model upgrade | queued | — | — | — | |
| 3. Multi-layer CTF mass model | queued | — | — | — | |
| 4. Multi-construction validation | queued | — | — | — | |
| 5. Engine agreement re-baseline | queued | — | — | — | |
| 6. Close-out | queued | — | — | — | |

## Brief 29 Building Completion

| Part | Status | Start | End | Commit | Notes |
|------|--------|-------|-----|--------|-------|
| 1. State 1 diagnostic views | queued | — | — | — | |
| 2. UI principles conformance | queued | — | — | — | |
| 3. Hardcoded constants cleanup | queued | — | — | — | |
| 4. BREDEM phasing factors | queued | — | — | — | |
| 5. Close-out + batch close | queued | — | — | — | |

---

## Decisions log

| Part / decision | Rationale |
|---|---|
| Use `$env:ENERGYPLUS_DIR = "C:\EnergyPlusV26-1-0"` inline for EP scripts | `nza_engine/config.py:17` falls back to `/Applications/EnergyPlus-25-2-0` (macOS-only) when env var unset. Not in scope to change config; setting inline works. Filed under "things worth fixing as part of constants cleanup in Brief 29 Part 3." |
| Part 1 — keep `mode="envelope-gains"` as-is in `HeatBalanceView.jsx:45`, don't expand scope to also fix the mode prop | The consumer `HeatBalance.jsx:494` declares `mode = DEFAULT_MODE   // 'envelope-only' \| 'full'`. The wrapper passes `'envelope-gains'` which is outside the documented enum — a pre-existing condition not flagged by the audit. Chris's instruction was specifically the prop name rename. Logged as a follow-up candidate: either extend the consumer's `mode` enum to include `'envelope-gains'` (with appropriate handling in `flattenGains` / `flattenLosses`), or change the wrapper to pass `'full'` semantically. Defer to Brief 28a (canvas restructure) or document as accepted-pre-existing. |

## Halts

| # | Date | Brief | Part | Classification | Resolution |
|---|------|-------|------|----------------|------------|
| 1 | 2026-05-14 | 27 cleanup | 1 (Heat Balance prop fix) | HH4 (premise concern) | **Resolved 2026-05-14.** Chris verified the empty state in browser. Bug is real, distinct from `4f4f3a5` race fix. Part 1 proceeds. See `docs/batch_halt_report.md` resolution section. |

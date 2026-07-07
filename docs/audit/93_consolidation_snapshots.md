# Brief 93 — Consolidation snapshots + merge deltas

## Method (Part 1b)

- **Anchor:** `scripts/_brief93_anchor.mjs` (adapted from `_brief75_p1_anchor.mjs`). Kept **untracked during
  the runs** and copied unchanged across all four checkouts, so **only the engine** (`frontend/src/utils/*`)
  varied between runs. Verified the checkout genuinely swapped the engine (main `instantCalc.js` = 7349 lines,
  `auxScalar`=0; interventions = 7374 lines, `auxScalar`=6) — the identical outputs below are real, not a
  cached run.
- **Project:** `12cf7cc4-9bdc-41bc-ab4e-24e044fbad9d` "Bridgewater Hotel" (canonical baseline, Chris-confirmed).
- **Backend:** served **read-only** from `chris/interventions-rework-ux` code (last writer, schema-safe per
  Chris); no DB writes (anchor GETs only). DB backed up first (`~/Backups/nza-sim-db/…20260707_085139`).
- **Dispatch:** `engine:'v2.5'`, `_skipInterventions:true` → State 3 on every run (running without the v2.5
  opt-in crashes on a known pre-existing inline-legacy bug).
- **12-month shape method:** the clean `result.monthly.{heating,cooling}_kWh` demand arrays live on the
  inline-legacy path the v2.5 anchor doesn't reach, so the shape captured is **Σ per-element
  `losses_at_setpoint.monthly_heating_loss_kwh`** (heating) + `internal_gains_monthly` + solar (gains) — the
  raw envelope monthly output, which is the *more* sensitive physics-regression detector.
- Raw JSON per line: `docs/audit/93_snapshots/{main,envelope-fix,interventions,energyplus-validation}.json`.

## Pre-consolidation snapshots — ALL FOUR BYTE-IDENTICAL

| Line | SHA | EUI | elec MWh | gas MWh | heat MWh | cool MWh | DHW MWh | vent-fan MWh | mech-vent loss MWh |
|---|---|---|---|---|---|---|---|---|---|
| main | `74d7327` | 169.8 | 558.5 | 157.4 | 87.7 | 101.1 | 257.3 | 40.6 | 277.2 |
| feat/envelope-fix | `4bacfbd` | 169.8 | 558.5 | 157.4 | 87.7 | 101.1 | 257.3 | 40.6 | 277.2 |
| chris/interventions-rework-ux | `a0dfd84` | 169.8 | 558.5 | 157.4 | 87.7 | 101.1 | 257.3 | 40.6 | 277.2 |
| feat/energyplus-validation | `7b9b252` | 169.8 | 558.5 | 157.4 | 87.7 | 101.1 | 257.3 | 40.6 | 277.2 |

**Heat balance (identical all four):** losses 486.8 MWh · gains 493.3 MWh. Per-element losses: external_wall
23.7, roof 12.6, ground_floor 10.9, glazing 88.9, thermal_bridging 24.0, fabric_leakage 30.6, permanent_vents
18.9, mech_ventilation 277.2 (all MWh). Internal gains: people 120.4, lighting 39.0, equipment 186.1 MWh.

**12-month heating-loss shape (identical all four):**
`[24307, 20131, 21130, 16993, 12862, 8739, 5932, 7274, 9589, 12787, 18695, 21879]` kWh — physically correct
(winter-high, summer-low).

Confirmed byte-identical via `json == json` (ignoring the `git_head` field) across all four files.

## Finding: Bridgewater physics is INVARIANT across the four branches

The engine-code differences between the branches **do not move this project's numbers**:
- **Brief 88** (interventions): EUI alias purge — read-path only, no number change.
- **Brief 92** (interventions): `auxScalar` — inert while auxiliary is enabled (scalar = 1.0), which it is.
- **Brief 86** (envelope-fix): the "rebuilt Bridgewater" is in the **DB data** (shared across all checkouts),
  not divergent engine code; its engine changes were a heat-balance crash-fix + schema, inert for this run.
- **EP-validation** (Briefs 81–85): validation harness, no engine-physics change.

**Consequence for the consolidation:** the stop condition (>5% unexplained drift) **structurally cannot fire
for Bridgewater** — every post-merge anchor must reproduce 169.8 exactly, because all four inputs already
agree. Merges bring the *code* together (features + harness); the physics is already unified.

> NB EUI reads 169.8 (not the ~139.5 seen earlier in the session) because a 5 W/m² always-on auxiliary load
> was added to the Bridgewater DB during auxiliary-bug debugging (~44 kWh/m² of electricity). It is counted
> by all four engines (auxiliary electricity accounting predates the branch split, Brief 74/77 base), so it
> is common to every snapshot and does not affect cross-branch comparison.

## §Part 2 — envelope-fix merged → ANCHOR ESTABLISHED

`git merge --no-ff feat/envelope-fix-bridgwater-rebuild` into main. **0 conflicts** (main had only added
new files since `d8a6207`; envelope-fix's STATUS.md / current.md / engine changes applied without overlap).
Merged `instantCalc.js` = 7374 lines (= envelope-fix's).

**Post-merge anchor = envelope-fix snapshot, FULL byte-match** (EUI 169.8, every metric + the 12-month
shape identical — 0% drift, well inside the <1% gate). Expected, per the Part-1b finding (physics invariant).
**This post-merge state (169.8, breakdown as in the P1b table) is now THE anchor for Parts 3–4.**

## §Part 3 — interventions merged
_(to fill)_

## §Part 3 — interventions merged
_(to fill)_

## §Part 4 — EP-validation merged
_(to fill)_

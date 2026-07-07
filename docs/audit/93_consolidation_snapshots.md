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

## §Part 3 — interventions merged — deltas: NONE

`git merge --no-ff chris/interventions-rework-ux` into main (= main+envelope-fix). **`instantCalc.js`
auto-merged cleanly** (envelope-fix's Brief 86 changes + interventions' Brief 88/92 changes were in
different regions → git combined them: merged = 7399 lines, carrying BOTH `auxScalar`×6 and the Brief 88
alias-deprecation). Only 2 conflicts, **both pure docs** — STATUS.md + docs/briefs/current.md — resolved
as a scribe (STATUS = union, interventions briefs newest-first then envelope/validation; current.md = Brief
93 consolidation lead). No physics conflict; nothing blended.

**Post-merge anchor = P2 anchor, FULL byte-match** (EUI 169.8, every metric + 12-month shape identical).
**Delta table: every metric moved 0.0% → zero unexplained, zero >5% — stop condition not triggered.**

Brief 91 transitional state **survived intact** (`HeadlineCostEditor` mounted, `computeCostPlanTotal`
old-headline dual-path present, `CostPlanEditor.jsx` absent). Full frontend `npm run build` clean.

## §Part 4 — EP-validation merged (already present via envelope-fix)

`git merge --no-ff feat/energyplus-validation` → **"Already up to date."** `feat/energyplus-validation`
(tip `7b9b252`) is an **ancestor of main** — envelope-fix was cut *from* it (Brief 86 STATUS), so Part 2's
envelope-fix merge already brought Briefs 81–85 onto main. No merge commit is possible or needed; the
harness goal (EP-validation on main) was met in Part 2. Harness files confirmed present on main:
`validation/{energyplus,nza_sim,fixtures,reports,sweeps}`, `generate_idf.py`, `compare.py`.

**Anchor unchanged** — nothing merged, so EUI still 169.8 (= P2/P3 anchor). No delta, stop condition N/A.

**Harness smoke test (`generate_idf.py --check-determinism`): DEFERRED to walkthrough** (not skipped). Exact
state recorded: EnergyPlus **is** installed (`/Applications/EnergyPlus-25-2-0`, `Energy+.idd` resolves with
`ENERGYPLUS_DIR` set), but the `eppy` module is **absent from the available Python** (the harness venv per
`validation/README` isn't provisioned in this session's environment). The determinism check is an
IDF-build-twice equality assertion — no physics/consolidation dependence — so deferring it to Chris's
walkthrough (with the harness venv active) is safe.

## §Part 4 follow-up (2026-07-07) — harness smoke test RUN, PASSED

The deferral above is now closed. The harness venv was provisioned per the `generate_idf.py` header recipe
(no standalone `validation/README` exists — the docstring is the authority): `python3 -m venv validation/.venv`
then `pip install eppy pyyaml` → **eppy 0.5.69, pyyaml 6.0.3** (venv gitignored, `.gitignore:41`).

```
$ ENERGYPLUS_DIR=/Applications/EnergyPlus-25-2-0 \
    validation/.venv/bin/python validation/energyplus/generate_idf.py --check-determinism
DETERMINISM OK: two builds byte-identical (40815 bytes).
(exit 0)
```

**Result: PASS.** The generator is a pure function of the fixture — two in-memory builds are byte-identical
(40815 bytes). No EnergyPlus *run* is involved in this check (it's a build-twice-and-diff assertion), so it
exercises the eppy/IDD object-assembly path only.

**IDD-version caveat (recorded, not a blocker):** `ep_config.json` nominally targets EnergyPlus **26.1.0**
(Windows `C:/EnergyPlusV26-1-0`), but this Mac has **25-2-0** at `/Applications/EnergyPlus-25-2-0`. The
determinism check passed against the 25-2-0 IDD, i.e. every object the generator emits assembles cleanly
against the 25-2-0 field schema too. This does **not** certify semantic equivalence on 26.1.0 (that needs a
full EP run + SQLite diff, audit §6.3 — still a walkthrough item on the 26.1.0 install); it certifies only
that byte-stability holds and the generator is IDD-parseable on the locally available EnergyPlus.

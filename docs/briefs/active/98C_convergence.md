# Brief 98-C: The Convergence — Close Every EP-Side Gap from the 98-R Register

**Purpose:** one pass that closes every EP-side, anchor-safe gap the reconciliation table found, with the table itself as the acceptance test. After this, the engines model the same building and every remaining red cell is either STRUCTURAL (labelled) or Chris-gated (anchor-moving, parked). Then the report ships.
**Grounding:** `docs/audit/98R_reconciliation.md` — the gap register IS the spec. Fix classes as assigned there.
**NZA-Sim untouched throughout. Anchors 132.6/126.0 byte-identical. Nothing tuned — inputs inherited, outputs fall where they fall.**

## BEFORE DOING ANYTHING
1. Confirm receipt: quote Purpose + the anchor line.
2. Branch `chris/engine-convergence` off `chris/reconciliation-table` (has the table + script + all prior fixes in the stack). Land brief at `docs/briefs/active/98C_convergence.md` as first commit.
3. Read the 98-R gap register in full. This brief implements its EP-side entries; anything marked "Chris sign-off required" is OUT.
4. Baseline snapshot: run `scripts/report/reconcile.py` once at start — this is the BEFORE table.

## Goal
Close the EP-side root gaps: people gain, ventilation topology (all systems + v40 flows), thermostat regime, DHW fuel split, thermal bridging, and align-or-label the permanent-vent basis. Re-run the reconciliation after each part. Final deliverable: the AFTER table with red cells reduced to only STRUCTURAL-labelled and Chris-gated rows, plus the resulting heating/cooling demand convergence — honestly reported, whatever it shows.

## Parts (fix order = bang per effort; one commit each; re-run reconcile.py in each falsifiable)

### P1 — People gain (the one-liner)
`epjson_assembler.py:330`: `activity_level_schedule_name` points at the 0–1 occupancy fraction. Fix: a proper activity-level schedule (~100 W/person sensible+latent basis — mirror NZA's per-person W value, cite its file:line; do NOT invent a wattage). Occupancy fraction stays as the number-of-people schedule.
**Falsifiable:** EP people gain ≈ NZA 120.4 MWh (state both); reconcile row flips 🔴→✅.

### P2 — Ventilation topology (the big one, ~248 MWh)
Retire `derive_systems_for_sim`'s single-primary slot: emit ALL v40 ventilation systems (public MVHR 1425 L/s @ 80% recovery, bedroom extract 2208 L/s @ 0%, toilet extract 210 L/s @ 0%) as separate EP objects with the v40 flows — not the per-person OA constant. Reuse the faithful per-system pattern from the Brief 95 validation path if applicable.
**Falsifiable:** three vent rows in the table, each EP value within a named tolerance of NZA's (226.4 / 21.5 / MVHR row); the per-person OA constant gone.

### P3 — Thermostat regime
EP inherits NZA's regime from v40: flat 21/24 band (or whatever the project's setpoint mode says) — the overnight setback default removed. Same-inputs rule: EP does not get to invent its own operating hours.
**Falsifiable:** emitted thermostat schedules match NZA's band; the register row flips.

### P4 — DHW fuel split
EP inherits NZA's parallel 52/48 gas/ASHP split (the v40 share model) in place of the series-preheat topology. Delivered DHW gas/elec should land near NZA's 157/42 (efficiency-split residual named if small difference remains).
**Falsifiable:** DHW fuel rows within tolerance; basis difference resolved or named.

### P5 — Thermal bridging
EP-side inherit: apply NZA's ISO 14683 linear-ψ total (24.0 MWh basis) via psi-adjusted U-values or an equivalent documented EP mechanism. If genuinely impractical after honest effort, re-label STRUCTURAL with the reason — but attempt the inherit first; "EP has no bridging object" is not the same as "EP cannot represent bridging".
**Falsifiable:** bridging row ✅ or STRUCTURAL-with-reason.

### P6 — Permanent vents: align or label
EP books 55.7 vs NZA 16.2 (+244%) — divergent flow physics (WindandStack auto vs NZA's cd/Cw). Try inheriting NZA's basis: drive EP's ZoneVentilation with NZA's computed flows (design flow + schedule) instead of Autocalculate effectiveness. If the models genuinely can't share a basis, label DIVERGENT-BASIS with both mechanisms stated.
**Falsifiable:** row within tolerance, or labelled with both bases cited.

### P7 — The AFTER table + convergence verdict
1. Re-run reconcile.py: the AFTER table. Diff against BEFORE — every row's flag transition shown.
2. Report the headline convergence: heating demand NZA vs EP (was 87.7 vs 10.3), cooling (was 101.1 vs 163.8), EUI. Honestly — if a gap persists after all inherits, it is real method difference (the gain-banking/mass-reset mechanism from the physics trace); name it, don't chase it.
3. Sanity vs meter: does EP's heating now show a winter signature consistent with the metered bump?
4. STATUS, archive, current.md, push, PR open — NOT merged.
**Falsifiable:** BEFORE/AFTER tables side by side; remaining 🔴 only STRUCTURAL or Chris-gated; the residual heating/cooling gap named with mechanism; anchors byte-identical.

## OUT (parked, Chris-gated — do not touch)
NZA-side thermostat option · fan-electricity accounting · NZA thermal-mass placeholder (TUNE_INTERNAL_MASS) · clamp-reset review · anything moving the anchor. These are the register's sign-off items; they come after the report as deliberate anchor-moving briefs.

## MUST NOT
Touch `instantCalc.js` · tune EP outputs toward NZA (inherit INPUTS only) · invent wattages/flows/psi values (mirror NZA's, cited) · silently re-label a fixable gap STRUCTURAL · merge unattended · exceed the register's scope.

## Escalate (stop-and-write)
An inherit needs NZA-side data that doesn't exist in v40 (report the gap) · EP rejects a faithful emission after 3 attempts (document the .err) · the AFTER table shows a NEW red cell (a fix broke something — stop) · residual demand gap >30% after all inherits (bigger method finding — report, don't chase).

## Independent review (mandatory)
Claude Chat reads: each inherit against its NZA source (cited both sides), the BEFORE/AFTER diff, the residual-gap naming, anchors. Builder doesn't grade itself.

## Close
Archive · STATUS · current.md · PR open · Chris reads the AFTER table. If the residual is a named method difference and everything else is green/labelled — the engines are converged, the comparison is presentable, and the report drafts on trusted numbers.

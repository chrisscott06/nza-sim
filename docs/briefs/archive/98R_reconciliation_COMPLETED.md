# Brief 98-R: The Reconciliation Table — Every Channel, Both Engines, Side by Side

**Purpose:** the systematic gap-detector this project should have had from the start. Every gap found this week (0.5 ACH, schedules, DHW litres, missing ventilation systems, thermostat regime) would have been a visible red cell in this table. Build it once; every future gap shows up as a red cell instead of a week of forensics.
**Grounding:** `docs/audit/98A2_matched_inputs.md`, the T1/T2 findings (missing vent topology, setback mismatch), NZA-Sim's Heat Balance channels, EnergyPlus component-level output variables.
**This brief DETECTS. It does not fix.** Every red cell gets named and logged; fixes are separate authorised briefs. No tuning, no engine changes beyond adding EP OUTPUT REQUESTS (output variables are reporting, not physics).

## BEFORE DOING ANYTHING
1. Confirm receipt: quote the Purpose + "detects, does not fix."
2. Branch `chris/reconciliation-table` off `chris/ep-inherit-nza-inputs` (the matched-inputs branch — this table must be built on the best current state). Land brief at `docs/briefs/active/98R_reconciliation.md` as first commit.
3. Read the 98-A/98-A2 audits, NZA-Sim's heat-balance output structure (the per-channel losses/gains it already reports), and EnergyPlus's output-variable docs for component balances.
4. **No physics changes either engine. `instantCalc.js` read-only. Assembler changes limited to OUTPUT:VARIABLE / OUTPUT:TABLE requests.** Anchors 132.6/126.0 byte-identical at start and close.

## Goal
One document — `docs/audit/98R_reconciliation.md` — containing two tables:
**Table A (output reconciliation):** every energy channel, NZA | EP | Δ, annual MWh, with automatic flags.
**Table B (input parity):** every v40 config field, with its fate in the EP translation: INHERITED (cited) / NOT INHERITED (red — a gap) / STRUCTURAL (EP genuinely can't, labelled).
Together they answer, exhaustively: do both engines see the same building, and where does the energy go differently?

## Table A — the channels (rows are mandatory; add any the engines expose beyond these)
**Losses:** wall conduction · roof · floor · glazing conduction · infiltration · permanent vents · thermal bridging · mech vent — PER SYSTEM (public MVHR / bedroom extract / toilet extract, one row each) · any other loss channel either engine books.
**Gains:** solar through glazing · solar opaque (sol-air) · people · lighting · equipment · DHW-to-zone (if either books it) · any other.
**Demands/delivered:** heating demand · cooling demand · per-service delivered (heating/cooling/DHW/vent fans/lighting/small power/aux) · fuel split.
**Flag rules (automatic, in the generation script):** 🔴 zero-vs-nonzero on any row · 🔴 |Δ| > 25% · 🟠 |Δ| 10–25% · ✅ within 10%. Every 🔴/🟠 gets a one-line named cause or "UNEXPLAINED — needs investigation" (never silently pass one).

## Table B — input parity
Walk EVERY field of Bridgewater's `systems_config_v40` + the building config (fabric, glazing, shading, openings, airtightness, schedules, occupancy, setpoints/thermostat regime, ventilation systems incl. flows+recovery, DHW basis, lighting, equipment, aux): for each, state INHERITED (where in the assembler, file:line) / NOT INHERITED (red) / STRUCTURAL (why EP can't, labelled — e.g. the Brief 23 H3 shading limitation). Known reds to confirm rather than rediscover: bedroom extract, toilet extract, thermostat regime (EP setback vs NZA continuous band), thermal bridging, permanent vents, shading effectiveness.

## Parts
### P1 — EP output plumbing
Add the OUTPUT:VARIABLE/OUTPUT:TABLE requests needed for component-level balances (surface conduction by class, infiltration, ZoneVentilation per object, window gains, internal gains by type, per-end-use delivered). Re-run the matched-inputs baseline. No physics change — prove demand byte-identical to the pre-request run.
Commit: `98R P1: EP component-level output requests (demand invariant)`.
**Falsifiable:** EP demand identical before/after adding outputs; the component variables appear in the SQL/CSV output.

### P2 — the generation script + Table A
`scripts/report/reconcile.py`: reads NZA's heat-balance channels (run the anchor path) + EP's component outputs → emits Table A with the automatic flags. No hand-typed numbers — the table is generated, rerunnable, and committed with its script.
Commit: `98R P2: Table A generated — per-channel reconciliation with flags`.
**Falsifiable:** the script runs end-to-end; every mandatory row present; every 🔴/🟠 carries a named cause or an explicit UNEXPLAINED; the known gaps (vent systems, bridging, permanent vents) appear as flagged rows — if they DON'T, the table is broken, stop.

### P3 — Table B + the consolidated gap register
Walk the config; produce Table B. Then the GAP REGISTER: every 🔴 from both tables, deduplicated, each with: cause · which engine is deficient · fix class (inherit-the-input / EP-structural-label / NZA-side [anchor-moving, Chris's call]) · suggested brief. This register IS the convergence plan's backlog.
Commit: `98R P3: input parity + consolidated gap register`.
**Falsifiable:** every v40 field classified, none skipped; the register covers every flag; each entry has a fix class; anchor-moving items explicitly marked "Chris sign-off required".

### P4 — Close
Plain-English summary at the top of the audit doc: "the engines currently agree on [channels], differ on [channels] for [named causes], and the building's inputs are [N]% inherited." STATUS, archive, current.md, push, PR open — NOT merged. Anchors byte-identical.
**Falsifiable:** the summary is quotable; anchors intact.

## MUST NOT
Fix anything found (log it — fixes are separate briefs) · tune either engine · change physics/assembler beyond output requests · hand-type table numbers (script-generated only) · silently pass an unexplained flag · merge unattended.

## Escalate (stop-and-write)
An EP output variable needed for a mandatory row doesn't exist (label the row "EP cannot report" — that's a finding) · the script's NZA channels don't sum to NZA's own totals (accounting bug — stop) · an UNEXPLAINED flag that resists a genuine attempt at naming.

## Independent review (mandatory)
Claude Chat reads: the script (no hand numbers, flags automatic), Table A's known-gap rows present, Table B completeness (spot-check fields against v40), the gap register's fix classes, anchors. Builder doesn't grade itself.

## Close
Archive · STATUS · current.md · PR open · deliverable `docs/audit/98R_reconciliation.md`. Chris reads the gap register and picks the fix order — that register is the finish-the-model plan, evidence-based, no more whack-a-mole.

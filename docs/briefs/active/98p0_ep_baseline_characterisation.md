# Brief 98 — Part 0: NZA-Sim vs Main-Sim EnergyPlus — Baseline Characterisation

**Canonical design notes (win over this brief):**
1. "Design note: NZA-Sim vs EnergyPlus — whole-building comparison on the Results page"
2. "Reference: NZA-Sim vs EnergyPlus — methodological differences & manual overrides"
Both on the NZA-Sim product page. Bible rule throughout: **specifics with citation and magnitude, or silence** — no unquantified "engine differences."

## Why this is Part 0, alone

The Results-page comparison (the full Brief 98) will show clients "the fast engine tracks EnergyPlus." But the EP it uses — the main `/api/simulate` pipeline (`nza_engine`) — has **never been diffed against NZA-Sim**. Every characterised number to date (heating −24%, cooling +108%, setpoint 4×) is from the *IdealLoads validation box*, a different, simpler model. Building a "look how well they agree" UI on an unmeasured pair would be dishonest. This Part measures the pair first — from first principles, documenting every residual, **tuning nothing**. Its output decides what the rest of Brief 98 can honestly claim, and surfaces the 0.5 ACH airtightness gap as a number rather than a guess.

## BEFORE DOING ANYTHING
1. Confirm receipt: quote this Goal.
2. Branch `chris/ep-baseline-characterisation` off fresh `main` (PR #4 merged — confirm). Land this brief at `docs/briefs/active/98p0_ep_baseline_characterisation.md` as the first commit.
3. Read CLAUDE.md, STATUS.md, and BOTH design notes' content. Reconcile session state.
4. This Part touches **zero engine code** — NZA-Sim's `instantCalc.js` and the EP engine are read and run, never modified. `--fixture` anchor byte-identical at start and close.

## Goal
Produce one authoritative document — `docs/audit/98p0_nza_vs_mainsim.md` — that characterises, from first principles, how NZA-Sim's instant engine and the main `/api/simulate` EnergyPlus differ on the **same building**, across annual totals, per-channel breakdown, and monthly shape. No UI. No engine changes. The residual table is the deliverable.

## Scope
**IN:** run both engines on one frozen building · tabulate NZA-Sim | main-EP | Δ% for every mappable metric · name each residual from first principles with a cited mechanism + magnitude · explicitly quantify the 0.5 ACH infiltration gap · monthly-shape correlation · a plain-English "what this means for the Results page" reading.
**OUT:** any engine/physics change · fixing the 0.5 ACH default (this Part *measures* it; the fix is a later deliberate change) · any Results-page UI · the interventions per-measure EP path (Brief 95, untouched) · tuning either engine toward the other.

## Decisions already agreed
1. EP side = the main `/api/simulate` run (`nza_engine`: epJSON → EnergyPlus → `sql_parser`), NOT the IdealLoads validation cache.
2. NZA-Sim side = `calculateInstant` (`instantCalc.js`), unchanged.
3. Same building both sides = the frozen `report_baseline_v1.yaml` fixture (clean config, aux load stripped). If a config detail can't cross to `/api/simulate`, document the bridge, don't fake it.
4. Characterisation, not pass/fail. There is no tolerance gate — the table IS the result. Residuals get named, never tuned away.
5. EP version: confirm `/api/simulate`'s `ENERGYPLUS_DIR` = the pinned 25-2-0 before comparing; a version mismatch is a silent divergence and must be ruled out first.

## Parts

### P1 — Land brief + confirm the two engines run on one building
1. Land brief. Confirm PR #4 merged; anchor 132.6.
2. Run NZA-Sim `calculateInstant` on `report_baseline_v1` → record the full breakdown (EUI, heating, cooling, DHW, mech-vent, gas, elec, monthly heating/cooling arrays).
3. Run the main `/api/simulate` EP on the same building. Confirm `ENERGYPLUS_DIR` = 25-2-0 first. Zero fatal errors; severe warnings listed with dispositions.
4. Commit: `Brief 98 P0.1: both engines run on report_baseline_v1`.
**Falsifiable:** both runs complete; both breakdowns captured in the audit doc; EP `.err` fatal count = 0; EP version confirmed 25-2-0.

### P2 — The residual table + first-principles naming
1. Build the NZA-Sim | main-EP | Δ% table for every metric.
2. For EACH residual >5%, name the mechanism from the reference note's catalogue (thermal bridging, permanent vents, thermal mass, real-HVAC part-load, infiltration model, mech-vent regimes) with its magnitude and a source citation. New residuals not in the catalogue (real HVAC control, real geometry solar decomposition) get named from first principles.
3. **Quantify the 0.5 ACH gap explicitly:** what infiltration loss does main-EP book at its flat 0.5 ACH vs what NZA-Sim books from q50? State the MWh difference and confirm the direction (does 0.5 ACH under- or over-ventilate vs the project's real airtightness?). This is the number that justifies the later fix.
4. Monthly shape: heating and cooling correlation (r) between the engines, like the Box arc's 0.96/0.91.
5. Commit: `Brief 98 P0.2: residual table + first-principles naming + 0.5 ACH quantified`.
**Falsifiable:** every >5% residual has a named mechanism + magnitude + citation; no blank cells; the 0.5 ACH gap is a stated MWh figure with direction; monthly r values present.

### P3 — Close + the "what this means" reading
1. Plain-English section: which Results tabs can honestly show "engines agree" (small residuals, high monthly r), which need a labelled caveat (heat balance — bridging/vents don't map), and which are blocked until the 0.5 ACH fix (anything airtightness-sensitive).
2. A recommendation line: does the main-EP diverge enough that the 0.5 ACH fix should be its own brief *before* the Results UI, or can the UI proceed with the gap labelled? (Recommendation only — Chris decides.)
3. `--fixture` anchor byte-identical. STATUS, archive brief, current.md, push, PR open — NOT merged.
4. Commit: `Brief 98 P0.3: close — Results-readiness reading + recommendation`.

## MUST NOT
Change either engine's numbers · fix the 0.5 ACH default (measure only) · tune anything toward agreement · build any Results UI · touch the Brief 95 interventions EP path · claim agreement anywhere without a magnitude.

## Escalate (stop-and-write)
`/api/simulate` won't run on `report_baseline_v1` (document the config bridge gap) · EP version ≠ 25-2-0 and can't be reconciled · a residual whose mechanism can't be named from first principles after genuine effort (name it "uncharacterised — needs investigation", don't hand-wave).

## Independent review (mandatory — engine data-flow, correctness-invisible)
Claude Chat reads on GitHub: the two engines' run provenance, the residual table, the 0.5 ACH quantification method, and the monthly-shape calc. Confirms nothing was tuned. The agent that ran it doesn't grade it.

## Close
Archive · STATUS · current.md · PR open · the audit doc `98p0_nza_vs_mainsim.md` is the deliverable — reviewed with Chris before the full Brief 98 (Results UI) is written.

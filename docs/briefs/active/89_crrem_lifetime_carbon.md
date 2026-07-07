# Brief C — CRREM lifetime carbon (populates Brief A's placeholders)

**Branch:** TBC — Code's call. Options: (a) continue on `chris/interventions-rework-ux` if Brief 87 + Brief 88 haven't merged yet; (b) new branch off `main` after that PR lands. Probably (b) — cleaner separation, Brief A is canonical, Brief C builds on it. Suggested branch name: `chris/interventions-crrem-lifetime-carbon`.
**Design note (canonical):** `brief_C_design_note.md` — sibling file. Land as `docs/design-notes/brief_C_crrem_lifetime_carbon.md` at Part 1's first commit. **Where this brief and the design note disagree, the design note wins.**
**Author:** Claude Chat (architect)
**Authorised by:** Chris (26 June 2026)
**Brief number:** TBC on landing. Likely 89, sequential after Brief 88.

---

## BEFORE DOING ANYTHING

- [ ] **Confirm receipt.** Quote this brief's title and the Goal paragraph back to Chris (Bible Brief sync rule 1).
- [ ] **Read this brief in full, plus the design note.** Sibling file `brief_C_design_note.md`. Design note is canonical.
- [ ] **Read repo `CLAUDE.md` and `STATUS.md`** at branch root. CLAUDE.md should now contain **Rule 11** (one canonical quantity, one exposure point, one read path) from Brief 88. This brief extends that principle to carbon factors and CRREM trajectory.
- [ ] **Confirm clean working tree, origin in sync.** `git status`, `git fetch --all`, `git log --oneline -20`.
- [ ] **Confirm branch.** Either continue on `chris/interventions-rework-ux` (if 87+88 haven't merged) or cut a new branch off `main` (cleaner). Document the choice in audit.
- [ ] **Read existing code being built on.**
  - `frontend/src/utils/engineReads.js` — Brief 88's canonical read helper. Brief C may add `readModelledCarbonFactor()` and `readCrremTarget()` helpers here, or in a new `carbonReads.js` sibling.
  - `frontend/src/utils/interventionsEngine.js` — produces per-intervention isolated/marginal/cumulative deltas including per-fuel kWh values. Brief C consumes these.
  - `frontend/src/components/modules/interventions/StrategyView.jsx` — the CRREM trajectory chart placeholder lives here. Brief C populates it.
  - The per-intervention Isolated view component (Library page) — also has placeholder cards. Brief C populates Lifetime Carbon Saved.
  - `frontend/src/data/ukGridCarbonTrajectory.js`, `frontend/src/data/carbonFactors.js`, `frontend/src/data/crremTargets.js` — existing data modules per `instantCalc.js` imports. Brief C consumes these; confirm shape and coverage match the CRREM methodology.
- [ ] **Read existing design notes.** Brief 88 (canonical reads), Brief A (UX scaffolding), and the Interventions Module Rework design note (full plan).
- [ ] **Read the Zeal report's CRREM chart** as the design reference. See: `Zeal team draft report` PowerPoint, slide 13 (HIEX Bridgwater CRREM Study, section 2.5). The chart Brief C builds on the Strategy view must match this style closely — it's the canonical client-facing chart format.
- [ ] **Run session-start reconciliation pass** (Bible Brief sync rule 3): `ls docs/briefs/active/`, `cat docs/briefs/current.md`, `tail STATUS.md`, `git log --oneline -20`.
- [ ] **Land this brief on disk** at `docs/briefs/active/<NN>_crrem_lifetime_carbon.md` as Part 1's first commit. Design note at `docs/design-notes/brief_C_crrem_lifetime_carbon.md` in the same commit.

---

## GOAL

Populate Brief A's placeholder Lifetime Carbon card on the per-intervention Isolated view, and Brief A's placeholder CRREM trajectory chart on the Strategy view, with rigorous fuel-switching-aware operational carbon math against the UK CRREM decarbonisation trajectory. Every intervention's lifetime carbon saved is `Σ_y Σ_fuel (baseline_kWh - post_kWh) × carbon_factor_y_fuel` summed 2025-2050 or to intervention lifetime. The Strategy view's CRREM chart matches the canonical client report style: two-axis (GHG intensity + energy intensity), target curve, asset performance curve, red-circle misalignment year marker, current-year diamond, excess-emissions shaded area. After this brief, intervention ranking by lifetime carbon is a first-class capability and clients see the same CRREM stranding diagram in NZA-Sim as they see in the report.

---

## SCOPE

### IN

- **Lifetime carbon math** per intervention. Year-by-year integration 2025-2050 (or shorter if intervention lifetime is shorter), fuel-switching aware. The general formula: `Δ_y = Σ_fuel (baseline_kWh - post_kWh) × carbon_factor_y_fuel`. Sum over years.
- **Canonical carbon-factor read path.** Either extend `engineReads.js` with `readElectricityFactor(year)`, `readGasFactor(year)`, etc., or create a new `carbonReads.js`. Single helper per quantity per Bible Rule 11.
- **Canonical CRREM trajectory read path.** `readCrremTarget(year, country, property_type, pathway)` or similar. One helper, all consumers.
- **Per-intervention Lifetime Carbon card** on Isolated view. Populates Brief A's placeholder. Shows total tCO₂e saved 2025-2050. Card includes the per-intervention small chart (baseline trajectory + post-intervention trajectory + lifetime saving as shaded area).
- **Strategy view CRREM stranding diagram.** Matches Zeal report style. Two parallel charts (GHG intensity top, energy intensity below), each with target curve, asset performance curve, red-circle misalignment, current-year diamond, excess-emissions area.
- **Strategy headline numbers** alongside chart: Current EUI, CRREM EUI target, Energy misalignment year, Carbon misalignment year, Lifetime carbon saved by 2050, Strategy headline year (when CRREM target reached, or "Never").
- **Baseline-vs-strategy comparison toggle** on the Strategy view's CRREM chart. Overlays the no-intervention trajectory alongside the strategy trajectory, two misalignment circles, two excess-emissions areas.
- **Project-level CRREM pick**: country + property type + pathway. UK + Hotel + 1.5°C as default for Bridgewater. Stored on the project, applies to all interventions in Library and Strategy.

### OUT

- **No engine changes.** `instantCalc.js`, `interventionsEngine.js`, `systemsEngine.js` stay unchanged. Brief C consumes existing engine output (per-fuel kWh annual values per intervention).
- **No embodied carbon.** Operational only. Embodied is a future brief.
- **No cost layer.** £ per tonne CO₂ saved is partial in Brief C — the tonnes side lands, the £ side waits for Brief B. The card shows "TBD — Brief B" for the £ value until B lands.
- **No multi-pathway comparison.** Single pathway per project for v1.
- **No multi-country support.** UK only for v1. Code confirms UK CRREM datasets are in codebase already.
- **No time-staged interventions.** v1 assumes strategy's final state reached in year 1. Phased rollout is a future enhancement.
- **No work on `main`, no merge to `main`** until the brief closes with verification gates passed.
- **No `npm install` pushed, no `package-lock.json` changes, no `node_modules` modifications** (Bible Claude Code rule).
- **No Brief A UX changes** beyond populating placeholders. Don't move the placeholder cards, don't change the chart's position, don't reflow the layout.

---

## DESIGN DECISIONS ALREADY AGREED

Locked here so any agent resolves ambiguity in the right direction:

1. **Fuel-switching methodology is the general formula**, not a special case. `Δ_y = Σ_fuel (baseline_kWh - post_kWh) × carbon_factor_y_fuel`. Single-fuel interventions are this formula with one fuel; fuel-switching interventions are this formula with two (or more) fuels with opposite signs.
2. **Per-year integration is required.** Lifetime carbon ≠ year-1 saving × lifetime years. The grid decarbonises, so electricity savings shrink over time and electricity additions grow more carbon-efficient. Year-by-year sum is the only honest math.
3. **CRREM stranding diagram on Strategy view matches the Zeal report style.** Two-axis, target + performance + red misalignment circle + current-year diamond + excess-emissions area. Not a generic trajectory chart.
4. **Per-intervention view shows the simpler version.** Single axis (carbon), three lines (target, baseline trajectory, post-intervention trajectory), saving as shaded area between baseline and post-intervention. No misalignment marker on per-intervention view — that's a strategy-level concept.
5. **UK CRREM datasets are already in the codebase.** Code uses them directly. If for any reason they're missing or inaccessible, fall back to a flat 0.190 → 0.025 kgCO₂/kWh linear decarbonisation 2025-2050 and flag for Chris. The chart works either way.
6. **Bible Rule 11 (canonical reads) applies to carbon factors and CRREM targets.** One canonical helper per quantity. No module re-implements grid factor lookup; no module re-implements CRREM target lookup. All reads via the canonical helper(s).
7. **Intervention lifetime defaults are sensible but overridable.** Heat pumps 15-20 years, fabric 40-50, LED 10-15, setpoint/occupancy/control changes treated as analysis horizon (25 years), BMS 15-20. User can override per intervention.
8. **Single CRREM pick per project.** Country + property type + pathway, set once, applies to all interventions and strategies. Default for Bridgewater: UK + Hotel + 1.5°C.
9. **Baseline trajectory on Strategy chart is the no-interventions case.** Project's current building config, projected forward with grid decarbonisation applied to its current fuel mix.
10. **Strategy trajectory in v1 assumes year-1 deployment.** All interventions in the strategy applied at year 1; trajectory from year 1 onwards reflects strategy's final state with annual grid decarbonisation applied to the strategy's electricity component.

---

## PRINCIPLES / CONSTRAINTS

- **One Part = one commit.** Including `STATUS.md` and any audit-doc update in the same commit.
- **Engine output is canonical** (Bible). The engine produces per-fuel kWh per intervention; Brief C applies carbon factors and CRREM trajectories on top. Never tweak the engine to make the chart hit a target number — the chart shows whatever the engine + factors produce.
- **Variable boundaries stay explicit** (Bible). When wiring engine outputs into the carbon math, name the boundary: "annual delivered electricity kWh", "annual delivered gas kWh". Not generic "energy". Same field, same physical boundary, all the way through.
- **One canonical read path per quantity** (Bible Rule 11, from Brief 88). Carbon factors and CRREM targets follow the same principle. If Brief C introduces `readElectricityFactor(year)` and `readCrremTarget(year, country, type, pathway)`, every consumer in the codebase reads through those helpers. No alternate paths.
- **Visualisation-as-verification** (Bible). The Strategy chart must visibly match the Zeal report's CRREM diagram on Bridgewater. If the chart looks like a generic line graph, the implementation isn't done.
- **No engine changes without a separate brief.** If during Brief C's work Code identifies an engine bug (e.g. the DHW-occupancy issue from Brief 87's walkthrough), STOP and escalate to a separate brief. Don't fix engine code as a side effect of carbon-layer work.
- **Performance discipline** (Bible). The lifetime carbon math is O(years × interventions × fuels) which is small (~26 × 10 × 2 = ~500 ops per strategy). No need to cache aggressively; computing on each render is fine.

---

## PARTS (each = one commit)

### Part 1 — Brief landing + design note landing + branch verify

- Confirm branch choice (continue on `chris/interventions-rework-ux` or new branch off `main`). Document choice in audit.
- Land this brief at `docs/briefs/active/<NN>_crrem_lifetime_carbon.md`.
- Land the design note at `docs/design-notes/brief_C_crrem_lifetime_carbon.md`.
- Open audit-doc stub at `docs/audit/<NN>_crrem_lifetime_carbon.md`.
- Update `STATUS.md`: Brief C opened, branch name, link to design note.
- Update `docs/briefs/current.md` to point at this brief.

**Commit:** `Brief <NN> P1: brief + design note landing + audit stub`

### Part 2 — Source-read audit + canonical-read helpers (READ + small helper additions)

Read the existing carbon-factor and CRREM data files. Document in audit §2 with file + line references:

- **Where electricity factors currently live.** `ukGridCarbonTrajectory.js`? `carbonFactors.js`? Both? What shape is the data — array of year-keyed values, function returning a factor for a year, or something else?
- **Where CRREM targets currently live.** `crremTargets.js`. Confirm the UK Hotel 1.5°C curve is in there with year-keyed values.
- **What consumers currently exist** for both — grep for direct reads to either module. Brief 88's principle: any direct read should migrate to a canonical helper.

**Then build the canonical-read helpers.** Either extend `engineReads.js` or create `carbonReads.js` (Code's choice; document reasoning). Required helpers:

- `readElectricityFactor(year)` — returns kgCO₂/kWh for that year on the UK grid trajectory.
- `readGasFactor(year)` — returns kgCO₂/kWh for that year (UK natural gas, approximately constant).
- `readCrremTarget(year, country='UK', property_type='hotel', pathway='1.5C')` — returns kWh/m²·yr and kgCO₂e/m²·yr for that year on the specified curve. Defaults to UK Hotel 1.5°C.

Add a `readme`-style comment header explaining the canonical-read principle (matching Brief 88's `engineReads.js` style).

**Migrate any existing direct reads** to use the new helpers. Search for direct imports of `ukGridCarbonTrajectory`, `carbonFactors`, `crremTargets` in non-canonical consumers; switch them to the helper.

**Falsifiability:** existing engine output unchanged. Any module that previously read carbon factors directly now reads through the helper, returns identical values. Bridgewater anchor numbers unaffected.

**Commit:** `Brief <NN> P2: canonical carbon + CRREM read helpers + migration`

### Part 3 — Lifetime carbon math

Implement the per-intervention lifetime carbon computation. Add a function (likely in a new file `frontend/src/utils/lifetimeCarbon.js` or extension to existing utilities) that takes:

- Per-fuel baseline annual kWh (from the engine's baseline state)
- Per-fuel post-intervention annual kWh (from the engine's isolated-impact state)
- Intervention lifetime (years)
- CRREM project config (country, property_type, pathway — though only the year-by-year electricity factor matters for the math; CRREM target is for the chart, not the lifetime saving)

Returns:

- `lifetime_carbon_saved_tCO2e` (total)
- `annual_carbon_saved_tCO2e_by_year` (array, for chart rendering)
- `electricity_factor_used` (for inspection / chart)

Implementation: the general formula, year-by-year. Multiple fuels supported. Robust to one fuel being zero (single-fuel intervention) or both fuels changing in opposite directions (fuel switching).

**Audit-doc walkthrough:** include three worked examples in audit §3:

1. **LED retrofit** (single-fuel electricity reduction): demonstrate the saving shrinks each year.
2. **Heat pump retrofit** (gas → electricity fuel switch): demonstrate the saving grows each year.
3. **Fabric insulation on gas-heated building** (single-fuel gas reduction): demonstrate the saving stays roughly constant.

These three cases together prove the math handles the three regimes correctly.

**Commit:** `Brief <NN> P3: lifetime carbon math + worked examples`

### Part 4 — Per-intervention Isolated view: populate Lifetime Carbon card

Wire the lifetime carbon math into the per-intervention Isolated view (Library page). Populate the placeholder card.

- Card shows: total tCO₂e saved, "by 2050" qualifier, and a small inline chart.
- Small chart: x-axis years 2025-2050, y-axis carbon, three lines (CRREM target, baseline trajectory, post-intervention trajectory), saving as shaded area between baseline and post-intervention trajectories.
- Use the project's CRREM curve (UK Hotel 1.5°C for Bridgewater).

The other three cards (£ per tonne CO₂, kWh saved/EUI Δ, Simple payback) stay as they are — kWh/EUI Δ already populated by Brief A; the two £ cards stay as "TBD — Brief B".

**Falsifiability:** load Bridgewater, click into each of the six authored interventions, confirm Lifetime Carbon card populated for all six. Sanity-check magnitudes:

- DHW heat pump (fuel switch): largest lifetime carbon saving in the Library, probably 100-300 tCO₂e
- LED retrofit: smaller, probably 10-50 tCO₂e
- Brise soleil: probably 5-15 tCO₂e
- Plug load management: depends on whether it saves heating (slight) or electricity (large)

If the numbers are wildly off (negative, or orders of magnitude wrong), the math is broken — STOP and diagnose.

**Commit:** `Brief <NN> P4: per-intervention Lifetime Carbon card populated`

### Part 5 — Strategy view CRREM stranding diagram (the big chart)

Build the chart on the Strategy view. Two parallel charts displayed vertically, sharing x-axis 2020-2050:

- **Top chart: GHG intensity** (left y-axis kgCO₂e/m²·yr)
- **Bottom chart: Energy intensity** (right y-axis kWh/m²·yr)

Each chart has:

1. Decarbonisation target curve (dark navy line) — from `readCrremTarget(year, ...)`, plotted for each year
2. Asset performance curve (lighter blue line) — strategy's projected trajectory: current EUI/carbon × annual grid decarbonisation factor (or the strategy's final state with annual decarbonisation if fuel mix has shifted)
3. Red circle at misalignment year — where asset performance crosses target. Compute via interpolation between annual points.
4. Past performance diamond — current year actual position (the "now" point, e.g. 2025 if running in 2025)
5. Excess emissions shaded area — translucent blue fill between asset performance and target, post-misalignment

Use the same color palette as the Zeal report (dark navy for target, lighter blue for performance, red for misalignment circle).

**Strategy headline row** above the chart:
- Current EUI (kWh/m²·yr)
- CRREM EUI target (current year, kWh/m²·yr)
- Energy misalignment year
- Carbon misalignment year
- Lifetime carbon saved by 2050 (tCO₂e — strategy total)
- Strategy headline year (year strategy reaches CRREM target, or "Never")

**Falsifiability:** load Bridgewater in the Strategy view. Compare the chart visually against the Zeal report's slide 13. Key checks:

- Two charts visible, sharing x-axis 2020-2050
- Both have target curve, asset performance, misalignment circle, current-year diamond, shaded excess area
- Color palette matches the report
- Strategy headline numbers populated and sensible

Capture screenshot and overlay against the report for direct comparison. The chart should look like the report's chart — not a generic line plot.

**Commit:** `Brief <NN> P5: Strategy view CRREM stranding diagram + headline numbers`

### Part 6 — Strategy comparison toggle (baseline vs strategy)

Add a comparison toggle on the Strategy view's CRREM chart. When toggled on:

- Show baseline trajectory alongside strategy trajectory
- Two misalignment circles (baseline misalignment year and strategy misalignment year)
- Two excess-emissions areas (one for baseline, larger; one for strategy, smaller — the visual gap is the strategy's lifetime carbon saving)
- Legend distinguishes the two trajectories

Same chart structure, just two performance lines instead of one.

**Falsifiability:** load Bridgewater, click Compare toggle on the CRREM chart, confirm baseline trajectory appears alongside strategy trajectory. The shaded excess-emissions area for baseline should be larger than for strategy.

**Commit:** `Brief <NN> P6: Strategy view CRREM comparison toggle (baseline vs strategy)`

### Part 7 — Project CRREM picker (settings)

Add a small UI control to set the project-level CRREM choice: country (UK only for v1), property type (Hotel default), pathway (1.5°C default). Live in project settings or similar — Code's call on placement.

For v1 UK-only, the picker may only expose property type and pathway (country fixed to UK). Other countries land in a future brief.

**Falsifiability:** load Bridgewater, navigate to project settings, change property type from Hotel to Office, confirm Strategy chart's target curve changes. Change back to Hotel, confirm reverts.

**Commit:** `Brief <NN> P7: project CRREM picker (country/property/pathway)`

### Part 8 — Cleanup + walkthrough prep

- Run `grep -r "kgCO2" frontend/src/` and `grep -r "carbon_factor" frontend/src/` to find any direct uses of carbon factors that haven't migrated to the helpers. Migrate or document as deferred.
- Run `grep -r "crrem" frontend/src/` (case-insensitive) to find CRREM target reads.
- Update CLAUDE.md if any rules need refinement based on what landed.
- Update `STATUS.md` close-out (handover-ready, written for a stranger).

**Commit:** `Brief <NN> P8: cleanup + final wiring`

### Part 9 — Walkthrough + close

- Browser walkthrough via MCP browser tools. Capture screenshots of:
  - Library page: Bridgewater intervention with populated Lifetime Carbon card and small chart
  - Strategy page: full CRREM stranding diagram visible, both charts (GHG + energy), all elements (target, performance, misalignment, diamond, shaded area), headline numbers populated
  - Strategy page: comparison toggle on, baseline vs strategy trajectories visible
  - Project settings: CRREM picker working
- Chris runs the walkthrough manually before close commit.
- After Chris signs off: `git mv docs/briefs/active/<NN>_*.md docs/briefs/archive/<NN>_*_COMPLETED.md`. Update `STATUS.md`. Update `docs/briefs/current.md`. Single push.
- PR opens from this branch to `main` (or stays as part of a combined PR with Brief A + 88 if branch was continued).

**Commit:** `Brief <NN> P9: walkthrough + close + STATUS update`

---

## VERIFICATION (non-negotiable, falsifiable)

- **Lifetime carbon math handles all three regimes correctly.** LED (electricity-only, saving shrinks over time), heat pump (fuel switch, saving grows), fabric on gas (gas-only, saving constant). Audit §3 walkthroughs prove each.
- **Per-intervention Lifetime Carbon card populated on all six Bridgewater interventions.** Magnitudes physically sensible per Part 4's sanity check.
- **Strategy view CRREM chart matches Zeal report style visually.** Side-by-side comparison with the report's slide 13. Two parallel charts, all five elements per chart, color palette consistent.
- **Strategy headline numbers populated correctly.** Energy misalignment year and carbon misalignment year computed from interpolation; current EUI from engine; lifetime carbon saved sums across all enabled interventions in the strategy.
- **Comparison toggle works.** Baseline trajectory + strategy trajectory + two misalignment circles + two excess-emissions areas all visible when toggled.
- **CRREM picker works.** Changing property type changes the target curve.
- **Bible Rule 11 maintained.** `grep -r "ukGridCarbonTrajectory\|crremTargets" frontend/src/` returns only references inside the canonical helpers themselves (and inside `instantCalc.js` for engine-internal use which is allowed since engine consumes them directly). All UI consumers go through `readElectricityFactor`, `readGasFactor`, `readCrremTarget`.
- **No engine changes.** `git diff main...HEAD -- frontend/src/utils/instantCalc.js frontend/src/utils/interventionsEngine.js frontend/src/utils/systemsEngine.js` returns nothing meaningful.
- **No Brief A UX changes.** Library/Strategy structure, two-section per-intervention view, drag-and-drop, Heat Balance compare — all untouched.
- **`main`'s Bridgewater anchor unchanged.** EUI / heating / cooling / mech vent / DHW match `main` exactly.
- **No `npm install` pushed, no `package-lock.json` changes, no `node_modules` modifications.**
- **STATUS.md close-out is handover-ready** (written for a stranger picking up cold per Bible rule).

---

## WHAT MUST NOT HAPPEN

- **Any commit, push, or merge to `main` until the brief closes.**
- **Any engine code change.** Brief C consumes existing engine output and applies carbon factors and CRREM targets on top.
- **Any direct read of carbon factors or CRREM data outside the canonical helpers.** Bible Rule 11 stays enforced.
- **Embodied carbon math.** Operational only. If during the brief Code is tempted to add embodied, STOP — that's a separate brief.
- **Multi-country support beyond UK.** v1 is UK only.
- **Multi-pathway comparison on a single chart.** Single pathway per project.
- **Time-staged interventions.** v1 assumes year-1 deployment.
- **`npm install` pushed, `package-lock.json` modified, `node_modules` changes** (Bible Claude Code rule).
- **Brief A UX layout changes.** Card positions, chart placements, page structure all stay.
- **Generic line-chart styling on the Strategy CRREM chart.** It must look like the Zeal report's chart, not like a default Recharts line plot.
- **Quiet scope expansion.** If a sub-problem looks like it needs Brief B or embodied-carbon work, STOP and escalate.

---

## WHEN TO ESCALATE / STOP

- **Part 2 source read reveals carbon factor or CRREM data isn't in the shape the design assumed.** STOP. Document, propose revised data model, ask before continuing.
- **Part 3 worked-example walkthroughs produce nonsensical numbers** (negative lifetime savings on a clearly-saving intervention; orders-of-magnitude errors). STOP and diagnose the math.
- **Part 5 chart can't be made to look like the report.** STOP, capture what it looks like, share with Chris, decide whether to iterate further or accept the closest match.
- **An engine bug surfaces during Brief C work** (e.g. DHW-occupancy from Brief 87's walkthrough). STOP, document the finding for a separate brief, continue with Brief C against the engine's current behaviour.
- **The CRREM dataset's UK Hotel 1.5°C curve isn't present** (against Code's confirmation). Fall back to flat 0.190 → 0.025 linear decarbonisation per the design note's safety net. Flag for Chris.
- **3 approaches tried on any blocker without progress.** STOP per Bible's "when stuck" rule.
- **Any indication work has accidentally landed on `main` or another non-feature branch.** STOP IMMEDIATELY.

---

## INDEPENDENT REVIEW TRIGGER

This brief produces correctness-invisible output (lifetime carbon numbers in tCO₂e). Independent review is **mandatory and proactive** per the Bible's verification framework.

Before close, Claude Chat reads:
- The lifetime carbon math (the new `lifetimeCarbon.js` or equivalent)
- The canonical-read helpers (`engineReads.js` extensions or `carbonReads.js`)
- The Strategy view CRREM chart implementation
- Part 3's worked-example walkthroughs in the audit doc

…and verifies:
- The math matches the methodology in the design note (fuel-switching aware, year-by-year, both fuels integrated correctly)
- The canonical-read principle is preserved (no alternate paths for carbon factors or CRREM targets)
- The Strategy chart's structure matches the Zeal report
- The worked examples in audit §3 produce numbers that pass arithmetic sanity check

Pre-close handover from Code: post the diff URLs (GitHub blob URLs at the relevant lines on the branch) for Claude Chat to read.

---

## CLOSE

- Browser walkthrough complete; screenshots captured at all six verification points.
- Claude Chat's independent source-read review complete (per Independent Review Trigger above).
- Chris signs off via manual browser walkthrough.
- `git mv docs/briefs/active/<NN>_*.md docs/briefs/archive/<NN>_*_COMPLETED.md` (single move).
- `STATUS.md` close-out written for a stranger: what was added (canonical carbon helpers, lifetime carbon math, populated Lifetime Carbon card, CRREM stranding diagram on Strategy view), what's now possible (intervention ranking by lifetime carbon, CRREM-target visualisation matching the report), what's next (Brief B cost layer to complete the £ per tonne CO₂ card).
- `docs/briefs/current.md` repointed.
- PR opens from this branch to `main` (or merges into the combined PR if branch was continued from `chris/interventions-rework-ux`).

**Final commit:** `Brief <NN> P9: close — CRREM lifetime carbon landed; Brief B (cost) next`

---

## FINAL REPORT

At close, Claude Code reports to Chris:
- Lifetime carbon math walkthrough — three worked examples confirmed
- Canonical-read helpers added — `engineReads.js` extended or `carbonReads.js` created, all consumers migrated, grep clean
- Per-intervention Lifetime Carbon card populated on all six Bridgewater interventions; magnitudes physically sensible
- Strategy view CRREM stranding diagram rendering — screenshot vs Zeal report comparison
- Comparison toggle working
- CRREM picker working
- Bible Rule 11 maintained
- Engine code untouched; Bridgewater anchor unchanged on `main`
- Independent review handover URLs for Claude Chat to verify before Chris signs off
- STATUS.md handover-ready; `current.md` points at Brief B as next

---

*Brief C's job: populate Brief A's placeholders with rigorous lifetime carbon math and render the canonical CRREM stranding diagram. Once this closes, every intervention has a defensible lifetime carbon number and clients see the same chart in NZA-Sim that they see in their report. Brief B (cost model, NRM2-aligned) follows to complete the £ per tonne CO₂ card and the strategy capex layer.*

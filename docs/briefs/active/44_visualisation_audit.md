# Brief 44 — Visualisation + reactivity audit and rebuild

**Author:** Claude Chat (architect)
**Authorised by:** Chris Scott
**Status:** Active. Multi-Part audit + fix + rebuild brief.
**Date opened:** 2026-05-21
**Target outcome:** Every view tab in every module shows trustworthy, reactive data. The Profiles tab is rebuilt as a simple-by-default, layered-by-choice visualiser. The Diagnostic tab's heating-delivered-vs-demand bug is diagnosed and fixed. The Schedule tab either reads real data or is removed. The Monthly tab is legible. Every panel updates within the same render cycle as upstream edits.

After this brief lands: Chris can confidently change a setpoint in Systems and watch every view (Sankey, Profiles, Monthly, Schedule, Diagnostic, Summary) update consistently. He can use the Profiles visualiser as the right-hand pop-out across modules to verify that interventions are doing what he expects. The foundation under interventions is trustworthy.

---

## BEFORE DOING ANYTHING

0. **Run the session-start documentation reconciliation pass (mandatory).** Per Process Rule 8:
   - `ls docs/briefs/active/` — list everything in active
   - `cat docs/briefs/current.md` — read what current.md claims
   - `tail -50 STATUS.md` — read most recent STATUS entries
   - `git log --oneline -20` — read the last 20 commits
   - **Cross-check:** Brief 43 archived at `ab0d777`. `docs/briefs/active/` should be empty (only Brief 30 paused, in archive). `current.md` should reflect no active brief.
   - If any check fails, the first commit of the session is the cleanup commit.

1. Read this entire brief.
2. Read CLAUDE.md end to end. Particularly Module Scopes sections (Building, Internal Gains, Operation, Systems, Interventions), Process Rules 7 (documentation hygiene), 8 (session reconciliation), 10 (scope), 11 (stop dev server before migrations).
3. Read the Notion design note: **NZA-Sim — Visualisation + reactivity audit (Brief 44 scope)** (URL: https://www.notion.so/367d645e05cc81af93d7fc57bfc45faf). This is the canonical reference. If there's any disagreement, the design note wins.
4. Read `docs/audit/29_open_issues.md` — three follow-ups from Briefs 42/43 are in scope for this brief's Part 1 audit and Part 2 fix:
   - "Heating delivered direction with lower setpoint" (Brief 42 Part 3 walkthrough; Brief 43 Part 4 follow-up #2)
   - "Construction patches show `[object Object]`" (Brief 43 follow-up #1 — cosmetic, lighter touch)
   - "Baseline EUI display flips between two result-shape paths" (Brief 43 follow-up #5 — pre-existing Brief 41 inconsistency)
5. Read `docs/audit/42_systems_ux_schema.md` to ground yourself in the post-Brief-42 schema (service-level fields vs per-system).
6. Read the existing view-tab components — at minimum, glance at:
   - `frontend/src/components/modules/systems/ProfilesTab.jsx` (or equivalent name)
   - `frontend/src/components/modules/systems/MonthlyTab.jsx`
   - `frontend/src/components/modules/systems/ScheduleTab.jsx`
   - `frontend/src/components/modules/systems/DiagnosticTab.jsx`
   - `frontend/src/components/modules/systems/SummaryTab.jsx`
   - `frontend/src/components/modules/systems/SankeyTab.jsx`
   - Equivalent view components in Building, Internal Gains, Operation modules
7. Confirm working tree clean: `git status --short`.
8. Confirm `origin/main == local main`.
9. **Part 1's first commit must include this brief file landed at `docs/briefs/active/44_visualisation_audit.md`** per Process Rule 7. No code work begins until that commit lands.
10. Do not begin Part 1 until checks 0–9 pass.

---

## Scope statement

This brief audits and rebuilds the visualisation surface across modules. It is **read-only in Part 1** (audit), with fixes and rebuild in subsequent Parts. The engine is unchanged unless Part 1 identifies a specific engine bug, in which case Part 2 fixes it surgically.

Per CLAUDE.md Module Scopes pattern, no module's scope changes. What changes is how each module's view tabs render their existing engine output, and whether they react correctly to upstream edits.

This brief delivers six substantive Parts plus close.

---

## Operational mode — keep ploughing through

Per Chris's authorisation: end-to-end run, no per-Part sign-off pauses. Walkthrough sign-off after Part 5 before Part 6 close. Stop and escalate only for the conditions in "When to escalate" below. Final report at end of Part 6.

---

## Principles

1. **Audit before fix.** Part 1 is a read-only diagnostic doc. No code changes. Same pattern as Audit 39 before Brief 39. Diagnosis errors lead to fix errors; rushing fixes without audit is how silent bugs compound.

2. **No engine restructure.** Bug fixes where Part 1 identifies them. The Diagnostic 248% issue is the only known candidate; fix it surgically. No wholesale engine changes.

3. **Simple by default, layered by choice.** The rebuilt Profiles visualiser starts minimal — one clear signal — and lets the user opt into additional layers, weather overlays, time-axis zoom. Eleven things on one chart was the problem; the fix isn't "tidy up eleven things" but "show one or two by default, and only the layers the user asks for."

4. **Falsifiability for the Diagnostic fix.** A 0.5°C setpoint change should produce a roughly proportional change in delivered energy. Specifically: changing setpoint from 21°C (follow comfort) to 21.5°C (custom) should change heating delivered by **less than 10%**. If the fix doesn't achieve that, the diagnosis was wrong and Part 2 needs revisiting.

5. **Schedule tab: real or removed, not synthetic.** Hardcoded defaults that look like data are worse than no tab at all — actively misleading. Part 1 audit determines real vs hardcoded; Part 4 either fixes it to read real data or removes it.

6. **One canonical visualiser, many module-specific data sources.** Extract `InteractiveProfileVisualiser` as a shared component in Part 3. Part 5 wires it into Building, Internal Gains, Operation with module-appropriate data feeds.

7. **Reactivity sweep.** Every panel updates within the same render cycle as upstream edits. Verification: change a wall U in Building → confirm Profiles updates, Monthly updates, Diagnostic updates, Summary updates, every module's equivalent updates. Same for setpoint changes, system toggles, schedule changes.

8. **Browser verification mandatory.** Part 6's 15-item walkthrough is the falsifiability check. No "the code looks right" sign-off.

9. **Documentation hygiene per Process Rule 7.** Each Part's commit includes STATUS.md + audit-doc update. Brief file landed in `docs/briefs/active/` as Part 1's first commit.

---

## Parts

### Part 1 — Audit (read-only)

**Goal:** Diagnose the current visualisation surface. No code changes. Produces a comprehensive diagnostic doc that the subsequent Parts work against.

**Files touched:**
- `docs/audit/44_visualisation_audit.md` (new) — the canonical audit
- `docs/briefs/active/44_visualisation_audit.md` — this brief file folded in
- `docs/briefs/current.md` — pointer updated
- CLAUDE.md — no changes in Part 1 (any scope tweaks land in later Parts where they're earned)

**Steps:**

1.1 **Walk every view tab in every module.** For each one, document in the audit doc:

| Field | Description |
|---|---|
| Module | Building / Internal Gains / Operation / Systems / Interventions |
| Tab | Sankey / Profiles / Monthly / Schedule / Diagnostic / Summary / etc. |
| Data source | Which engine output paths it reads from (e.g. `consumption.brief40.heating.systems[].delivered_mwh`) |
| Computation | Any client-side aggregation (rolling sums, daily means, etc.) |
| Reactivity | Whether it updates when upstream edits land — TEST in browser: change a setpoint, change wall U, toggle a system; confirm whether each tab reacts |
| Design intent | What the tab was supposed to show (read original brief / comments) |
| Current state | What it actually shows |
| Gap | The delta between intent and reality |

At minimum, cover Systems tabs (the six in image 1). Building / Internal Gains / Operation tabs as exhaustively as the time allows but at least one representative example.

1.2 **Investigate the Diagnostic 248% issue specifically.**

Reproduce in browser: set heating setpoint to Custom 21.5°C (vs follow comfort 21°C). Confirm Diagnostic tab shows ~248% over-delivery.

Then read code path: 
- Where does Diagnostic read "heating delivered" from?
- Where does it read "heating demand" from?
- What does `_resolveSetpoint` do when mode is `custom` and value is 21.5?
- Does `_computeHeatingOrCooling` call State 2 with the setpoint override?
- Does State 2's demand integral with setpoint 21.5 produce sensible numbers?

Document the answer in audit doc § "Diagnostic 248% — root cause." Three possible outcomes:
- **UI bug** — the field displayed as "delivered" is actually total annual gross output or similar (e.g. summing across hours including weekend operation when demand is filtered to occupied hours). Fix in Part 2 is field swap.
- **Engine bug** — `_resolveSetpoint` produces wrong setpoint, OR State 2 setpoint override path produces wrong demand recompute, OR `_computeHeatingOrCooling` mis-scales. Fix in Part 2 is targeted engine fix.
- **Definitional mismatch** — "delivered" and "demand" are being calculated against different scopes (different hours, different zones, different boundary). Fix is either a UI rename or scope alignment.

Document hypothesis + evidence + recommended fix path.

1.3 **Investigate Schedule tab data source.** Read `ScheduleTab.jsx` (or equivalent). Does it read `systems_config_v40.{service}[].control_schedule_id` and look up against `schedules` library? Or does it have hardcoded mock data? Document.

1.4 **Investigate "[object Object]" construction patches.** Read `summarizePatch` in `patchCapture.js`. Identify why construction `{library_id, u_value_override}` objects stringify to `[object Object]`. Note the fix shape (small string-formatting tweak); Part 2 implements it.

1.5 **Investigate baseline EUI display flip.** Brief 43 follow-up #5 — `InterventionsModule.baselineSummary` flips between two result-shape paths. Read the code; document which two paths are involved and why one wins sometimes vs the other.

1.6 **Audit summary table.** End of audit doc, summarise:
- Bugs (real defects requiring code fix): list with module + tab + nature
- Inconsistencies (works but inconsistent with siblings): list
- Missing features (designed but not built / broken cosmetics): list
- Recommended Part 2-5 ordering

**Commit message:**
```
Brief 44 Part 1: Visualisation audit (read-only diagnostic)

docs/audit/44_visualisation_audit.md walks every view tab in every
module. For each: data source, computation, reactivity status,
design intent vs current state, gap.

Specifically diagnoses:
- Diagnostic tab 248% over-delivery for 21.5°C setpoint: [hypothesis
  documented with evidence and recommended fix path]
- Schedule tab data source: [real / hardcoded / mixed]
- Construction patches showing [object Object]: summarizePatch
  string-formatting issue
- Baseline EUI display flip in InterventionsModule: [two result-shape
  paths identified]

Brief file folded into docs/briefs/active/. current.md pointer
updated.

No code changes. Part 2 fixes Diagnostic bug; Part 3 rebuilds
Profiles; Part 4 reactivity sweep + Monthly + Schedule; Part 5
cross-module rollout; Part 6 walkthrough + close.
```

STATUS.md + audit doc updated in same commit.

---

### Part 2 — Diagnostic bug fix + lightweight cosmetic fixes

**Goal:** The Diagnostic tab shows sensible delivered-vs-demand numbers across the full setpoint range. The cosmetic bugs from Brief 43 follow-ups #1 and #5 are resolved.

**Files touched:**
- Depending on Part 1 finding: either `systemsEngine.js` (engine fix), or `DiagnosticTab.jsx` (UI fix), or both
- `patchCapture.js` — fix `summarizePatch` for construction patches
- `InterventionsModule.jsx` — fix baselineSummary result-shape path
- `docs/audit/44_visualisation_audit.md` — append "Part 2 — fixes and falsifiability" section

**Steps:**

2.1 **Diagnostic fix.** Per Part 1 finding. Implement the targeted fix.

2.2 **Falsifiability verification.** With the fix in place, walk this matrix in browser:

| Setpoint mode | Setpoint value | Expected delivered behaviour |
|---|---|---|
| Follow comfort | (resolves to 21°C) | Delivered ≈ demand (baseline) |
| Custom | 21.5°C | Delivered slightly higher (< 10%) than baseline |
| Custom | 22.0°C | Delivered higher than 21.5°C case, smoothly |
| Custom | 19.0°C | Delivered slightly lower than baseline |
| Custom | 25.0°C | Delivered much higher; diagnostic "% over" shows large positive |
| Custom | 16.0°C | Delivered much lower; diagnostic "% over" shows large negative |

All six rows must produce sensible, monotonic, smooth deltas. No 248% jumps for 0.5°C changes.

Document the matrix and results in audit doc § "Part 2 — fixes and falsifiability."

2.3 **`summarizePatch` construction fix.** Construction patches use shape `{library_id: 'cavity_wall_enhanced', u_value_override: 0.18}`. Render as `"cavity_wall_enhanced (U=0.18)"` or similar — not `[object Object]`. Apply same treatment to any other object-valued patch values.

2.4 **`baselineSummary` flip fix.** Per Part 1 finding. Settle on one result-shape path; use consistently.

2.5 **Commit.**

**Commit message:**
```
Brief 44 Part 2: Diagnostic bug fix + cosmetic patch summarisations

[Specific fix description per Part 1 finding.]

Falsifiability verified: 6-row setpoint matrix produces sensible
monotonic deltas. No more 248% jumps for 0.5°C setpoint changes.

summarizePatch correctly renders construction patches as
"<library_id> (U=<override>)" instead of [object Object].

InterventionsModule.baselineSummary uses [chosen result-shape path]
consistently — eliminates the flip behaviour Brief 43 follow-up #5.
```

STATUS.md + audit doc updated in same commit.

---

### Part 3 — Profiles visualiser rebuild

**Goal:** The Profiles tab is rebuilt as `InteractiveProfileVisualiser` — simple by default, layered by choice. Extracted as a shared component for Part 5's cross-module rollout.

**Files touched:**
- `frontend/src/components/shared/InteractiveProfileVisualiser/` (new directory) — the shared component
- `frontend/src/components/modules/systems/ProfilesTab.jsx` — refactored to wrap `InteractiveProfileVisualiser`
- `docs/audit/44_visualisation_audit.md` — append "Part 3 — Profiles rebuild" section

**Steps:**

3.1 **Default view.** On first load: show ONE clear signal. For Systems, this is **total electricity (kW)** as a single line across the year, OR **total demand (kW)** if user has selected demand-mode. Simple. Legible.

3.2 **Layer toggle.** A control panel beside or above the chart lets the user toggle individual layers on/off:
- Heating delivered (kW)
- Cooling delivered (kW)
- DHW delivered (kW)
- Fan power (kW)
- Lighting (kW)
- Small power (kW)
- Electricity total (kW)
- Gas total (kW)

Each layer has a checkbox + colour swatch. Default state: only one layer on (the simplest meaningful default — total electricity).

3.3 **Chart mode toggle.** Three modes:
- **Single line** — total of selected layers as one trend
- **Stacked area** — selected layers stacked
- **Small multiples** — each selected layer as a separate small chart in a grid

Default: single line.

3.4 **Weather overlay toggle.** Off by default. Three independent toggles:
- Outdoor air temperature
- Wind speed
- Solar irradiance

When on, displayed as a thin overlay or a small panel beneath the primary chart — never crammed onto the same axis as the energy data.

3.5 **Time-axis toggle.** Year / Quarter / Month / Day. Default: Year. Selecting Quarter shows a quarter selector (Q1/Q2/Q3/Q4); Month shows month selector; Day shows date picker. The chart rescales to the selected window and the y-axis adjusts to fit.

3.6 **Day-scrubber.** When viewing a single day: hover/drag to scrub through hours; small readout panel shows the values of all selected layers at the hovered timestamp plus weather context if enabled.

3.7 **Reactivity.** The visualiser reads from engine output (`consumption.brief40.*` for Systems case). When upstream edits land, the visualiser re-renders within the same render cycle. Walk through this in the implementation: editing setpoint in Heating section header should immediately reshape heating delivered in the chart.

3.8 **Performance.** Year view = 8760 hourly points. Should render smoothly. If browser becomes sluggish, use day-aggregated points (365) for year/quarter views; hourly only for month/day. Choose threshold sensibly.

3.9 **Component API.** Design `InteractiveProfileVisualiser` so it can be reused in Part 5:

```jsx
<InteractiveProfileVisualiser
  layers={[
    { id: 'heating', label: 'Heating delivered', colour: '#dc2626', dataPath: 'consumption.brief40.heating.profile_kw' },
    { id: 'electricity', label: 'Electricity', colour: '#f59e0b', dataPath: 'consumption.electricity.profile_kw' },
    ...
  ]}
  defaultLayers={['electricity']}
  weatherContext={true} // module-specific override
  chartModes={['single_line', 'stacked_area', 'small_multiples']}
  module="systems"
/>
```

Module-specific layers passed in. The component handles the toggles, time axis, scrubbing, weather overlay.

3.10 **Browser verification.** Boot dev server. Load Bridgewater. Open Systems → Profiles. Verify:
- Default view: single line, total electricity, year axis. Clean.
- Toggle on heating delivered → second line appears
- Switch to stacked area mode → layers stack
- Zoom to July → chart rescales, heating drops out
- Day picker: select July 21 → 24-hour view, scrubber works
- Enable outdoor temp overlay → appears beneath chart
- Edit setpoint in left panel → chart updates within same render cycle

**Commit message:**
```
Brief 44 Part 3: Profiles rebuilt as InteractiveProfileVisualiser

New shared component frontend/src/components/shared/InteractiveProfileVisualiser/.

Simple by default: total electricity, single line, year axis. User
opts in to additional layers (heating, cooling, DHW, fan, lighting,
small power, gas).

Chart modes: single_line / stacked_area / small_multiples.

Weather overlays (outdoor temp, wind, solar) off by default;
toggleable independently; rendered as thin overlay or beneath
primary chart, never crammed onto the same axis.

Time-axis toggle: Year / Quarter / Month / Day. Rescales smoothly.
Day view enables hover-scrubber with values readout.

Performance: day-aggregated 365 points for year/quarter; hourly
8760 for month/day.

Browser-verified on Bridgewater: setpoint edits propagate to chart
within same render cycle.

Old Profiles tab refactored to wrap the new component. Part 5 wires
it into Building / Internal Gains / Operation modules.
```

STATUS.md + audit doc updated in same commit.

---

### Part 4 — Reactivity sweep + Monthly fix + Schedule decision

**Goal:** Every panel in every module updates within the same render cycle as upstream edits. Monthly tab is legible. Schedule tab either reads real data or is removed.

**Files touched:**
- `frontend/src/components/modules/systems/MonthlyTab.jsx` — cosmetic fix
- `frontend/src/components/modules/systems/ScheduleTab.jsx` — fix or remove per Part 1 finding
- `frontend/src/components/modules/*/` — minor reactivity tweaks per Part 1 audit
- `docs/audit/44_visualisation_audit.md` — append "Part 4 — reactivity, Monthly, Schedule" section

**Steps:**

4.1 **Reactivity sweep.** From Part 1 audit, list every tab that doesn't react to upstream edits. For each, identify the cause:
- Missing `useMemo` dependency
- Reading from stale closure
- Component not re-mounting on context change
- Specific upstream context update missing the relevant key

Fix each. Re-test in browser per Part 1's reactivity test matrix.

4.2 **Monthly tab cosmetic fix.** From image 3: numbers (`↓20539 ↑1703` etc.) overlap with month labels. Restructure layout so labels and numbers don't collide. Likely: numbers as small text labels positioned consistently below the bar, OR move them to a tooltip on hover.

4.3 **Schedule tab decision.** Per Part 1 finding:
- **If real-data:** ensure reactivity (test: change a system's `control_schedule_id` in left panel, confirm Schedule tab updates), confirm layout legibility, leave alone otherwise.
- **If hardcoded:** remove the tab. Restore later via a focused brief if real consultancy demand surfaces.
- **If mixed/partial:** treat as hardcoded — remove.

4.4 **Browser verification.** Stop and start dev server. Load Bridgewater. Walk through changes that should propagate everywhere:
- Change a wall U-value in Building → verify Sankey + Profiles + Monthly + Diagnostic + Summary + Live Results all update in every module within same render cycle
- Toggle a heating system off → verify same
- Change a setpoint → verify same
- Edit an internal gain → verify same

Capture findings.

**Commit message:**
```
Brief 44 Part 4: Reactivity sweep + Monthly fix + Schedule decision

Reactivity: every tab in every module now updates within same render
cycle as upstream edits. Specific fixes: [list per Part 1 audit].

Monthly tab cosmetic fix: numbers no longer overlap with month
labels. Layout restructured.

Schedule tab: [kept and made reactive / removed per Part 1 audit].

Browser-verified on Bridgewater: changing a wall U-value propagates
across all module view tabs immediately.
```

STATUS.md + audit doc updated in same commit.

---

### Part 5 — Cross-module rollout of InteractiveProfileVisualiser

**Goal:** The shared visualiser is wired into Building, Internal Gains, and Operation modules with module-appropriate data feeds.

**Files touched:**
- `frontend/src/components/modules/building/` — relevant tab(s)
- `frontend/src/components/modules/internalgains/` — relevant tab(s)
- `frontend/src/components/modules/operation/` — relevant tab(s)
- `docs/audit/44_visualisation_audit.md` — append "Part 5 — cross-module rollout" section

**Steps:**

5.1 **Building module integration.** Building's equivalent "profile over time" tab uses `InteractiveProfileVisualiser` with layers:
- Conduction loss (W/m²) per envelope element
- Infiltration loss (W/m²)
- Solar gain (W/m²)
- Ventilation loss (W/m²)
- Net demand (W/m²) — single signal default

5.2 **Internal Gains module integration.** Layers:
- Occupancy gain (W/m²)
- Lighting gain (W/m²)
- Equipment gain (W/m²)
- Total internal gain — single signal default

5.3 **Operation module integration.** Layers:
- Operable opening flow (m³/h or l/s)
- Effective ventilation rate (ACH)
- Permanent vent flow (l/s)

5.4 **Browser verification.** For each module, walk:
- Default view shows single clear signal
- Layer toggles work
- Time-axis toggle works
- Reactivity to upstream edits works

**Commit message:**
```
Brief 44 Part 5: Cross-module rollout of InteractiveProfileVisualiser

Building / Internal Gains / Operation modules now use the shared
InteractiveProfileVisualiser for their profile-over-time tab.
Module-specific layers per scope:
- Building: conduction, infiltration, solar gain, ventilation loss,
  net demand
- Internal Gains: occupancy, lighting, equipment gains
- Operation: opening flow, effective ACH, permanent vent flow

Consistent UX across all four modules' time-profile tabs.

Browser-verified on Bridgewater: each module's visualiser
defaults to one clean signal; layers, time-axis, weather, reactivity
all work.
```

STATUS.md + audit doc updated in same commit.

---

### Part 6 — Bridgewater walkthrough + close

**Goal:** Chris's walkthrough confirms Brief 44 lands. Brief 44 archived. Issues from Briefs 42/43 follow-ups closed (those that this brief addresses). STATUS.md final.

**Files touched:**
- `docs/audit/44_visualisation_audit.md` — append "Part 6 — walkthrough"
- `docs/audit/29_open_issues.md` — close Diagnostic delivered-vs-demand issue + cosmetic patch summarisation issue + baselineSummary flip issue
- `docs/briefs/active/44_visualisation_audit.md` → `docs/briefs/archive/44_visualisation_audit_COMPLETED.md`
- `docs/briefs/current.md` — pointer updated
- STATUS.md — close-out

**Walkthrough checklist Chris runs (15 items):**

1. Open Bridgewater. Confirm Live Results panel shows sensible numbers.
2. Open Systems → Diagnostic. Confirm heating delivered ≈ demand (no 248% jump). Change setpoint to Custom 21.5°C: delivered shifts by <10%. Change to 25°C: delivered shifts substantially. Smooth and monotonic.
3. Systems → Profiles. Default view: clean single line (electricity total). Time axis: Year.
4. Toggle on heating layer. Second line appears.
5. Switch to Stacked Area mode. Layers stack cleanly.
6. Zoom to July (Q3 → July). Heating drops out, cooling dominant. Y-axis rescales.
7. Day picker: July 21. 24-hour view. Hover scrubber works; readout shows values at the hovered hour.
8. Enable Outdoor Temp overlay. Thin trace appears beneath primary chart. Doesn't crowd it.
9. Disable Outdoor Temp; toggle Solar instead. Same clean behaviour.
10. Back to year view. Change heating setpoint from Follow comfort to Custom 19°C in left panel. Within same render cycle: Profiles, Sankey, Diagnostic, Monthly, Summary all update consistently.
11. Toggle a heating system off in left panel. Same — all views update.
12. Systems → Monthly. Numbers and labels don't collide. Readable at a glance.
13. Systems → Schedule. Either: reads real data and updates when system schedules change, OR tab no longer exists.
14. Building module → time-profile tab uses same visualiser pattern with envelope-relevant layers. Internal Gains, Operation similar.
15. Edit a fabric assumption in Building (e.g. wall U). Profile visualiser in Building updates; Sankey + Profiles in Systems also update. Cross-module reactivity verified.

If all 15 pass → Part 6 close commit.
If anything anomalous → log in 29_open_issues.md, diagnose, fix in follow-up commit, re-verify.

**Final report Chris pastes after close:**

1. New origin/main HEAD SHA
2. Diagnostic tab: confirmed 6-row setpoint matrix produces sensible monotonic deltas (specific numbers)
3. Profiles visualiser: confirmed simple-by-default + layered-by-choice behaviour on Bridgewater
4. Reactivity sweep: list of every tab confirmed reactive to upstream edits
5. Schedule tab: kept / removed (per Part 1 finding)
6. Monthly tab cosmetic: confirmed legible
7. Cross-module rollout: confirmed Building / Internal Gains / Operation all using shared visualiser
8. Issues closed in 29_open_issues.md (Diagnostic, summarizePatch, baselineSummary flip)
9. Any new issues logged from walkthrough
10. CLAUDE.md unchanged (no scope drift)

**Commit message (after Chris's sign-off):**
```
Brief 44 close: Visualisation surface trustworthy across modules

Diagnostic tab now produces sensible delivered-vs-demand deltas
across the full setpoint range. 248% over-delivery bug fixed
[engine fix / UI fix per Part 1 finding].

Profiles rebuilt as InteractiveProfileVisualiser — shared component
used across Systems, Building, Internal Gains, Operation. Simple by
default; user opts into layers, chart modes, weather overlays,
time-axis zoom.

Reactivity sweep complete: every tab in every module updates within
same render cycle as upstream edits.

Monthly tab cosmetic fix landed. Schedule tab [kept / removed].

Cosmetic patch summaries no longer show [object Object] for
constructions. InterventionsModule.baselineSummary uses consistent
result-shape path.

Foundation now trustworthy for Brief 45 — Interventions UX polish +
simple waterfall.
```

---

## What MUST NOT happen in this brief

- No engine restructure. Diagnostic bug fix is surgical; everything else is unchanged.
- No new physics or methodology. This is visualisation work.
- No new modules.
- No interventions UX changes — Brief 45 owns those.
- No waterfall chart or decarbonisation pathway overlays — Brief 45 owns those too.
- No partial commits — each Part is one commit including STATUS.md + audit-doc updates.
- No skipping browser verification — Part 6's 15-item walkthrough is mandatory.
- No expansion into other modules' fundamental scope (Roadmap, CRREM module, Calibration view) — all out of scope.

---

## When to escalate

Pause and escalate to Chris ONLY if:

- Part 1 audit reveals that the Diagnostic 248% bug requires significant engine restructure to fix correctly (suggests a deeper bug worthy of its own brief)
- Part 3's `InteractiveProfileVisualiser` rebuild reveals that the existing engine output doesn't expose the per-hour data needed (would suggest an engine-side data exposure brief is prerequisite)
- Part 5 cross-module rollout reveals that Building/Internal Gains/Operation don't have equivalent profile data ready to plug in (would suggest those modules need data-layer work first)
- A reactivity issue from Part 1 audit turns out to be caused by a fundamental state-management problem in `ProjectContext` (would warrant its own brief)
- Documentation hygiene starts slipping

Otherwise, plough through Parts 1–5, walkthrough sign-off after Part 5, Part 6 close.

---

## Notes for Claude Code on the discipline pattern

This brief follows the pattern that's worked for Briefs 36, 39, 40, 41, 42, 43:

- **Read everything before starting.** The Notion design note + the three open issues + the BEFORE-DOING-ANYTHING checklist are all mandatory.
- **Audit before fix.** Part 1 is read-only diagnostic. Resist the temptation to fix during audit. Diagnosis errors lead to fix errors.
- **Each Part is one commit.** Audit doc + STATUS.md updates land in same commit.
- **Falsifiability for the Diagnostic fix.** The 6-row setpoint matrix is the acceptance criterion. If it doesn't produce monotonic smooth deltas after Part 2, the diagnosis was wrong; revisit Part 1.
- **Browser verification mandatory at Part 3, Part 4, Part 5, Part 6.** This brief is mostly visual work; code-side reasoning consistently underestimates UX-layer issues.
- **Simple by default, layered by choice.** The Profiles rebuild's core principle. Resist the temptation to default-on every layer "because they exist."
- **The shared component (`InteractiveProfileVisualiser`) is the durable deliverable.** Even if specific module integrations have rough edges, the shared component lets future briefs improve the pattern in one place.

Standing by for authorisation to begin Part 1.

# Brief 28-IM-Polish — Building module reference pattern + cross-module rollout

**Status:** Ready for Claude Code
**Author:** Chris (with Claude Chat — drafted 2026-05-17 after Chris's M1-M6 test run)
**Builds on:** Brief 28-IM (M1 → M6) — all CLOSED
**Discipline:** Visible-at-every-gate. Engine and display land together. Pre-screenshot magnitude + UX assertions enforce both numerical AND visual correctness.

---

## 0. Why this brief exists

Brief 28-IM landed six gates and produced a working platform. Testing it surfaced ~15 distinct issues across bugs, UI quality, information architecture, and missing features. None are blockers. All together degrade the product from "works" to "feels right."

This brief takes the **Building module** as the reference pattern, fixes everything broken there, establishes the UX patterns that should be consistent everywhere, then rolls those patterns to the other four modules (Internal Gains, Operation, Systems, Results) and the Roadmap.

The Static vs Dynamic fabric gap (Static ~94 MWh vs Dynamic ~136 MWh on Bridgewater) is acknowledged as documented physics differences (Brief 28-DynamicParity territory) and is NOT addressed here. It will be visible in the Summary view and annotated, but not "fixed."

---

## 1. Reading order

1. §2 — Bug fixes (12 items, mostly small)
2. §3 — Information architecture decisions (4 items)
3. §4 — Cross-chart consistency rules (the patterns to enforce everywhere)
4. §5 — Building module reference rebuild (Gate POL-M1)
5. §6 — Cross-module propagation (Gate POL-M2)
6. §7 — Polish gate (Gate POL-M3 — Profile zoom, Summary refactor, totals)
7. §8 — Validation discipline

Same multi-agent pattern as Brief 28-IM (Interpret / Build / Verify per gate). Visible-at-every-gate.

---

## 2. Bugs to fix

### Bug 2.1 — Thermal bridging input is in the wrong place (IM-M1 drift)

**Symptom:** Building tab left panel has no Thermal Bridges section. Instead, construction editor popouts (External Wall / Roof / Ground Floor / Glazing) each have a Y-factor selector (1.00× / 1.05× / 1.15× / 1.25× / Custom) labelled "THERMAL BRIDGING".

**Cause:** IM-M1 implementation drifted from Brief 28-IM §5.2 step 7. The brief specified a building-level TB section in the left panel; instead, a per-construction y-factor input was added inside each construction popout. The popout input is also **dead code** — not wired to the engine.

**Underlying engine:** Engine still computes `H_TB = 92.94 W/K` correctly from `building_config.thermal_bridges: { mode: 'iso14683_auto', multiplier: 1.0 }` (verified in Summary view). The seed has the right value.

**Fix:**

1. Add **Thermal Bridges section to Building tab left panel** between Fabric and Airtightness, with:
   - Mode dropdown: `ISO 14683 auto` (default) / `Manual H_TB` / `Absent`
   - Multiplier slider: 0.5–3.0, default 1.0
   - Read-only badge below: "→ H_TB = 92.94 W/K"
   - Expandable per-junction breakdown (collapsible, default closed):

   | Junction type | Length formula | Default ψ (W/m·K) — ISO 14683 Table A.2 |
   |---|---|---|
   | Wall-to-roof | 2 × (L + W) | 0.08 |
   | Wall-to-ground floor | 2 × (L + W) | 0.16 |
   | Wall-to-intermediate floor | 2 × (L + W) × (num_floors − 1) | 0.08 |
   | External corner | 4 × total_height | 0.05 |
   | Window perimeter (head + jamb + sill combined) | 4 × √(glazing_area_per_facade) × num_facades | 0.05 |
   | Door perimeter | 2 × (area/height + height) per opening | 0.10 |

   Each junction row shows: type, length (auto-derived, read-only), ψ (editable), contribution to H_TB (read-only). Editing any ψ recomputes H_TB live.

2. **Remove the y-factor selector from every construction editor popout.** Construction editors only show layer stack + total R + U-value. No TB inputs.

3. **Manual H_TB mode**: switching mode to `Manual H_TB` reveals a single number input "H_TB (W/K)" replacing the multiplier slider. Per-junction breakdown disappears.

4. **Absent mode**: H_TB = 0. Engine outputs unchanged but no TB contribution.

**Acceptance:**
- Default state: H_TB = 92.94 W/K with default ψ values, multiplier 1.0
- Multiplier 1.5 → H_TB ≈ 139 W/K
- Editing window perimeter ψ from 0.05 to 0.10 → H_TB increases proportionally
- Heat balance "Thermal bridging" line updates instantly
- Summary view H_TB readout matches the left-panel readout

### Bug 2.2 — Air permeability slider zones don't scale with unit toggle

**Symptom:** Switching the unit display from m³/(h·m²) to l/(s·m²) keeps the zone labels "≤3 best / 3–10 typical / >10 leaky". These thresholds are correct for m³/(h·m²) but wrong for l/(s·m²).

**Fix:** Zones scale with the unit toggle:
- m³/(h·m²): "≤3 best · 3–10 typical · >10 leaky"
- l/(s·m²): "≤0.83 best · 0.83–2.78 typical · >2.78 leaky"

Equivalent values computed as `q50_m3_h_m2 / 3.6`.

### Bug 2.3 — Profiles axis labels overlap

**Symptom:** Building Profiles chart has y-axis labels (kW, °C, m/s, W/m²) clashing with grid lines and number ticks. Labels are cut off or overprint each other.

**Fix:** Margins / padding adjustment per Recharts/D3 standard practice:
- Increase left margin on each pane to fit y-axis label + tick numbers
- Position the unit label (kW / °C / m/s / W/m²) at the top-left of each pane, not overlapping the tick column
- Confirm legend doesn't crash into the chart area

### Bug 2.4 — Stacked Heat Balance bar labels clipped

**Symptom:** Switching Heat Balance from Rows to Stacked produces tall vertical bars with segment values that get clipped or overlap each other.

**Fix:**
- Bar segments below ~5% of total height: hide inline label, show on hover only
- Bar segments above ~5%: render label inside the segment, white text with semi-transparent dark background for legibility
- If segment has neither room nor height: callout line out to the side with leader text

### Bug 2.5 — Right column not resizable

**Symptom:** Left column has drag-to-resize handle; right column doesn't.

**Fix:** Add drag-to-resize on right column boundary. Both column widths persist to localStorage. Centre column flexes to fill remaining space.

### Bug 2.6 — Live Results tab is wasted space

**Symptom:** Right column has a 3D Model / Live Results toggle. Live Results when selected occupies the full right column (~400px wide) showing 5-6 KPI numbers in lots of whitespace.

**Fix:** Live Results becomes an always-visible compact strip **below** the 3D viewer in the right column, not a separate tab. Strip shows: Heating demand · Cooling demand · EUI · Annual mean T (free-running). Single row, compact, ~80px tall. 3D viewer keeps the rest of the right column.

### Bug 2.7 — Static/Dynamic label clarity missing

**Symptom:** Live Results panel and every chart that's Static-only doesn't say so. User has to remember which engine each view uses.

**Fix:** Every chart and KPI panel shows a small pill in the corner: "Static" or "Dynamic" or "Static + Dynamic" (when both are overlaid). Pill colour matches the engine convention (Static teal-ish, Dynamic violet-ish — already used elsewhere). If the user toggles Static/Dynamic via the chart toolbar, the pill updates.

### Bug 2.8 — Static vs Dynamic fabric loss gap explanation incomplete

**Symptom:** Building tab Summary view annotates documented convention differences (sky long-wave, T_ground, BS 5925, TB, glazing) but the actual fabric loss gap on Bridgewater (Static ~94 MWh vs Dynamic ~136 MWh = +44%) is larger than the listed conventions account for.

**Fix:** Add a one-line magnitude diagnostic to the convention notes block: "Cumulative effect on Bridgewater: Dynamic fabric losses ~44% higher than Static, of which approximately X% is sky long-wave (Roof + ExtWall), Y% is glazing angle-aware solar transmission, Z% is T_ground variation. Remaining ~Q% TBC — see Brief 28-DynamicParity."

Numbers above are placeholders — Claude Code computes from the actual delta between Static `losses_at_setpoint.*` and Dynamic equivalents on Bridgewater current state. If exact attribution is too hard, note "decomposition queued for Brief 28-DynamicParity" and just report the cumulative magnitude.

### Bug 2.9 — Monthly chart cropped at bottom, "guff" repeated below

**Symptom:** Building tab Monthly view bars are constrained by chart chrome below them (Heat Balance summary, comfort band selector) that's already visible above.

**Fix:**
- Monthly view, when active, hides the Heat Balance summary row + comfort band selector below the chart. They reappear when user switches back to Heat Balance view.
- Result: Monthly chart fills the full centre column height.
- Same pattern applies to Profiles view.

### Bug 2.10 — Monthly chart and Heat Balance totals don't visibly reconcile

**Symptom:** Building Heat Balance shows total solar gain ~99.4 MWh. Building Monthly shows 12 stacked bars summing to ... unknown. User has to manually add 12 numbers to verify they match. Same issue for losses.

**Fix:** Every aggregation view shows the total it sums to, prominently:
- Monthly view: below the bars, "Σ losses = 249 MWh · Σ solar = 99 MWh" — same units, same figures as the Heat Balance for that module
- If they don't match, that's a bug, not a display issue (engine output mismatch)
- Confirms cross-view consistency at a glance

### Bug 2.11 — Static-vs-Dynamic Summary table is amber when no Dynamic run available

**Symptom:** Summary view shows "Dynamic not available — run dynamic engine to populate" or similar when no Dynamic simulation has been triggered yet. This is technically correct but visually noisy when the user is mostly working in Static.

**Fix:** Two states:
- No Dynamic run yet: show "Δ% requires Dynamic run" with a "Run Dynamic" button inline. Don't render the amber per-row warnings.
- Dynamic run stale (inputs changed): show "Dynamic stale — last run at HH:MM" with re-run button. Keep the Δ% values from last run but mark them with a small staleness indicator.
- Dynamic fresh: show Δ% values normally with green/amber/red bands.

### Bug 2.12 — Profiles axis labels and units inconsistent across panes

**Symptom:** Each pane of the Profiles chart has its own axis label format. Top pane (kW) shows "kW" once at top-left. Bottom panes (°C / m/s / W/m²) sometimes overlap their unit label with the y-axis tick label "-5".

**Fix:** Standardise per pane:
- Unit label in top-left corner of each pane, not on the axis itself
- Y-axis ticks: 3-4 evenly spaced values per pane, all in the same numerical format
- Pane heights: roughly equal, so larger panes (kW) get only ~40% of total chart height (currently they dominate)

---

## 3. Information architecture decisions

### IA 3.1 — Comfort band setpoint lives in the left input column

**Current:** Comfort band sliders (e.g. 21°C / 24°C) sit below the Heat Balance chart in the centre column.

**Decision:** Move to left input column. Setpoint is an **input** (affects the calculation). The chart is an **output**. Inputs go left.

Apply everywhere this exists — Building, Internal Gains, Operation. Systems already has its own setpoint inputs in the system editors and doesn't need a duplicate.

### IA 3.2 — Live Results: compact strip below 3D viewer, always visible

**Decision per Bug 2.6:** Live Results is not a separate tab. It's a compact strip below the 3D viewer showing Heating demand · Cooling demand · EUI · Annual mean T. Always visible. Updates live on every input change.

This pattern applies across **all five modules**:
- Building: Heating demand, Cooling demand, EUI, Annual mean T (free-running)
- Internal Gains: Heating demand (with gains), Cooling demand (with gains), Annual gains total, Net offset
- Operation: Heating demand, Cooling demand, Total operable loss/gain, Avg open hours
- Systems: EUI, Total electricity, Total gas, Carbon today
- Results: EUI, Carbon today, Carbon 2038, vs CRREM 2030

Always Static. Dynamic re-run via separate button as per current pattern.

### IA 3.3 — Summary view reframed

**Current:** Summary tab is the place to find headline numbers + per-element breakdowns + Static/Dynamic Δ%.

**Decision:** With totals on every chart (Bug 2.10) and Live Results always visible (IA 3.2), Summary becomes the **diagnostic + comparison view**, not a headline number view. Keep but reframe:

- Per-element breakdown (currently there — keep, it's useful)
- Static vs Dynamic Δ% with convention notes (currently there — keep, this is the calibration/diagnostic value)
- Comfort hours / temperature stats (currently there — keep)
- **Remove** the demand cards (Static / Dynamic Heating / Cooling) — those are now in Live Results

### IA 3.4 — Construction editor popouts: layer stack only

**Per Bug 2.1:** Remove the y-factor selector from each construction popout. Popouts only show:
- Layer stack (outside to inside): material, d (mm), λ (W/mK), R (m²K/W)
- Surface resistances Rsi / Rse
- Total R, U-value (1D), Effective U with thermal mass marker
- Layer R (without surface), Total R (with surface)

No thermal bridging inputs. No effective U-with-TB. The popout is a per-element construction view; TB is a building-level concept owned by the Thermal Bridges section in the left panel.

---

## 4. Cross-chart consistency rules

These rules apply to every chart in every module. Verifier role rejects screenshots that violate them.

### 4.1 Every chart shows a totals badge

Top-right of every chart, a small badge: "Σ = X MWh/yr (Y kWh/m²·yr)" where X is the sum of what's plotted and Y is X / GIA. Two units always shown side by side (per the brief's q50 unit toggle pattern — show both, no toggle needed).

When chart is Static: badge says "Σ (Static)". When Dynamic: "Σ (Dynamic)". When overlaid: both totals separately.

### 4.2 Every chart has a Static/Dynamic pill

Per Bug 2.7. Small pill in top-left of every chart indicating which engine produced the rendered data. Click the pill to toggle (where Dynamic is available). When Dynamic data is stale, pill shows a stale indicator.

### 4.3 Every chart has a unit toggle (where meaningful)

For energy: kWh ↔ MWh ↔ kWh/m²·yr (auto-scale based on magnitude is fine if always shown clearly).

For loss/gain bars on Heat Balance: kWh ↔ kWh/m²·yr (existing — keep).

For temperatures: °C only (no F).

For volumetric flow: l/s ↔ m³/h (existing q50 pattern — apply same approach to vent flow rates).

### 4.4 Every aggregation view shows the sum

Per Bug 2.10. Monthly: 12 bars + "Σ = X MWh" below. Profiles (annual): "Σ = X MWh" below the trace. Summary: row totals already shown — keep.

### 4.5 Hover tooltips everywhere

Every chart supports hover-to-inspect. Synchronised across panes where there's a shared x-axis (Profiles already does this — verify it persists after other fixes).

### 4.6 Empty / loading states

When engine is recomputing: skeleton placeholder, not blank chart. When data unavailable (e.g. Dynamic not run): clear message + action button, not amber spam.

---

## 5. Gate POL-M1 — Building module reference rebuild

Apply everything from §2 (bugs) + §3 (IA) + §4 (consistency rules) to **Building module only first**, as the reference pattern.

Scope:

1. Add Thermal Bridges section to left panel (Bug 2.1 — full implementation per §2.1 spec)
2. Remove y-factor selector from construction popouts (Bug 2.1 part 2, IA 3.4)
3. Fix airtightness slider zones with unit toggle (Bug 2.2)
4. Fix Profile axis labels (Bug 2.3, Bug 2.12)
5. Fix Stacked Heat Balance label clipping (Bug 2.4)
6. Add right column resize (Bug 2.5)
7. Replace Live Results tab with compact strip below 3D viewer (Bug 2.6, IA 3.2)
8. Add Static/Dynamic pill to every chart (Bug 2.7, §4.2)
9. Add fabric-gap magnitude diagnostic to Summary convention notes (Bug 2.8)
10. Hide Heat Balance chrome on Monthly/Profiles views (Bug 2.9)
11. Add totals badge to every chart (Bug 2.10, §4.1)
12. Refine Static-vs-Dynamic empty states (Bug 2.11)
13. Move comfort band sliders to left panel (IA 3.1)
14. Reframe Summary view (IA 3.3)

### Gate POL-M1 PASS criteria

Pre-screenshot assertions:
```
engine: H_TB still 92.94 W/K (Bridgewater default, multiplier 1.0, default ψ)
engine: H_TB scales with multiplier (1.5 → ~139 W/K)
engine: H_TB scales with custom ψ override on wall_to_roof junction
engine: airtightness q50 → operational ACH still 0.068 (unchanged from IM-M1)
ui: Building tab left panel has Thermal Bridges section between Fabric and Airtightness
ui: Construction editor popouts have NO TB inputs (only layer stack + R + U)
ui: Airtightness slider zone labels change when unit toggled
ui: Profile axis labels do not overlap tick numbers
ui: Stacked Heat Balance labels fit or hover-only when too small
ui: Right column has drag-to-resize handle
ui: Live Results is a compact strip below 3D viewer, NOT a separate tab
ui: Every chart has a "Static" or "Dynamic" pill in corner
ui: Every chart has a totals badge top-right
ui: Comfort band sliders in left panel, not centre
ui: Monthly view fills full centre height (no Heat Balance chrome below)
ui: Summary view does not show demand cards (moved to Live Results strip)
```

Screenshots:
- `pol_M1_building_heat_balance_with_thermal_bridges.png` — left panel TB section visible
- `pol_M1_building_thermal_bridges_expanded.png` — per-junction breakdown expanded
- `pol_M1_building_construction_editor.png` — popout without y-factor
- `pol_M1_building_airtightness_unit_toggle.png` — l/s·m² with correct zones
- `pol_M1_building_profiles_axis_fixed.png` — no overlapping labels
- `pol_M1_building_stacked_balance.png` — readable segment labels
- `pol_M1_building_live_results_strip.png` — 3D + strip in right column
- `pol_M1_building_monthly_full_height.png` — chart fills centre
- `pol_M1_building_summary_reframed.png` — diagnostic-only summary

---

## 6. Gate POL-M2 — Cross-module propagation

Roll the Building module patterns to the other four modules.

For each of **Internal Gains / Operation / Systems / Results**:

1. Live Results strip below 3D viewer (or below right-column-equivalent for Results which is full-width)
2. Static/Dynamic pill on every chart
3. Totals badge on every chart
4. Move setpoint/control inputs to left column where they exist
5. Hide irrelevant chrome on Monthly/Profile views
6. Apply Summary reframing where each module has one

Module-specific considerations:

**Internal Gains:**
- Already closest to target. Audit, don't rebuild.
- Add totals badges, Static/Dynamic pills
- Live Results strip below 3D (currently this module may not have 3D viewer — if not, strip goes at top of right column or bottom of centre)

**Operation:**
- Three-column layout already from M3 — keep
- Live Results strip below 3D viewer
- Operable openings list editor stays left, view tabs centre, 3D + strip right
- Schedule editor remains popout-launched from ✏️ buttons

**Systems:**
- Three-column already from M4 — keep
- Live Results currently a dedicated right column — replace with compact strip below... something. Systems doesn't currently have a 3D viewer in the right column. Decision: right column becomes the Live Results strip + system-specific diagnostic (e.g. fuel split bars). NOT a 3D viewer. Centre column gets more width.
- The substantive Systems UX redesign (named systems / popouts) is deferred to Brief 28-M4b — not in scope here. POL-M2 just applies the consistency rules to what's there.

**Results:**
- Full-width module by §9 design
- Live Results KPI strip already at the top — keep as is
- Apply totals badges and Static/Dynamic pills to all four sub-views

### Gate POL-M2 PASS criteria

For each module:
```
ui: Live Results strip present and consistent across modules
ui: Every chart has Static/Dynamic pill
ui: Every chart has totals badge
ui: No duplicate chrome (chart-related controls only in chart area, not also elsewhere)
ui: Setpoint/control inputs in left column where they exist
ui: Visual consistency: column widths, fonts, spacing match Building module
```

Screenshots (one per module per view tab where relevant):
- `pol_M2_internal_gains_*.png`
- `pol_M2_operation_*.png`
- `pol_M2_systems_*.png`
- `pol_M2_results_*.png`

---

## 7. Gate POL-M3 — Polish features

Three additions identified in the test run that aren't strictly bugs but are quality-of-life essentials.

### 7.1 Profile zoom / pan

Every Profile chart supports zoom and pan:
- **Drag** to select a time range → chart zooms to that range
- **Scroll** (or pinch on touch) to zoom in/out around cursor position
- **Double-click** to reset to full year
- **Range buttons** above chart: "Year / Quarter / Month / Week" preset zoom levels
- **Brush track** below chart: small overview chart showing current viewport position within the full year (Recharts `Brush` component)

Applies to all Profile charts across Building / Operation / Systems / Internal Gains.

### 7.2 Cross-chart total reconciliation

Verify and surface that totals match across views:
- Building Heat Balance solar total = Building Monthly solar total = Building Summary solar total
- Same for losses
- If they don't match, the engine has a bug — but the user needs to be able to verify visually
- Add an explicit reconciliation line in Summary view: "Heat Balance solar 99.4 MWh = Monthly solar 99.4 MWh ✓"
- Same for losses, fabric breakdown, etc.

This is a debugging-aid view. If everything matches, it's reassuring. If anything mismatches, it surfaces a bug immediately.

### 7.3 Roadmap sparkline polish

The IM-M6 sparklines per intervention card work but are small. Polish:
- Increase sparkline size to ~120px wide × 40px tall (currently ~80×24)
- Show year markers (2026, 2030, 2040, 2050) below sparkline
- Show install-year marker as a dot on the sparkline
- Hover sparkline → tooltip with year + value
- Color the sparkline by trend (growing = green, decaying = amber, stable = grey)

### Gate POL-M3 PASS criteria

```
ui: Building/Operation/Systems Profile charts support drag-to-zoom + brush
ui: Range preset buttons present
ui: Reset double-click works
ui: Summary view shows reconciliation lines
ui: Roadmap sparklines are larger, year-marked, tooltipped, trend-coloured
```

Screenshots:
- `pol_M3_profile_zoom_january.png`
- `pol_M3_profile_brush.png`
- `pol_M3_summary_reconciliation.png`
- `pol_M3_roadmap_sparkline_polish.png`

---

## 8. Validation discipline

Same as Brief 28-IM:

- **Per gate:** pre-screenshot assertions (engine + UI) + magnitude sanity + design self-check + module ownership check
- **Build through uncertainty** per Brief 28-IM §15.1: if something's hard, fall back per §15.2, flag in halt, continue
- **Halt reports:** PASS/FAIL summary, screenshots, magnitude check, design self-check sign-off, stuck-point fallbacks used, followups flagged
- **No questions back** unless genuinely unresolvable

### Stuck-point fallbacks for this brief

| Original target | Fallback if stuck |
|---|---|
| Per-junction ψ editable inline (Bug 2.1) | ψ values display-only V1, editable in V2 |
| Recharts Brush component for Profile zoom (POL-M3) | Range preset buttons only, no drag-to-zoom |
| Static-vs-Dynamic fabric-gap magnitude decomposition (Bug 2.8) | Cumulative magnitude only, note "decomposition queued for Brief 28-DynamicParity" |
| Right column resize (Bug 2.5) | Fixed widths if resize handler is complex; flag for follow-up |
| Stacked label fitting algorithm (Bug 2.4) | Hover-only labels for all segments below 10% (less elegant but works) |

### Gate sequence

1. **POL-M1** — Building module reference (most work — bugs + IA + consistency rules)
2. **POL-M2** — Roll patterns to other 4 modules (mostly consistent application)
3. **POL-M3** — Polish (Profile zoom, reconciliation lines, sparkline polish)

Total: 3 gates. POL-M1 is the largest (~2-3 hours). POL-M2 and POL-M3 lighter (~1-2 hours each).

### Out of scope (deliberately)

- **Static vs Dynamic accuracy fixes** — deferred to Brief 28-DynamicParity
- **Systems UX redesign (named systems, popouts)** — deferred to Brief 28-M4b
- **3D facade raycast** — deferred (chip-select fallback from M3 works)
- **New physics** — none in this brief
- **Performance optimisation** — only if recompute > 1s on any input change

---

## 9. File pointers

**Engine:** none (engine unchanged; this is a UI brief)

**UI components:**
- `frontend/src/components/modules/BuildingDefinition.jsx` — left panel restructure, TB section, comfort band move
- `frontend/src/components/modules/building/HeatBalance.jsx` — stacked label fix, totals badge
- `frontend/src/components/modules/building/Profiles.jsx` — axis fix, zoom, brush
- `frontend/src/components/modules/building/Monthly.jsx` — full-height layout, totals badge
- `frontend/src/components/modules/building/Summary.jsx` — reframe, reconciliation lines, no demand cards
- `frontend/src/components/inputs/AirPermeabilityInput.jsx` — zone scaling with unit toggle
- `frontend/src/components/inputs/ConstructionSelector.jsx` — remove TB y-factor
- `frontend/src/components/inputs/ThermalBridgesPanel.jsx` (NEW) — left-panel TB section with per-junction breakdown
- `frontend/src/components/shared/LiveResultsStrip.jsx` (NEW) — compact strip, used across modules
- `frontend/src/components/shared/ChartTotalsBadge.jsx` (NEW) — reusable totals badge
- `frontend/src/components/shared/EnginePill.jsx` (NEW) — reusable Static/Dynamic pill
- `frontend/src/components/shared/ColumnResize.jsx` — extend to right column
- `frontend/src/components/modules/InternalGains.jsx` — apply patterns (POL-M2)
- `frontend/src/components/modules/OperationModule.jsx` — apply patterns (POL-M2)
- `frontend/src/components/modules/SystemsModule.jsx` — apply patterns (POL-M2)
- `frontend/src/components/modules/IMResultsModule.jsx` — apply patterns (POL-M2)
- `frontend/src/components/modules/RoadmapModule.jsx` — sparkline polish (POL-M3)

**Briefs:**
- `docs/briefs/active/28im_polish.md` — THIS BRIEF, drop here
- `docs/validation/brief_28im_polish_pass.md` — pass report per gate

---

## 10. The discipline

This brief is smaller than 28-IM but more sensitive to design quality. Every screenshot is reviewed against §2/§3/§4. If a screenshot doesn't pass the engineer-eye-test, reject and rework.

The product needs to feel right. Numbers being right is no longer enough — they were right at the end of 28-IM. This brief makes "right" also feel right.

**End of Brief 28-IM-Polish.**

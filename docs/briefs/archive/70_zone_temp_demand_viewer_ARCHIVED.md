# Brief 70 — Zone Temperature + Demand Viewer

**Status:** active
**Lands at:** `docs/briefs/active/70_zone_temp_demand_viewer.md`
**Owner/reviewer:** Chris (in-browser walkthrough)
**Architect:** Claude Chat
**Builder/verifier:** Claude Code
**Canonical test buildings:** Bridgewater (HIX hotel, vent-dominated) + Brief66 Test Office (`3cb8cac5-2458-49a8-99f5-ac1eed5b9821`, gains-moderate)
**Predecessor:** Brief 69 closed (zone-temperature demand model). The float trace + dead-band-gated demand are exposed; this brief surfaces them in the UI so users can SEE what the model is doing instead of having to infer from totals.

---

## BEFORE DOING ANYTHING

1. Quote this brief's title + first paragraph back.
2. Read this brief in full, then `CLAUDE.md`, `STATUS.md`, `docs/briefs/current.md`, and the closing notes of Brief 69 (`docs/audit/67_partB_findings.md` for context on what the model actually computes).
3. Read the existing Systems-module tab layout (`frontend/src/components/modules/SystemsModule.jsx` — tab strip + view dispatch).
4. Read where `result.demand.hourly_zone_air_c`, `heating_demand_hourly_kwh`, and `cooling_demand_hourly_kwh` are surfaced today (`instantCalc.js` ~L3877–3905, the State 2 demand result block).
5. Clean tree + origin sync. Land this brief at `docs/briefs/active/`.

---

## SCOPE (module check per CLAUDE.md Rule 10)

This brief touches the Systems module. Per the CLAUDE.md module scope, Systems is responsible for the **comfort-vs-setpoint diagnostic** and the conversion from demand → delivered → source → carbon. A diagnostic view of the zone temperature trajectory + hourly demand power is squarely inside that remit — it surfaces the comfort/setpoint relationship the module is already computing.

**In scope:**
- New "Zone temperature" tab on the Systems module.
- Annual heatmap of the zone air temperature trace.
- Time-bucket selectors (day, week) that zoom from the annual view into hourly traces.
- A free-running overlay: a SECOND engine call with `control_strategy='free_running'` exposes the un-conditioned zone temperature alongside the active_setpoint trace, so the user can see the gap conditioning is closing.
- KPI strip: hours above csp, hours below hsp, hours in dead band, peak heating kW, peak cooling kW, hottest/coldest hour of the year.

**Out of scope:**
- Any engine change. Brief 69 produces everything we need; this is a UI surfacing brief, not a physics brief.
- Multi-zone (single-zone constraint stands).
- Setting setpoints from inside this tab — the existing left-panel setpoint editors remain the single source.
- Predicted Mean Vote / comfort categories — separate brief if it ever comes up.
- Custom date-range pickers beyond day + week — if Chris wants month or arbitrary ranges, a follow-up.

---

## PRINCIPLES

1. **Single engine source.** All numbers come from `result.demand.*`. No re-computation of demand magnitudes anywhere in the tab.
2. **Free-running compare is a second engine call, not a side calc.** When the user toggles the overlay, we run `calculateInstant(...,{ mode:'envelope-gains', control_strategy:'free_running' })` and read its `hourly_zone_air_c`. No parallel temperature path.
3. **Heatmap is the entry point.** Annual at a glance; click to drill.
4. **Day and week views read the same underlying arrays.** No different sources for different zoom levels.
5. **Empty / partial states are honest.** Pre-Brief-67 projects (no `hourly_zone_air_c` on result) show "Run a simulation to populate" — no fake heat.
6. **"Complete" is banned.** Report "built, walkthrough run with N items checked" or "built, item X failed."

---

## PART 1 — Annual heatmap + KPI strip

**One commit. The smallest viable view.**

Files touched:
- New: `frontend/src/components/modules/systems/ZoneTempTab.jsx` (tab body)
- New: `frontend/src/components/modules/systems/ZoneTempHeatmap.jsx` (24 × 365 SVG heatmap; reuse `HalfHourlyHeatmap.jsx` pattern if shapes line up — likely a sibling component for clarity)
- New: `frontend/src/components/modules/systems/ZoneTempKpiStrip.jsx` (6-tile strip)
- `frontend/src/components/modules/SystemsModule.jsx` — wire the tab into the existing tab strip + view dispatch.

Spec:
- **Heatmap.** Rows = hour of day (0–23, top → bottom). Columns = day of year (1–365, left → right). Cell colour = T_zone air. Diverging palette: blue (cold) → grey (in band) → red (hot). Setpoint contours overlaid (thin lines at hsp + csp). Hover tooltip: date / hour / T_zone / T_out / heating kW / cooling kW.
- **KPI strip (6 tiles).** Hours above csp · Hours below hsp · Hours in dead band · Peak heating kW · Peak cooling kW · Hottest hour (date + temp).
- **Title + outline.** "Zone temperature" with a one-line description: "Hourly indoor air temperature across the year. Cell colour shows zone temp; contour lines mark the heating and cooling setpoints. Hours outside the dead band are when conditioning fired."

Reactivity: the existing `SimulationContext` / `useStateComparison` pipeline already triggers recompute on slider changes. The tab consumes the result.demand.* arrays — no additional plumbing needed.

**Gate (verification):**
- Open Bridgewater. Switch to Zone temperature tab. Hovering cells reveals the right tooltip. Slide cooling setpoint 24 → 22 — heatmap colours shift more cells into "above csp" red, KPI updates live.
- Vent on/off toggle: with vent off, summer cells shift dramatically warmer (sealed-building effect from Brief 69 visible in the heatmap).
- Build clean (`npx vite build`); no harness change.

---

## PART 2 — Day-zoom panel

**One commit.**

Files touched:
- New: `frontend/src/components/modules/systems/ZoneTempDayView.jsx`
- `ZoneTempTab.jsx` — wire click → set selectedDate, render DayView below the heatmap when set.

Spec:
- Clicking any cell on the heatmap pins that day. A 24-hour time-series panel renders below.
- Lines: T_out (grey) · T_zone (navy) · hsp (red dashed) · csp (cyan dashed). Bars overlaid on a secondary axis: heating kW (red) · cooling kW (cyan).
- Day picker controls beside the panel: prev/next, calendar.
- Annotation chip: total heating / cooling kWh for that day; hours above csp; hours below hsp.

**Gate:**
- Click a January cell, confirm the line traces the cold day correctly (low T_out, heating kW spikes during occupied hours).
- Click a July afternoon cell, confirm heating kW = 0 and cooling kW spikes when T_zone touches csp.
- Build clean.

---

## PART 3 — Week-zoom + free_running compare

**One commit. The widest scope item — the storytelling tool.**

Files touched:
- New: `frontend/src/components/modules/systems/ZoneTempWeekView.jsx`
- `ZoneTempTab.jsx` — view-mode toggle (day | week), compare toggle.
- A second `calculateInstant` call with `control_strategy='free_running'` to populate the overlay trace. Memoised — only runs when compare is enabled.

Spec:
- Week view: 7-day time-series, same axes as day view; the time axis spans 168 hours.
- "Show free-floating" toggle. When ON, dashed line shows T_zone with NO conditioning (from the free_running run). Lets the user see "where would the building drift to if I switched off the systems for this week."
- KPI strip gains: free-floating peak, free-floating dead-band-only hours (none, by definition — free_running has no setpoint), Δ "energy saved by the conditioning intervention" = active_setpoint demand vs free_running demand (= active_setpoint demand, since free_running demand is zero per Brief 69).
- Annotation: "free-floating shows the building with no heating/cooling. The difference between this trace and your current trace is what your systems are doing for you."

**Gate:**
- Bridgewater hot week (mid-July). Toggle free-floating ON — the dashed line rises above the active_setpoint trace by 5–15 °C (Brief 69's vent-off result, 11 °C mean shift). Toggle OFF — overlay disappears.
- Bridgewater cold week (early January). Free-floating dips well below hsp — confirms the heating intervention.
- Build clean.

---

## PART 4 — Walkthrough + close

**One commit (after Chris's browser walk).**

Checklist for the walkthrough:
1. Heatmap renders on Bridgewater + on the Brief 66 office. Tooltip works.
2. KPI strip numbers match a hand sanity-check (e.g. dead-band hour count ≈ Brief 69 gate's 6251 on Bridgewater at default setpoints).
3. Cooling setpoint guard (from earlier today) prevents cooling crossing below heating — confirm the new tab reflects sensible numbers.
4. Click any cell → day view opens.
5. Day view: hsp/csp dashed lines; bars on secondary axis for heating/cooling kW; date chip; total energy.
6. Week view toggle works. Free-floating overlay reveals the sealed-building effect.
7. Switch to active_setpoint with vent on/off — heatmap visibly responds (the Brief 69 headline result becomes visible).
8. Chart export modal works on the heatmap + the day view + the week view (Phase 2 chart export should cover them automatically once they're wrapped via `ChartExportCard`).

On pass: archive this brief to `docs/briefs/archive/70_zone_temp_demand_viewer_COMPLETED.md`, update STATUS.md, copy the next brief to `current.md`.

---

## WHAT MUST NOT HAPPEN

- No engine edits. The demand model is settled (Brief 69); this brief surfaces what it already produces.
- No second temperature path. The free-running overlay must come from a `calculateInstant(... control_strategy='free_running')` call — not a re-derivation inside the React tree.
- No new physics in JSX. CLAUDE.md Rule 1.
- No setting setpoints from the new tab — separate concern, lives in the existing left panel.
- No multi-zone scope creep.
- No shipping without the walkthrough.

---

## WHEN TO ESCALATE (3 approaches then stop)

Hard-stop and report if: heatmap renders incorrectly (wrong cells coloured); the free-running second call produces NaN/empty arrays; clicking cells doesn't trigger the day view (state plumbing broken); or the new tab measurably regresses any existing Systems tab.

---

## FINAL REPORT

- Title + first paragraph quoted.
- Part 1: screenshots of heatmap on Bridgewater + office. KPI tile values.
- Part 2: day-view screenshots for a cold day + a hot day on each building.
- Part 3: week-view + free-floating overlay screenshots showing the Brief 69 sealed-building effect visually (vent on vs vent off, week of July).
- Part 4: walkthrough checklist marked complete or failed-at-item-X.
- Commits (one per part).
- Status per part: "built, gates RUN" or "built, gate FAILED."
- Walkthrough PENDING Chris until §Part 4 ticks.

---

## NOTE

After this brief: the Brief 67/69 demand-model story has a face in the UI. The next likely follow-ups are (a) inline-legacy harmonisation (still uses the old balance method), (b) thermal-mass surfacing (register G3, decisions you can now make off the heatmap data), (c) the Brief 60 Part B / Part C work pending in the task list.

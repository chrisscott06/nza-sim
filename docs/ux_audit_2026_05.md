# NZA-Sim UX Audit — May 2026

**Reference building:** HIX Bridgewater (GIA 3,457 m², 134 rooms, comfort band 21/25°C).
**Scope:** Overview, Weather, Building, Internal Gains, Operation, Systems, Results.
**Method:** Source-level walkthrough (read-only) of each module's JSX, augmented by reference docs `ui_principles.md`, `pavlo_chart_components_investigation.md`, `state_1_engine_divergence_investigation.md`, and the `module_checklists/internal_gains_brief_27.md` close-out.
**Out of scope:** Implementation/code review, physics correctness (parallel audit), visual redesign proposals.
**Score key:** STRONG / OK / WEAK / BROKEN. Recommendation key: KEEP / POLISH / REWORK / REPLACE.

A "Chris-flagged" tag in the Notes column means the row addresses one of the 8 known issues from the Brief 27 walkthrough.

---

## Headline finding

The tool's spine is sound — sidebar workflow ordering, project context, library-as-source-of-truth, the State 1 → State 2 progression in Internal Gains — but four classes of friction are dragging the user out of flow on every walkthrough: (1) **EUI-relative figures are absent** on every gain input despite annual MWh being computed, forcing the user to mental-arithmetic against GIA; (2) the **Live | Simulation engine toggle is unlabelled, unwired, or contradicts itself across modules** (live-engine output silently appears under "Live engine" badges in Internal Gains while Heat Balance has a real working toggle, and the Internal Gains placeholder slot is wired but inert); (3) **terminology leaks** — "Free-running", "envelope-only", "State 1/2", "proportional with spill", "relationship_to_occupancy" — surface model internals as labels; (4) **Internal Gains has 7 tabs of which 3 are redundant or empty**, and one (Heat balance) currently shows the "load a project" empty state on a fully-loaded Bridgewater because of an integration bug in `HeatBalanceView.jsx`. The cumulative effect is a tool that looks finished module-by-module but produces a discordant tour when walked end-to-end.

---

## Top 5 BLOCKING / HIGH severity items

| # | Item | Module | Severity |
|---|---|---|---|
| 1 | Heat balance tab inside Internal Gains shows empty-state on a loaded project (prop-name mismatch — `balance=` passed where `liveData=` expected) | Internal Gains | BLOCKING |
| 2 | No EUI-relative readout (kWh/m²·yr) anywhere in the gain input sections; every magnitude is W/m² or absolute MWh | Internal Gains | HIGH |
| 3 | Engine-toggle inconsistency: Internal Gains canvas shows "Engine toggle inline (Part 11)" placeholder text where a control should be; Building has a working Live/Sim toggle; Operation/Systems/Weather/Overview have no engine concept at all | Internal Gains, Building, cross-module | HIGH |
| 4 | "Free-running" / "envelope-only" / "State 1, State 2" used as user-visible labels in tabs, body copy, and badges; internal model vocabulary surfaced as UI | Internal Gains, Building, Results | HIGH |
| 5 | Internal Gains has 7 canvas tabs — Hourly Profile and Annual Breakdown carry overlapping content; 3D Model is a placeholder; default-load tab is Schedule (correct) but the headline diagnostic (Delta) is tab #2 not #1 | Internal Gains | HIGH |

---

## Dimension 1 — Input/Output separation

Inputs left, outputs centre/right is the canonical pattern.

| Module | Pattern observed | Score | Notes |
|---|---|---|---|
| Overview (/information) | No left-right split. Single-column scrolling page. Inputs (metadata, postcode) and read-only summary cards interleaved top-to-bottom. | OK | Acceptable for a metadata page; deviates from rest of tool. |
| Weather | Read-only — no inputs. Tabs / charts in centre. | STRONG | Correctly no input/output split — nothing to invert. |
| Building | Left inputs (geometry / glazing / shading / openings / fabric / airtightness), centre 3D viewer with a 2-button toggle (3D ↔ Heat Balance). Right results panel removed (consciously). | STRONG | Canonical and works. The 3D ↔ Heat Balance toggle in the centre is the right place for the toggle. |
| Internal Gains | Left inputs (occupancy / lighting / equipment), centre canvas with 7 tabs. | STRONG | Layout is correct. **But:** the canvas-Schedule tab is itself an editor (input surface) — so inputs live in two places (left-panel magnitudes + centre-canvas schedule). This is by design (v2.4 contract) but the centre-canvas Schedule is conceptually an input, not an output. |
| Operation | Single column, max-width 3xl. Three cards stacked vertically: schedule, per-facade openable %, footer cross-link. No output. | WEAK | No live output. User can't see what their schedule choice does to anything without leaving the page. |
| Systems | Left inputs (accordions per demand), centre system schematic/Sankey, right live-results panel (`SystemsLiveResults`). | STRONG | Canonical. |
| Results | Sidebar (status banner + scenario picker + tab list), main content tabs. | STRONG | Read-only by design. |

**Recommendation summary**

| Module | Recommendation |
|---|---|
| Overview | POLISH — separate read-only summaries from editable metadata into distinct visual treatments. |
| Operation | REWORK — add a live preview (free-running temp shift, ventilation losses delta) on the right or below. |
| All others | KEEP |

---

## Dimension 2 — Live feedback on input changes

| Module | Live update on input change? | Loading indicator? | Score | Notes |
|---|---|---|---|---|
| Overview | Yes — checklist re-evaluates immediately. | No (no slow op). | STRONG | |
| Weather | N/A — read-only. | Yes, on weather-file load. | STRONG | |
| Building | Yes — `calculateInstant` re-runs on every input change via useMemo. Heat balance bars animate. | No skeleton. | STRONG | |
| Internal Gains | Yes for `useAnnualGains` aggregates in the left-panel readouts and `useStateComparison` for canvas. **But:** Free-Running canvas redraw waits on `width` (ResizeObserver gated on `ready` — Brief 27 close fix). | None. | OK | Chris-flagged #2: "numbers changing in front of your eyes" — confirmed: `useAnnualGains` and `useStateComparison` are independent memos, can settle at different times. **Chris-flagged #7:** No live update of gain totals when editing inside the centre-canvas Schedule editor that's visibly reflected in the left-panel readouts? — verify visually on next walkthrough; the wiring suggests it should propagate. |
| Operation | Yes — `updateParam` writes back through context. **But:** zero visible feedback — no preview chart, no recompute readout, no count of hours/year windows would be open. | None. | WEAK | User adjusts an openable fraction; nothing on the page changes. |
| Systems | Yes — `SystemsLiveResults` panel updates instantly. | None. | STRONG | |
| Results | After Run Simulation: status banner cycles idle → running → complete. EUI displayed in sidebar. | Yes — `ResultsSkeleton` + sidebar banner. | STRONG | |

**Static (live engine) vs Dynamic (EnergyPlus) confusion** is the cross-cutting issue here:

| Where | What happens | Score |
|---|---|---|
| Building / Heat Balance | Real Live/Sim toggle (`EngineToggle` component), works. Defaults to Live; switches to Sim when only Sim available. | STRONG |
| Internal Gains / Delta, Heat balance, Free-running | `EngineBadge` chip shown — but it's a **label only**, not a toggle. Module shell shows literal text "Engine toggle inline (Part 11)" in the top-right of the canvas as a placeholder. | BROKEN |
| Internal Gains / Hourly profile, Annual breakdown, 3D | No badge, no toggle, source of numbers is implicit. | WEAK |
| Operation / Systems / Weather / Overview / Results | No engine concept exposed. (Results is correctly Sim-only.) | OK |

**Chris-flagged #5:** Confirmed — the Internal Gains canvas shows a literal placeholder string `Engine toggle inline (Part 11)` (`InternalGainsModule.jsx:430-434`), not a control.

**Chris-flagged #8 — engines disagree visibly without explanation:** Confirmed by reading `state_1_engine_divergence_investigation.md`: Live 103.4 / 108.6 MWh vs Sim 130.9 / 5.0 MWh on Bridgewater State 1. No UI surface attributes the divergence to the isotropic-sky residual; `EngineBadge`'s tooltip mentions it but only on hover, and only in Internal Gains. The HeatBalance footer disclosure (`Live engine uses a simplified isotropic sky model — peak summer ...`) does explain it on the Building view but is collapsed by default.

**Recommendations**

| # | Recommendation | Severity |
|---|---|---|
| D2.1 | Wire the Internal Gains engine toggle (Brief 28 Part 3 — already queued). | BLOCKING |
| D2.2 | Add a single canonical "Why these numbers differ" disclosure component, default-open on first session, dismissable, shown anywhere both engines surface. | HIGH |
| D2.3 | Operation: add a small preview (e.g. effective ventilation hours/yr or a 24-hour openness sparkline) so input changes produce visible feedback. | MEDIUM |
| D2.4 | Investigate Chris-flagged #2: confirm whether `useAnnualGains` and `useStateComparison` settle in different RAFs and produce visible flicker. If so, batch into a single memo or stagger displays. | HIGH |

---

## Dimension 3 — Information density and mental arithmetic

| Where | Inputs shown | Derived value missing | Score | Notes |
|---|---|---|---|---|
| Internal Gains / Lighting section | LPD value (W/m²), area_share %, rel-to-occupancy label, annual MWh, peak kW, effective LPD W/m² | **kWh/m²·yr** | WEAK | Chris-flagged #1. Annual MWh shown but not divided by GIA — every project requires the user to do `MWh*1000/3457` mentally. |
| Internal Gains / Equipment section | Same pattern | **kWh/m²·yr** | WEAK | Same. |
| Internal Gains / Occupancy section | Density + basis + rate. Effective = total occupants × rate. | Effective annual occupied hours; effective people-hours/m²/yr | WEAK | "Per_room" basis shows a clarifying sub-note (uses num_bedrooms = N), which is good — but "people/m²" basis gives no per-room context. Chris-flagged: density per_room without showing total occupants is **partially solved** — the "At 100% × rate" readout exists in OccupancySection lines 137–142. |
| Internal Gains / Lighting / area_share % | % shown without absolute m² | Per-profile m² | OK | Easy to compute but worth showing on hover. |
| Internal Gains / Schedules — exception periods | Day fractions in editor | Effective annual hours after exceptions applied | WEAK | User can't tell if their Christmas exception removes 200 or 2000 hours. |
| Building / WWR slider | % per facade | Glazing area (m²) per facade | WEAK | Glazing m² shown in Overview summary but not in the input next to the slider where the decision is being made. |
| Building / Per-element fabric | U-value badge per construction | kWh/m² contribution per element | WEAK | User can see U=0.18 vs U=0.28 but not what that costs in kWh/m²/yr. Heat Balance tab shows it after a click. |
| Building / Airtightness ACH | Text label ("Good", "Leaky") | kWh/yr or kWh/m²/yr from infiltration | WEAK | The Heat Balance shows fabric_leakage in kWh — wire the value into the input control hint. |
| Operation / Per-facade openable % | % only | Effective ventilation hours/yr at the current schedule | WEAK | |
| Systems / LPD slider | W/m² | kWh/yr or kWh/m² | WEAK | Same Chris-flagged #1 issue here. |
| Systems / SCOP/SEER input | Efficiency number | Annual delivered kWh saved by moving 0.1 on the slider | OK | Industry-standard reading. |
| Results / OverviewTab | EUI kWh/m² shown. | — | STRONG | This is the one place EUI lives. |
| Weather | HDD/CDD shown at multiple bases (good). | Project HDD relative to typical-year benchmark. | OK | Benchmark dictionary exists (`HDD_BENCHMARKS_18C`) but it isn't surfaced as "your project HDD is high/low vs London". |

**Recommendations**

| # | Recommendation | Severity |
|---|---|---|
| D3.1 | Add kWh/m²·yr next to MWh in every gain section's live readout (Occupancy, Lighting, Equipment). | HIGH (Chris-flagged #1) |
| D3.2 | Surface glazing m² next to each WWR slider. | MEDIUM |
| D3.3 | Add per-construction kWh/m²·yr contribution badge next to the U-value badge. | MEDIUM |
| D3.4 | Surface the post-exception effective annual hours on each schedule (a single line under the heatmap is sufficient). | MEDIUM |
| D3.5 | Operation: show effective open hours/yr and resulting ventilation kWh from the current schedule. | MEDIUM |

---

## Dimension 4 — Jargon and terminology

| Term | Where used | Audience meaning | Plain-language alternative | Notes |
|---|---|---|---|---|
| "Free-running" | Internal Gains tab; FreeRunningView title; Building HeatBalance label; many tooltips | Industry term, ~25% of energy consultants recognise | "Zone temperature (no heating/cooling)" | Chris-flagged #6. Title + tab label + body copy. |
| "Live engine" / "Simulation" | EngineBadge component (`live` / `Simulation`); HeatBalance EngineToggle | Internal — "Live" = JS in-browser instantCalc; "Simulation" = EnergyPlus. | "Static" / "Dynamic" (per Chris) — or "Instant estimate" / "Full simulation" (more self-explanatory). | Rename in flight. Surviving instances: `EngineBadge.jsx` text + tooltip; `HeatBalance.jsx` EngineToggle; comments + JSDoc throughout. |
| "Envelope-only" / "State 1" / "State 2" | DeltaView labels ("State 1 (envelope only)" / "State 2 (with gains)"); Internal Gains tab "State 1 → State 2"; HeatBalance mode prop; module headers ("— State 2 contract" in Internal Gains header) | Internal contract vocabulary. End user does not know what State 1 vs State 2 means. | "Envelope alone" / "Envelope + internal gains" — already partially used in DeltaView body. Drop "State 1/2" from tab labels and headers entirely; keep in code only. | Module header literally shows `— State 2 contract` to the user. |
| "WWR" | Building / Glazing section header | Industry standard; ~70% recognise | "Window area" or "Glazing fraction"; tooltip explaining "WWR = Window-Wall Ratio" | Acceptable for energy consultants but no in-tool explanation. |
| "EUI" | Results, Overview, Information | Industry standard; ~80% recognise. | "Energy Use Intensity" expanded on first appearance. | Acceptable. |
| "ACH" | Building / Airtightness | ~60% recognise. | "Air changes/hour" once. | Tooltip would suffice. |
| "U-value" | Building / Fabric | ~85% recognise. | Keep. | Standard. |
| "SCOP", "SEER" | Systems | ~70% recognise. | Tooltip with one-line explanation. | |
| "Proportional with spill" | Lighting / Equipment profile detail line (`REL_LABELS` in LightingSection) | Internal — model parameter for relationship_to_occupancy. | "Tracks occupancy + small overshoot" | Surfaces in profile-detail text. |
| "Daylight factor" | Equipment / Lighting profile settings | Standard term among lighting designers. | Keep — but tooltip. | |
| "Relationship to occupancy" | Lighting / Equipment profile editor | Verbose; raw parameter name. | "How it follows occupancy" | |
| "TMYx", "TMY", "DSY", "HDY" | Weather module | Specialist. | Tooltip + the existing methodology badge is doing the work — STRONG already. | KEEP — this is one of the best-explained jargon places in the tool. |
| "Ideal Loads" | Systems module mode toggle | EnergyPlus internal. | "No-systems demand mode" / "Theoretical demand" | Acceptable to keep but tooltip recommended. |
| "Y-factor" | Construction Inspector | Industry. | Tooltip. | |
| "Bivalent" | Systems / Space heating "+ Add secondary (bivalent)" button | Industry. | "Add backup heating system" | |
| "Heat balance" | Multiple modules; canvas tab; Results tab | Industry term, reasonably plain. | Keep. | |

**Recommendations**

| # | Recommendation | Severity |
|---|---|---|
| D4.1 | Coordinate the Live→Static, Simulation→Dynamic rename across `EngineBadge.jsx` text, `HeatBalance.jsx` EngineToggle labels, and tooltip strings in one pass. | HIGH |
| D4.2 | Rename "Free-running" to "Zone temperature (unconditioned)" or similar; keep the term only in tooltips or as a footnote. | HIGH (Chris-flagged #6) |
| D4.3 | Drop "State 1/2" from any user-facing label. Replace `— State 2 contract` in the Internal Gains module header. Keep "Envelope alone / Envelope + gains" wording. | HIGH |
| D4.4 | Add tooltips to WWR, ACH, EUI, SCOP, SEER, Y-factor, Ideal Loads on first appearance per module. | MEDIUM |
| D4.5 | Replace `REL_LABELS` values with end-user phrasings. | LOW |

---

## Dimension 5 — Visual hierarchy

| Module | Headline number identifiable? | Eye competes? | Score | Notes |
|---|---|---|---|---|
| Overview | Summary cards are equally weighted — Building, Systems, Profiles, Consumption, Simulation. Simulation status doesn't get any visual privilege despite being the "did it work" answer. | Yes — five cards with identical treatment. | OK | The status banner in Results sidebar carries the answer; the Overview cards repeat it without emphasis. |
| Weather | Methodology badge prominent (good — coloured pill). Annual stats grid. | No. | STRONG | |
| Building | 3D viewer dominates the centre. Inputs uniformly compact in the left rail (good density). U-value badges colour-coded (green/amber/red) — meaningful. | The Heat Balance toggle is small — easy to miss. | STRONG | |
| Internal Gains / Delta tab | Heating + Cooling bar pair is the headline; delta arrow + colour next to it. | Good — the headline is clear. | STRONG | One of the cleanest views in the tool. |
| Internal Gains / left panel | Three section accents (occupancy, lighting, equipment colours) — visually distinct. Live readout uses border-l-2 colour cue. | No. | STRONG | |
| Internal Gains / Free-running canvas | Three stat cards (annual mean, winter min, summer max) above the trace — good. State 1 trace in grey, State 2 in accent — clear hierarchy. | No. | STRONG | |
| Internal Gains / Hourly profile | Stacked bar; gains type colour-coded; legend bottom. | No. | OK | Day-type buttons + month picker are equally weighted to the chart title — fine. |
| Operation | Three uniformly-weighted cards stacked. Nothing is the answer; there's no answer here. | N/A — no output. | WEAK | |
| Systems | Accordion summary lines are compact and informative ("Gas Boiler · 92% eff + secondary"). System schematic + live results panel work together. | No. | STRONG | |
| Results / Overview | EUI is the headline. Tab list left, content right. | No. | STRONG | |

**Recommendations**

| # | Recommendation | Severity |
|---|---|---|
| D5.1 | Operation: redesign to have a single dominant output (e.g. annual venting kWh, or zone temp shift) so the page has a focal point. | MEDIUM |
| D5.2 | Overview: give Simulation status card visual privilege (taller, accent border) — it's the "is the model run" answer. | LOW |

---

## Dimension 6 — Cross-module consistency

Walking the modules side by side reveals where the same pattern is treated differently.

| Pattern | Overview | Weather | Building | Internal Gains | Operation | Systems | Results | Consistent? |
|---|---|---|---|---|---|---|---|---|
| Section bounding box | SectionCard (white, rounded-xl, border-light-grey) | N/A | CollapsibleSection (accent header, ▾/▸ chevron) | CollapsibleSection (accent header, ▾/▸ chevron) — same component pattern | bg-white rounded-xl border, no accent header | AccordionSection (accent header, summary line, ▾/▸) | Tab-internal, no consistent treatment | **NO** — at least 3 different section styles in use. |
| Tab strip | None | Custom tab buttons (selectedVar) | Two-button centre toggle (3D / Heat Balance) | Bottom-border underline accent, centred, 7 tabs | None | None | Sidebar vertical tab list with left-bar accent + active background | **NO** — five distinct tab idioms across the tool. |
| Input control style | Tailwind native inputs, rounded-lg, focus:border-teal | N/A | Custom `NumberInput`, `WWRSlider`, `CompassRose`; sliders with text width-aligned values | `NumField`, `PercentSlider`, `SelectField` — similar but separate components | Native select + native range; no shared component | `SliderWithNumber`, `CompactSelect`, `Toggle` | Native inputs in scenario picker | **PARTIAL** — building and gains diverge from operation. |
| Heat Balance display | N/A | N/A | Embedded HeatBalance (mode=envelope-only) | Embedded HeatBalance (mode=envelope-gains) — **broken**: passes `balance=` not `liveData=` | N/A | N/A | HeatBalanceTab (mode=full) | **NO** — one component, three modes, three call sites, one of which is broken. |
| Engine toggle placement | N/A | N/A | Inline in HeatBalance header (right side, next to unit/layout) | Module-shell top-right of canvas — but as placeholder text, not a control | N/A | N/A | N/A in Results | **NO** |
| Colour scheme (module accent) | Building #A1887F · Systems #00AEEF · Profiles #8B5CF6 · Consumption #2D6A7A · Sim #2B2A4C | Cloud blue palette | #A1887F (warm earth) | #EA580C (orange) | #0E7490 (cyan-700) | #00AEEF | Tab-content driven | **PARTIAL** — Overview's "Profiles" card still uses #8B5CF6 even though /profiles is deleted; sidebar uses moduleThemes lookup which should be canonical. |
| Loading states | None | Loading text placeholder | None | "Loading constructions library…" or "Waiting for weather…" inline | None | "Loading…" in dropdown items | ResultsSkeleton (animate-pulse) | **NO** — four loading idioms. |
| Empty states | "—" in stat cells | "Assign a weather file…" | N/A | "Waiting for engine…" or "no data — load a project" (broken) | N/A | N/A | Status banner in sidebar ("No simulation run") | **PARTIAL** |
| Module header | Section card with metadata | Inspector header with badge | Top-3px coloured border + accent text "Building" + subtitle | 1px coloured strip + Flame icon + bolded title + subtitle text | Top-3px coloured border + accent text "Operation" + subtitle | Top-3px coloured border + accent text "Systems" | Sidebar header (caption + project name) | **NO** — three header idioms. |
| Footer / cross-link strip | Checklist | None | None | None | Cross-link card | None | None | **NO** |
| Resizable columns | None | None | Yes (`ResizeHandle`, localStorage `nza-building-layout`) | Yes (same pattern, localStorage `nza-gains-layout`) | None | None | None | **PARTIAL** — only Building and Internal Gains. |

**Canonical recommendations (where to converge)**

| Pattern | Canonical | Rationale |
|---|---|---|
| Section bounding box | Internal Gains' `CollapsibleSection` (accent header + ▾/▸) | Most informative; accent identifies the concept; works collapsed or expanded. |
| Tab strip | Internal Gains' centred bottom-underline accent | Cleanest visual; consistent with the active-module-accent pattern. |
| Input control style | Pull `NumField` / `PercentSlider` / `SelectField` from Internal Gains into a shared `components/ui/` set; replace per-module reimplementations. | Already the cleanest set in the tool. |
| Heat Balance | Single `HeatBalance` component with consistent `mode` prop. Fix the Gains call site. | Already exists; integration bug only. |
| Engine toggle | `EngineToggle` from HeatBalance (used in Building view). | Already works; lift to a shared component. |
| Module header | Top-3px accent strip + accent-coloured title + subtitle. Already the dominant pattern; Internal Gains should adopt. | 3 of 5 input modules already conform. |
| Resizable columns | The shared ResizeHandle pattern is identical between Building and Internal Gains. Lift into `components/layout/`. | Two copies of the same code today. |

**Recommendations**

| # | Recommendation | Severity |
|---|---|---|
| D6.1 | Single shared `EngineToggle` component (canonical Static/Dynamic labels) used everywhere both engines surface. | HIGH |
| D6.2 | Single shared `SectionCard` / `CollapsibleSection` component; deprecate per-module copies. | MEDIUM |
| D6.3 | Single shared `ModuleHeader` component (top-3px accent strip + title + subtitle + breadcrumb). | MEDIUM |
| D6.4 | Lift `ResizeHandle` to `components/layout/`. | LOW (purely DRY; visual is already consistent.) |
| D6.5 | Audit `accentForPath` (moduleThemes.js) against current sidebar — Profiles route is deleted but the colour likely lingers in `InformationModule.jsx`. | LOW |

---

## Dimension 7 — Mental model communication

| Question | Where answered | Score | Notes |
|---|---|---|---|
| 30-second comprehension on first open? | Overview is the landing if a project is loaded; sidebar order communicates flow (Overview → Weather → Building → Internal Gains → Operation → Systems → Results). | OK | Sidebar flow is good. Overview itself doesn't explain the flow. |
| State 1 / State 2 communicated visually? | Internal Gains' Delta view labels bars "State 1 (envelope only)" / "State 2 (with gains)" — uses the term. | WEAK | Term itself is the issue (see D4). The concept of building up complexity in layers is communicated by the sidebar order — but never narrated. |
| Provenance (which engine produced this number) visible? | EngineBadge in Internal Gains canvas views; EngineToggle in Building HeatBalance; nowhere else. | PARTIAL | Results module's numbers are EnergyPlus-only and that's not labelled either. |
| Model limitations disclosed? | HeatBalance has a collapsible disclosure ("Live engine uses a simplified isotropic sky model — peak summer max may sit above EnergyPlus by ~8°C"). FreeRunningView has a one-line footnote referencing `docs/state_2_part2_verification.md`. | PARTIAL | Disclosed once, deeply technical, references docs paths the user can't open. |
| Does "I changed X" make causal mechanism clear? | Building module: yes — change WWR, see solar gain bar move. Internal Gains: yes — change LPD, see Delta bars move. | STRONG | Where causal mechanism is computed live, it works. |

**Recommendations**

| # | Recommendation | Severity |
|---|---|---|
| D7.1 | Add a one-sentence model-progression strip to Overview ("This tool builds the model in layers: envelope → gains → operation → systems"). | LOW |
| D7.2 | Single "About these numbers" expandable panel per module that includes engine source, model limitation summary, and "open in browser" link to the canonical reference. | MEDIUM |
| D7.3 | Add a Sim-engine label to Results headers so the user knows those numbers are EnergyPlus, not Live. | LOW |

---

## Dimension 8 — Tab / canvas structure

### Internal Gains — 7 tabs

| # | Tab | Purpose | Overlapping with? | Default content present? | Recommendation |
|---|---|---|---|---|---|
| 1 | Schedule (context-sensitive) | Edit the active gain's schedule | — | Yes (drag-paint editor) | KEEP — this is the workspace. |
| 2 | State 1 → State 2 (Delta) | Headline diagnostic; engine toggle | — | Yes | KEEP, **rename**: "Impact" or "What gains change". Make this the default-load tab instead of Schedule. |
| 3 | Heat balance | Annual gains + losses in PHPP style | Delta (totals) | **BROKEN** — empty state on loaded project (Chris-flagged #3) | **FIX** + KEEP. |
| 4 | Free-running | Annual hourly temperature trace | Hourly profile (different axis but overlapping concept) | Yes (canvas trace) | KEEP — distinct content. |
| 5 | Hourly profile | Stacked bar per-hour for typical day | Annual breakdown (different aggregation) | Yes | CONSOLIDATE with Annual breakdown into "Profiles" with a time-scale toggle. |
| 6 | Annual breakdown | Per-profile monthly bars | Hourly profile | Yes (assumed — not read) | CONSOLIDATE with Hourly profile. |
| 7 | 3D Model | Placeholder | — | **Placeholder only** | REMOVE until populated. |

**Chris-flagged #3 (Heat balance empty state):** Confirmed root cause. `HeatBalanceView.jsx:45` calls `<HeatBalance balance={state2} mode="envelope-gains" />` but `HeatBalance` expects `liveData` / `simulationData` props (`HeatBalance.jsx:488–490`). With both undefined, `data` resolves to undefined and `HeatBalance.jsx:547–555` renders the "load a project" empty state. Fix is one-line: rename the prop or update the integration.

**Chris-flagged #4 (7 tabs feel too many):** Confirmed. Recommended consolidated structure (5 tabs):

| # | Tab | Replaces |
|---|---|---|
| 1 | Schedule (workspace) | Tab 1 unchanged |
| 2 | Impact | Tab 2 (renamed) — DEFAULT |
| 3 | Heat balance | Tab 3 (fixed) |
| 4 | Profiles | Tabs 4+5+6 (Free-running, Hourly profile, Annual breakdown) with a time-scale toggle: Daily / Monthly / Annual |
| 5 | — | Tab 7 (3D) removed |

This is consistent with Brief 28 Part 5 (shared `TimeSeriesCanvas`) — the consolidation is in flight.

### Building — 2 centre views

| View | Score | Notes |
|---|---|---|
| 3D Model | STRONG | The 3D viewer is real, dominant. |
| Heat Balance | STRONG | Embedded HeatBalance with envelope-only mode. |

KEEP both. Two views is the right number.

### Results — 7 tabs

| Tab | Score | Notes |
|---|---|---|
| Overview | STRONG | EUI headline + summary. |
| Heat Balance | STRONG | Full-mode HeatBalance. |
| Energy Flows | STRONG | Sankey. |
| Monthly Energy | STRONG | Bar chart. |
| Load Profiles | STRONG | Time series. |
| Fabric Analysis | OK | Specific use. |
| CRREM & Carbon | OK | Specific use. |

KEEP. 7 here is fine because they are non-overlapping output views, not editor surfaces.

### Weather — tabs/charts

KEEP.

### Operation / Overview / Systems — no canvas tabs

Operation: no tabs. Add at least one preview chart (Dimension 2 recommendation).

**Recommendations**

| # | Recommendation | Severity |
|---|---|---|
| D8.1 | Fix the `balance=` → `liveData=` prop wiring in `HeatBalanceView.jsx`. | BLOCKING (Chris-flagged #3) |
| D8.2 | Consolidate Free-running + Hourly profile + Annual breakdown into a single "Profiles" tab with a time-scale toggle. | HIGH (Chris-flagged #4) |
| D8.3 | Remove or hide the 3D Model tab in Internal Gains until it has content. | HIGH (Chris-flagged #4) |
| D8.4 | Default-load Internal Gains to the Impact tab (renamed Delta). | MEDIUM |
| D8.5 | Rename "State 1 → State 2" tab to "Impact". | MEDIUM |

---

## Dimension 9 — Specific recurring issues

### Stale cache / state

| Repro | Steps | Observed | Score |
|---|---|---|---|
| Internal Gains "numbers flickering" | Load Bridgewater. Edit LPD on first lighting profile. Watch left-panel readout + Delta tab. | Two memos (`useAnnualGains`, `useStateComparison`) may settle in separate frames. Chris-flagged #2. | OK (needs visual verification — code structure permits flicker) |
| Building / WWR change | Change WWR on south facade. | Heat balance updates immediately. 3D viewer updates. | STRONG |
| Engine confusion in Internal Gains | Look at Delta view, then click Heat balance tab. | Both badges say "Live engine". No way to switch. | WEAK (Chris-flagged #5) |
| Sim-only Results vs Internal Gains badge | Run a simulation. Visit Results (no engine label). Visit Internal Gains (badge says Live). | User can't tell what produced Results' EUI vs the badge'd Live engine in Internal Gains. | WEAK |

### Loading states

| Repro | Steps | Observed | Score |
|---|---|---|---|
| Internal Gains first-load with library not cached | Hard refresh on /gains | "Loading constructions library…" text in Delta view | OK |
| Results during simulation | Click Run Simulation | Sidebar banner cycles + skeleton in main area | STRONG |
| Building during input edit | Change any input | No skeleton — instantCalc is sub-second | OK |
| Weather file change | Pick a different weather file | "Loading" text, then chart redraws | OK |
| Save status | Edit anything on any module | TopBar (not audited in detail) shows saveStatus per ProjectContext | (Not verified) |

### Error states

| Repro | Steps | Observed | Score |
|---|---|---|---|
| EnergyPlus fail | Run simulation with intentionally invalid setup | Results sidebar: red "Simulation failed" + error text | STRONG |
| Invalid input | Type 999 into a clamped field (e.g. window count) | WindowCountInput clamps on commit; LouvreAreaInput likewise. | STRONG |
| Zero-area-share profile | Set all profiles' area_share to 0 in Internal Gains | (Behaviour not verified — useAnnualGains may return zero MWh; no explicit warning) | WEAK |
| No project loaded | Visit /building before picking a project | Likely empty params; instantCalc returns zeros or null | OK |

### Auto-simulate clarity

The user manually triggers EnergyPlus via the top-bar Run Simulation button. There is no auto-simulate. Live engine updates continuously. This is **correctly** clear — top bar is the only entry point — but the relationship between Live (auto) and Simulation (manual) is not narrated anywhere.

**Recommendations**

| # | Recommendation | Severity |
|---|---|---|
| D9.1 | Verify on a walkthrough whether Internal Gains shows multi-pass flicker on input change. If so, batch memos. | HIGH (Chris-flagged #2) |
| D9.2 | Add a warning state when all gain profiles have area_share = 0 (or when sum > coverage in a way that wasn't intended). | LOW |
| D9.3 | Narrate the Live/Sim relationship: "Live updates on every change. Click Run Simulation in the top bar to refresh the full EnergyPlus run." Display once on first visit, dismiss. | LOW |

---

## Dimension 10 — The Pavlo benchmark (time-series viz)

NZA-Sim's time-series is fragmented across three tabs (Free-running, Hourly profile, Annual breakdown). Pablo's Load Inspector consolidates equivalent views via shared primitives: `ChartContainer`, `ZoomNav`, `MonthJumpButtons`, `DataCard`, `chartTokens.js`. Detail in `docs/pavlo_chart_components_investigation.md`.

| Feature | NZA-Sim current | Pavlo | Recommendation |
|---|---|---|---|
| Time zoom (period buttons 1d / 7d / 14d / 30d / Q / 6m / Year) | None — fixed annual canvas in Free-running; fixed 24h in Hourly profile | `ZoomNav` with period buttons | Adopt. Brief 28 Part 4 — already planned. |
| Date scrubbing (◄ ► to move window) | None | `ZoomNav` start-day scrubbing | Adopt. |
| Month picker | Hourly profile has a `<select>` month picker. Free-running has none. | `MonthJumpButtons` (12 buttons + All) | Adopt — replace native select with chip buttons. |
| Stat panel (Annual mean / Winter min / Summer max / etc.) | Free-running has three stat cards above the trace | `DataCard` — uniform style | Adopt the DataCard component for consistency. |
| Multi-series display (State 1 + State 2; or per-profile) | Yes — but custom Canvas drawing per view | Recharts-based, composable | Use Recharts with `chartTokens` style objects. |
| Unit toggle (kW / kWh / kWh-m2) | HeatBalance has a unit toggle (kWh / kWh/m²); time-series views don't | Pablo has £/kWh / kWh toggles | Add unit toggle to time-series views. |
| Chart container with title + optional export | Custom div per view; no export | `ChartContainer` (incl. print modal) | Adopt stripped lift (no jsPDF dep) per Pavlo investigation. |

**Patterns to adopt** (already queued as Brief 28 Part 4):

1. `ChartContainer` (stripped, no export modal) — uniform chart card.
2. `ZoomNav` — time-period selection + scrub.
3. `MonthJumpButtons` — month picker.
4. `DataCard` — uniform stat card.
5. `chartTokens.js` — Recharts style objects.

**Recommendation:** Execute Brief 28 Part 4 as scoped. No additional Pavlo work to suggest.

---

## Cross-cutting prioritised improvements

| # | Issue | Module(s) | Severity | Effort | Brief / scope |
|---|---|---|---|---|---|
| 1 | Heat balance tab empty-state on loaded Bridgewater (prop name mismatch) | Internal Gains | BLOCKING | S | One-line fix in `gains/canvas/HeatBalanceView.jsx` — pass `liveData={state2}` (or update HeatBalance to accept `balance`). New brief required: Brief 28 hotfix or Brief 28 Part 3 prerequisite. |
| 2 | Engine toggle placeholder text on Internal Gains canvas | Internal Gains | BLOCKING | M | Brief 28 Part 3 (already scoped). |
| 3 | Inconsistent engine vocabulary ("Live engine" / "Simulation" still in code; rename to "Static" / "Dynamic" not yet done) | All modules with engine concept | HIGH | S–M | Brief 28 — add a label-rename sweep alongside Part 3 toggle wiring. |
| 4 | No kWh/m²·yr next to gain inputs (annual MWh present, EUI-relative missing) | Internal Gains | HIGH | S | New brief required: Internal Gains polish — add derived `kwh_per_m2_yr` field to live readout. |
| 5 | "Free-running" / "State 1, State 2" / "envelope-only" surfaced as labels | Internal Gains, Building, HeatBalance | HIGH | M | New brief required: terminology pass. Coordinates with #3. |
| 6 | Internal Gains has 7 tabs; redundancy across Free-running / Hourly / Annual; placeholder 3D | Internal Gains | HIGH | M | Brief 28 Part 5 (canvas restructure) + remove 3D placeholder. |
| 7 | Operation module has no live output | Operation | HIGH | M | New brief required: Operation v2 (Brief 30 already queued for State 2.5; this should be merged into that scope). |
| 8 | Live vs Simulation divergence undisclosed in the views where they disagree | Building, Internal Gains | HIGH | S | New brief: add a single "Why these numbers differ" disclosure component, used everywhere both engines surface, default-open on first project load. |
| 9 | Cross-module visual inconsistency (3 section-card styles, 5 tab idioms, 3 header styles) | All input modules | MEDIUM | L | New brief required: cross-module visual conformance pass. Defer to after the in-flight component lifts (Brief 28). |
| 10 | Profiles route deleted but referenced from Overview + Operation cross-link | Overview, Operation | MEDIUM | S | Small cleanup — delete Profiles SummaryCard in `InformationModule.jsx` and the `Profiles` cross-link in OperationModule. |
| 11 | "Numbers flicker" on input change — multi-memo settle timing | Internal Gains | MEDIUM | M | New brief: batch `useAnnualGains` + `useStateComparison` into a single hook returning both. |
| 12 | No tooltips on WWR / ACH / EUI / SCOP / SEER / Y-factor / Ideal Loads | Building, Systems | MEDIUM | S | Lightweight pass; can be done in a single morning. |
| 13 | Glazing m² missing next to WWR slider; per-construction kWh/m² missing next to U-value badge | Building | MEDIUM | S | New brief: Building polish — surface derived areas + kWh contribution inline. |
| 14 | No effective annual hours surfaced after schedule exceptions | Internal Gains / Schedule editor | MEDIUM | S | Add a single derived line under the heatmap. |
| 15 | Weather HDD benchmark dictionary defined but not surfaced | Weather | LOW | S | One paragraph addition. |
| 16 | Overview Simulation status card visually equal-weighted to inputs cards | Overview | LOW | S | Add accent border or enlarge. |
| 17 | EngineBadge tooltip references doc paths the user can't open | Internal Gains | LOW | S | Replace with a friendlier "one engine is fast and approximate; the other is slow and rigorous; they sometimes disagree on solar by ~30%". |
| 18 | Ideal Loads vs Detailed toggle has no tooltip explaining what bypassing real HVAC means | Systems | LOW | S | Tooltip. |
| 19 | "Internal Gains" header reads `— State 2 contract` to the user | Internal Gains | LOW | S | Drop that text. |
| 20 | Sidebar / accentForPath mapping should be verified post-Profiles-deletion | Sidebar / Information | LOW | S | Audit colour token usage. |

---

## Self-improvement review pass

Performed after first draft. Adjustments made:

| Check | Finding | Adjustment |
|---|---|---|
| Contradictory recommendations | Recommendation D3.1 (add kWh/m²·yr next to inputs) and the UI principle #1 (cards match content not container) could conflict if a card grows too tall. | Confirmed compatible — a 3-line readout (Annual / Peak / kWh-m2) still fits the existing live readout box. |
| Same severity calibration | Initial draft had nine HIGH items. Reviewed each. Demoted three to MEDIUM (#9 visual conformance is real but large effort; #11 flicker is unconfirmed; #12 tooltips are quick wins but not user-blocking). Kept two BLOCKING (#1 broken heat-balance, #2 placeholder toggle). | Severity now: 2 BLOCKING, 6 HIGH, 7 MEDIUM, 5 LOW. |
| Recommendations specific enough to act on? | D4.2 originally said "Rename Free-running". Specified target language and where (tab + view title + body — keep in tooltip footnote). | Added concrete strings. |
| Internal coherence | Cross-checked D6.1 (single `EngineToggle`) against D2.1 (wire the Internal Gains toggle). D6.1 supersedes D2.1 — wiring the toggle should *use* the shared component, not re-implement. | Reconciled — D6.1 is the canonical recommendation; D2.1 becomes "use D6.1's component to satisfy Brief 28 Part 3". |
| Chris-flagged issue coverage | Verified all 8 issues are explicitly tagged in the matrices. | #1 EUI: D3.1 / row #4. #2 flicker: D9.1 / row #11. #3 heat balance empty: D8.1 / row #1. #4 7 tabs: D8.2-D8.3 / row #6. #5 toggle placeholder: D2.1 / row #2. #6 Free-running: D4.2 / row #5. #7 no live update of gain totals: noted in D2 row but needs visual verification. #8 engines disagree: D2.2 + D7.2 / row #8. |
| Over-page? | First draft was on track for ~14 pages — within target. | Within band. |

---

## Follow-up items (out of audit scope; flag only)

Items I noticed but did not chase, per the brief:

1. The shared in-flight library-fetch promise in `useStateComparison.js` is module-level (`let _libraryDataPromise`); fine for now, but if the library is ever invalidated mid-session, the cache won't refresh. Probably worth a TTL or invalidation hook in Brief 28.
2. `BuildingDefinition.jsx` carries memo state for WWR / shading / louvre values that resets on remount. Not a UX issue today, but if a future brief adds a "reset to defaults" affordance, it should clear those memos too.
3. The `LiveResultsPanel` was removed from Building intentionally per Brief 24, but its absence leaves the Building module without a dedicated "what's the EUI right now" display. The Heat Balance toggle covers this. Worth verifying user expectations.
4. `decomposeHour` is called in a tight loop inside `HourlyProfileView`'s `useHourlyDayAverage` — performance is acceptable but a memo of decomposed-hour metadata at weather-load time would future-proof.

None of the above should expand this audit's scope.

---

## Appendix — Module entry points verified

| Route | File | Status |
|---|---|---|
| `/information` (Overview) | `frontend/src/components/modules/InformationModule.jsx` | exists |
| `/weather` | `frontend/src/components/modules/WeatherModule.jsx` | exists |
| `/building` | `frontend/src/components/modules/building/BuildingDefinition.jsx` | exists |
| `/gains` | `frontend/src/components/modules/gains/InternalGainsModule.jsx` | exists |
| `/operation` | `frontend/src/components/modules/OperationModule.jsx` | exists |
| `/systems` | `frontend/src/components/modules/SystemsZones.jsx` (route name is /systems) | exists |
| `/results` | `frontend/src/components/modules/results/ResultsDashboard.jsx` | exists |
| `/profiles` | — | deleted (Brief 27 Revised Part 11) |

# Brief 28: Solar Diagnostic Views for the Building module

BEFORE DOING ANYTHING:
1. Read `CLAUDE.md`
2. Read `docs/state_contracts.md` — every view here lives in State 1 (Building module). Outputs must respect the State 1 `inputs_used` list.
3. Read `STATUS.md`
4. Read `docs/briefs/Brief_26_State_1.md` — this brief assumes Brief 26 has landed (geometry fix, envelope-only physics, free-running zone temperature).
5. Read `docs/briefs/Brief_27_Systems_Inspectors.md` — this brief lands AFTER 27 in the queue but does not depend on its outputs.
6. Look at `frontend/src/components/modules/building/BuildingViewer3D.jsx` — the existing 3D solar overlay ("Solar on" button) lives here. Several of the parts below extend it.
7. One part at a time. Verify in browser at 1440×900. Commit. Push.

---

## Context

After Brief 26 Part 2.5 fixes the 3D viewer / live calc axis-convention mismatch, the building's per-facade solar gain will be correct end-to-end (live calc, EnergyPlus, and 3D solar tint all agree). At that point the user can **trust** the solar numbers — but there's still no fast visual way to confirm them.

This brief adds **solar diagnostic views** to the Building module. Each one is a visualisation of data the live engine already computes per-facade, per-hour, so cost is mostly UI work. They have two purposes:

- **User-facing:** confirms location + orientation + glazing strategy are working the way the user expects (immediate visual feedback while sliding WWR or rotating the building).
- **Validation tool:** any future solar physics change (e.g. real `Daylighting:Controls`, multi-zone shading, AFN coupling) gets a built-in regression visual. A diff in the bar chart or sun path is much faster to spot than a diff in a Sankey number.

Scope is State 1 (envelope-only) — no Operation-mode operable-window flow, no Systems-mode setpoint coupling. Reads `building_config` + EPW directly.

---

## Part 1 — Annual solar per facade bar chart (Priority 2 in user note; brought forward as the cheapest, highest-validation-value view)

The single bar chart that pays back the most diagnostic time. Annual integrated solar irradiance per facade in kWh/m²·yr (per-area, not totals — totals are already in the Heat Balance). Compare against UK norms:

| Facade direction | Expected annual irradiance (vertical surface) |
|---|---:|
| South | ~700 kWh/m²·yr |
| SE / SW | ~600 kWh/m²·yr |
| East / West | ~480 kWh/m²·yr |
| NE / NW | ~350 kWh/m²·yr |
| North | ~250 kWh/m²·yr |

### What lands

- New panel below the Building module's centre canvas (toggle: 3D Model / Heat Balance / **Solar Diagnostics**) or as an expandable section under Heat Balance.
- Horizontal bar chart, 4 rows (F1–F4), each labelled `F1 — NE  ·  768 m² wall  ·  42°`.
- Bar fill shows annual kWh/m²·yr (per-area). Bar length scales to the F-with-the-highest-value, so the user instantly sees which facade is dominant.
- A faint reference line at the UK-norm value for each facade's compass direction (interpolated from the table above). Helps spot anomalies.
- Tooltip on hover: `Annual incident: 612 kWh/m²·yr  ·  Glazing area: 768 m²  ·  Total through glazing: 235 MWh/yr  ·  g-value: 0.60`.

### Files
- `frontend/src/components/modules/building/SolarPerFacadeBar.jsx` (new)
- Wire into `BuildingDefinition.jsx`'s centre canvas

### Verification

Bridgewater at orientation 42° after Brief 26 Part 2.5 lands:
- F1 NE (short, WWR=0): bar shows incident ~400 kWh/m²·yr (per-area), zero through glazing
- F2 SE (long, WWR=1): incident ~620, through glazing ~470 MWh/yr
- F3 SW (short, WWR=1): incident ~640, through glazing ~120 MWh/yr
- F4 NW (long, WWR=1): incident ~370, through glazing ~280 MWh/yr

If any per-area value falls more than ±20% off the reference line for its compass direction, something physics-level is wrong — investigate before continuing.

### Commit
`Brief 28 Part 1: annual solar per facade bar chart with UK-norm reference lines`

---

## Part 2 — Sun path diagram with facade overlays

The classic stereographic sun path projection. Shows the analemma + hour rays + each facade as a wedge showing its solar window.

### What lands

- New tab/panel below the 3D Model, or as a permanent overlay in the Solar Diagnostics view.
- Stereographic projection (north up, observer-centred). Sun rays for solstices (Jun 21 / Dec 21) + equinoxes (Mar 21 / Sep 21), with hour markers (06 / 09 / 12 / 15 / 18).
- Latitude is read from `weatherData.location.latitude` — projection updates if the user changes weather file.
- Each facade rendered as a coloured wedge on the projection: the arc of sun positions that strike it directly (azimuth ± 90° from facade normal, clipped to above-horizon hours).
- Wedge colour matches the corresponding solar gain colour from the Heat Balance Sankey (south = amber, north = warm yellow per `balanceColours.js`).
- Hover a wedge → highlights the facade in the 3D viewer (cross-link).
- Annotations: "Yeovilton, Somerset · 51.0°N" prominently displayed.

### Files
- `frontend/src/components/modules/building/SunPathDiagram.jsx` (new)
- `frontend/src/utils/sunPosition.js` (new — solar position algorithm; NREL SPA simplified)

### Verification

For Bridgewater (51.0°N, orientation 42°):
- South wedge spans from ~60° east of south (morning) to ~60° west of south (evening) on the projection
- North wedge appears only at high-summer mornings/evenings (sun rising slightly east of north on Jun 21)
- Sun path arc peaks ~62.5° above horizon at noon Jun 21 (latitude check: 90 - 51 + 23.5 = 62.5)

### Commit
`Brief 28 Part 2: sun path diagram with per-facade solar window overlays`

---

## Part 3 — Time slider on existing 3D Solar overlay

The current 3D viewer has a "Solar on" toggle that tints each facade by annual incident solar. Extend it with a time slider so the user can scrub through the year and watch surface irradiance shift hour by hour.

### What lands

- Time slider added below the 3D viewer when "Solar on" is active.
- Slider has two modes (toggle pill):
  - **Hour-of-year** (0–8759): scrubs through every hour. Default: noon, June 21.
  - **Hour-of-day** (0–23): combined with a small month picker. Shows that hour every day in the chosen month.
- 3D facade tint updates live — each face's colour reflects W/m² incident at that specific hour, scaled against the year-max.
- Compass rose shows current sun azimuth + altitude.
- Small readout: `Tue 21 Jun 14:00  ·  Sun: 232° / 56°  ·  Direct: 612 W/m²  ·  Diffuse: 168 W/m²`.
- The colour scale legend already shown in the Solar overlay updates to reflect the per-hour scale rather than annual.

### Files
- `frontend/src/components/modules/building/BuildingViewer3D.jsx` (extend Solar overlay handling)
- `frontend/src/utils/sunPosition.js` (shared with Part 2)
- Reuse `useHourlySolar` hook output for facade incident values

### Verification

Bridgewater, orientation 42°, slider at noon Jun 21:
- F2 (SE, azimuth 132°) — sun is at azimuth ~180°, so F2 is at ~48° to the sun's direction. Strongly lit.
- F4 (NW, azimuth 312°) — at ~132° from sun, nearly opposite. Dark.
- Slider to 18:00 Jun 21: sun azimuth ~280°, F4 (NW) now lit, F2 (SE) dark. Visual confirmation of orientation.

### Commit
`Brief 28 Part 3: time slider on 3D Solar overlay with sun-position readout`

---

## Part 4 — Lower priority stretch views

Implement only if Parts 1–3 land cleanly and there's appetite for more. Each is small.

### 4a — Monthly solar heatmap by facade

A 4×12 grid (4 facades × 12 months). Each cell coloured by monthly kWh/m². Spot summer-only vs year-round facades; spot months where shading is most effective.

### 4b — Hourly carpet per facade

A 24×365 carpet per facade (4 carpets stacked). Each pixel is one hour's incident W/m². Diurnal + seasonal patterns visible at a glance. Pairs with the time slider for click-to-jump.

### 4c — Solar incidence vs transmitted comparison

For each facade, two bars: incident (W/m² on the wall) + transmitted (through glazing, after g-value × frame_factor × shading_factor). Shows the **fraction** of solar that actually reaches the zone — quick check that g-value and shading inputs are doing what's expected.

### Commit
`Brief 28 Part 4: stretch — monthly heatmap, hourly carpet, incidence-vs-transmitted bar`

---

## Verification (whole brief)

After all parts land:
- Solar Diagnostics tab/panel on the Building module shows: per-facade bar, sun path, time slider on 3D.
- Bridgewater values fall within UK norms (Part 1).
- Sun path geometry matches the latitude (Part 2).
- Scrubbing the slider lights facades in the order you'd expect from the sun's path (Part 3).
- No regressions in the 3D viewer, Heat Balance view, or live calc.
- All views work in both `mode='envelope-only'` (Building module's locked state) and `mode='full'` (Results dashboard, if cross-mounted).

---

## What this brief does NOT do

- **Solar physics changes.** This is purely visualisation of data already computed. If Part 1's bar chart shows values outside UK norms, fix the physics in a separate brief — don't tweak the visualisation to mask the problem.
- **Real-time EnergyPlus solar.** EP's hourly facade solar would require a SQL parser path to `Surface Outside Face Incident Solar Radiation Rate per Area`. Out of scope; the live engine's per-facade solar is canonical enough for diagnostics.
- **Three-dimensional sun-path animation** (rotating Earth, sky dome, etc.). The stereographic 2D projection is sufficient and standard.
- **Operable-window solar coupling** — operable windows are a State 2.5 input; if they're cracked open the solar through the open area is the same as through the glazed area (Brief 26's openings flow doesn't add a separate solar term). State 1 ignores this entirely.

---

## Notes for the implementer

- All views derive from `building_config` + EPW only. They do not read `gains.*`, `systems.*`, or `openings.{face}.openable_fraction`. State isolation rule.
- The per-facade solar arrays already exist as `useHourlySolar(weatherData, orientationDeg)` → `{ f1, f2, f3, f4, roof }` of length 8760. Wire from there.
- Annual integration: `Float32Array.reduce((a, b) => a + b, 0)` × glazing area for total kWh, ÷ wall area for kWh/m².
- Reference UK norms (Part 1's table) come from CIBSE TM37 / Wood et al. Add as a constant in `frontend/src/data/solarNorms.js`.
- The 3D viewer's existing colour scale (350-550-750 kWh/m²/yr in the legend) is the right scale for annual. For per-hour (Part 3), switch to a 0-1000 W/m² scale dynamically.

---

## Estimated effort

| Part | Effort | Why |
|---|---|---|
| 1 — bar chart | S | One component, reads existing data |
| 2 — sun path | M | New stereographic projection + solar position algorithm |
| 3 — time slider on 3D | M | Slider UI + tint recompute on each tick (performance check) |
| 4 — stretch | M-L | Three small views; do as appetite allows |

Total: ~3–5 sessions for Parts 1–3.

---

## Sequencing

This brief slots in **after Brief 27** (Systems Inspectors) in the default queue. Two reasons:

1. **Brief 27 builds the Inspector pattern** used universally going forward. Better to land that pattern before introducing new diagnostic-panel patterns here.
2. **Part 1's bar chart is the most valuable validation tool** — could be brought forward into Brief 26 Part 5 (Bridgewater bounds verification) if useful. Decide when Brief 26 Part 5 starts.

If the user wants Solar Diagnostics earlier (e.g. directly after Brief 26 Part 2.5 / 4 to validate the geometry fix), Brief 28 Part 1 alone is ~1 session and could ship as a small spike.

# Audit — Brief 89: CRREM lifetime carbon (Brief C)

Branch: **`chris/interventions-rework-ux`** (continued, not a fresh cut off `main`).
Design note (canonical): [`../design-notes/brief_C_crrem_lifetime_carbon.md`](../design-notes/brief_C_crrem_lifetime_carbon.md).
Brief: [`../briefs/active/89_crrem_lifetime_carbon.md`](../briefs/active/89_crrem_lifetime_carbon.md).

## §1 — Branch decision (Part 1)

The brief offered two options: (a) continue on `chris/interventions-rework-ux`, or (b) cut a fresh
branch off `main`. **Chose (a).** Brief C *populates Brief A's placeholders* (the Lifetime Carbon card
in `PerInterventionView` and the CRREM chart slot in `StrategyView`). Brief A (87) + Brief 88 have **not
merged to `main` yet** (the combined PR is gated on Chris's Brief 87 walkthrough), so a fresh branch off
`main` would lack the scaffolding Brief C builds on. Continuing keeps the work compilable; the eventual
single PR carries Brief 87 + 88 + the gains tweaks + Brief 89 together (the brief explicitly allows this:
"merges into the combined PR if branch was continued").

## §2 — Source-read: carbon + CRREM data (Part 2)

### Where the data lives (pre-existing, read-only)
- **Electricity grid trajectory** — `frontend/src/data/ukGridCarbonTrajectory.js`: `UK_GRID_TRAJECTORY`
  (gCO₂/kWh waypoints 2024→2050: 190 → 5), `GAS_CARBON_FACTOR_gCO2_per_kWh = 184` (flat),
  `ukGridIntensityForYear(year)` + `buildUkGridYearlyTrajectory()`. **This is the year-by-year source
  Brief C's lifetime math needs.**
- **CRREM carbon targets (frontend)** — `frontend/src/data/crremTargets.js`: `CRREM_HOTEL_KGCO2_PER_M2_YR`
  (v2.04 *International* Hotel, 2024=33 → 2050=2.8), `crremTargetForYear()`. **Carbon only — no energy
  curve.** Consumed by `instantCalc.js` (engine) + `roadmapEngine.js`. **Do not touch** (engine boundary).
- **CRREM targets (backend benchmark)** — `crrem_hotel_uk_15` via `GET /api/library/benchmarks?building_type=hotel`,
  `config_json.{eui_targets, carbon_targets}`: **full year-by-year 2020–2060, BOTH axes** (EUI 2020=280→2060=55;
  carbon 2020=80→2060=2). v2.07 UK. Consumed by `results/CRREMTab.jsx`. This is the **richest, client-aligned**
  CRREM source and matches the report.
- **Single-point fuel factors** — `frontend/src/data/carbonFactors.js`: `ELECTRICITY_CURRENT=0.207`,
  `GAS=0.183`, etc. For *today's* headline carbon KPI — NOT a trajectory. Not used by Brief C.

### Pre-existing multiplicity (Rule 11 debt — NOT Brief 89's to fix)
Three electricity-carbon curves coexist (`ukGridCarbonTrajectory` 0.190→0.005; `CRREMTab.GRID_INTENSITY`
0.172→0.007; `carbonFactors.ELECTRICITY_CURRENT` 0.207) and two CRREM carbon curves (frontend v2.04 vs
backend v2.07). `carbonFactors.js` itself already flags "Cross-trajectory harmonisation is queued as a
follow-up." Brief 89 does **not** harmonise these (would touch the engine + Results module — out of scope).
It picks **one canonical source per quantity for the interventions/Brief-C boundary** and documents the
distinction, exactly as Brief 88 kept the instant-engine EUI separate from the EnergyPlus-sim EUI.

### Canonical choices for Brief 89 (the interventions CRREM boundary)
- **Year electricity factor** → `ukGridCarbonTrajectory.js` (dedicated trajectory module; matches the
  design note's 0.190→~0 intent). Helper: `readElectricityFactor(year)` → kgCO₂/kWh.
- **Year gas factor** → `ukGridCarbonTrajectory.GAS_CARBON_FACTOR` (0.184, flat). Helper: `readGasFactor(year)`.
- **CRREM target curve (EUI + carbon)** → new frontend module mirroring the **backend v2.07 UK Hotel**
  benchmark (both axes, the curve the report uses). Helper: `readCrremTarget(year, {country,property,pathway})`.
  Baked into the frontend so the client-side interventions module reads synchronously; documented as a
  view of the same CRREM v2.07 UK Hotel dataset as the backend benchmark.

### Per-fuel engine exposure (the math's input) — CONFIRMED PRESENT
`interventionsEngine.computeDelta` already emits per-intervention `per_fuel.electricity_mwh.{from,to,delta}`
and `per_fuel.gas_mwh.{from,to,delta}` (interventionsEngine.js:590+). `.from` = baseline annual MWh,
`.to` = post-intervention annual MWh. **This is the fuel-switching input** — no engine change needed.

## §3 — Lifetime carbon math worked examples (Part 3)
_(to fill in Part 3 — LED shrinks / heat pump grows / fabric-on-gas constant)_

## §4 — Per-intervention card (Part 4)
_(to fill)_

## §5 — Strategy CRREM stranding diagram (Part 5)
_(to fill)_

## §6 — Comparison toggle / §7 picker / §8 cleanup
_(to fill)_

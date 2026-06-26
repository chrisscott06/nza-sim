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

`utils/lifetimeCarbon.js` — `computeLifetimeCarbon(perFuel, {lifetimeYears, startYear, endYear})`.
General formula, year-by-year: `Δ_y = Σ_fuel (from_kwh − to_kwh) × factor_y_fuel`, summed
`[2025, min(2050, 2025+lifetime−1)]`. Factors via `carbonReads` only. Canonical factors used:
electricity **0.17 → 0.01** kgCO₂/kWh (2025→2050, UK grid trajectory), gas **0.184** flat.

Verified the three regimes (the proof the math handles each correctly):

| Intervention | per-fuel kWh | lifetime | yr1 → yrN saved | lifetime tCO₂e | regime |
|---|---|---|---|---|---|
| **LED** | −50,000 elec | 12y → 2025–2036 | 8,500 → **680** kg | **41.4** | **shrinks** (grid decarbonises the saved kWh) |
| **Heat pump** (fuel switch) | −100,000 gas, +30,000 elec | 18y → 2025–2042 | 13,300 → **18,178** kg | **304.7** | **grows** (electricity added decarbonises) |
| **Fabric on gas** | −40,000 gas | 45y → clamps 2025–2050 | 7,360 → **7,360** kg | **191.4** | **constant** (gas does not decarbonise) |

All three behave exactly as the design note predicts. The heat-pump yr1 (13,300 kg) matches the design
note's worked example (~12,600 kg; small delta because the codebase grid curve is 0.17/0.005 vs the note's
illustrative 0.190/0.025). **Heat pumps look better over lifetime than year-1** — the saving grows 37% from
2025 to 2042. This is the long-game insight the tool surfaces. Rank order can flip vs the year-1 EUI delta:
that's the feature.

Helpers: `defaultLifetimeYears(category)` (systems 18 / lighting 12 / ventilation 20 / solar 30 / operation
25 / small_power 25), `perFuelFromDeltaRecord()` (MWh→kWh from `per_fuel.{electricity,gas}_mwh.{from,to}`),
`carbonIntensityForYear(fuelsKwh, gia, year)` (for the chart's asset-performance line).

## §4 — Per-intervention card (Part 4)

`PerInterventionView` Lifetime Carbon card populated + `crrem/MiniCrremChart.jsx` (target / baseline /
post trajectories + translucent saving band, single carbon axis, no misalignment marker per design note).
Lifetime = `intervention.lifetime_years` override ?? `defaultLifetimeYears(intervention.theme)`.

**Field-name fix:** the intervention category chip is `intervention.theme` ("Systems", "Lighting", "Solar"…),
NOT `.category` — initially fell through to the 25y default. Now normalised (case + spaces) in
`defaultLifetimeYears`; DHW (theme "Systems") correctly resolves 18y.

**Bridgewater magnitudes (verified physically sensible, all 7 interventions populate):**

| Intervention | per-fuel Δ (MWh/yr) | life | lifetime tCO₂e | check |
|---|---|---|---|---|
| DHW ASHP (fuel switch) | gas −188.9, elec +12.4 | 18y | **+614.8** | hand-calc: 188.9·0.184·18 − elec penalty ≈ 610 ✓ |
| LED | elec −14.5 | 12y | **+13.4** | in brief's 10–50 range ✓ (shrinks with grid) |
| Brise soleil | elec −3.4 | 30y→2050 | **+3.2** | electricity-saving, erodes with grid ✓ |

DHW is the largest (big hotel DHW gas→electric switch, gas saving constant over 18y). Above the brief's
rough 100–300 guess because the actual gas DHW load (188.9 MWh/yr) is larger than guessed — not a bug;
math cross-checks by hand. Year-1 op-carbon −32.0 tCO₂; lifetime grows to 614.8 as the +12.4 MWh
electricity penalty decarbonises away.

## §5 — Strategy CRREM stranding diagram (Part 5)

`crrem/CrremStrandingDiagram.jsx` on the Strategy "Carbon" tab. Two stacked charts (GHG intensity top,
energy intensity below) sharing x 2020–2050, each with: CRREM target (navy dashed), strategy asset line
(blue), current-year diamond, red-circle misalignment marker + translucent excess area when stranded.
CRREM headline row: Strategy EUI, CRREM EUI target (current year), energy + carbon misalignment years,
lifetime carbon saved. Main headline "Lifetime carbon" stat also populated.

Inputs from the engine results (no engine change): `fuelsKwhFromResult()` reads
`consumption.total.{electricity,gas}_mwh` for baseline (`stackResult.baseline`) + final (`lastEnabled.result`);
EUI via canonical `readModelledEui`; gia via `getGia`. Strategy lifetime carbon = Σ each enabled
intervention's MARGINAL lifetime carbon (marginals telescope to cumulative; lets each measure carry its
own lifetime without double-counting).

v1 modelling (design note): energy-intensity asset line flat at strategy EUI (kWh doesn't decarbonise);
GHG-intensity asset line declines as the electricity portion follows the grid trajectory.

**Bridgewater (7-measure strategy):** Strategy EUI **71.4**, CRREM EUI target 215 (2026), lifetime carbon
**+797 tCO₂e**. Both axes report **Compliant / aligned to 2050** — correct: the strategy drives EUI to
71.4, below the 2050 target (75), so it never strands. The misalignment circle + excess area therefore
show on the BASELINE (139.5 EUI) via the Part 6 compare toggle, where stranding is visible.

## §6 — Comparison toggle (Part 6)

`StrategyView` Carbon tab: "Compare · Baseline (no measures)" toggle (default ON), drives
`showBaseline` on the diagram. When on, each chart adds the baseline trajectory (grey dotted), a baseline
misalignment circle, and the baseline excess-emissions area. Verified Bridgewater: baseline (139.5 EUI)
**strands ~2036 on energy** (grey circle + shaded excess where target drops below 139.5) and ~2049 on
carbon, while the strategy (71.4) stays compliant — the gap between the two lines is the strategy's
improvement. Matches the design note's two-line comparison.

## §7 — Project CRREM picker (Part 7)

`crrem/CrremPicker.jsx` in the Strategy Carbon tab header: country (UK, fixed v1), property type
(derived from `params.building_type`, single source of truth — not duplicated), pathway dropdown.
`InterventionsModule` builds `crremPick = {country:'UK', property_type: building_type, pathway}` and
threads it to both Library (`PerInterventionView` → `MiniCrremChart`) and Strategy (`CrremStrandingDiagram`).
Both charts guard via `hasCrremPathway(pick)` — a non-Hotel building shows "no curve yet (v1: UK Hotel
1.5°C only)" instead of silently borrowing the Hotel curve.

Verified Bridgewater: picker shows **UK · Hotel · 1.5°C**, charts render with the pick threaded.

**v1 honesty / falsifiability note:** the brief's Part 7 gate ("change property type to Office → target
curve changes") is **not demonstrable in v1** — only the UK Hotel 1.5°C curve exists (2°C/4°C disabled
"future" in the dropdown; other property types render the no-curve guard). The plumbing is correct and
future-proof; the pathway pick is local state (not yet persisted) since with one valid curve there's
nothing to persist. Persisting the pick + adding more curves is a future brief.

## §8 — Cleanup + grep verification (Part 8)
_(to fill)_

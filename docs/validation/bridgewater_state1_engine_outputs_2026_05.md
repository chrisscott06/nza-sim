# Bridgewater — Static engine State 1 outputs (validation extract, 2026-05-14)

**Source:** Live engine `calculateInstant(..., {mode: 'envelope-only'})` run
against the current persisted Bridgewater config (commit `cfdedcb`) at
2026-05-14T13:24:23Z. Raw JSON in `docs/validation/_dump.json`. Inputs are
documented in `bridgewater_baseline_inputs.md`.

**Engine version:** `frontend/src/utils/instantCalc.js` post commit
`5f890c2` (decomposeHour day=1 fix) and `cfdedcb` (visible-polish; doesn't
touch State 1 path). EnergyPlus reference numbers separately captured —
this doc is Static engine only.

---

## ⚠ Reconciliation note — vs Chris's walkthrough screenshots

Chris reported State 1 numbers (from a Building module screenshot earlier
in the session):

| Item | Chris's State 1 screenshot | This live engine extract | Δ |
|---|---:|---:|---:|
| Solar F1 (north / NE @ orient 42°) | 54.8 MWh | **57.5 MWh** | +4.9% |
| Solar F2 (east / SE) | 4.2 MWh | **4.4 MWh** | +4.8% |
| Solar F3 (south / SW) | 68.0 MWh | **71.4 MWh** | +5.0% |
| Solar F4 (west / NW) | 3.0 MWh | **3.1 MWh** | +3.3% |
| Facade sum | 130.0 MWh | **136.4 MWh** | +4.9% |
| External wall loss | 15.9 MWh | **16.5 MWh** | +3.8% |
| Roof loss | 10.7 MWh | **11.1 MWh** | +3.7% |
| Ground floor loss | 14.7 MWh | **15.3 MWh** | +4.1% |
| Glazing loss | 80.3 MWh | **83.2 MWh** | +3.6% |
| Fabric leakage | 56.6 MWh | **58.7 MWh** | +3.7% |

**The current live engine output matches Chris's State 2 screenshot exactly**
(State 2 reports Solar F1 N 57.5 / F2 E 4.4 / F3 S 71.4 / F4 W 3.1 = 136.4
MWh; External wall 16.5 / Roof 11.1 / Ground 15.2 / Glazing 82.9 — all
identical or within rounding to this extract). The State 1 screenshot
numbers (54.8 / 4.2 / 68.0 / 3.0 + 15.9 / 10.7 / 14.7 / 80.3) are 3-5%
lower across the board, uniformly, for both solar and conduction. The
most parsimonious explanation: the building config was edited between
the two screenshots and the State 1 screenshot captured a pre-edit
state.

**Implication for the heat-balance investigation:** This extract is
evidence — not proof — that Problems 1 + 4 are screenshot-time-skew
rather than engine bugs. Per Chris's zero-tolerance rule on
State-to-State drift, the bar is byte-identity. Live repro in one
session with no edits is the binary pass/fail test for the current
config; the invariance test runbook
(`docs/validation/state_1_invariance_tests.md`) probes byte-identity
across geometry rotations, fabric extremes, and weather extremes that
this single extract cannot reach. Both are required before declaring
the engine path correct.

**Note also:** the facade compass labels in the two screenshots
("F1 NE" vs "F1 N") reflect a separate, confirmed bug (Problem 1a):
Internal Gains' `HeatBalanceView` doesn't pass `orientationDeg` to
`HeatBalance`, so labels don't rotate with the building's orientation.
This is independent of any numeric drift question and remains a bug
regardless of how the live repro resolves.

---

## Solar gains (envelope-only, free-running)

### Per facade (building-local — F1=north, F2=east, F3=south, F4=west)

| Facade | kWh/yr | kWh/m²·yr | Glazing area m² | Displayed at orient 42° |
|---|---:|---:|---:|---|
| F1 north | 57,488.5 | 16.63 | 414 | "Solar — F1 (NE)" |
| F2 east | 4,397.9 | 1.27 | 19 | "Solar — F2 (SE)" |
| F3 south | 71,400.5 | 20.65 | 286 | "Solar — F3 (SW)" |
| F4 west | 3,132.5 | 0.91 | 21 | "Solar — F4 (NW)" |
| Roof (opaque, 0.05 transmission) | 46,454.2 | — | 864 | (not shown in flattenGains) |
| **Total** | **182,873.6** | **52.89** | — | |

`solar.total_kwh` includes roof; the 4-facade breakdown shown to the user
sums to 136,419 kWh (136.4 MWh) — the missing 46.5 MWh is roof.

---

## Losses (envelope-only, free-running)

### Conduction + ventilation

| Element | kWh/yr | kWh/m²·yr | Area m² |
|---|---:|---:|---:|
| External wall | 16,515.4 | 4.78 | 1,142 |
| Roof | 11,110.0 | 3.21 | 864 |
| Ground floor | 15,276.3 | 4.42 | 864 |
| Glazing (all four facades combined) | 83,166.6 | 24.05 | 739 |
| Thermal bridging | 0 | 0 | — |
| Fabric leakage (infiltration @ 0.2 ACH) | 58,661.0 | 16.97 | — |
| Permanent vents (louvres) | 0 | 0 | — |
| **Total losses** | **184,729.4** | **53.43** | — |

### Glazing loss split per facade (from top-level `losses.conduction.glazing`)

| Facade | kWh/yr | kWh/m²·yr |
|---|---:|---:|
| F1 north | 46,556.4 | 112.5 |
| F2 east  | 2,116.2  | 111.4 |
| F3 south | 32,166.2 | 112.5 |
| F4 west  | 2,327.8  | 110.8 |

Conduction-loss-per-glazing-m² is uniform across facades (≈ 112 kWh/m²·yr)
because all four faces share U_glaz × dT_air integrated over the same
free-running trace — the only per-face variable is area.

---

## Derived demand (against comfort band 21 / 25 °C)

| Field | Value |
|---|---:|
| `heating_demand_mwh` | 103.4 MWh |
| `cooling_demand_mwh` | 108.6 MWh |
| `underheating_hours` | 4,430 |
| `overheating_hours` | 3,449 |
| `comfort_hours` | 881 |
| Hours total | 8,760 |
| Comfort fraction | 10.1 % |

---

## Free-running zone temperature (annual)

| Metric | Value °C |
|---|---:|
| Annual mean (`annual_mean_c`) | 21.2 |
| Hourly mean (independent recompute) | 21.224 |
| Hourly std deviation | 8.74 |
| Winter min (Dec–Feb min of T_op) | 4.0 |
| Summer max (Jun–Aug max of T_op) | 44.2 |

**Hourly array:** `hourly_temperature_c` is a `Float32Array(8760)` — not
included in this doc, but available in `_dump.json` if needed for spectral
analysis. Engine emits T_op = 0.5 × (T_air + T_mass) per the two-node
solve.

**Note on summer_max_c 44.2 °C:** the Static lumped two-node mass model
under-stores heat compared to EnergyPlus per-layer CTF. EnergyPlus
free-running on the same building reads ~28.9 °C peak (delta ≈ 15 K). The
gap is documented in `docs/state_1_engine_divergence_investigation.md`
(2026-05-14 update). Brief 28b Part 3 lands the multi-layer CTF fix.

---

## Energy balance check

| Item | kWh |
|---|---:|
| Total gains (solar incl. roof) | 182,873.6 |
| Total losses (conduction + vent) | 184,729.4 |
| **Net (gains − losses)** | **−1,855.8** |
| Net per m² | −0.54 kWh/m²·yr |

State 1 balance closes to within 1% — natural gain and natural loss are
in equilibrium (modulo the comfort-band-driven heating/cooling demand
which is shown separately).

---

## What's NOT in this State 1 output (per state contract)

- People, equipment, lighting gains (State 2 territory)
- Operable-window driven ventilation losses (State 2.5 territory)
- Mechanical heating / cooling / DHW (State 3 territory)

All of the above are stripped from the building config by `withMode('envelope-only')` before the engine runs. Output is byte-identical regardless of any value in `occupancy`, `gains`, `systems`, or `openings.{face}.openable_fraction` / `openings.schedule`.

---

## File pointers

- Raw JSON dump: `docs/validation/_dump.json` (key `state1`)
- Engine source: `frontend/src/utils/instantCalc.js` `_calculateEnvelopeOnly`
- Mode router: `frontend/src/utils/instantCalc.js` `calculateInstant`
- Input filter: `frontend/src/utils/instantCalc.js` `withMode`

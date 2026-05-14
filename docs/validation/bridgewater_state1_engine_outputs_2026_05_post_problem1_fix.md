# Bridgewater — Static engine State 1 outputs (post Problem-1 fix, 2026-05-14)

**Status:** Canonical engine baseline for the validation spreadsheet.
Engine commit `e0282c2` (Problem 1/1a/2/3 fix batch). Persisted
Bridgewater config — `infiltration_ach: 0.2` (restored earlier today
from 0.1). Source JSON: `docs/validation/_dump.json` (regenerated
2026-05-14T14:54Z).

**What changed since the previous extract** (`bridgewater_state1_engine_outputs_2026_05.md`):

- Engine `getGValue` now accepts top-level `item.g_value` (the shape the
  list API serves), not just `item.config_json.g_value`. The script
  `_validation_dump.mjs` already wrapped library items as
  `config_json: c.config_json ?? c`, so script engine outputs are
  byte-identical to the previous extract. **The shift is on the
  browser side**: Building module now matches engine output exactly
  (was previously 5% low because BuildingDefinition stored API items
  as-is and the engine fell back to `DEFAULT_G_VALUE = 0.40`).
- Engine `thermalMass.js::resolveCmass` now reads
  `constructionItem.layers ?? constructionItem.config_json?.layers`
  (was top-level only). Removes a ~0.31% loss-side residual drift
  between consumers that wrap vs. don't.
- Persisted `infiltration_ach: 0.2` restored before this run.

---

## Project metadata

| Field | Value |
|---|---|
| Project ID | `14b4a5b1-8c73-4acb-8b65-1d22f05ec969` |
| Name | HIX Bridgewater |
| Weather | `GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw` (TMYx 2011-2025) |
| Lat / Long | 51.0064° N / −2.6428° E |
| Comfort band | 21 / 25 °C |
| Orientation (CW from N) | 42° |
| Infiltration ACH | 0.2 |
| GIA (computed) | 3,457 m² |
| Volume (computed) | 11,064 m³ |

---

## Solar gains (per facade, post-fix)

Per the engine: `acc_solar_<face> = Σ hourlySolar.<face>[h] × glazing.<face> × g_value × (1 − FRAME_FRACTION) × shadingFactors.<face>`.

After the Problem 1 fix, the engine reads `g_value = 0.42` from the
`double_low_e` library item regardless of which consumer assembled
`libraryData`.

| Facade | kWh/yr | kWh/m²·yr | Glazing area m² | Compass label at orient 42° |
|---|---:|---:|---:|---|
| F1 (north) | **57,488.5** | 16.63 | 414 | F1 (NE) |
| F2 (east) | **4,397.9** | 1.27 | 19 | F2 (SE) |
| F3 (south) | **71,400.5** | 20.65 | 286 | F3 (SW) |
| F4 (west) | **3,132.5** | 0.91 | 21 | F4 (NW) |
| Roof (opaque, 0.05 transmission) | **46,454.2** | — | 864 | not shown in flattenGains |
| **Total** | **182,873.6** | **52.89** | — | — |

---

## Losses

| Element | kWh/yr | kWh/m²·yr | Area m² |
|---|---:|---:|---:|
| External wall | 16,515.4 | 4.78 | 1,142 |
| Roof | 11,110.0 | 3.21 | 864 |
| Ground floor | 15,276.3 | 4.42 | 864 |
| Glazing (all four facades combined) | 83,166.6 | 24.05 | 739 |
| Thermal bridging | 0.0 | 0.00 | — |
| Fabric leakage (infiltration @ 0.2 ACH) | 58,661.0 | 16.97 | — |
| Permanent vents (louvres, area 0) | 0.0 | 0.00 | — |
| **Total losses** | **184,729.4** | **53.43** | — |

### Glazing loss split per facade

| Facade | kWh/yr |
|---|---:|
| F1 (north) | 46,556.4 |
| F2 (east) | 2,116.2 |
| F3 (south) | 32,166.2 |
| F4 (west) | 2,327.8 |

---

## Derived demand (vs comfort band 21 / 25 °C)

| Field | Value |
|---|---:|
| Heating demand | 103.4 MWh |
| Cooling demand | 108.6 MWh |
| Underheating hours | 4,430 |
| Overheating hours | 3,449 |
| Comfort hours | 881 |
| Comfort fraction | 10.1 % |

---

## Free-running zone temperature (annual, no system)

| Metric | Value °C |
|---|---:|
| Annual mean | 21.2 |
| Winter min (Dec–Feb) | 4.0 |
| Summer max (Jun–Aug) | 44.2 |
| Hourly mean (recomputed) | 21.224 |
| Hourly std deviation | 8.736 |

**Note:** Static lumped two-node mass model under-stores heat vs
EnergyPlus per-layer CTF (gap ~8.8 K on summer max for Bridgewater).
Brief 28b Part 3 lands the multi-layer CTF fix.

---

## Energy balance check (post-fix)

| Item | kWh |
|---|---:|
| Total gains (solar incl. roof) | 182,873.6 |
| Total losses (fabric + ventilation) | 184,729.4 |
| **Net (gains − losses)** | **−1,855.8** |
| Net per m² | −0.54 kWh/m²·yr |

Closes within 1 %. State 1's natural-gain ≈ natural-loss balance is
preserved (modulo the comfort-band-driven heating/cooling demand
shown separately).

---

## Comparison vs previous extract (pre Problem-1 fix)

The script (`_validation_dump.mjs`) produces byte-identical output
before and after the engine fix, because the script's library-item
wrapper (`config_json: c.config_json ?? c`) made the pre-fix engine
read the correct g-value via the nested path. **The previous
`bridgewater_state1_engine_outputs_2026_05.md` extract is still
numerically correct.** The fix changes only the *browser-side
Building module's* behaviour — Building used to use g=0.40, now uses
g=0.42, and now matches this engine baseline.

| Field | Pre-fix (script) | Post-fix (script) | Diff |
|---|---:|---:|---:|
| F1 solar | 57,488.5 | 57,488.5 | 0 |
| F2 solar | 4,397.9 | 4,397.9 | 0 |
| F3 solar | 71,400.5 | 71,400.5 | 0 |
| F4 solar | 3,132.5 | 3,132.5 | 0 |
| External wall loss | 16,515.4 | 16,515.4 | 0 |
| Fabric leakage | 58,661.0 | 58,661.0 | 0 |
| Heating demand MWh | 103.4 | 103.4 | 0 |
| Cooling demand MWh | 108.6 | 108.6 | 0 |
| Annual mean T °C | 21.2 | 21.2 | 0 |

The validation spreadsheet should anchor on these numbers.

---

## File pointers

- Raw JSON: `docs/validation/_dump.json` (regenerated)
- Engine source: `frontend/src/utils/instantCalc.js` `_calculateEnvelopeOnly`
- Library API: `GET /api/library/constructions`
- Project API: `GET /api/projects/14b4a5b1-8c73-4acb-8b65-1d22f05ec969`
- Discrepancy resolution doc: `docs/state_2_heat_balance_discrepancies_2026_05.md`

# Hard-coded constants audit

**Status:** v1.0, produced during Brief 27 Part 2 as a cross-cutting
concern. Referenced by Section I of `docs/module_completion_checklist.md`.

**Scope of this pass:** Numeric literals in the four files explicitly
named by the user-set audit scope:

1. `frontend/src/utils/instantCalc.js` (live engine + degree-day fallback)
2. `frontend/src/utils/` other `_calculate*` helpers (currently all live
   in instantCalc.js; if extracted, this audit must extend)
3. `nza_engine/generators/epjson_assembler.py` (EnergyPlus epJSON emit)
4. `nza_engine/parsers/sql_parser.py` (EnergyPlus result extraction)

Trivial literals (0, 1, indices, array-size 24/12) are not catalogued.
Every numeric literal with physical meaning, calibration intent, or
likely user-configuration value is.

---

## Category definitions

- **Physics constant** — fundamental physical property or unit
  conversion. Should be `const NAME = value  // citation`. Never an
  input. Examples: ρ × Cp for air, Stefan-Boltzmann.
- **Algorithm parameter** — internal numerical constant of an
  implemented method (tolerance, iteration limit, coefficient choice
  with citation). Keep with documenting comment. Not user-tunable.
- **Configurable but defaulted** — a value the user, library, or
  project config could/should own. Currently hard-coded as a default.
  **Promote** to library/config; keep the default but read from there.
- **Needs review** — unclear category, requires an architectural
  decision (e.g., EP design-day temperatures: keep as built-in defaults
  or surface to user?).

---

## A. `frontend/src/utils/instantCalc.js`

### A.1 Physics constants (keep, all documented)

| Line | Value | Name | Notes |
|---|---|---|---|
| 70  | 2200 | `UK_HDD` | Heating degree-days, UK average; **superseded** for hourly calcs by EPW. Used only in degree-day fallback path. |
| 71  | 150  | `UK_CDD` | Cooling degree-days, UK average; same caveat. |
| 72  | 8760 | `HOURS` | Hours per year (constant). |
| 102 | 0.33 | `AIR_HEAT_CAPACITY` | kWh/m³/K (ρ × Cp for air at 20 °C). Reference Cibse Guide A. |
| 115 | 4.18 / 3600 | `WATER_SHC` | kWh/L/K (specific heat of water). |
| 402, 978 | 0.6 | `Cd` | Discharge coefficient for open windows/louvres (CIBSE AM10 §6.4). |
| 458, 986 | 4.5  | `H_AM_W_PER_M2K` | Zone-to-mass convective transfer coefficient. Lumped-capacitance simplification of EN ISO 13790. Citation in inline comment. **Promote candidate** — could become user-tunable in advanced thermal mass mode. |
| 362, 972 | 0.20 | `FRAME_FRACTION` | 20% of WWR area is frame (no solar gain). Industry standard for double-glazed UK windows. |

### A.2 Algorithm parameters (keep, document)

| Line | Value | Context | Notes |
|---|---|---|---|
| 1010, 1011 | -20, 60 | T_mass clamps in 8760-hour loop | Bounds the integrator against runaway during simulation; never reached in practice. Document. |
| 493, 1015 | 0.05 | Roof solar coupling | "Weak solar contribution through opaque roof" — 5% of roof irradiance assumed to penetrate (CIBSE simplified). Inline comment exists. |
| 169 | 1.5 | Shading saturation threshold | Projection-factor saturation. Empirical fit. Comment exists. |
| 178 | 0.45 | `pfFin × 0.4` clamp | Fin reduction ceiling. Empirical. Comment. |
| 180 | 0.4 | `Math.max(0.4, ...)` | Minimum shading factor — represents irreducible diffuse. Document. |
| 1934 | 0.04 | `OPAQUE_GAIN_FRACTION` | Sol-air conduction through opaque envelope (CIBSE simplified). Comment exists. **Possibly review** — should be elemental U-value × ΔT_sol-air rather than blanket 4%? |
| 1692, 2385 | 0.10 | `ventilation_cooling: × 0.10 / 1000` | Magic share of ventilation kWh assigned to cooling Sankey link. **Needs review** — currently a flat 10% allocation. |
| 2382 | 0.10 | `pump_factor` in heating/cooling Sankey | Pump electrical demand assumed 10% of distribution kWh. Citation needed. |
| Daylight window: 9–16 | hour-of-day | Lighting daylight dimming window | Timezone-independent — should be solar-noon-relative in future. Brief-29 candidate. |

### A.3 Configurable but defaulted — promote candidates

| Line | Value | Today | Should live in | Severity |
|---|---|---|---|---|
| 99  | 0.4   | `DEFAULT_G_VALUE` (glazing solar transmittance) | `glazing` library item; only fall back to this if a project genuinely has no glazing assigned. | HIGH |
| 110 | 0.145 | `GRID_INTENSITY_2026` kgCO₂/kWh | Project-level (selectable year + region). Brief 28+ when carbon module lands. | HIGH |
| 111 | 0.183 | `GAS_CARBON_KG_KWH` | Same — fuel-emissions table by year. | HIGH |
| 114 | 1.1   | `DHW_LITRES_PER_M2_DAY` | Building-type table (hotel 1.1, office 0.2, residential 0.8, etc.). | MEDIUM |
| 116 | 10    | `DHW_COLD_TEMP` °C | `systems.dhw.cold_water_temp_c` (already exists in some configs — not consistently read). | MEDIUM |
| 117 | 60    | `DHW_SETPOINT` °C | `systems.dhw.setpoint_c` (already exists). Read from there always. | MEDIUM |
| 105 | 2200  | `HOTEL_OPERATING_HOURS` | **Legacy** — superseded by `building_config.gains.lighting.schedule` in v2.3. Used only in degree-day fallback. Mark for retirement when degree-day path retires. | LOW |
| 106 | 1800  | `HOTEL_EQUIP_HOURS`        | **Legacy** — same. | LOW |
| 107 | 0.35  | `HOTEL_OCCUPIED_FRACTION`  | **Legacy** — same. | LOW |
| 1312, 1952 | 0.75 | `occupancy_rate` default | Now in `building_config.occupancy.occupancy_rate` (v2.3). Two more call sites still fall back to 0.75 in legacy degree-day path — needs `building.occupancy?.occupancy_rate` lookup. | MEDIUM |
| 1313, 1953 | 1.5 | `people_per_room` default | Now in `building_config.occupancy.density` (v2.3). Same comment. | MEDIUM |
| 759, 760 | 1.5 | `occupancy.density` defaults | Last-resort fallback in `computeTotalOccupants`. Acceptable — only fires if user explicitly clears density. |
| 1296 | 0.04 | `OPAQUE_GAIN_FRACTION` (deg-day) | Same magic 4% as A.2; review elementally. |
| 1333–1335 | 0.60 | `COOLING_GAIN_FRACTION` heuristic | Tuning constant for degree-day path. Brief 28+ retirement. |
| 1220, 1227 | 0.55, 0.20 | Lighting fallback fractions (hotel hardcode) | **Legacy** — superseded by v2.3 schedules. Mark for retirement. |
| 144, 145, 148 | 0.55, 0.55, 0.20 | `ORIENT_OVERHANG_EFF` values | Empirical orientation-dependent shading effectiveness. Could move to a shading library item; for now document the source. |
| 1946 | 24 | `T_cool_setpoint` (degree-day path) | Hard-coded — should read comfortBand.upper_c. Bug-adjacent. |

### A.4 Standby / spill factors now in v2.3 contract

These are read from `building_config.gains.*` with the listed values as
last-resort defaults. **Acceptable** — defaults match the v2.3 preset
defaults the migration writes to every project.

| Line | Value | Path |
|---|---|---|
| 831 | 0.6  | `gains.lighting.daylight_factor` |
| 853 | 0.10 | `gains.equipment.standby_factor` |
| 894 | 75   | `occupancy.sensible_w_per_person` |
| (n/a)| 55  | `occupancy.latent_w_per_person` (defined in `DEFAULT_OCCUPANCY` in ProjectContext) |
| (n/a)| 15  | `gains.lighting.spill_minutes` (defined in defaults) |

---

## B. `nza_engine/generators/epjson_assembler.py`

### B.1 Physics / algorithm constants (keep)

| Line | Value | Context | Notes |
|---|---|---|---|
| 326 | 0.6  | AFN discharge coefficient | Matches live engine (Cd). |
| 73  | 0.5  | `DEFAULT_INFILTRATION_ACH` | Building-config default; documented. |
| 77  | 0.008 | `_VENT_M3_PER_S_PER_PERSON` | ASHRAE 62.1 / CIBSE Guide B minimum fresh-air rate. Citation in comment. |
| 200 | 0.30 | People `fraction_radiant` | EnergyPlus standard. |
| 222 | 0.32 | Lights `fraction_radiant` | EP standard for fluorescent baseline. Update when LED tables land. |
| 223 | 0.25 | Lights `fraction_visible` | EP standard. |
| 242 | 0.30 | Equipment `fraction_radiant` | EP standard. |
| 461, 462 | 14, 40 °C | Supply-air design temps | EP autosizing defaults. **Needs review** — surface to systems library? |
| 465, 466 | 1.25, 1.15 | Heating/cooling sizing factors | CIBSE TM52-aligned. Document. |

### B.2 Configurable but defaulted — promote

| Line | Value | Today | Should live in | Severity |
|---|---|---|---|---|
| 115–118 | 51.5, -0.1, 0.0, 10.0 | Building site location (lat/lon/tz/elev) | Project's `location` block. The fallback fires only if the EPW header is unreadable — verify it's truly a fallback, not silently used as default. | HIGH (silent failure risk) |
| 297–301 | 60, 15, 3.0 | Building geometry defaults | Building-config defaults. Same comment — should never fire for a real project. |
| 472–495 | Design-day temperatures | London-derived hard-coded values | Project's `location` should drive these; or read from EPW. Brief 28 candidate. | MEDIUM |
| 478, 491 | 101325 Pa | Barometric pressure (design day) | Standard atmosphere; physics constant, accept. |
| 480, 493 | 270 | Wind direction (design day) | Westerly default — UK appropriate but should be user-tunable for non-UK. |
| 699–701 | 1.20 / 0.80 / 0.60 | Lighting control factors (manual / sensing / dimming) | Already a lookup table; **promote** the table to a systems-library entry so users can edit. | MEDIUM |
| 729, 730 | 0.75, 1.5 | Legacy occupancy_rate / people_per_room | Identical to instantCalc.js — same retirement path. | LOW |

### B.3 Needs review

| Line | Value | Question |
|---|---|---|
| 200, 222, 242 | 0.30 / 0.32 / 0.30 | Should `fraction_radiant` come from the library entry for the specific lighting type / equipment type? EP allows per-instance values. Today every project uses identical fractions. |
| 461–466 | Design supply air temps + sizing factors | Should these surface to the user under "Sizing & comfort assumptions"? |

---

## C. `nza_engine/parsers/sql_parser.py`

### C.1 Physics / algorithm constants (keep)

| Line | Value | Context | Notes |
|---|---|---|---|
| 29 | 1.0/3_600_000.0 | `J_TO_KWH` | Unit conversion. |
| 105 | 3600.0 | Default hourly reporting interval (seconds) | EP standard. |
| 482 | 0.001 | Division-by-zero guard | Algorithm parameter. Comment exists. |
| 742 | { sheltered: 0.05, normal: 0.10, exposed: 0.20 } | `Cw` site-exposure dictionary | Matches live engine. CIBSE AM10. **Promote candidate** — should be a single shared module. | 
| 752 | 4.0 | Default wind speed m/s if EPW unparseable | Fallback. Document. |
| 791 | 0.008 | `_VENT_M3_PER_S_PER_PERSON` | Same as assembler.py — **should be a shared constant**, not duplicated. | MEDIUM |
| 807, 814–816 | 18.0, 22.0 °C | HDD / CDD base temperatures | CIBSE convention. Document. |
| 1082 | 0.33 | `_AIR_HEAT_CAPACITY_WH_PER_M3_K` | Same as live engine — **duplication**, promote to a shared physics constants module. |

### C.2 Configurable but defaulted

| Line | Value | Today | Should live in | Severity |
|---|---|---|---|---|
| 759, 760 | 60, 15 | Geometry defaults | Building config; fallback only. |
| 780–784 | always/occupied/summer_day/never schedule fractions | `applicable_fraction` dictionary | These are *EnergyPlus schedule profiles*. Already library-aligned; surface this lookup as a comment cross-reference. |
| 788, 789 | 0.75, 1.5 | Legacy occupancy_rate / people_per_room | Same retirement path. | LOW |
| 1095–1098 | 0.28, 0.18, 0.22, 1.4 | Default U-values (wall, roof, floor, glazing) | These are duplicated with `DEFAULT_U_VALUES` in instantCalc.js — **promote to a shared constants module**. | MEDIUM |
| 1100–1102 | 0.4, 0.20, 1.0 | g-value / frame fraction / shading factor | Duplicated with live engine constants. Promote. | MEDIUM |

### C.3 Cross-file duplication (top priority)

The following constants appear in two or three of the audited files with
identical values:

| Constant | Files | Recommendation |
|---|---|---|
| Air heat capacity (0.33 Wh/m³K = 0.00033 kWh/m³K) | instantCalc.js, sql_parser.py | Single `physics_constants` module per language. |
| Cd discharge coefficient (0.6) | instantCalc.js, epjson_assembler.py | Same. |
| Cw site exposure dict | instantCalc.js, sql_parser.py | Single shared dict. |
| Frame fraction (0.20) | instantCalc.js, sql_parser.py | Same. |
| Default g-value (0.4) | instantCalc.js, sql_parser.py | Same. |
| Default U-values (4 elements) | instantCalc.js, sql_parser.py | Same. |
| 0.008 m³/s per person ventilation | epjson_assembler.py, sql_parser.py | Same. |
| Legacy 0.75 occupancy_rate / 1.5 people_per_room | All three calc files | Now in v2.3 occupancy block; mark legacy fallbacks for retirement. |

These duplications are the single biggest "magic number" risk — a
change in one place will silently disagree with the other.

---

## Action queue

**Address during Brief 27 (trivially):**
- Document `OPAQUE_GAIN_FRACTION` rationale in inline comment.
- Document `_AIR_HEAT_CAPACITY` source citation in both files.
- Add inline citation for `H_AM_W_PER_M2K` (EN ISO 13790 §A.4).

**Queue for Brief 28 (substantive — `Cross-cutting cleanup` brief):**
- Promote duplicated constants into a shared module (`nza_engine/constants.py`
  on the Python side; `frontend/src/utils/physicsConstants.js` on the JS
  side) and assert at module-load that JS and Python versions agree.
- Promote `Cw` site exposure dict to the shared module.
- Promote default U-values + g-value to a single source.
- Promote grid + gas carbon intensity to a year/region-selectable table.
- Promote DHW litres-per-m²-day to a building-type table.
- Promote lighting control factor table to a systems-library entry.
- Pull legacy `occupancy_rate` / `people_per_room` fallbacks from v2.3
  `building_config.occupancy.*` so legacy + v2.3 paths agree.
- Fix `T_cool_setpoint = 24` hard-code in degree-day path to read from
  `comfortBand.upper_c`.

**Architectural decisions deferred to Brief 28+:**
- Should EP `fraction_radiant`/`fraction_visible` come from library
  per-load-type rather than a single global constant?
- Should design-day supply air temps + sizing factors surface to user
  as "Sizing & comfort assumptions"?
- Should daylight dimming window (currently 9–16 hour-of-day) become
  solar-noon-relative?
- Should the 10% ventilation-cooling Sankey share be physics-derived?

---

## How to apply this audit going forward

Every new brief that adds calculation code must add a row here for any
new numeric literal it introduces, with category and rationale. Section
I of `docs/module_completion_checklist.md` enforces this at close-out.

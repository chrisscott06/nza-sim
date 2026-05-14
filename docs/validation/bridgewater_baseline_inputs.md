# Bridgewater — baseline inputs (validation extract, 2026-05-14)

**Source:** Live project `14b4a5b1-8c73-4acb-8b65-1d22f05ec969` via running
backend (`/api/projects/{id}`) at 2026-05-14T13:24:23Z. Raw JSON in
`docs/validation/_dump.json`. This document reformats the same data for
the hand-calc spreadsheet — no analysis, no derived numbers.

---

## Project metadata

| Field | Value |
|---|---|
| Name | HIX Bridgewater |
| Address | Market Way, Bridgwater TA6 6DF |
| Postcode | TA6 6DF |
| Building type | Hotel |
| Weather file | `GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw` |
| Location | Bridgwater, Somerset (51.087° N, −2.985° E) |
| Comfort band | 21 °C / 25 °C |

---

## Geometry

| Field | Value |
|---|---:|
| Length | 58.8 m |
| Width | 14.7 m |
| Number of floors | 4 |
| Floor height | 3.2 m |
| Orientation (CW from N) | 42° |
| GIA (computed) | 3,457 m² |
| Volume (computed) | 11,064 m³ |
| Floor area per floor | 864 m² |
| Total opaque wall (computed) | 1,142 m² |
| Total glazing (computed) | 739 m² |
| Roof / ground area | 864 m² each |

### WWR per facade (building-local)

| Facade | WWR | Glazing area m² |
|---|---:|---:|
| North (F1) | 0.55 | 414 |
| South (F3) | 0.38 | 286 |
| East (F2)  | 0.10 | 19  |
| West (F4)  | 0.11 | 21  |

### Window count per facade

| Facade | Count |
|---|---:|
| North | 18 |
| South | 16 |
| East  | 1  |
| West  | 1  |

### Shading — overhangs (depth + offset, all four facades)

| Facade | Depth m | Offset m |
|---|---:|---:|
| North | 0.5 | 0 |
| South | 0.5 | 0 |
| East  | 0.5 | 0 |
| West  | 0.5 | 0 |

### Shading — fins (left + right depth, all four facades)

| Facade | Left depth m | Right depth m |
|---|---:|---:|
| North | 0.5 | 0.5 |
| South | 0.5 | 0.5 |
| East  | 0.5 | 0.5 |
| West  | 0.5 | 0.5 |

---

## Constructions assigned

| Element | Library item | U-value W/m²K | Y-factor | Other |
|---|---|---:|---:|---|
| External wall | `cavity_wall_enhanced` | 0.18 | 1.0 (config null → default) | thermal_mass: medium |
| Roof | `pitched_roof_standard` | 0.16 | 1.0 (config null → default) | thermal_mass: low |
| Ground floor | `ground_floor_slab` | 0.22 | 1.0 (config null → default) | thermal_mass: high |
| Glazing | `double_low_e` | 1.40 | 1.0 (config null → default) | g-value: 0.42 |

**Y-factors:** All four library items have `y_factor: null` in their
config_json, which `getUValue` treats as 1.0 (no thermal-bridging uplift
applied). Engine reports `thermal_bridging` loss as 0 kWh on this project.

### Layer breakdowns (for layered-construction validation)

**cavity_wall_enhanced** (outside → inside):
1. Brick outer leaf — 102 mm, k=0.77 W/mK, ρ=1700 kg/m³, cp=800 J/kgK
2. PIR insulation — 150 mm, k=0.022, ρ=30, cp=1400
3. Concrete block — 100 mm, k=0.51, ρ=1400, cp=1000
4. Plasterboard — 13 mm, k=0.16, ρ=950, cp=840

**pitched_roof_standard** (outside → inside):
1. Tiles — 12 mm, k=0.84, ρ=1900, cp=800
2. Membrane — Material:NoMass, R=0.06 m²K/W
3. Mineral wool — 200 mm, k=0.038, ρ=15, cp=1030
4. Plasterboard — 13 mm, k=0.16, ρ=950, cp=840

**ground_floor_slab** (outside/ground → inside):
1. Carpet — 10 mm, k=0.06, ρ=200, cp=1300
2. Screed — 65 mm, k=0.41, ρ=1200, cp=840
3. Concrete slab — 150 mm, k=1.13, ρ=2000, cp=1000
4. XPS insulation — 100 mm, k=0.033, ρ=35, cp=1400

**double_low_e**: glazing, no layers stored (single-pane equivalent: U=1.40, g=0.42)

---

## Infiltration + ventilation

| Field | Value |
|---|---:|
| `infiltration_ach` | 0.2 ACH |
| Volume (computed) | 11,064 m³ |
| Air heat capacity (constant) | 0.33 Wh/m³K |
| → UA_leakage | 0.33 × 0.2 × 11,064 ≈ 730 W/K |

### Permanent openings (louvres only)

| Field | Value |
|---|---|
| `site_exposure` | normal |
| Wind-pressure coefficient Cw | 0.10 |
| Discharge coefficient Cd | 0.6 |
| North louvre area | 0 m² |
| South louvre area | 0 m² |
| East louvre area | 0 m² |
| West louvre area | 0 m² |
| Total louvre area | **0 m²** → permanent-vents loss is structurally zero |

### Operable windows (State 2.5 territory — stripped by `withMode` for State 1/2)

| Facade | Openable fraction |
|---|---:|
| North | 0.30 |
| South | 0    |
| East  | 0    |
| West  | 0    |

Operable-window schedule: `"occupied"` (string ID; not resolved at State 1/2).

---

## Thermal mass

| Field | Value |
|---|---|
| `thermal_mass_mode` | auto (resolves from construction layers) |
| `thermal_mass_category` | light (legacy fallback if auto fails) |
| Derived `C_mass_J` | computed by `resolveCmass` from construction stack |

---

## Comfort band

| Field | Value °C |
|---|---:|
| `lower_c` (heating threshold) | 21 |
| `upper_c` (cooling threshold) | 25 |

---

## Occupancy (State 2 input — stripped from State 1 by `withMode`)

| Field | Value |
|---|---:|
| `num_bedrooms` | 134 |
| `occupancy.density.value` | 2 |
| `occupancy.density.basis` | per_room |
| `occupancy.occupancy_rate` | 1.0 |
| `occupancy.sensible_w_per_person` | 75 W |
| `occupancy.latent_w_per_person` | 55 W (not used in State 2 dry-bulb balance) |
| Total occupants at 100% (computed) | 134 × 2 = 268 |

### Occupancy schedule (`occupancy.schedule`)

**Weekday hourly fractions (0..23):**
```
[0.92, 0.92, 0.91, 0.89, 0.89, 0.88, 0.93, 0.90, 0.54, 0.28, 0.36, 0.28,
 0.49, 0.27, 0.19, 0.31, 0.60, 0.90, 0.95, 1.00, 1.00, 1.00, 1.00, 1.00]
```

**Saturday hourly fractions (0..23):** identical to weekday except hour-8 = 0.34 (vs 0.54 weekday).

**Sunday hourly fractions (0..23):** identical to saturday.

**Monthly multipliers (Jan..Dec):**
```
[1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 0.94, 0.89, 0.83, 0.87, 0.91]
```

**Exception — Xmas:** 24-Dec to 7-Jan, all-zero curves for weekday / saturday / sunday. `ignore_monthly_multipliers: false`.

---

## Internal gains (State 2 input)

### Lighting (`gains.lighting.profiles`) — 1 profile

| Field | Value |
|---|---|
| ID | `hotel_bedroom_lighting_mp4j51hx_4` |
| Label | Bedroom lighting |
| Magnitude | 2 W/m² (`w_per_m2`) |
| Relationship to occupancy | `independent` |
| Spill minutes | 15 |
| Daylight factor | 0.16 |
| Area share | 1.0 |

**Lighting schedule weekday (0..23):**
```
[0.51, 0.52, 0.55, 0.55, 0.54, 0.56, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00,
 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 0.47, 0.47, 0.45, 0.45]
```

Saturday and sunday identical to weekday.

**Lighting monthly multipliers (Jan..Dec):**
```
[1.00, 1.00, 0.90, 0.80, 0.70, 0.70, 0.70, 0.70, 0.80, 0.90, 1.00, 1.00]
```

### Equipment (`gains.equipment.profiles`) — 2 profiles

**Profile 1: Custom equipment (id `custom_equipment_mp4j3fhe_3`)**

| Field | Value |
|---|---|
| Baseload | 1 W/m² (`w_per_m2`) |
| Active | 1.5 W/m² (`w_per_m2`) |
| Relationship to occupancy | `independent` |
| Standby factor | 1.0 |
| Area share | 1.0 |

Schedule weekday: irregular pattern peaking 0.95 at hour 14, with daytime average ~0.5. Saturday/Sunday: peak 0.95 at hours 10–11, near-zero overnight.

Monthly multipliers: `[0.90, 0.90, 1.00, 1.00, 1.00, 0.90, 0.80, 0.80, 1.00, 1.00, 1.00, 0.85]`

**Profile 2: Custom equipment (id `custom_equipment_mp4j6877_6`)**

| Field | Value |
|---|---|
| Baseload | 1 W/m² (`w_per_m2`) |
| Active | 2 W/m² (`w_per_m2`) |
| Relationship to occupancy | `proportional` |
| Standby factor | 0.1 |
| Area share | **0.1** (only 10% of GIA gets this profile) |

Same daytime peak pattern but flattens to 0.05 overnight and through weekends.

---

## Systems config (State 3 — stripped from State 1/2 by `withMode`)

For reference only; State 1 and State 2 engines do not read these.

| Field | Value |
|---|---|
| `hvac_type` (legacy) | vrf_standard |
| `space_heating.primary.system` | vrf_standard, share 1.0 |
| `space_cooling.primary.system` | vrf_standard, share 1.0 |
| `dhw.primary.system` | gas_boiler_dhw, share 0.3 |
| `dhw.secondary.system` | ashp_dhw, share 0.7 |
| `dhw_setpoint` / `dhw_preheat_setpoint` | 60 / 45 °C |
| `ventilation.primary.system` | mev_standard, share 1.0 |
| `ventilation_control` | continuous |
| `sfp_override` | 2.3 W/(L/s) |
| `hre_override` | 85 % |
| `natural_ventilation` | true |
| `natural_vent_threshold` | 22 °C |
| `window_opening_threshold` | 28 °C |
| `lighting_power_density` (legacy) | 8 W/m² |
| `equipment_power_density` (legacy) | 15 W/m² |
| `lighting_control` (legacy) | occupancy_sensing |

---

## Derived constants (engine internals)

| Constant | Value | Source |
|---|---:|---|
| `FRAME_FRACTION` | 0.20 | instantCalc.js:362 |
| `H_AM_W_PER_M2K` | 4.5 | instantCalc.js:458 |
| `A_internal_surface` (computed) | roof + ground + walls = 864 + 864 + 1142 = 2,870 m² | instantCalc.js:450 |
| `h_am_total` (computed) | 4.5 × 2870 = 12,915 W/K | instantCalc.js:459 |
| `AIR_HEAT_CAPACITY` | 0.33 Wh/m³K | instantCalc.js constant |
| `WINDOW_HEIGHT_DEFAULT` | (engine constant — used by shading PF calc) | instantCalc.js |

---

## File pointers

- Raw JSON dump: `docs/validation/_dump.json`
- Engine source: `frontend/src/utils/instantCalc.js`
- Construction library API: `GET /api/library/constructions`
- Project API: `GET /api/projects/14b4a5b1-8c73-4acb-8b65-1d22f05ec969`

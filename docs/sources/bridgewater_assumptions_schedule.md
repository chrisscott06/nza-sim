# Bridgewater — Fabric & Systems Assumptions Schedule (BRUKL / as-built)

**Document:** `26002-NZA-XX-XX-SC-X-0010_-_Fabric___Systems_Assumptions_Schedule_v2.xlsx`

**Canonical location:**
```
C:\Users\ChrisScott\OneDrive - NZA Consultancy Ltd\01a - Live Projects\
  26002 - Zeal HIX CRREM Study\01 - WIP\CA_Calcs\
  26002-NZA-XX-XX-SC-X-0010_-_Fabric___Systems_Assumptions_Schedule_v2.xlsx
```

**Project:** 26002 — Zeal HIX (Bridgewater) CRREM Study
**Origin:** BRUKL Technical Data Sheet + as-built Bridgewater drawings, compiled by Chris.
**First imported:** 2026-05-16 (Brief 28k Gate 3+).

This is the canonical source of truth for Bridgewater's fabric U-values, thermal
bridging coefficient, air permeability, ventilation system schedule, system
efficiencies, and DHW assumptions. The repo's seeded values for the
Bridgewater test project (`14b4a5b1-8c73-4acb-8b65-1d22f05ec969`) come from
this document. When values diverge between this schedule and the persisted
project state, this document wins — re-run `scripts/seed_bridgewater_v25_systems.mjs`
to restore canonical state.

## Values currently sourced from this schedule

Tracked in `scripts/seed_bridgewater_v25_systems.mjs` and applied via the
`PUT /api/projects/{id}` and `PUT /api/projects/{id}/building` endpoints.

### Fabric U-values (per-project overrides on construction_choices)

| Element | BRUKL value | Engine field |
|---|---:|---|
| External wall | 0.14 W/m²K | `construction_choices.external_wall.u_value_override` |
| Roof | 0.15 W/m²K | `construction_choices.roof.u_value_override` |
| Ground floor | 0.13 W/m²K | `construction_choices.ground_floor.u_value_override` |
| Glazing U-value | 1.40 W/m²K | (matches library default — no override) |
| Glazing g-value | 0.50 (area-weighted) | `construction_choices.glazing.g_value_override` |

### Air permeability + thermal bridging

| Field | BRUKL value | Engine field |
|---|---:|---|
| Air permeability | 4.64 m³/h·m² @ 50 Pa → ≈ 0.23 ac/h | `building_config.infiltration_ach` |
| Thermal bridging coefficient α | 200% (BRUKL Tech Data Sheet) | `building_config.fabric.thermal_bridging_alpha_pct` |

### Mechanical ventilation (3 distinct systems)

`building_config.systems_config_v25.ventilation`:

| System | Flow | HRE | SFP | Coverage |
|---|---:|---:|---:|---|
| `mvhr_gf_public` | 1425 L/s | 0.80 | 1.4 W/L·s | Ground floor public areas (5 × Toshiba VN-M1000HE) |
| `bedroom_extract` | 2208 L/s | 0.0 | 0.4 W/L·s | Bedrooms via single roof fan EF R.01 + trickle vent inlet |
| `public_toilet_extract` | 210 L/s | 0.0 | 0.4 W/L·s | Public WCs |

### System efficiencies (already persisted, verified vs BRUKL)

| System | BRUKL value | Library template field |
|---|---:|---|
| VRF heating SCOP | 5.12 | `vrf_heat_recovery_dual_function.heating_scop` |
| VRF cooling SEER | 3.51 | `vrf_heat_recovery_dual_function.cooling_seer` |
| DX split SEER (Comms Room) | 5.62 | `dx_split_cooling.cooling_seer` |
| Electric panel COP | 1.0 | `electric_panel_heater.heating_scop` |
| ASHP DHW COP | 3.0 | `ashp_dhw_preheat.dhw_seasonal_efficiency` |
| Gas heater seasonal efficiency | 0.90 | `gas_boiler_calorifier.dhw_seasonal_efficiency` |
| MVHR sensible HRE | 0.80 | `systems_config_v25.ventilation[].hre` |

## Pending action items

- **Trickle vents:** Renson IEMAH065 over every bedroom window. Equivalent area
  not in BRUKL doc. Currently spreadsheet uses 1.0 m² NE + 0.76 m² SW as
  permanent openings; this is per Chris's earlier review and stays as-is.
- **LPDs:** Lighting and equipment power densities not in this BRUKL doc.
  Engine currently uses 1.5 / 1.5 W/m² (low). Source from BRUKL p.27 Key
  Features or NCM defaults. **Future calibration work.**
- **VRF ground floor:** A separate VRF system serves the ground floor with
  SCOP 4.93 / SEER 3.29. Currently merged into the single `vrf_heat_recovery_dual_function`
  template entry. Lower priority — small portion of total heat.

## Update procedure

If this schedule changes:
1. Update the OneDrive document (canonical reference).
2. Update `scripts/seed_bridgewater_v25_systems.mjs` constants.
3. Run `node scripts/seed_bridgewater_v25_systems.mjs` to apply.
4. Re-run the Brief 28k Gate 3 validator: `node scripts/_check_28k_gate3_state2_demand.mjs`.
5. Update `docs/validation/brief_28k_validation.md` (when it exists) with new run summary.

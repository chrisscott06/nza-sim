# Baseline calculation trace

Generated: 2026-05-27T08:22:12.305Z
Project: HIX Bridgewater (id 14b4a5b1-8c73-4acb-8b65-1d22f05ec969)
Reported GIA: 4322 m²  ·  Comfort band: 21–24 °C

## ENVELOPE LOSSES (annual, at comfort band)

Each line: gross conduction / vent loss in MWh/yr, integrand over hourly heating-needed K·h.

  external_wall        = 39.9 MWh   (9.2 kWh/m² area=1900 m²)
     [source: heat_balance.annual.losses.external_wall.kwh; integrated in _calculateState2 hourly loop]
  roof                 = 19.5 MWh   (4.5 kWh/m² area=864 m²)
     [source: heat_balance.annual.losses.roof.kwh; integrated in _calculateState2 hourly loop]
  ground_floor         = 16.9 MWh   (3.9 kWh/m² area=864 m²)
     [source: heat_balance.annual.losses.ground_floor.kwh; integrated in _calculateState2 hourly loop]
  glazing              = 94.9 MWh   (22.0 kWh/m² area=452 m²)
     [source: heat_balance.annual.losses.glazing.kwh; integrated in _calculateState2 hourly loop]
  thermal_bridging     = 10.3 MWh   (2.4 kWh/m²)
     [source: heat_balance.annual.losses.thermal_bridging.kwh; integrated in _calculateState2 hourly loop]
  fabric_leakage       = 47.5 MWh   (11.0 kWh/m²)
     [source: heat_balance.annual.losses.fabric_leakage.kwh; integrated in _calculateState2 hourly loop]
  permanent_vents      = 13.8 MWh   (3.2 kWh/m²)
     [source: heat_balance.annual.losses.permanent_vents.kwh; integrated in _calculateState2 hourly loop]
  ──
  envelope total       = 242.9 MWh
     [Σ of lines above; cross-check vs hb.annual.totals]

## VENTILATION (per system — full chain)

AIR_HEAT_CAPACITY = 0.33 Wh/m³·K (constant)

### mvhr_gf_public
  flow_l_s   = 1425                  [source: v40.systems_config_v40.ventilation[id=vent_mvhr_gf_public].flow_rate=1425 (basis 'constant', v40-wins per Brief 59 P1)]
  HRE        = 0.75                    [source: v40.systems_config_v40.ventilation[id=vent_mvhr_gf_public].efficiency_metric.recovery_sensible_pct=75 (÷100; v40-wins per Brief 50 P6)]
  SFP        = 1.4 W/(l·s⁻¹)       [source: v25.sfp_w_per_l_s]
  hours      = 8760                    [source: v25.hours, sched_factor = hours/8760]
  Q_m3_h     = 1425 × 3.6              = 5130.0 m³/h
  ventUA     = 0.33 × 5130.0 × (1 − 0.75) × 1.00 = 423.23 W/K
  effective K_hours integrand  = 86328 K·h    (back-solved from engine; UK heating-needed degree-hours at 21°C)
  → heat_loss  = 423.23 × 86328 / 1000 = 36.5 MWh
     [source: losses_at_setpoint.ventilation[].heat_loss_kwh; computed in _calculateState2 hourly loop]
  → fan_power  = 1.4 × 1425 × 8760 / 1000 = 17476.2 kWh
     [source: losses_at_setpoint.ventilation[].fan_kwh; same flow as demand integrand AFTER Brief 59 P1]

### bedroom_extract
  flow_l_s   = 2208                  [source: v40.systems_config_v40.ventilation[id=vent_bedroom_extract].flow_rate=2208 (basis 'constant', v40-wins per Brief 59 P1)]
  HRE        = 0                    [source: v40.systems_config_v40.ventilation[id=vent_bedroom_extract].efficiency_metric.recovery_sensible_pct=0 (÷100; v40-wins per Brief 50 P6)]
  SFP        = 0.4 W/(l·s⁻¹)       [source: v25.sfp_w_per_l_s]
  hours      = 8760                    [source: v25.hours, sched_factor = hours/8760]
  Q_m3_h     = 2208 × 3.6              = 7948.8 m³/h
  ventUA     = 0.33 × 7948.8 × (1 − 0) × 1.00 = 2623.10 W/K
  effective K_hours integrand  = 86328 K·h    (back-solved from engine; UK heating-needed degree-hours at 21°C)
  → heat_loss  = 2623.10 × 86328 / 1000 = 226.4 MWh
     [source: losses_at_setpoint.ventilation[].heat_loss_kwh; computed in _calculateState2 hourly loop]
  → fan_power  = 0.4 × 2208 × 8760 / 1000 = 7736.8 kWh
     [source: losses_at_setpoint.ventilation[].fan_kwh; same flow as demand integrand AFTER Brief 59 P1]

### public_toilet_extract
  flow_l_s   = 210                  [source: v40.systems_config_v40.ventilation[id=vent_public_toilet_extract].flow_rate=210 (basis 'constant', v40-wins per Brief 59 P1)]
  HRE        = 0                    [source: v40.systems_config_v40.ventilation[id=vent_public_toilet_extract].efficiency_metric.recovery_sensible_pct=0 (÷100; v40-wins per Brief 50 P6)]
  SFP        = 0.4 W/(l·s⁻¹)       [source: v25.sfp_w_per_l_s]
  hours      = 8760                    [source: v25.hours, sched_factor = hours/8760]
  Q_m3_h     = 210 × 3.6              = 756.0 m³/h
  ventUA     = 0.33 × 756.0 × (1 − 0) × 1.00 = 249.48 W/K
  effective K_hours integrand  = 86328 K·h    (back-solved from engine; UK heating-needed degree-hours at 21°C)
  → heat_loss  = 249.48 × 86328 / 1000 = 21.5 MWh
     [source: losses_at_setpoint.ventilation[].heat_loss_kwh; computed in _calculateState2 hourly loop]
  → fan_power  = 0.4 × 210 × 8760 / 1000 = 735.8 kWh
     [source: losses_at_setpoint.ventilation[].fan_kwh; same flow as demand integrand AFTER Brief 59 P1]

## INTERNAL GAINS (annual, at zone)

  people      = 0.0 MWh   (0.0 kWh/m²)
     [source: heat_balance.annual.gains.internal.people.kwh; integrand: building.occupancy + sensible_w_per_person]
  lighting    = 65.8 MWh   (15.2 kWh/m²)
     [source: heat_balance.annual.gains.internal.lighting.kwh; integrand: building.gains.lighting.profiles[*] × effectiveSystemScalar(systems_config_v40.lighting) [Brief 58 C coupling]]
  equipment   = 78.9 MWh   (18.3 kWh/m²)
     [source: heat_balance.annual.gains.internal.equipment.kwh; integrand: building.gains.equipment.profiles[*] × effectiveSystemScalar(systems_config_v40.small_power) [Brief 58 C coupling]]
  solar       = 99.4 MWh   (23.0 kWh/m²)
     [source: heat_balance.annual.gains.solar; per facade × g_value × (1−frame_fraction) × shading × WWR_area]

## HEATING + COOLING DEMAND (post heat balance, post MVHR recovery)

  heating_demand  = 245.6 MWh   (Σ over hours: max(0, hourly_loss − useful_gain) per State 2 hourly loop)
     [source: demand.heating_demand_mwh; State 2 integrand combines envelope + vent loss − internal/solar gain utilisation buckets]
  cooling_demand  = 69.1 MWh   (Σ over hours: max(0, hourly_gain_surplus − loss-removal-budget))
     [source: demand.cooling_demand_mwh]

## DHW DEMAND (Brief 58 B3 headcount basis)

  basis            = per_person    [source: systems_config_v40.dhw_demand_basis]
  num_rooms        = 134      [source: building.num_bedrooms (UI label "Number of rooms")]
  people_per_room  = 1.5            [source: building.people_per_room (Internal Gains sensitivity, Brief 58 B2)]
  occupancy_rate   = 1       [source: building.occupancy.occupancy_rate]
  headcount        = 134 × 1.5 × 1 = 201.0 people
  L_per_person/day = 80        [source: systems_config_v40.dhw_demand_litres_per_person_per_day]
  total_tap_lpd    = 201.0 × 80 = 16080 L/day
  tap_outlet_c     = 40     [source: systems_config_v40.dhw_tap_outlet_temp_c]
  storage_c        = 60     [source: systems_config_v40.dhw_storage_setpoint_c]
  cold_supply_c    = 10     [source: systems_config_v40.dhw_cold_supply_temp_c]
  hot_fraction     = (40 − 10) / (60 − 10) = 0.60
  boiler_lpd       = 16080 × 0.60 = 9648 L/day
  → annual_thermal = 9648 × 50 K × 4186 J/L/K × 365 / 3.6e9
                   = 204.7 MWh
     [source: brief40.dhw.demand_at_comfort_mwh — engine arithmetic matches above]
  load_shape       = flat   [source: systems_config_v40.dhw_load_shape; Brief 58 B4 toggle]
  demand_at_comfort = 204.4 MWh   [engine output]

## DELIVERED ENERGY (per service)

  heating       = 245.6 MWh   [source: brief40.heating.delivered_total_mwh]
  cooling       = 69.1 MWh   [source: brief40.cooling.delivered_total_mwh]
  dhw           = 204.4 MWh   [source: brief40.dhw.delivered_total_mwh]
  ventilation   = 22.5 MWh   [source: brief40.ventilation.total_fan_electrical_mwh]
  lighting      = 65.8 MWh   [source: brief40.lighting.total_delivered_electrical_mwh]
  small_power   = 78.9 MWh   [source: brief40.small_power.total_delivered_electrical_mwh]

## FUEL (per carrier)

  electricity          = 311129 kWh   [source: brief40.totals.fuel_split.electricity_kWh]
  gas                  = 147654 kWh   [source: brief40.totals.fuel_split.gas_kWh]
  ──
  source_total          = 458783 kWh   [source: brief40.totals.annual_source_kWh]

## EUI (kWh/m²·yr)

  EUI = source_total / GIA = 458783 / 4322 = 106.2 kWh/m²·yr
     [source: brief40.totals.eui_kWh_per_m2; FINAL ENGINE OUTPUT]


---

# After mutation: vent[vent_bedroom_extract].flow_rate = 1000

Generated: 2026-05-27T08:22:12.432Z
Project: HIX Bridgewater (id 14b4a5b1-8c73-4acb-8b65-1d22f05ec969)
Reported GIA: 4322 m²  ·  Comfort band: 21–24 °C

## ENVELOPE LOSSES (annual, at comfort band)

Each line: gross conduction / vent loss in MWh/yr, integrand over hourly heating-needed K·h.

  external_wall        = 39.9 MWh   (9.2 kWh/m² area=1900 m²)
     [source: heat_balance.annual.losses.external_wall.kwh; integrated in _calculateState2 hourly loop]
  roof                 = 19.5 MWh   (4.5 kWh/m² area=864 m²)
     [source: heat_balance.annual.losses.roof.kwh; integrated in _calculateState2 hourly loop]
  ground_floor         = 16.9 MWh   (3.9 kWh/m² area=864 m²)
     [source: heat_balance.annual.losses.ground_floor.kwh; integrated in _calculateState2 hourly loop]
  glazing              = 94.9 MWh   (22.0 kWh/m² area=452 m²)
     [source: heat_balance.annual.losses.glazing.kwh; integrated in _calculateState2 hourly loop]
  thermal_bridging     = 10.3 MWh   (2.4 kWh/m²)
     [source: heat_balance.annual.losses.thermal_bridging.kwh; integrated in _calculateState2 hourly loop]
  fabric_leakage       = 47.5 MWh   (11.0 kWh/m²)
     [source: heat_balance.annual.losses.fabric_leakage.kwh; integrated in _calculateState2 hourly loop]
  permanent_vents      = 13.8 MWh   (3.2 kWh/m²)
     [source: heat_balance.annual.losses.permanent_vents.kwh; integrated in _calculateState2 hourly loop]
  ──
  envelope total       = 242.9 MWh
     [Σ of lines above; cross-check vs hb.annual.totals]

## VENTILATION (per system — full chain)

AIR_HEAT_CAPACITY = 0.33 Wh/m³·K (constant)

### mvhr_gf_public
  flow_l_s   = 1425                  [source: v40.systems_config_v40.ventilation[id=vent_mvhr_gf_public].flow_rate=1425 (basis 'constant', v40-wins per Brief 59 P1)]
  HRE        = 0.75                    [source: v40.systems_config_v40.ventilation[id=vent_mvhr_gf_public].efficiency_metric.recovery_sensible_pct=75 (÷100; v40-wins per Brief 50 P6)]
  SFP        = 1.4 W/(l·s⁻¹)       [source: v25.sfp_w_per_l_s]
  hours      = 8760                    [source: v25.hours, sched_factor = hours/8760]
  Q_m3_h     = 1425 × 3.6              = 5130.0 m³/h
  ventUA     = 0.33 × 5130.0 × (1 − 0.75) × 1.00 = 423.23 W/K
  effective K_hours integrand  = 86328 K·h    (back-solved from engine; UK heating-needed degree-hours at 21°C)
  → heat_loss  = 423.23 × 86328 / 1000 = 36.5 MWh
     [source: losses_at_setpoint.ventilation[].heat_loss_kwh; computed in _calculateState2 hourly loop]
  → fan_power  = 1.4 × 1425 × 8760 / 1000 = 17476.2 kWh
     [source: losses_at_setpoint.ventilation[].fan_kwh; same flow as demand integrand AFTER Brief 59 P1]

### bedroom_extract
  flow_l_s   = 1000                  [source: v40.systems_config_v40.ventilation[id=vent_bedroom_extract].flow_rate=1000 (basis 'constant', v40-wins per Brief 59 P1)]
  HRE        = 0                    [source: v40.systems_config_v40.ventilation[id=vent_bedroom_extract].efficiency_metric.recovery_sensible_pct=0 (÷100; v40-wins per Brief 50 P6)]
  SFP        = 0.4 W/(l·s⁻¹)       [source: v25.sfp_w_per_l_s]
  hours      = 8760                    [source: v25.hours, sched_factor = hours/8760]
  Q_m3_h     = 1000 × 3.6              = 3600.0 m³/h
  ventUA     = 0.33 × 3600.0 × (1 − 0) × 1.00 = 1188.00 W/K
  effective K_hours integrand  = 86328 K·h    (back-solved from engine; UK heating-needed degree-hours at 21°C)
  → heat_loss  = 1188.00 × 86328 / 1000 = 102.6 MWh
     [source: losses_at_setpoint.ventilation[].heat_loss_kwh; computed in _calculateState2 hourly loop]
  → fan_power  = 0.4 × 1000 × 8760 / 1000 = 3504.0 kWh
     [source: losses_at_setpoint.ventilation[].fan_kwh; same flow as demand integrand AFTER Brief 59 P1]

### public_toilet_extract
  flow_l_s   = 210                  [source: v40.systems_config_v40.ventilation[id=vent_public_toilet_extract].flow_rate=210 (basis 'constant', v40-wins per Brief 59 P1)]
  HRE        = 0                    [source: v40.systems_config_v40.ventilation[id=vent_public_toilet_extract].efficiency_metric.recovery_sensible_pct=0 (÷100; v40-wins per Brief 50 P6)]
  SFP        = 0.4 W/(l·s⁻¹)       [source: v25.sfp_w_per_l_s]
  hours      = 8760                    [source: v25.hours, sched_factor = hours/8760]
  Q_m3_h     = 210 × 3.6              = 756.0 m³/h
  ventUA     = 0.33 × 756.0 × (1 − 0) × 1.00 = 249.48 W/K
  effective K_hours integrand  = 86328 K·h    (back-solved from engine; UK heating-needed degree-hours at 21°C)
  → heat_loss  = 249.48 × 86328 / 1000 = 21.5 MWh
     [source: losses_at_setpoint.ventilation[].heat_loss_kwh; computed in _calculateState2 hourly loop]
  → fan_power  = 0.4 × 210 × 8760 / 1000 = 735.8 kWh
     [source: losses_at_setpoint.ventilation[].fan_kwh; same flow as demand integrand AFTER Brief 59 P1]

## INTERNAL GAINS (annual, at zone)

  people      = 0.0 MWh   (0.0 kWh/m²)
     [source: heat_balance.annual.gains.internal.people.kwh; integrand: building.occupancy + sensible_w_per_person]
  lighting    = 65.8 MWh   (15.2 kWh/m²)
     [source: heat_balance.annual.gains.internal.lighting.kwh; integrand: building.gains.lighting.profiles[*] × effectiveSystemScalar(systems_config_v40.lighting) [Brief 58 C coupling]]
  equipment   = 78.9 MWh   (18.3 kWh/m²)
     [source: heat_balance.annual.gains.internal.equipment.kwh; integrand: building.gains.equipment.profiles[*] × effectiveSystemScalar(systems_config_v40.small_power) [Brief 58 C coupling]]
  solar       = 99.4 MWh   (23.0 kWh/m²)
     [source: heat_balance.annual.gains.solar; per facade × g_value × (1−frame_fraction) × shading × WWR_area]

## HEATING + COOLING DEMAND (post heat balance, post MVHR recovery)

  heating_demand  = 141.4 MWh   (Σ over hours: max(0, hourly_loss − useful_gain) per State 2 hourly loop)
     [source: demand.heating_demand_mwh; State 2 integrand combines envelope + vent loss − internal/solar gain utilisation buckets]
  cooling_demand  = 88.3 MWh   (Σ over hours: max(0, hourly_gain_surplus − loss-removal-budget))
     [source: demand.cooling_demand_mwh]

## DHW DEMAND (Brief 58 B3 headcount basis)

  basis            = per_person    [source: systems_config_v40.dhw_demand_basis]
  num_rooms        = 134      [source: building.num_bedrooms (UI label "Number of rooms")]
  people_per_room  = 1.5            [source: building.people_per_room (Internal Gains sensitivity, Brief 58 B2)]
  occupancy_rate   = 1       [source: building.occupancy.occupancy_rate]
  headcount        = 134 × 1.5 × 1 = 201.0 people
  L_per_person/day = 80        [source: systems_config_v40.dhw_demand_litres_per_person_per_day]
  total_tap_lpd    = 201.0 × 80 = 16080 L/day
  tap_outlet_c     = 40     [source: systems_config_v40.dhw_tap_outlet_temp_c]
  storage_c        = 60     [source: systems_config_v40.dhw_storage_setpoint_c]
  cold_supply_c    = 10     [source: systems_config_v40.dhw_cold_supply_temp_c]
  hot_fraction     = (40 − 10) / (60 − 10) = 0.60
  boiler_lpd       = 16080 × 0.60 = 9648 L/day
  → annual_thermal = 9648 × 50 K × 4186 J/L/K × 365 / 3.6e9
                   = 204.7 MWh
     [source: brief40.dhw.demand_at_comfort_mwh — engine arithmetic matches above]
  load_shape       = flat   [source: systems_config_v40.dhw_load_shape; Brief 58 B4 toggle]
  demand_at_comfort = 204.4 MWh   [engine output]

## DELIVERED ENERGY (per service)

  heating       = 141.4 MWh   [source: brief40.heating.delivered_total_mwh]
  cooling       = 88.3 MWh   [source: brief40.cooling.delivered_total_mwh]
  dhw           = 204.4 MWh   [source: brief40.dhw.delivered_total_mwh]
  ventilation   = 22.5 MWh   [source: brief40.ventilation.total_fan_electrical_mwh]
  lighting      = 65.8 MWh   [source: brief40.lighting.total_delivered_electrical_mwh]
  small_power   = 78.9 MWh   [source: brief40.small_power.total_delivered_electrical_mwh]

## FUEL (per carrier)

  electricity          = 276051 kWh   [source: brief40.totals.fuel_split.electricity_kWh]
  gas                  = 147654 kWh   [source: brief40.totals.fuel_split.gas_kWh]
  ──
  source_total          = 423705 kWh   [source: brief40.totals.annual_source_kWh]

## EUI (kWh/m²·yr)

  EUI = source_total / GIA = 423705 / 4322 = 98.0 kWh/m²·yr
     [source: brief40.totals.eui_kWh_per_m2; FINAL ENGINE OUTPUT]


---

# DIFF MODE — Before vs After

Mutation: `v40.ventilation[id=vent_bedroom_extract].flow_rate := 1000`

| Stage | Before | After | Δ |
|---|---:|---:|---:|
| Heating demand (MWh) | 245.6 | 141.4 | -104.2 |
| Cooling demand (MWh) | 69.1 | 88.3 | 19.2 |
| EUI (kWh/m²·yr)      | 106.2                | 98.0                | -8.2 |

## Patched system: vent_bedroom_extract

| Field | Source | Before | After | Δ | Tracked patch? |
|---|---|---:|---:|---:|---|
| v40.flow_rate           | systems_config_v40.ventilation[id=vent_bedroom_extract].flow_rate | 2208 | 1000 | -1208 | ✓ this is what the editor writes |
| demand-path flow_l_s    | ventSystems[].flow_l_s (Brief 59 P1: v40-wins) | 2208 | 1000 | -1208 | ✓ coupled to v40.flow_rate |
| fan-path flow_l_s       | _computeVentilation reads v40 directly | 2208 | 1000 | -1208 | ✓ |
| ventUA (W/K)            | 0.33 × Q_m3_h × (1−HRE) × hours/8760 | 2623.1 | 1188.0 | -1435.1 |  |
| vent heat_loss (kWh/yr) | losses_at_setpoint.ventilation[].heat_loss_kwh | 226448 | 102558 | -123890 | engine arithmetic |
| fan_kwh                 | losses_at_setpoint.ventilation[].fan_kwh | 7737 | 3504 | -4233 | engine arithmetic |

### Bug-signature check (Brief 59 Part 1)

✓ Demand-path flow AND fan-path flow AND vent heat_loss all move together. Coupling is correct (post-fix).


---

## Harness self-consistency (T-G2)

All inspected formula↔result pairs reconcile within tolerance ✓

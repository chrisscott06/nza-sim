# Brief 63 — Validation report

Generated: 2026-05-27T14:04:30.565Z
Project: HIX Bridgewater (GIA 4322 m²)
Weather: GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw

**Totals:** PASS 275 · FAIL 0 · BLOCKED 0 · TOTAL 275

## Per category

| Category | PASS | FAIL | BLOCKED |
|---|---:|---:|---:|
| A | 40 | 0 | 0 |
| B | 44 | 0 | 0 |
| C | 30 | 0 | 0 |
| D | 100 | 0 | 0 |
| E | 19 | 0 | 0 |
| F | 42 | 0 | 0 |

## All tests

| ID | Category | Status | Name |
|---|---|---|---|
| A01 | A | PASS | heating_setpoint 19→24 → demand_heating ↑ |
| A02 | A | PASS | heating_setpoint 24→28 → demand_heating ↑ |
| A03 | A | PASS | heating_setpoint 19→24 → fuel_heating ↑ |
| A04 | A | PASS | heating_setpoint 19→28 → total_elec ↑ |
| A05 | A | PASS | heating_setpoint 19→28 → EUI ↑ |
| A06 | A | PASS | heating_setpoint 19→28 → hours_heating_dir ↑ |
| A07 | A | PASS | cooling_setpoint 28→22 → demand_cooling ↑ |
| A08 | A | PASS | cooling_setpoint 22→18 → demand_cooling ↑ |
| A09 | A | PASS | cooling_setpoint 28→18 → fuel_cooling ↑ |
| A10 | A | PASS | cooling_setpoint 28→18 → total_elec ↑ |
| A11 | A | PASS | heating_scop 2.0→4.0 → fuel_heating ↓ |
| A12 | A | PASS | heating_scop ↑ → demand_heating unchanged |
| A13 | A | PASS | heating_scop ↑ → delivered_heating unchanged |
| A14 | A | PASS | cooling_seer 2.5→5.0 → fuel_cooling ↓ |
| A15 | A | PASS | cooling_seer ↑ → demand_cooling unchanged |
| A16 | A | PASS | dhw_efficiency 0.7→1.0 → fuel_dhw ↓ |
| A17 | A | PASS | dhw_efficiency ↑ → demand_dhw unchanged |
| A18 | A | PASS | dhw_litres_per_person 40→150 → demand_dhw ↑ |
| A19 | A | PASS | mvhr_flow 700→2500 → vent heat_loss ↑ |
| A20 | A | PASS | mvhr_flow 700→2500 → fan_elec ↑ |
| A21 | A | PASS | mvhr_flow 700→2500 → demand_heating ↑ (more vent loss) |
| A22 | A | PASS | sfp 1.0→2.5 → fan_elec ↑ |
| A23 | A | PASS | sfp ↑ → demand_heating unchanged (fan power doesn't drive demand) |
| A24 | A | PASS | sfp ↑ → demand_cooling unchanged |
| A25 | A | PASS | sfp ↑ → demand_dhw unchanged |
| A26 | A | PASS | hre 60→90 → vent heat_loss ↓ (post-recovery) |
| A27 | A | PASS | hre 60→90 → demand_heating ↓ (recovery offsets demand) |
| A28 | A | PASS | hre 60→90 → recovery_offset ↑ |
| A29 | A | PASS | lighting_cf 0.4→1.0 → light_elec ↑ |
| A30 | A | PASS | lighting_cf 0.4→1.0 → lighting_gain (heat_balance) ↑ |
| A31 | A | PASS | lighting_cf 0.4→1.0 → demand_heating ↓ (more internal gain offsets demand) |
| A32 | A | PASS | lighting_cf 0.4→1.0 → demand_cooling ↑ |
| A33 | A | PASS | sp_cf 0.5→1.5 → sp_elec ↑ |
| A34 | A | PASS | sp_cf 0.5→1.5 → equipment_gain (heat_balance) ↑ |
| A35 | A | PASS | vent enabled→disabled → vent heat_loss ↓ |
| A36 | A | PASS | vent enabled→disabled → fan_elec ↓ |
| A37 | A | PASS | lighting enabled→disabled → light_elec ↓ |
| A38 | A | PASS | lighting disabled → lighting_gain in heat_balance ↓ |
| A39 | A | PASS | cooling_seer 2.5→5.0 → carbon ↓ |
| A40 | A | PASS | heating_scop 2.0→4.0 → carbon ↓ |
| B01 | B | PASS | no negative demand/fuel/EUI/carbon across all sweep points |
| B02h | B | PASS | baseline: fuel_heating = delivered / scop |
| B02c | B | PASS | baseline: fuel_cooling = delivered / seer |
| B03h | B | PASS | scop_hi: fuel_heating = delivered / scop |
| B03c | B | PASS | scop_hi: fuel_cooling = delivered / seer |
| B04h | B | PASS | seer_hi: fuel_heating = delivered / scop |
| B04c | B | PASS | seer_hi: fuel_cooling = delivered / seer |
| B05h | B | PASS | baseline: delivered_heating == demand_heating |
| B05c | B | PASS | baseline: delivered_cooling == demand_cooling |
| B05d | B | PASS | baseline: delivered_dhw == demand_dhw |
| B06h | B | PASS | hsp_28: delivered_heating == demand_heating |
| B06c | B | PASS | hsp_28: delivered_cooling == demand_cooling |
| B06d | B | PASS | hsp_28: delivered_dhw == demand_dhw |
| B07h | B | PASS | csp_18: delivered_heating == demand_heating |
| B07c | B | PASS | csp_18: delivered_cooling == demand_cooling |
| B07d | B | PASS | csp_18: delivered_dhw == demand_dhw |
| B08 | B | PASS | scop_effective ≤ 10 (no super-physical heating) |
| B09 | B | PASS | seer_effective ≤ 10 (no super-physical cooling) |
| B10 | B | PASS | dhw_blended_eff ≤ 10 |
| B11 | B | PASS | baseline: cooling_demand ≤ Σ gains |
| B12 | B | PASS | csp_18: cooling_demand ≤ Σ gains |
| B13 | B | PASS | vent_off: cooling_demand ≤ Σ gains |
| B13b | B | PASS | SCREENSHOT (vent_off + lcf=1.33 + spcf=1.48 + csp=14 + heat_off): cooling_demand ≤ Σ gains |
| B13d | B | PASS | vent_off: cooling_demand cannot decrease when cooling_setpoint drops 24→18 |
| B14 | B | PASS | baseline: heating_demand ≤ Σ heating_loss_at_setpoint |
| B15 | B | PASS | HRE>0: vent heat_loss ≤ HRE=0 vent heat_loss (recovery reduces, never increases) |
| B16 | B | PASS | HRE>0: demand_heating ≤ HRE=0 demand_heating |
| B17 | B | PASS | bypass_on EUI ≤ bypass_off EUI (correct bypass cannot increase consumption) |
| B18 | B | PASS | hours_heating + cooling + shoulder = 8760 (baseline) |
| B19 | B | PASS | bypass_hours_total ≤ 8760 |
| B20 | B | PASS | bypass_hours_in_cool ≤ hours_cooling_dir |
| B21 | B | PASS | bypass_hours_in_heat ≤ hours_heating_dir |
| B22 | B | PASS | overheating + underheating + comfort hours = 8760 |
| B23 | B | PASS | EUI = (Σ fuel by carrier) × 1000 / gia |
| B24 | B | PASS | csp_18: EUI = (Σ fuel) × 1000 / gia |
| B25 | B | PASS | solar facade sum = solar.total_kwh |
| B26 | B | PASS | free_running default (csp=24 follow_comfort): cool_demand == 69.1 (pre-Brief-64 anchor) |
| B27 | B | PASS | free_running default: EUI == 110.3 (pre-Brief-64 anchor) |
| B28 | B | PASS | free_running csp=28: cool_demand == 66.7 (pre-Brief-64 record) |
| B29 | B | PASS | free_running csp=18: cool_demand == 77.9 (pre-Brief-64 record) |
| B30 | B | PASS | csp=18: clamp cool_demand ≥ free_running cool_demand |
| B31 | B | PASS | baseline (csp=24 follow_comfort): clamp cool_demand ≥ free_running cool_demand |
| B32 | B | PASS | control_strategy toggle leaves heating_demand unchanged |
| B33 | B | PASS | control_strategy default (no field) == explicit active_setpoint |
| C01 | C | PASS | baseline: total_elec = Σ per-service elec |
| C02 | C | PASS | hsp_24: total_elec = Σ per-service elec |
| C03 | C | PASS | csp_18: total_elec = Σ per-service elec |
| C04 | C | PASS | vent_off: total_elec = Σ per-service elec |
| C05 | C | PASS | light_off: total_elec = Σ per-service elec |
| C06 | C | PASS | baseline: total_gas = Σ per-service gas |
| C07 | C | PASS | dhweff_lo: total_gas = Σ per-service gas |
| C08h | C | PASS | baseline: brief40.heating.demand == consumption.space_heating.demand |
| C08c | C | PASS | baseline: brief40.cooling.demand == consumption.space_cooling.demand |
| C08d | C | PASS | baseline: brief40.dhw.demand == consumption.dhw.demand |
| C09h | C | PASS | hsp_28: brief40.heating.demand == consumption.space_heating.demand |
| C09c | C | PASS | hsp_28: brief40.cooling.demand == consumption.space_cooling.demand |
| C09d | C | PASS | hsp_28: brief40.dhw.demand == consumption.dhw.demand |
| C10 | C | PASS | brief40.lighting.total_delivered == consumption.lighting.electricity |
| C11 | C | PASS | brief40.small_power.total_delivered == consumption.small_power.electricity |
| C12 | C | PASS | brief40.ventilation.total_fan == Σ consumption.ventilation[].fan_elec |
| C13 | C | PASS | consumption.total.eui ≈ brief40.totals.eui (≤0.5) |
| C14 | C | PASS | Brief 58 C: hb.gain.lighting (kWh) == consumption.lighting.elec × 1000 |
| C15 | C | PASS | Brief 58 C: hb.gain.equipment (kWh) == consumption.sp.elec × 1000 |
| C16 | C | PASS | demand.effective_heating_setpoint == losses_at_setpoint.setpoints_used.heating_c |
| C17 | C | PASS | demand.effective_cooling_setpoint == losses_at_setpoint.setpoints_used.cooling_c |
| C18 | C | PASS | heating_setpoint_source = "custom" when mode=custom |
| C19 | C | PASS | heating_setpoint_source = "comfortBand" when mode=follow_comfort |
| C19b | C | PASS | cooling_setpoint_source = "custom" when mode=custom |
| C19c | C | PASS | cooling_setpoint_source = "comfortBand" by default |
| C20 | C | PASS | baseline: heating_demand ≈ losses_at_setpoint − ig_offset − solar_beneficial |
| C20b | C | PASS | hsp_28: heating_demand ≈ losses_at_setpoint − ig_offset − solar_beneficial |
| C21 | C | PASS | losses_at_setpoint: Σ per-element heating_loss ≈ totals.total_heating_loss |
| C22 | C | PASS | internal_gains_bucketed: offset_h + added_c + shoulder = total |
| C23 | C | PASS | glazing solar: beneficial + contributing_cooling ≤ transmission (split, not duplicate) |
| D01_0 | D | PASS | sfp change: demand_heating_mwh unchanged |
| D01_1 | D | PASS | sfp change: demand_cooling_mwh unchanged |
| D01_2 | D | PASS | sfp change: demand_dhw_mwh unchanged |
| D01_3 | D | PASS | sfp change: heat_elec_mwh unchanged |
| D01_4 | D | PASS | sfp change: cool_elec_mwh unchanged |
| D01_5 | D | PASS | sfp change: dhw_elec_mwh unchanged |
| D01_6 | D | PASS | sfp change: dhw_gas_mwh unchanged |
| D01_7 | D | PASS | sfp change: light_elec_mwh unchanged |
| D01_8 | D | PASS | sfp change: sp_elec_mwh unchanged |
| D01_9 | D | PASS | sfp change: hb_gain_lighting_kwh unchanged |
| D01_10 | D | PASS | sfp change: hb_gain_equipment_kwh unchanged |
| D02_0 | D | PASS | seer change: demand_heating_mwh unchanged |
| D02_1 | D | PASS | seer change: demand_cooling_mwh unchanged |
| D02_2 | D | PASS | seer change: demand_dhw_mwh unchanged |
| D02_3 | D | PASS | seer change: heat_elec_mwh unchanged |
| D02_4 | D | PASS | seer change: heat_gas_mwh unchanged |
| D02_5 | D | PASS | seer change: dhw_elec_mwh unchanged |
| D02_6 | D | PASS | seer change: dhw_gas_mwh unchanged |
| D02_7 | D | PASS | seer change: fan_elec_mwh unchanged |
| D02_8 | D | PASS | seer change: light_elec_mwh unchanged |
| D02_9 | D | PASS | seer change: sp_elec_mwh unchanged |
| D03_0 | D | PASS | scop change: demand_heating_mwh unchanged |
| D03_1 | D | PASS | scop change: demand_cooling_mwh unchanged |
| D03_2 | D | PASS | scop change: demand_dhw_mwh unchanged |
| D03_3 | D | PASS | scop change: cool_elec_mwh unchanged |
| D03_4 | D | PASS | scop change: dhw_elec_mwh unchanged |
| D03_5 | D | PASS | scop change: dhw_gas_mwh unchanged |
| D03_6 | D | PASS | scop change: fan_elec_mwh unchanged |
| D03_7 | D | PASS | scop change: light_elec_mwh unchanged |
| D03_8 | D | PASS | scop change: sp_elec_mwh unchanged |
| D04_0 | D | PASS | dhw_efficiency change: demand_heating_mwh unchanged |
| D04_1 | D | PASS | dhw_efficiency change: demand_cooling_mwh unchanged |
| D04_2 | D | PASS | dhw_efficiency change: demand_dhw_mwh unchanged |
| D04_3 | D | PASS | dhw_efficiency change: heat_elec_mwh unchanged |
| D04_4 | D | PASS | dhw_efficiency change: cool_elec_mwh unchanged |
| D04_5 | D | PASS | dhw_efficiency change: fan_elec_mwh unchanged |
| D04_6 | D | PASS | dhw_efficiency change: light_elec_mwh unchanged |
| D04_7 | D | PASS | dhw_efficiency change: sp_elec_mwh unchanged |
| D04_8 | D | PASS | dhw_efficiency change: hb_gain_lighting_kwh unchanged |
| D04_9 | D | PASS | dhw_efficiency change: hb_gain_equipment_kwh unchanged |
| D04_10 | D | PASS | dhw_efficiency change: hb_gain_solar_total_kwh unchanged |
| D05_0 | D | PASS | dhw_litres change: heat_elec_mwh unchanged |
| D05_1 | D | PASS | dhw_litres change: cool_elec_mwh unchanged |
| D05_2 | D | PASS | dhw_litres change: heat_gas_mwh unchanged |
| D05_3 | D | PASS | dhw_litres change: fan_elec_mwh unchanged |
| D05_4 | D | PASS | dhw_litres change: light_elec_mwh unchanged |
| D05_5 | D | PASS | dhw_litres change: sp_elec_mwh unchanged |
| D05_6 | D | PASS | dhw_litres change: hb_gain_lighting_kwh unchanged |
| D05_7 | D | PASS | dhw_litres change: hb_gain_equipment_kwh unchanged |
| D05_8 | D | PASS | dhw_litres change: hb_gain_solar_total_kwh unchanged |
| D06_0 | D | PASS | dhw_load_shape change: demand_heating_mwh unchanged |
| D06_1 | D | PASS | dhw_load_shape change: demand_cooling_mwh unchanged |
| D06_2 | D | PASS | dhw_load_shape change: fan_elec_mwh unchanged |
| D06_3 | D | PASS | dhw_load_shape change: light_elec_mwh unchanged |
| D06_4 | D | PASS | dhw_load_shape change: sp_elec_mwh unchanged |
| D06_5 | D | PASS | dhw_load_shape change: hb_gain_lighting_kwh unchanged |
| D06_6 | D | PASS | dhw_load_shape change: hb_gain_equipment_kwh unchanged |
| D07_0 | D | PASS | no-op input clone: demand_heating_mwh unchanged |
| D07_1 | D | PASS | no-op input clone: demand_cooling_mwh unchanged |
| D07_2 | D | PASS | no-op input clone: demand_dhw_mwh unchanged |
| D07_3 | D | PASS | no-op input clone: heat_elec_mwh unchanged |
| D07_4 | D | PASS | no-op input clone: cool_elec_mwh unchanged |
| D07_5 | D | PASS | no-op input clone: dhw_elec_mwh unchanged |
| D07_6 | D | PASS | no-op input clone: dhw_gas_mwh unchanged |
| D07_7 | D | PASS | no-op input clone: fan_elec_mwh unchanged |
| D07_8 | D | PASS | no-op input clone: light_elec_mwh unchanged |
| D07_9 | D | PASS | no-op input clone: sp_elec_mwh unchanged |
| D07_10 | D | PASS | no-op input clone: total_elec_mwh unchanged |
| D07_11 | D | PASS | no-op input clone: total_gas_mwh unchanged |
| D07_12 | D | PASS | no-op input clone: eui_kwh_per_m2 unchanged |
| D07_13 | D | PASS | no-op input clone: carbon_kg_per_m2 unchanged |
| D08_0 | D | PASS | lighting_cf change: demand_dhw_mwh unchanged |
| D08_1 | D | PASS | lighting_cf change: dhw_elec_mwh unchanged |
| D08_2 | D | PASS | lighting_cf change: dhw_gas_mwh unchanged |
| D08_3 | D | PASS | lighting_cf change: fan_elec_mwh unchanged |
| D08_4 | D | PASS | lighting_cf change: sp_elec_mwh unchanged |
| D08_5 | D | PASS | lighting_cf change: hb_gain_equipment_kwh unchanged |
| D08_6 | D | PASS | lighting_cf change: hb_gain_solar_total_kwh unchanged |
| D09_0 | D | PASS | control_strategy toggle: demand_heating_mwh unchanged |
| D09_1 | D | PASS | control_strategy toggle: demand_dhw_mwh unchanged |
| D09_2 | D | PASS | control_strategy toggle: heat_elec_mwh unchanged |
| D09_3 | D | PASS | control_strategy toggle: heat_gas_mwh unchanged |
| D09_4 | D | PASS | control_strategy toggle: dhw_elec_mwh unchanged |
| D09_5 | D | PASS | control_strategy toggle: dhw_gas_mwh unchanged |
| D09_6 | D | PASS | control_strategy toggle: fan_elec_mwh unchanged |
| D09_7 | D | PASS | control_strategy toggle: light_elec_mwh unchanged |
| D09_8 | D | PASS | control_strategy toggle: sp_elec_mwh unchanged |
| D09_9 | D | PASS | control_strategy toggle: hb_gain_lighting_kwh unchanged |
| D09_10 | D | PASS | control_strategy toggle: hb_gain_equipment_kwh unchanged |
| D09_11 | D | PASS | control_strategy toggle: hb_gain_solar_total_kwh unchanged |
| D09_12 | D | PASS | control_strategy toggle: hb_loss_total_kwh unchanged |
| D10_0 | D | PASS | control_strategy toggle at csp=18: demand_heating_mwh unchanged |
| D10_1 | D | PASS | control_strategy toggle at csp=18: demand_dhw_mwh unchanged |
| D10_2 | D | PASS | control_strategy toggle at csp=18: heat_elec_mwh unchanged |
| D10_3 | D | PASS | control_strategy toggle at csp=18: heat_gas_mwh unchanged |
| D10_4 | D | PASS | control_strategy toggle at csp=18: dhw_elec_mwh unchanged |
| D10_5 | D | PASS | control_strategy toggle at csp=18: dhw_gas_mwh unchanged |
| D10_6 | D | PASS | control_strategy toggle at csp=18: fan_elec_mwh unchanged |
| D10_7 | D | PASS | control_strategy toggle at csp=18: light_elec_mwh unchanged |
| D10_8 | D | PASS | control_strategy toggle at csp=18: sp_elec_mwh unchanged |
| E01 | E | PASS | order independence: total_elec [A,B] == [B,A] |
| E02 | E | PASS | order independence: eui [A,B] == [B,A] |
| E03 | E | PASS | order independence: heating_fuel [A,B] == [B,A] |
| E04 | E | PASS | order independence: cooling_fuel [A,B] == [B,A] |
| E05 | E | PASS | order independence: demand_heating [A,B] == [B,A] |
| E06 | E | PASS | parity: baseline_edit(scop=4.0) ≈ intervention(scop=4.0) total_elec |
| E06b | E | PASS | parity: baseline_edit(scop=4.0) ≈ intervention(scop=4.0) eui |
| E07 | E | PASS | parity: baseline_edit(csp=18) ≈ intervention(csp=18) demand_cooling |
| E08 | E | PASS | parity: baseline_edit(csp=18) ≈ intervention(csp=18) total_elec |
| E09 | E | PASS | parity: baseline_edit(csp=18) ≈ intervention(csp=18) eui |
| E09b | E | PASS | parity: baseline_edit(light_cf=0.4) ≈ intervention total_elec |
| E09c | E | PASS | parity: baseline_edit(light_cf=0.4) ≈ intervention demand_heating (gain coupling) |
| E09d | E | PASS | parity: baseline_edit(control_strategy=free_running) ≈ intervention cool_demand |
| E09e | E | PASS | parity: baseline_edit(control_strategy=free_running) ≈ intervention EUI |
| E09f | E | PASS | parity: baseline_edit(control_strategy=free_running) ≈ intervention heating_demand |
| E10 | E | PASS | disabled intervention: total_elec equals empty-stack baseline |
| E11 | E | PASS | disabled intervention: eui equals empty-stack baseline |
| E12 | E | PASS | empty-stack baseline == direct-call baseline total_elec |
| E13 | E | PASS | empty-stack baseline == direct-call baseline eui |
| F01e | F | PASS | hsp_19→hsp_28: Δtotal_elec = Σ Δper-service elec |
| F01g | F | PASS | hsp_19→hsp_28: Δtotal_gas = Σ Δper-service gas |
| F01u | F | PASS | hsp_19→hsp_28: ΔEUI = (Δtotal_elec + Δtotal_gas) × 1000 / gia |
| F02e | F | PASS | baseline→scop_hi: Δtotal_elec = Σ Δper-service elec |
| F02g | F | PASS | baseline→scop_hi: Δtotal_gas = Σ Δper-service gas |
| F02u | F | PASS | baseline→scop_hi: ΔEUI = (Δtotal_elec + Δtotal_gas) × 1000 / gia |
| F03e | F | PASS | baseline→csp_18: Δtotal_elec = Σ Δper-service elec |
| F03g | F | PASS | baseline→csp_18: Δtotal_gas = Σ Δper-service gas |
| F03u | F | PASS | baseline→csp_18: ΔEUI = (Δtotal_elec + Δtotal_gas) × 1000 / gia |
| F04e | F | PASS | baseline→hre_hi: Δtotal_elec = Σ Δper-service elec |
| F04g | F | PASS | baseline→hre_hi: Δtotal_gas = Σ Δper-service gas |
| F04u | F | PASS | baseline→hre_hi: ΔEUI = (Δtotal_elec + Δtotal_gas) × 1000 / gia |
| F05e | F | PASS | baseline→light_cf_lo: Δtotal_elec = Σ Δper-service elec |
| F05g | F | PASS | baseline→light_cf_lo: Δtotal_gas = Σ Δper-service gas |
| F05u | F | PASS | baseline→light_cf_lo: ΔEUI = (Δtotal_elec + Δtotal_gas) × 1000 / gia |
| F06e | F | PASS | baseline→sfp_hi: Δtotal_elec = Σ Δper-service elec |
| F06g | F | PASS | baseline→sfp_hi: Δtotal_gas = Σ Δper-service gas |
| F06u | F | PASS | baseline→sfp_hi: ΔEUI = (Δtotal_elec + Δtotal_gas) × 1000 / gia |
| F07e | F | PASS | baseline→vent_off: Δtotal_elec = Σ Δper-service elec |
| F07g | F | PASS | baseline→vent_off: Δtotal_gas = Σ Δper-service gas |
| F07u | F | PASS | baseline→vent_off: ΔEUI = (Δtotal_elec + Δtotal_gas) × 1000 / gia |
| F08e | F | PASS | intervention csp=20 from baseline: Δtotal_elec = Σ Δper-service elec |
| F08g | F | PASS | intervention csp=20 from baseline: Δtotal_gas = Σ Δper-service gas |
| F08u | F | PASS | intervention csp=20 from baseline: ΔEUI = (Δtotal_elec + Δtotal_gas) × 1000 / gia |
| F09 | F | PASS | csp_18: brief40.cooling.demand == consumption.space_cooling.demand |
| F10 | F | PASS | hsp_28: brief40.heating.demand == consumption.space_heating.demand |
| F11 | F | PASS | vent_off: brief40.ventilation total fan == Σ per-system fan |
| F12 | F | PASS | light_off: brief40.lighting.total_delivered == consumption.lighting.elec |
| F13 | F | PASS | hsp_28: effective_heating_setpoint_c == losses_at_setpoint.setpoints_used.heating_c |
| F14 | F | PASS | csp_18: effective_cooling_setpoint_c == losses_at_setpoint.setpoints_used.cooling_c |
| F15e | F | PASS | hsp_19→hsp_24: Δtotal_elec = Σ Δper-service elec |
| F15g | F | PASS | hsp_19→hsp_24: Δtotal_gas = Σ Δper-service gas |
| F15u | F | PASS | hsp_19→hsp_24: ΔEUI = (Δtotal_elec + Δtotal_gas) × 1000 / gia |
| F16e | F | PASS | hsp_24→hsp_28: Δtotal_elec = Σ Δper-service elec |
| F16g | F | PASS | hsp_24→hsp_28: Δtotal_gas = Σ Δper-service gas |
| F16u | F | PASS | hsp_24→hsp_28: ΔEUI = (Δtotal_elec + Δtotal_gas) × 1000 / gia |
| F17e | F | PASS | csp_28→csp_22: Δtotal_elec = Σ Δper-service elec |
| F17g | F | PASS | csp_28→csp_22: Δtotal_gas = Σ Δper-service gas |
| F17u | F | PASS | csp_28→csp_22: ΔEUI = (Δtotal_elec + Δtotal_gas) × 1000 / gia |
| F18e | F | PASS | csp_22→csp_18: Δtotal_elec = Σ Δper-service elec |
| F18g | F | PASS | csp_22→csp_18: Δtotal_gas = Σ Δper-service gas |
| F18u | F | PASS | csp_22→csp_18: ΔEUI = (Δtotal_elec + Δtotal_gas) × 1000 / gia |

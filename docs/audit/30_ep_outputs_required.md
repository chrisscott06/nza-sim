# Brief 30 Phase 0.2 — Required EP `Output:Variable` list per state

**Scope:** What EP must emit at each state so the parser can read the heat balance directly (per Brief 30 Principle 1: "Dynamic computes its own answer"). Grouped by state — emission gating in Phase 1's `should_emit_for_state` helper consults this list.

**EnergyPlus target version:** V26.1.0 (per Chris call 2026-05-18).
**Source:** Brief 30 §0.2 spine + EP V26.1 InputOutputReference (`C:\EnergyPlusV26-1-0\Documentation\InputOutputReference.pdf`) + V26.1 EngineeringReference.

**Note:** Each "Reporting frequency" is `Hourly` unless stated otherwise. EP V26.1 valid frequencies are `Detailed`, `Timestep`, `Hourly`, `Daily`, `Monthly`, `RunPeriod`, `Environment`, `Annual`. Hourly is the right default for envelope work — fast enough for the diagnostic granularity we need, small enough that the SQL doesn't bloat unmanageably.

---

## State 1 — envelope-only

The zone is bounded by envelope only. No occupancy, no equipment, no lighting, no operable openings, no HVAC. The only ventilation is infiltration via q50-rated `ZoneInfiltration:DesignFlowRate`. Required variables to assemble the heat balance from EP outputs alone:

| EP Output:Variable | Frequency | Per | Purpose | EP V26.1 confirmed? | Notes |
|---|---|---|---|---|---|
| `Surface Inside Face Conduction Heat Transfer Energy` | Hourly | per BuildingSurface:Detailed | Per-element conduction loss/gain. Replaces Python `U × A × dT_air` re-derivation. Multi-layer CTF + sky long-wave + sol-air all baked in. | ✓ (used today, line 645 baseline) | Sign convention: positive = heat into zone. Parser groups by surface category (wall / roof / ground floor) via the surface naming pattern. |
| `Surface Outside Face Conduction Heat Transfer Energy` | Hourly | per BuildingSurface:Detailed | Diagnostic only — surface energy balance check (Inside − Outside should ≈ ΔU_storage in the wall). | ⚠ V26.1 NEW IN THIS BRIEF — verify name | Used to confirm CTF integration is closing per surface, catches assembler material-layer bugs. |
| `Surface Window Heat Loss Energy` | Hourly | per FenestrationSurface:Detailed | Per-window conduction loss (U × A × dT path, no solar). | ✓ V26.1 valid | Separate from inside face conduction; the window has its own balance. |
| `Surface Window Heat Gain Energy` | Hourly | per FenestrationSurface:Detailed | Per-window conduction gain (rare in UK). | ✓ V26.1 valid | Sign-conventioned opposite of Heat Loss. |
| `Surface Window Transmitted Solar Radiation Energy` | Hourly | per FenestrationSurface:Detailed | Per-window transmitted solar — what EP itself computes via SimpleGlazingSystem incidence-angle adjustment. Replaces Python `g × area × frame × incident` re-derivation. | ✓ (currently emitted, line 685 baseline; consumed only by 28-IM consumption block at line 640, not by State 1 parser) | The single most important variable for State 1 solar accuracy. |
| `Zone Infiltration Sensible Heat Loss Energy` | Hourly | per Zone | Replaces Python `UA_leakage × max(0, dT_air)`. EP integrates per-timestep wind/stack on the `DesignFlowRate` ach. | ✓ (currently emitted, line 669 baseline; consumed only by 28-IM consumption block line 634, not by State 1) | |
| `Zone Infiltration Sensible Heat Gain Energy` | Hourly | per Zone | Counterpart to above when T_out > T_air (rare in winter, common in summer). | ✓ (currently emitted, line 670 baseline) | |
| `Zone Mean Air Temperature` | Hourly | per Zone | Display only — the free-running zone temp. NOT used for re-derivation per Brief 30 Principle 1. | ✓ (currently emitted line 658, consumed line 1521) | |
| `Zone Operative Temperature` | Hourly | per Zone | Comfort-hour counting (T_op gates the under/in/over band). Display only — not for re-derivation. | ✓ (currently emitted line 659, consumed line 1522) | |
| `Site Outdoor Air Drybulb Temperature` | Hourly | Site (single) | Context for the T_zone trace + EPW sanity check. | ⚠ V26.1 NEW IN THIS BRIEF — verify name | Not currently emitted; parser currently reads T_out from the raw EPW file. Emit via EP for consistency. |
| `Surface Outside Face Sunlit Fraction` | Hourly | per surface | Brief 23 shading-audit diagnostic — confirms external shading geometry is reducing solar on shaded surfaces. | ✓ (currently emitted line 680, never consumed) | Keep emitted for diagnostic; not core to heat balance. |

**State 1 total: 11 variables. 7 of these are currently emitted but not consumed by the State 1 parser (a structural Brief 29 Issue #8). 2 must be added (Outside Face Conduction, Site Outdoor Air Drybulb Temperature) — flagged ⚠ for Phase 0.3 schema confirmation.**

---

## State 2 — internal gains added

Adds People, Lights, ElectricEquipment to State 1's envelope. Still no operable openings, no HVAC. Additional variables on top of State 1's list:

| EP Output:Variable | Frequency | Per | Purpose | EP V26.1 confirmed? | Notes |
|---|---|---|---|---|---|
| `Zone People Total Heating Energy` | Hourly | per Zone | Sensible + latent people heat (sensible portion drives T_zone). | ✓ (currently emitted, consumed at line 1072 + 1850) | |
| `Zone People Sensible Heating Energy` | Hourly | per Zone | Sensible-only portion — directly affects T_zone heat balance. | ⚠ V26.1 NEW IN THIS BRIEF — verify name | Currently only the total is read; the sensible split needs to be explicit for invariant work. |
| `Zone People Latent Gain Energy` | Hourly | per Zone | Latent moisture gain — doesn't affect T_zone directly but tracked for cross-check and future humidity work. | ⚠ V26.1 NEW IN THIS BRIEF — verify name | |
| `Zone Lights Total Heating Energy` | Hourly | per Zone | Heat actually delivered to zone air (accounts for fraction-radiant/visible/convective). | ✓ (currently emitted line 665, consumed lines 1077 / 1851) | |
| `Zone Lights Electricity Energy` | Hourly | per Zone | Delivered electrical input. Should equal Total Heating Energy for non-daylighting Lights objects (100% of electricity becomes heat). Cross-check invariant. | ✓ (currently emitted line 664) | |
| `Zone Electric Equipment Total Heating Energy` | Hourly | per Zone | Heat to zone from equipment. | ✓ (currently emitted, consumed) | |
| `Zone Electric Equipment Electricity Energy` | Hourly | per Zone | Delivered electrical input. Same cross-check as Lights. | ✓ (currently emitted, consumed) | |
| `Zone Total Internal Total Heating Energy` | Hourly | per Zone | EP-computed sum of People + Lights + ElectricEquipment + HotWaterEquipment + GasEquipment etc. **Critical cross-check**: Σ components computed by parser must agree with this within 0.1%. | ⚠ V26.1 NEW IN THIS BRIEF — verify name (may be `Zone Total Internal Sensible Heat Gain Energy` or similar in V26.1) | |

**State 2 total: 11 (State 1) + 8 (State 2-specific) = 19 variables. 4 new emission requests flagged ⚠.**

---

## State 2.5 — operation added

Adds operable openings (windows, doors, vents) with schedule + temperature control. Still no mechanical systems. Additional variables on top of State 2's list:

| EP Output:Variable | Frequency | Per | Purpose | EP V26.1 confirmed? | Notes |
|---|---|---|---|---|---|
| `Zone Ventilation Sensible Heat Loss Energy` | Hourly | per Zone | Heat loss through operable openings (the `ZoneVentilation:WindandStackOpenArea` emission). EP integrates per-timestep wind + stack + schedule + temperature-gate logic. | ✓ (currently emitted line 671, consumed at line 1094) | |
| `Zone Ventilation Sensible Heat Gain Energy` | Hourly | per Zone | Counterpart for cooling-direction flow (summer). | ✓ (currently emitted line 672, never consumed — gain side missing from State 2 parser) | |
| `AFN Zone Infiltration Sensible Heat Loss Energy` | Hourly | per Zone | Only emitted if `AirflowNetwork:*` objects are present. Bridgewater doesn't use AFN today — but flag for future. | ⚠ V26.1 NOT IN CURRENT BUILD — verify name when AFN is wired | Bridgewater envelope-only baseline uses `ZoneVentilation:WindandStackOpenArea` not AFN, so this variable will be empty. |
| `AFN Zone Infiltration Sensible Heat Gain Energy` | Hourly | per Zone | AFN counterpart. | ⚠ Same as above | |
| `AFN Linkage Node 1 to Node 2 Mass Flow Rate` | Hourly | per AFN linkage | AFN-only diagnostic — per-opening flow trace. | ⚠ Same as above | Useful for the future AFN-based future where opening flows are per-room rather than zone-aggregated. |
| `Schedule Value` | Hourly | per Schedule object | Diagnostic — confirms the opening control schedule is doing what the user intended. Especially useful for Brief 28e's per-opening control modes. | ⚠ V26.1 NEW IN THIS BRIEF — verify name | Lightweight; can request only for the opening-control schedules to avoid SQL bloat. |

**State 2.5 total: 19 (State 2) + 6 (State 2.5-specific, but 3 are AFN-only) = 22–25 depending on AFN. 4 new emission requests flagged ⚠.**

---

## State 3 — systems added

Adds HVAC, thermostat, mechanical vent, DHW, lighting controls. Heating + cooling demand are computed by EP here. Additional variables:

| EP Output:Variable | Frequency | Per | Purpose | EP V26.1 confirmed? | Notes |
|---|---|---|---|---|---|
| `Zone Ideal Loads Supply Air Total Heating Energy` | Hourly | per Zone | IdealLoads heating demand (when IdealLoads is the system). | ✓ (currently emitted line 660, consumed line 276 etc.) | |
| `Zone Ideal Loads Supply Air Total Cooling Energy` | Hourly | per Zone | IdealLoads cooling demand. | ✓ (currently emitted line 661, consumed line 277 etc.) | |
| `Zone Air System Sensible Heating Energy` | Hourly | per Zone | Energy actually delivered to zone air by the HVAC system (works for any system, not just IdealLoads). | ⚠ V26.1 NEW IN THIS BRIEF — verify name (might be `Zone Air System Sensible Heating Rate` × time) | Brief 30 §4.2 names this as the EP-native demand reading. |
| `Zone Air System Sensible Cooling Energy` | Hourly | per Zone | Counterpart. | ⚠ Same | |
| For VRF systems: `VRF Heat Pump Heating Electricity Energy` | Hourly | per VRF outdoor unit | VRF electric demand for heating. | ⚠ V26.1 verify exact name (was renamed between V23 and V25) | Used by SCOP/COP back-calculation. |
| For VRF systems: `VRF Heat Pump Cooling Electricity Energy` | Hourly | per VRF outdoor unit | Counterpart. | ⚠ Same | |
| For gas boilers: `Boiler Heating Energy` | Hourly | per Boiler:HotWater | Energy actually delivered by boiler. | ✓ V26.1 valid | |
| For gas boilers: `Boiler NaturalGas Energy` | Hourly | per boiler | Gas input. Cross-check: `Boiler NaturalGas Energy × efficiency ≈ Boiler Heating Energy`. | ⚠ V26.1 verify (V24 renamed from `Boiler Gas Energy`) | |
| For MVHR: `Heat Exchanger Total Heating Energy` | Hourly | per HeatExchanger:AirToAir:SensibleAndLatent | Recovered heat from extract → supply. | ⚠ V26.1 verify | |
| For MVHR: `Heat Exchanger Sensible Effectiveness` | Hourly | per HX | Recovery efficiency — verify against design. | ⚠ V26.1 verify | |
| `Fan Electricity Energy` | Hourly | per Fan:* | Parasitic fan energy. | ✓ (currently emitted line 673) | |
| `Pump Electricity Energy` | Hourly | per Pump:* | Parasitic pump energy (boilers, chillers, MVHR loops). | ⚠ V26.1 verify | |
| `Water Use Equipment Hot Water Energy` | Hourly | per WaterUse:Equipment | DHW delivered energy. | ⚠ V26.1 verify | |
| `Water Heater Heating Energy` | Hourly | per WaterHeater:Mixed | Hot water generation. | ⚠ V26.1 verify | |
| `Water Heater Source Side Heat Transfer Energy` | Hourly | per WaterHeater | Source side (gas/electric) energy. | ⚠ V26.1 verify | |
| Daylighting Reference Point Illuminance | Hourly | per ReferencePoint | Illuminance for daylighting controls verification. | ⚠ V26.1 verify | |

**State 3 total: 19 (State 2) + 5 (State 2.5 non-AFN) + 14–16 (State 3-specific) = 38–40 variables. Many flagged ⚠ pending V26.1 confirmation.**

Plus the existing `Output:Meter` set (`Heating:EnergyTransfer`, `Cooling:EnergyTransfer`, etc.) which the parser already consumes correctly per the baseline doc.

---

## Cross-cutting: what to STOP emitting

Per Brief 30 Principle 4 (object removal) and Principle 1 (parser does not re-derive), the following currently-emitted variables can be **dropped** because the parser will no longer need them:

- `Zone People Occupant Count` (#5 in baseline) — diagnostic-only, no parser need
- `Zone Hot Water Equipment Electricity Energy` (#11) — never consumed
- `Zone Ventilation Sensible Heat Gain Energy` (#15) — currently emitted but no parser path reads the gain side; keep emitted in State 2.5 (per required list above) but drop in States where ventilation = infiltration only
- `Fan Electricity Energy` (#16 per-fan) — superseded by `Fans:Electricity` meter; can be dropped
- `Zone Ideal Loads Heat Recovery Total Heating Energy` (#22) — never consumed, only relevant when IdealLoads is the system AND MVHR is being modelled via IdealLoads' built-in recovery (not how the assembler does it today)
- `Zone Ideal Loads Heat Recovery Total Cooling Energy` (#23) — same
- `Baseboard Gas Energy` (#24), `Baseboard Total Heating Energy` (#25), `Baseboard Electricity Energy` (#26) — no project uses baseboard heaters; drop entirely

**State-aware output gating.** Per Brief 30 Principle 4, Phase 1's `should_emit_for_state` governs OBJECT emission. I recommend extending the same helper to govern OUTPUT request emission — keeps the contract symmetrical and SQL clean. E.g. don't request `Zone People Total Heating Energy` in State 1 mode; EP would emit zero columns otherwise.

---

## Open items for Phase 0.3 schema lock

Variables flagged ⚠ in the tables above need V26.1 name confirmation before Phase 1 begins:

1. `Surface Outside Face Conduction Heat Transfer Energy` (State 1)
2. `Site Outdoor Air Drybulb Temperature` (State 1)
3. `Zone People Sensible Heating Energy` (State 2 — sensible split)
4. `Zone People Latent Gain Energy` (State 2 — latent split)
5. `Zone Total Internal Total Heating Energy` (State 2 — sum for invariant)
6. `Schedule Value` (State 2.5 — diagnostic)
7. `Zone Air System Sensible Heating Energy` (State 3 — system-agnostic demand)
8. `Zone Air System Sensible Cooling Energy` (State 3)
9. `VRF Heat Pump Heating Electricity Energy` (State 3 VRF)
10. `VRF Heat Pump Cooling Electricity Energy` (State 3 VRF)
11. `Boiler NaturalGas Energy` (State 3 gas boilers — renamed from `Boiler Gas Energy`)
12. `Heat Exchanger Total Heating Energy` (State 3 MVHR)
13. `Heat Exchanger Sensible Effectiveness` (State 3 MVHR)
14. `Pump Electricity Energy` (State 3)
15. `Water Use Equipment Hot Water Energy` (State 3 DHW)
16. `Water Heater Heating Energy` (State 3 DHW)
17. `Water Heater Source Side Heat Transfer Energy` (State 3 DHW)
18. AFN variables (State 2.5 if AFN is wired in future)

Phase 0.3 will confirm these against the V26.1 InputOutputReference and EP's own `.rdd` (Report Data Dictionary) output — which lists every Output:Variable EP knows how to produce in the current configuration. I'll run a one-off `eplusout.rdd` extract from yesterday's baseline run to cross-reference.

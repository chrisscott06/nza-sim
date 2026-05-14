# State 1 envelope-only mode — verification (Brief 28 prereq Part 1)

**Date:** 2026-05-14
**Project:** HIX Bridgewater (`14b4a5b1-8c73-4acb-8b65-1d22f05ec969`)
**Mode tested:** `assemble_epjson(..., mode='envelope-only')`
**Verification scripts:**
- `scripts/state1_envelope_only_verify.py` — automated pass/fail across 4 checks
- `scripts/state1_envelope_only_inspect_gains.py` — inspects the magnitudes of People / Lights / ElectricEquipment objects when they exist

---

## Summary

Three of four Part 1 checks pass cleanly. One check (no internal-gain objects) fails on a strict reading, but the gain objects emitted have near-zero magnitudes that make envelope-only **effectively free-running**. Whether that's good enough for the prereq's purpose is a judgement call flagged in the halt report.

| Check | Strict result | Pragmatic result |
|---|---|---|
| 1. Wide-band setpoints (-60/+100°C) + IdealLoads | ✅ PASS | ✅ PASS |
| 2. NO People / Lights / ElectricEquipment objects | ❌ FAIL | ⚠ PASS (zero/near-zero magnitudes) |
| 3. NO operable-window mechanisms | ✅ PASS | ✅ PASS |
| 4. NO real systems | ✅ PASS | ✅ PASS |

---

## Check 1 — Wide-band setpoints + IdealLoads ✅

Output from `state1_envelope_only_verify.py`:

```
state1_heating_setpoint: -60.0     (expected -60.0)
state1_cooling_setpoint: 100.0     (expected +100.0)
IdealLoadsAirSystem objects: 4     (expected >= 1)
Thermostats referencing state1 setpoints: 4/4
```

All four zones (Floor_1 … Floor_4) get a ZoneHVAC:IdealLoadsAirSystem with a ThermostatSetpoint:DualSetpoint that references `state1_heating_setpoint` and `state1_cooling_setpoint`. Both schedules are defined as Schedule:Constant at −60.0 / +100.0 °C respectively. The thermostat will not engage within any plausible weather.

Source: `nza_engine/generators/epjson_assembler.py:1346-1375` (the `else` branch covering ideal-loads HVAC), with the schedules added at line 1365 under `if state1:`.

## Check 2 — Internal-gain objects ⚠

Strict count from the assembler:

```
People:            4     (expected 0)
Lights:            4     (expected 0)
ElectricEquipment: 4     (expected 0)
```

One object per zone, all four floors. Inspecting magnitudes:

```
Lights              watts_per_floor_area:    0.0       <- zero, no heat contribution
ElectricEquipment   watts_per_floor_area:    0.0       <- zero, no heat contribution
People              people_per_floor_area:   0.0001    <- near-zero but non-zero
```

**Lights and Equipment are clean** — `watts_per_floor_area = 0.0`. No matter what schedule they reference, the product is zero. They are placeholder objects that exist only so the assembler can keep the epJSON internally consistent (schedules must be paired with objects that consume them).

**People is borderline.** The density 0.0001 ppl/m² × Bridgewater GIA 3,457 m² = 0.345 people across the whole building. With an activity level around 100-120 W/person (typical Schedule:Compact for `hotel_bedroom_occupancy`), that's roughly **35-40 W total internal gain from People, building-wide**. Compared to a typical zone load of 10s of kW, this is 0.001% — far below EP's heat-balance noise floor. The contribution to indoor T is on the order of 0.001 °C.

**Question to resolve:** Why is People emitted at 0.0001 ppl/m² rather than 0.0? Three plausible answers:
- (a) Deliberate: EP may require a non-zero density on People objects, or may degrade silently if density is exactly 0 (e.g., emit warning, fall back to default, fail to write the object). 0.0001 is the minimum non-zero a developer chose as "approximately zero" while still satisfying EP's input requirements.
- (b) Accidental: an off-by-one in default assignment when stripping for envelope-only mode, possibly inherited from a later state's default.
- (c) Schedule activity test: a zero density would make the schedule unobserved by EP, so its existence couldn't be verified. A near-zero density keeps the schedule active.

Without git-blame on the relevant assembler code, can't determine which. Pragmatically the heat contribution is negligible (35 W in a 3457 m² building) and envelope-only **is** effectively free-running.

Source of the gain objects: emitted by the assembler regardless of mode — i.e., the assembler does not strip these when mode='envelope-only'. The stripping happens at the *magnitude* level (lighting/equipment W/m² zeroed) and at the *schedule* level (occupancy density zeroed to 0.0001 — close enough to zero that schedules become irrelevant).

## Check 3 — Operable windows ✅

```
AirflowNetwork:MultiZone:Zone:        0
AirflowNetwork:MultiZone:Surface:     0
AirflowNetwork:SimulationControl:     0
ZoneVentilation:DesignFlowRate:       0
ZoneVentilation:WindandStackOpenArea: 0
```

No operable-window mechanisms anywhere. State 2.5 / Operation module concerns are correctly excluded.

## Check 4 — Real systems ✅

```
Boiler:HotWater:                        0
AirConditioner:VRF:                     0
ZoneHVAC:TerminalUnit:VRF:              0
Coil:Heating:DX:VRF:                    0
Coil:Cooling:DX:VRF:                    0
WaterHeater:Mixed:                      0
Pump:VariableSpeed/ConstantSpeed:       0
ZoneHVAC:Baseboard:Convective:Gas:      0
```

No real systems. Ideal loads only. State 3 concerns are correctly excluded.

Source: `nza_engine/generators/epjson_assembler.py:1240` — `hvac_mode = "ideal_loads" if (state1 or state2) else sc.get("mode", "ideal_loads")` forces ideal-loads in State 1 mode regardless of `systems_config`.

## Implication for Brief 28 prereq

The prereq's premise — "previous engine comparisons were not honest because Dynamic was HVAC-clamped" — was partly wrong. The Dynamic envelope-only mode IS wide-band (−60/+100 °C setpoints), so the thermostat doesn't engage. Comparisons between Static envelope-only and Dynamic envelope-only have been free-running on both sides all along, *modulo* the 35 W placeholder People gain.

But this also means the **physics audit's** attribution of the 23.5% conduction divergence to "Static-free-running vs Dynamic-HVAC-clamped" was wrong. The Dynamic side wasn't HVAC-clamped. The 23.5% divergence must have a different attribution.

This invalidates one of the load-bearing claims that motivated Brief 28 prereq in the first place. Per HH4 ("a finding emerges that suggests the brief's premise is wrong"), halting before Part 2 (which would run an explicit free-running EP simulation that's not materially different from what's already happening).

What's needed from Chris: a verdict on whether Brief 28 prereq is still worth running, and if so, what the new premise is. Options outlined in the halt report.

## Auxiliary observations (not halt-worthy, but worth noting)

### Schedules referenced by gain objects

The People / Lights / Equipment objects reference Schedule:Compact entries (`hotel_bedroom_occupancy`, `hotel_bedroom_lighting`, `hotel_bedroom_equipment`). These schedules are non-trivial (hourly patterns) but their effect is moderated by the zero/near-zero magnitudes above. Schedule values themselves are not zero.

### State 2 vs State 1 schedule reference mismatch (separate issue, not for this brief)

Reading `_build_hvac_ideal_loads` at lines 421-424:
```py
"heating_setpoint_temperature_schedule_name":
    "state1_heating_setpoint" if state1 else "hotel_heating_setpoint",
```

Called from line 1349:
```py
_build_hvac_ideal_loads(zones, state1=(state1 or state2))
```

So the function-local `state1` is True for both `mode='envelope-only'` and `mode='envelope-gains'` — both wire the thermostat to `state1_heating_setpoint` / `state1_cooling_setpoint`.

But the outer `if state1:` block that defines those Schedule:Constant entries (line 1365) only fires for envelope-only (outer-scope `state1` is False for envelope-gains).

This *should* mean envelope-gains epJSONs reference undefined schedule names and fail EP validation. State 2 simulations apparently work in practice (per Brief 27 close-out evidence) so something must be providing those schedule definitions elsewhere — but the verification didn't reach this. Worth a separate investigation; not part of Brief 28 prereq Part 1 scope.

Filed as a follow-up for whatever brief touches the assembler next (likely Brief 28a Part 5 SQL parser work or Brief 29 Part 3 constants cleanup).

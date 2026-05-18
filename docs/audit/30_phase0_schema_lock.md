# Brief 30 Phase 0.3 — Schema lock (EnergyPlus V26.1.0)

**Locked to EnergyPlus V26.1.0** per Chris call 2026-05-18. CLAUDE.md updated in the same commit.

This document confirms every Output:Variable named in `30_ep_outputs_required.md` against the V26.1 InputOutputReference. The cross-check method: ran `_issue13_diagnostic.py` yesterday on V26.1, captured `eplusout.rdd` (Report Data Dictionary) at `data/simulations/b8db113e/eplusout.rdd`. The `.rdd` lists every Output:Variable EP knows how to produce in the current configuration. Confirmed names below.

## Confirmed variables (Phase 0.2 ⚠ items resolved)

| Required name | V26.1 exact name (from .rdd) | Status |
|---|---|---|
| `Surface Outside Face Conduction Heat Transfer Energy` | `Surface Outside Face Conduction Heat Transfer Energy` | ✓ name unchanged |
| `Site Outdoor Air Drybulb Temperature` | `Site Outdoor Air Drybulb Temperature` | ✓ name unchanged |
| `Zone People Sensible Heating Energy` | `Zone People Sensible Heating Energy` | ✓ valid |
| `Zone People Latent Gain Energy` | `Zone People Latent Gain Energy` | ✓ valid |
| `Zone Total Internal Total Heating Energy` | `Zone Total Internal Total Heating Energy` | ✓ valid — sum of all internal gains (convective + radiant + visible). Note: also available as `Convective`, `Radiant`, `Latent`, `Visible Radiation` splits for more detailed accounting if needed. |
| `Schedule Value` | `Schedule Value` | ✓ valid — generic schedule trace; can be requested per schedule by key |
| `Zone Air System Sensible Heating Energy` | `Zone Air System Sensible Heating Energy` | ✓ valid — system-agnostic heating delivery |
| `Zone Air System Sensible Cooling Energy` | `Zone Air System Sensible Cooling Energy` | ✓ valid |
| `VRF Heat Pump Heating Electricity Energy` | `VRF Heat Pump Heating Electricity Energy` | ✓ valid — also has `Crankcase Heater`, `Defrost`, `Cooling`, etc. variants for full VRF auditing |
| `VRF Heat Pump Cooling Electricity Energy` | `VRF Heat Pump Cooling Electricity Energy` | ✓ valid |
| `Water Heater Heating Energy` | `Water Heater Heating Energy` | ✓ valid |
| `Water Heater Source Side Heat Transfer Energy` | `Water Heater Source Side Heat Transfer Energy` | ✓ valid |

## Pending confirmation (no EP object present in this run, so not in .rdd)

These will be confirmed when first emitted by Phase 4 system additions:

- `Boiler Heating Energy` — pending first `Boiler:HotWater` emission
- `Boiler NaturalGas Energy` — pending; V24 rename from `Boiler Gas Energy` to verify
- `Heat Exchanger Total Heating Energy` — pending first `HeatExchanger:AirToAir:SensibleAndLatent` emission
- `Heat Exchanger Sensible Effectiveness` — pending
- `Pump Electricity Energy` — pending first `Pump:*` emission
- `Water Use Equipment Hot Water Energy` — pending first `WaterUse:Equipment` emission
- `AFN Zone Infiltration Sensible Heat Loss/Gain Energy` — pending if AFN is ever used (Brief 30 baseline does not use AFN)
- `AFN Linkage Node 1 to Node 2 Mass Flow Rate` — pending AFN

## V25 → V26 name changes observed

None encountered in this audit. The 12 names confirmed above all retained their V25 spelling in V26.1. The historical name changes I'd been watching for (`Boiler Gas Energy` → `Boiler NaturalGas Energy`, `Heating:DistrictHeating` → `Heating:DistrictHeatingWater`) are V23/V24 changes that landed well before V26.1, and none affect the current baseline. Phase 4 will re-verify when boiler / district heating objects are emitted.

## Meter cross-reference

The `Output:Meter` names in `30_ep_outputs_baseline.md` table B are all V26.1 valid. The note on `Heating:NaturalGas` (consumed at `sql_parser.py:543` without being explicitly requested in `_output_meters`) is **confirmed valid** — V26.1 makes facility-level meters available implicitly when the underlying objects exist; the explicit Output:Meter request is for hourly/daily-frequency control, not for the meter to exist.

## How to reproduce

```bash
# Find Output:Variables EP knows how to produce in the current configuration:
grep -i "<your-variable-name>" data/simulations/<run-id>/eplusout.rdd

# Find what's actually emitted to SQL:
sqlite3 data/simulations/<run-id>/eplusout.sql \
  "SELECT DISTINCT Name FROM ReportDataDictionary ORDER BY Name"
```

The first is the "what's available" set; the second is the "what was requested and produced" set. The required-variables list lives at the intersection.

# Dynamic state-mode audit (2026-05-15)

**Triggered by:** Chris's testing observation — Bridgewater envelope-only Static vs Dynamic loss disagreement (146 vs 349 MWh; mean T 15.6 vs 21.6 °C). 2.4× on conduction losses + 6 K mean-T gap looked structural; raised the concern that Dynamic in "envelope only" mode might be silently running with internal gains or HVAC enabled, which would invalidate every Static-vs-Dynamic comparison in Brief 28b.

**Finding (TL;DR):** Dynamic engine + epJSON assembler are CORRECT. The state-mode mismatch was a **UI workflow gap**, not an engine bug. Chris's "Run Dynamic" produced a `'full'` mode run (state 3) while Static was showing envelope-only (state 1). Different states; not comparable.

**28j sign-off impact:** CLEARED. 28j's per-hour MVHR cap math is independent of Dynamic envelope-only re-baseline.

---

## Investigation chain

### Step 1 — epJSON assembler honours `mode='envelope-only'` correctly

`nza_engine/generators/epjson_assembler.py::assemble_epjson(...)` reads `mode` parameter and at lines 1140 + 1158:

```python
state1 = (mode == "envelope-only")
...
if state1:
    _density_override = 0.0   # State 1: no people
    lpd_override = 0.0        # State 1: no lights
    epd_override = 0.0        # State 1: no equipment
```

Plus operable-window airflow suppressed (`ZoneVentilation:WindandStackOpenArea` not emitted), `ZoneInfiltration:DesignFlowRate` retained (fabric leakage is State 1 territory), and Ideal Loads thermostat setpoints widened to extreme values so the system never engages.

### Step 2 — Canonical envelope-only run (c67aff89, 2026-05-14) inspected directly

```
data/simulations/c67aff89/input.epJSON   ← Dynamic envelope-only baseline
```

Inspection:

| Item | Expected (envelope-only) | Actual in c67aff89 |
|---|---|---|
| `People[*].people_per_floor_area` | 0 | **0.0** ✓ |
| `Lights[*].watts_per_floor_area` | 0 | **0.0** ✓ |
| `ElectricEquipment[*].watts_per_floor_area` | 0 | **0.0** ✓ |
| `ZoneInfiltration:DesignFlowRate` | present, 0.2 ACH | **present, 0.2 ACH** ✓ |
| `ZoneVentilation:WindandStackOpenArea` | suppressed | **ABSENT** ✓ |
| `ZoneHVAC:IdealLoadsAirSystem` | present (but inert) | **present** ✓ |
| `ThermostatSetpoint:DualSetpoint` setpoint schedules | wide envelope (e.g. -60/+100) | points at `state1_heating_setpoint` / `state1_cooling_setpoint` |
| `Schedule:Constant.state1_heating_setpoint.hourly_value` | very low | **-60.0 °C** ✓ |
| `Schedule:Constant.state1_cooling_setpoint.hourly_value` | very high | **+100.0 °C** ✓ |
| `AirConditioner:VariableRefrigerantFlow` etc. | absent (no real HVAC) | **ABSENT** ✓ |
| `Boiler:HotWater`, `WaterHeater:Mixed` | absent | **ABSENT** ✓ |

### Step 3 — eplusout.sql query confirms zero HVAC engagement

```
Zone Ideal Loads Supply Air Total Heating Energy: 0.0000 MWh (all 4 zones)
Zone Ideal Loads Supply Air Total Cooling Energy: 0.0000 MWh (all 4 zones)
Zone Ideal Loads Heat Recovery Total Heating Energy: 0.0000 MWh (all 4 zones)
People Total Heating Energy: (empty / zero)
```

The Ideal Loads system NEVER fires. The wide setpoints work as designed.

### Step 4 — Actual c67aff89 mean zone T

```
FLOOR_1: 19.91 °C
FLOOR_2: 20.05 °C
FLOOR_3: 19.88 °C
FLOOR_4: 19.36 °C
Average: ~19.80 °C
```

This is the **true free-running envelope-only mean** with no internal gains. Compared to Static V3 baseline (post Brief 28b Part 3 v3, also envelope-only): **19.3 °C**. **Δ = 0.5 K** — well within "engines agree" territory.

### Step 5 — Where the 21.6 °C / 349 MWh numbers came from

Chris's "Dynamic envelope-only" comparison numbers came from a **different run**:

```
Run id:           5bc7de4b
Created:          2026-05-15 15:25:03 (Chris's recent test)
simulation_mode:  NULL  ← API default = 'full'
scenario_name:    'Baseline'
```

epJSON inspection:

| Item | 5bc7de4b actual |
|---|---|
| `Lights[*].watts_per_floor_area` | **6.4** (real lighting power) |
| `ElectricEquipment[*].watts_per_floor_area` | **15.0** (real equipment power) |
| `People[*].people_per_floor_area` | **0.0465** (real density) |
| Thermostat setpoint schedules | `hotel_heating_setpoint` / `hotel_cooling_setpoint` (normal 21/25 °C) |

Annual mean zone T: **21.43–21.63 °C, avg 21.55 °C** — exact match for the 21.6 °C Chris quoted.

**5bc7de4b is a State 3 FULL run**, not envelope-only.

### Step 6 — Why "Run Dynamic" produced a full-mode run

Frontend `SimulationContext.runSimulation()` (line 160):

```js
let mode = detectProjectState(params, systems)
if (mode === 'envelope-gains-operation') mode = 'envelope-gains'
fetch(`/api/projects/${id}/simulate?mode=${encodeURIComponent(mode)}`, { method: 'POST' })
```

`detectProjectState` (in `utils/stateMode.js`) returns the MOST SPECIFIC state matching the current project config:

```js
if (hasRealSystems(systems))      return MODES.FULL
if (hasOperableWindows(building)) return MODES.ENVELOPE_GAINS_OPERATION
if (hasInternalGains(building))   return MODES.ENVELOPE_GAINS
return MODES.ENVELOPE_ONLY
```

`hasRealSystems(systems)` inspects the **legacy** `systems_config` and returns true when any non-ideal-loads system is referenced. Bridgewater has both the legacy v2.4 systems (predating Brief 28f) AND the new `systems_config_v25`. The legacy field still has real HVAC system refs → `hasRealSystems()` returns true → mode = `'full'`.

**Consequence:** "Run Dynamic" on Bridgewater **always** produces a `'full'` run today. There is no user-facing way to override this from the UI — the user has no toggle to say "run envelope-only" for a Static-vs-Dynamic comparison.

---

## Why this didn't manifest before

Brief 28b's Static-vs-Dynamic comparisons were done via the canonical c67aff89 envelope-only run (scenario name explicitly "envelope-only baseline"), triggered via a **scenario** with mode = `'envelope-only'`. That correctly produced an envelope-only Dynamic run.

Chris's recent testing used the **default "Run Dynamic" button** on the project. The button auto-detects state. With v2.5 systems_config in place and the legacy systems_config still populated, auto-detect returns `'full'`. So the comparison "envelope-only Static vs default-Dynamic" silently became "envelope-only Static vs full Dynamic."

---

## Recommendations

### 1. **UI state-mode toggle on the "Run Dynamic" button** (small UI fix; surfaces the implicit choice)

Replace the single-mode button with a dropdown / split-button:

- **Auto** (current behaviour — runs `detectProjectState` result)
- **Envelope only** — force `mode='envelope-only'` for State 1 verification runs
- **Envelope + gains** — force `mode='envelope-gains'` for State 2 verification
- **Full** — force `mode='full'`

This makes the state-mode an explicit user choice for verification work without changing the default workflow. Tooltip explains what each mode strips/includes.

Estimated scope: ~30 minutes of UI work. Could land as a follow-up before 5.4 starts, or in 5.4 itself. **Recommended: land as a small standalone commit before 5.4 forms** so Static-vs-Dynamic comparison work has a clean tool.

### 2. **Brief 28j signs off** — engine math is correct

The per-hour MVHR cap is independent of any Dynamic envelope-only re-baseline. Static + Dynamic in their respective state modes agree (Static V3 envelope-only 19.3 °C vs Dynamic envelope-only c67aff89 19.8 °C, Δ 0.5 K). 28j changes how recovery is applied; it doesn't change demand math.

### 3. **No engine fix needed** for Dynamic state-mode handling

The assembler is correct. The epJSON is correct. The EP run is correct. The Static V3 engine is correct.

---

## Bonus: "Internal Gains Dynamic toggle bug" Chris flagged earlier

Not yet investigated in detail. Two possibilities:
- A toggle in the Internal Gains module that visually claims to include/exclude gains from Dynamic but doesn't actually feed into anything (`detectProjectState` reads project state, not a UI toggle)
- A Dynamic-vs-Static comparison view that mislabels modes

Will investigate when surfaced again; not blocking 28j.

---

## File pointers

- Assembler: `nza_engine/generators/epjson_assembler.py::assemble_epjson` (lines 1040-1170)
- Envelope-only canonical: `data/simulations/c67aff89/` (created 2026-05-14 from "envelope-only baseline" scenario)
- Full-mode latest: `data/simulations/5bc7de4b/` (created 2026-05-15 from default "Run Dynamic" button)
- Frontend trigger: `frontend/src/context/SimulationContext.jsx::runSimulation` (line 130-180)
- State-mode detection: `frontend/src/utils/stateMode.js::detectProjectState` (line 372)

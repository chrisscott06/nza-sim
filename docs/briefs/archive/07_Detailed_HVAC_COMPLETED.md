# Brief 07: Detailed HVAC Systems — Real VRF, MVHR, Gas Boiler & ASHP

BEFORE DOING ANYTHING:
1. Read CLAUDE.md
2. Read STATUS.md
3. Read docs/briefs/00_project_brief.md — sections 2 (Systems to model), 5.2 (Zone & Systems Setup)
4. Read this ENTIRE brief before writing a single line of code
5. One part at a time. Verify in browser at 1440×900. Commit. Push.

---

## VERIFICATION RULES

**Browser verification is mandatory.** After completing each part, you MUST open the application in a real browser and visually confirm it works. Take screenshots. Report what you actually see. Check browser DevTools console for red errors. If anything is broken, fix it before committing.

**CRITICAL FOR THIS BRIEF:** EnergyPlus HVAC objects are the most common source of fatal simulation errors. After every change to the assembler, run a test simulation and check the `.err` file. If EnergyPlus fails, read the error, fix it, and re-run BEFORE moving on. Do not commit code that produces a failing simulation.

**Three strikes rule applies hard here.** If a particular HVAC object won't work after 3 attempts, fall back to a simpler EnergyPlus approach (e.g. HVACTemplate objects instead of native objects) and document why. Getting a working simulation is more important than using the most detailed HVAC representation.

---

## Context

The tool currently uses `ZoneHVAC:IdealLoadsAirSystem` for all HVAC — a perfect system that meets any load at 100% efficiency. This produces unrealistically low EUI (~56 kWh/m²) and means:
- MVHR shows no benefit (ideal loads already assumes perfect heat recovery)
- VRF COP doesn't affect results (ideal loads is COP ∞)
- Gas boiler efficiency doesn't matter
- The fuel split (electricity vs gas) isn't modelled, so carbon calculations are approximate

This brief replaces ideal loads with real HVAC system objects:
- **VRF** for bedroom heating and cooling (with real COP/EER)
- **Mechanical ventilation** with or without heat recovery (MEV vs MVHR)
- **Gas boiler** for DHW with optional ASHP preheat
- **Fans and pumps** with real power consumption

The "Ideal Loads" mode should be kept as an option (it's useful for seeing pure building demand), but "Detailed Systems" becomes the default for realistic results.

**Target outcome:** After this brief, the Bridgewater Hotel EUI should be in the range of 150-300 kWh/m² (typical for a UK hotel per CIBSE TM54), MVHR should show a meaningful benefit over MEV, and the fuel split should be real (electricity for VRF/fans/lighting/equipment, gas for DHW boiler).

10 parts. Do them in order.

---

## PART 1: Research EnergyPlus HVAC objects for our systems

**File(s):** No code changes — this is a research and planning part. Create `docs/hvac_implementation_notes.md` with findings.

Before writing any HVAC code, investigate which EnergyPlus objects to use. Check the EnergyPlus documentation and example files in `/Applications/EnergyPlus-25-2-0/ExampleFiles/`.

**Questions to answer:**

1. **VRF:** What's the simplest working VRF setup in epJSON?
   - Option A: `AirConditioner:VariableRefrigerantFlow` + `ZoneHVAC:TerminalUnit:VariableRefrigerantFlow` — full native objects
   - Option B: `HVACTemplate:Zone:VRF` + `HVACTemplate:System:VRF` — simplified templates
   - Option C: `ZoneHVAC:PackagedTerminalHeatPump` — simpler than VRF but models a heat pump per zone
   - Which option works reliably in epJSON format with EnergyPlus 25.2? Search the ExampleFiles for working examples.

2. **MVHR:** How to model mechanical ventilation with heat recovery?
   - Option A: `AirLoopHVAC` with `HeatExchanger:AirToAir:SensibleAndLatent` — full air loop
   - Option B: `ZoneVentilation:DesignFlowRate` with `HeatExchanger` — simpler
   - Option C: `HVACTemplate:Zone:Unitary` or `HVACTemplate:System:DedicatedOutdoorAir` with heat recovery
   - Which option gives us controllable heat recovery efficiency?

3. **Gas boiler for DHW:**
   - Option A: `WaterHeater:Mixed` with fuel type = NaturalGas
   - Option B: `WaterHeater:Stratified`
   - Which is simpler and works for our use case?

4. **ASHP preheat for DHW:**
   - `HeatPump:WaterHeater:WrappedCondenser` or `HeatPump:WaterHeater:PumpedCondenser` feeding into the DHW tank
   - How does this connect to the gas boiler as backup?

5. **Fans:**
   - `Fan:SystemModel` or `Fan:VariableVolume` or `Fan:ConstantVolume`
   - Which is appropriate for extract ventilation vs balanced MVHR?

Look at the `.rdd` file from a previous simulation to understand what output variables are available for each system type.

**Document your findings** in `docs/hvac_implementation_notes.md`: which objects you'll use, why, and a rough sketch of how they connect. If you find working example files, note which ones.

**Commit message:** "Part 1: HVAC implementation research — object selection documented"

**Verify:**
1. The document exists and covers all 5 questions with clear recommendations
2. At least one EnergyPlus example file has been identified that demonstrates the chosen approach
3. Report: "Recommended approach: VRF via [Option X], MVHR via [Option X], DHW via [Option X], ASHP via [Option X], Fans via [Option X]. Example files referenced: [list]. Document at docs/hvac_implementation_notes.md."

---

## PART 2: VRF system implementation

**File(s):** `nza_engine/generators/epjson_assembler.py`, `nza_engine/generators/hvac_vrf.py` (new)

Create a dedicated HVAC generator module `hvac_vrf.py` that produces the EnergyPlus objects needed for a VRF system.

The function should accept:
```python
def generate_vrf_system(
    zone_names: list[str],
    zone_floor_areas: dict[str, float],
    heating_cop: float = 3.5,
    cooling_eer: float = 3.2,
    fan_power_w_per_m2: float = 3.0,
    min_outdoor_temp: float = -15.0,
) -> dict:
    """Returns epJSON objects dict for a VRF system serving the given zones."""
```

It should generate:
- One VRF outdoor unit (condenser) serving all zones
- One terminal unit per zone with an indoor coil and fan
- Performance curves for COP/EER as a function of outdoor temperature (use standard biquadratic curves — EnergyPlus has defaults)
- Fan objects per terminal unit

The COP and EER from the system template should be the rated values at standard conditions. The performance curves allow EnergyPlus to adjust them based on actual operating conditions (part load, outdoor temp).

Update the assembler: when `systems_config.mode == "detailed"` and `hvac_type` is a VRF template, call `generate_vrf_system()` instead of creating IdealLoadsAirSystem objects.

**CRITICAL:** After implementing, run a test simulation immediately. Check the `.err` file for fatal or severe errors. VRF objects are complex and easy to get wrong. Common issues:
- Missing curve objects
- Node connection mismatches
- Sizing issues (auto-size should handle most cases)

If native VRF objects fail after 3 attempts, fall back to `HVACTemplate:Zone:VRF` + `HVACTemplate:System:VRF` and document the issue.

**Commit message:** "Part 2: VRF system generator with performance curves"

**Verify:**
1. Run `python scripts/test_simulate.py` with `systems_mode="detailed"` and `hvac_type="vrf_standard"`
2. Check the `.err` file: zero fatal errors, zero severe errors (warnings are OK)
3. Check the results:
   - EUI should be HIGHER than ideal loads (VRF COP of 3.5 means heating uses ~3.5x less electricity than direct electric, but it's not 100% efficient like ideal loads)
   - Heating and cooling energy should both be non-zero
   - There should be fan energy (from the VRF terminal units)
4. Compare: ideal loads EUI [X] vs detailed VRF EUI [X] — the difference quantifies the system efficiency impact
5. Report: "VRF system working. Approach used: [native objects / HVACTemplate]. EUI: ideal loads [X] kWh/m² → detailed VRF [X] kWh/m². Fan energy: [X] kWh. Zero fatal errors, [X] warnings. COP/EER rated at [X]/[X]."

---

## PART 3: Mechanical ventilation — MEV and MVHR

**File(s):** `nza_engine/generators/hvac_ventilation.py` (new), update `nza_engine/generators/epjson_assembler.py`

Create a ventilation generator that produces either MEV or MVHR objects:

```python
def generate_ventilation_system(
    zone_names: list[str],
    zone_floor_areas: dict[str, float],
    ventilation_type: str,  # "mev_standard" or "mvhr_standard"
    specific_fan_power: float = 1.5,  # W/(l/s)
    heat_recovery_efficiency: float = 0.0,  # 0 for MEV, 0.85 for MVHR
    flow_rate_per_person: float = 8.0,  # l/s/person
    ventilation_schedule: str = None,  # schedule name, or None for always-on
) -> dict:
```

**MEV (Mechanical Extract Ventilation):**
- Extract fan removing air from each zone
- Fresh air enters via infiltration / trickle vents (already modelled by infiltration ACH)
- No heat recovery
- Fan energy = extract flow rate × SFP

**MVHR (Mechanical Ventilation with Heat Recovery):**
- Balanced supply and extract
- Heat exchanger recovering heat from exhaust to supply
- Heat recovery efficiency as a parameter (typically 85%)
- Fan energy = total flow rate × SFP (higher than MEV because there are two fans)

The key difference in the model: MVHR pre-warms the supply air using exhaust heat, which reduces the heating demand. MEV doesn't do this — all the ventilation air arrives at outdoor temperature.

For EnergyPlus implementation:
- Use `ZoneVentilation:DesignFlowRate` for the airflow
- For MVHR, add a `HeatExchanger:AirToAir:SensibleAndLatent` object, or model the effect by reducing the ventilation heat loss using an EnergyPlus `EnergyManagementSystem` actuator
- Alternative: use the `ZoneHVAC:EnergyRecoveryVentilator` object which wraps the fan + heat exchanger together

Choose the approach that works most reliably. The critical thing is that changing from MEV to MVHR produces a visible reduction in heating demand.

**Commit message:** "Part 3: MEV and MVHR ventilation generators with heat recovery"

**Verify:**
1. Run simulation A: `ventilation_type="mev_standard"`, `heat_recovery=0`
2. Run simulation B: `ventilation_type="mvhr_standard"`, `heat_recovery=0.85`
3. Compare results:
   - Heating demand: MVHR should be LOWER than MEV (heat recovery reduces ventilation heat loss)
   - Fan energy: MVHR should be HIGHER than MEV (two fans vs one)
   - Total EUI: MVHR should be lower overall (heating savings outweigh extra fan energy)
4. **CRITICAL CHECK:** If heating demand is IDENTICAL for both, heat recovery isn't working. Check the `.err` file and the epJSON to confirm the heat exchanger is present and active.
5. Check `.err` file: zero fatal errors
6. Report: "MEV vs MVHR comparison: MEV heating [X] kWh, MVHR heating [X] kWh (reduction: [X]%). MEV fan energy [X] kWh, MVHR fan energy [X] kWh. MEV EUI [X], MVHR EUI [X]. Heat recovery confirmed working — heating demand reduced by [X]%. Approach used: [describe EnergyPlus objects]."

---

## PART 4: Gas boiler for DHW

**File(s):** `nza_engine/generators/hvac_dhw.py` (new), update `nza_engine/generators/epjson_assembler.py`

Create a DHW generator:

```python
def generate_dhw_system(
    zone_names: list[str],
    num_bedrooms: int,
    dhw_primary: str,           # "gas_boiler_dhw"
    dhw_preheat: str,           # "ashp_dhw" or "none"
    boiler_efficiency: float = 0.92,
    dhw_setpoint: float = 60.0,
    dhw_preheat_setpoint: float = 45.0,
    ashp_cop: float = 2.8,
    litres_per_bedroom_per_day: float = 120.0,
) -> dict:
```

**Gas boiler only:**
- `WaterHeater:Mixed` with fuel type NaturalGas
- Efficiency from system template
- DHW demand schedule linked to the hotel DHW profile
- Hot water setpoint temperature
- Tank size estimated from number of bedrooms

**Gas boiler with ASHP preheat:**
- ASHP heats water to the preheat setpoint (e.g. 45°C)
- Gas boiler tops up to the delivery setpoint (e.g. 60°C)
- The ASHP reduces gas consumption by providing the first stage of heating at COP ~2.8
- In EnergyPlus: use two `WaterHeater:Mixed` objects in series, or a `HeatPump:WaterHeater` feeding into the main tank

**The critical outcome:** Gas consumption should appear in the results. This is the first time we have real gas use in the model — it enables correct carbon calculations.

Update the assembler to include DHW objects when detailed mode is active.

**Commit message:** "Part 4: Gas boiler DHW system with optional ASHP preheat"

**Verify:**
1. Run simulation with `dhw_primary="gas_boiler_dhw"`, `dhw_preheat="none"`
2. Check results: there should be non-zero gas consumption (previously everything was electric)
3. Check the annual energy breakdown: a "DHW" or "Water Systems" end use should appear
4. Run simulation with `dhw_preheat="ashp_dhw"`
5. Compare: gas consumption should DECREASE (ASHP provides first-stage heating electrically), electricity should increase slightly
6. The total DHW energy should be similar, but the fuel split should change
7. Check `.err` file: zero fatal errors
8. Report: "Gas boiler DHW working. Gas-only: gas consumption [X] kWh, DHW energy [X] kWh. With ASHP preheat: gas [X] kWh (reduced by [X]%), electricity [X] kWh (increased). Total DHW similar. Gas now appearing in fuel split — carbon calculation can use real data."

---

## PART 5: Fuel-split results and updated carbon calculation

**File(s):** `nza_engine/parsers/sql_parser.py`, update `frontend/src/components/modules/results/CRREMTab.jsx`

Now that we have real gas and electricity consumption, update the results parsing and carbon calculation.

**SQL parser update:**
Add `get_energy_by_fuel(sql_path)` that returns:
```python
{
    "electricity_kwh": float,   # Total annual electricity
    "natural_gas_kwh": float,   # Total annual gas
    "total_kwh": float,
    "electricity_fraction": float,  # 0-1
    "gas_fraction": float,          # 0-1
}
```

EnergyPlus reports energy by fuel type in the `TabularDataWithStrings` table — look for "End Uses By Subcategory" or "End Uses" with fuel type columns.

Include this in the simulation results response as `fuel_split`.

**Carbon calculation update:**
Update the CRREM tab's carbon trajectory to use the real fuel split:
```
carbon_kgCO2_per_m2[year] = (
    electricity_kwh × grid_intensity[year] +
    gas_kwh × 0.183
) / GIA
```

This should now show a more realistic carbon trajectory — the gas component doesn't decarbonise (stays at 0.183 kgCO₂/kWh), while the electricity component does. Buildings with more gas use will have a flatter carbon decline.

**Commit message:** "Part 5: Real fuel-split results and updated carbon calculation"

**Verify:**
1. Run a detailed simulation with gas boiler DHW
2. Check the fuel_split in the API response: both `electricity_kwh` and `natural_gas_kwh` should be non-zero
3. Navigate to Results → CRREM & Carbon
4. **SCREENSHOT:** The carbon trajectory should now show a realistic curve — starting higher than before (gas adds carbon) and declining more slowly (gas component is constant)
5. **DATA CHECK:** The 2026 carbon intensity should be higher than with ideal loads (because gas has a fixed carbon factor). The trajectory should still decline but not reach zero (the gas component remains).
6. Compare with a scenario that has ASHP DHW preheat — it should show lower carbon (less gas use)
7. Report: "Fuel split working. Electricity: [X] kWh ([X]%), Gas: [X] kWh ([X]%). Carbon 2026: [X] kgCO₂/m² (was [X] with ideal loads). Carbon 2060: [X] kgCO₂/m² (doesn't reach zero due to gas). ASHP preheat reduces gas fraction to [X]%."

---

## PART 6: Update frontend for system mode selection

**File(s):** `frontend/src/components/modules/systems/HVACTab.jsx`, update `frontend/src/context/ProjectContext.jsx`

Update the HVAC tab to make the system mode selection more prominent and clear:

**System mode toggle** — prominent at the top of the HVAC tab:
- **"Ideal Loads"** — shows pure building demand (100% efficient systems). Useful for understanding the building fabric performance in isolation.
- **"Detailed Systems"** — uses real system efficiencies (VRF COP, MVHR recovery, gas boiler efficiency). Required for realistic EUI, fuel splits, and carbon calculations.

When "Ideal Loads" is selected: show a note explaining what it means and that the EUI will be lower than reality. Dim or disable the COP/EER inputs (they don't affect ideal loads).

When "Detailed Systems" is selected: all system parameters are active and affect the simulation. Show a note: "Results include real system efficiencies, fan energy, and fuel-specific carbon."

The default for new projects should be "Detailed Systems" (now that it works).

Update the ProjectContext default:
```js
systems: {
  mode: 'detailed',  // changed from 'ideal'
  ...
}
```

**Commit message:** "Part 6: System mode toggle with clear explanation, default to detailed"

**Verify:**
1. Navigate to /systems → HVAC tab
2. **SCREENSHOT 1:** The system mode toggle should be prominently visible at the top, with "Detailed Systems" selected by default
3. **INTERACT:** Select "Ideal Loads" — COP/EER inputs should dim/disable, note should explain the mode
4. **INTERACT:** Select "Detailed Systems" — inputs should be active
5. Run simulation in each mode — EUI should differ significantly (ideal loads much lower than detailed)
6. Report: "System mode toggle working. Default is now 'detailed'. Ideal loads EUI: [X] kWh/m². Detailed EUI: [X] kWh/m². Difference: [X] kWh/m². COP/EER inputs correctly disabled in ideal mode."

---

## PART 7: Update scenario comparison with detailed systems

**File(s):** `frontend/src/components/modules/scenarios/ScenarioEditor.jsx`

Update the Scenario Editor to include the system mode as a changeable parameter. When creating scenarios, users should be able to compare:
- Baseline with detailed systems vs improved fabric with detailed systems
- MEV vs MVHR (both with detailed systems)
- Gas-only DHW vs ASHP preheat DHW

Add "System Mode" to the scenario editor (but default to "detailed" — ideal loads is mainly for advanced users who want to isolate building demand).

Ensure the `changes_from_baseline` computation captures system mode changes and HVAC parameter changes meaningfully.

**Commit message:** "Part 7: Scenario editor supports system mode and HVAC parameter comparison"

**Verify:**
1. Navigate to /scenarios
2. Create a new scenario "MVHR + ASHP"
3. Edit it: change ventilation to MVHR, change DHW preheat to ASHP
4. The changes_from_baseline should show: ventilation changed, DHW preheat changed
5. Run the scenario
6. Compare with baseline: heating should be lower (MVHR), gas should be lower (ASHP preheat)
7. **SCREENSHOT:** Comparison view showing baseline vs MVHR+ASHP with meaningful differences
8. Report: "Scenario comparison with detailed HVAC working. Baseline EUI: [X], MVHR+ASHP EUI: [X]. Heating reduction: [X]%. Gas reduction: [X]%. Changes tracked in comparison view."

---

## PART 8: Performance curves for COP variation

**File(s):** `nza_engine/generators/hvac_vrf.py`

Enhance the VRF implementation with realistic performance curves so that COP/EER varies with outdoor temperature and part load ratio.

EnergyPlus uses biquadratic and cubic curves for VRF performance:
- **Heating COP = f(outdoor_temp):** COP decreases as outdoor temp drops (harder to extract heat from cold air). At -5°C, COP might be 60% of rated. At 7°C, it's close to rated.
- **Cooling EER = f(outdoor_temp):** EER decreases as outdoor temp rises (harder to reject heat to hot air). At 35°C, EER might be 80% of rated.
- **Part load ratio curve:** Efficiency at part load — VRF systems are relatively efficient at part load (60-80% capacity), less so at very low loads.

Use standard performance curve coefficients from EnergyPlus reference datasets or manufacturer data. The curves should be reasonable defaults that can be overridden in future (when we add COP curve editing to the UI).

The effect: heating energy will increase in cold months (lower COP) and decrease in mild months. This produces more realistic monthly profiles than a flat COP.

**Commit message:** "Part 8: VRF performance curves for temperature and part-load dependent COP"

**Verify:**
1. Run a simulation with VRF performance curves
2. Check monthly heating energy: winter months should show disproportionately higher heating energy relative to degree days (because COP drops in cold weather)
3. Compare with a flat-COP simulation (if available from Part 2): the shaped COP should produce higher total heating energy (because average COP across the year is lower than rated COP)
4. The annual EUI should increase slightly compared to flat COP
5. Check `.err` file: zero fatal errors, curves accepted
6. Report: "Performance curves implemented. Annual heating with flat COP: [X] kWh. With performance curves: [X] kWh (increase of [X]% — cold-weather COP penalty). Monthly pattern shows winter months using proportionally more energy. Curves: heating COP at -5°C ≈ [X], at 7°C ≈ [X]. Cooling EER at 35°C ≈ [X]."

---

## PART 9: Full Bridgewater test with realistic HVAC

Run the complete Bridgewater scenario comparison with detailed HVAC systems. Create these scenarios:

1. **Baseline (Detailed)** — Standard fabric, VRF (COP 3.5), MEV, gas boiler DHW, 8 W/m² lighting
2. **Enhanced Fabric (Detailed)** — Enhanced fabric, same systems
3. **MVHR Upgrade (Detailed)** — Standard fabric, MVHR (85% recovery) instead of MEV
4. **Full Upgrade (Detailed)** — Enhanced fabric + MVHR + ASHP DHW preheat + LED lighting (4 W/m²)
5. **Baseline (Ideal)** — Same as scenario 1 but with ideal loads (for comparison)

Run all 5 scenarios. Record and compare results.

**Commit message:** "Part 9: Full Bridgewater 5-scenario comparison with detailed HVAC"

**Verify — report this table:**

| Scenario | Mode | EUI (kWh/m²) | Heating (MWh) | Cooling (MWh) | Gas (MWh) | Electricity (MWh) | Carbon 2026 (kgCO₂/m²) | CRREM Stranding |
|----------|------|-------------|---------------|---------------|-----------|-------------------|----------------------|-----------------|
| Baseline (Detailed) | detailed | | | | | | | |
| Enhanced Fabric | detailed | | | | | | | |
| MVHR Upgrade | detailed | | | | | | | |
| Full Upgrade | detailed | | | | | | | |
| Baseline (Ideal) | ideal | | | | | | | |

**Expected outcomes:**
- Detailed EUI should be significantly higher than ideal (150-300 kWh/m² vs ~56)
- MVHR should show meaningful heating reduction vs MEV (unlike with ideal loads)
- Full Upgrade should be the best performer
- Gas consumption should appear for gas boiler scenarios, zero for ASHP-only
- Carbon should differ based on fuel mix
- Stranding years should differ meaningfully between scenarios

If the detailed EUI is still below 100 or above 400 kWh/m², something is wrong — investigate before committing.

---

## PART 10: Full integration test

Run a complete end-to-end walkthrough:

1. Open the app, load Bridgewater project
2. /building: confirm geometry and fabric inputs
3. /systems → HVAC: toggle between Ideal and Detailed — confirm UI responds
4. /systems → Ventilation: switch MEV/MVHR — confirm heat recovery visibility
5. /systems → DHW: switch gas-only vs ASHP preheat
6. /systems → Lighting: use LED preset
7. Run simulation in Detailed mode
8. /results → Overview: EUI should be in realistic range (150-300 kWh/m²)
9. /results → Energy Balance: monthly bars should show seasonal patterns with fan energy visible
10. /results → Load Profiles → Full Year: zoom into a cold week — heating should spike
11. /results → Load Profiles → fuel toggle: "Gas" should show DHW consumption
12. /results → Fabric Analysis: envelope data should persist after refresh
13. /results → Energy Flows: Sankey should show gas and electricity inputs separately
14. /results → CRREM: carbon trajectory should be non-zero and realistic, declining but not to zero (gas component)
15. /scenarios: run comparison of all 5 scenarios — comparison view should show meaningful differences
16. /scenarios → CRREM overlay: 5 lines with different stranding years

**SCREENSHOTS:**
1. HVAC tab with Detailed mode selected and VRF parameters visible
2. Results Overview with realistic EUI (150-300 range)
3. Sankey diagram showing gas and electricity as separate input flows
4. CRREM carbon trajectory with realistic non-zero values
5. Scenario comparison showing 5 scenarios with meaningful EUI differences
6. Full Year load profile zoomed into a winter week

**Commit message:** "Part 10: Full integration test — detailed HVAC verified end-to-end"

**Verify — final report:**
- Detailed HVAC working for: VRF ✓/✗, MVHR ✓/✗, Gas Boiler ✓/✗, ASHP Preheat ✓/✗
- Fuel split: electricity [X]%, gas [X]%
- EUI range across scenarios: [min] to [max] kWh/m²
- MVHR benefit over MEV: heating reduced by [X]%
- ASHP preheat benefit: gas reduced by [X]%
- Performance curves: COP varies with outdoor temp ✓/✗
- Carbon 2026: [X] kgCO₂/m² for baseline
- CRREM stranding: baseline [year], best scenario [year]
- Browser console: zero red errors across entire walkthrough

---

## After all 10 parts are complete

Update STATUS.md with:
- All 10 parts completed
- HVAC implementation approach (which EnergyPlus objects used)
- Full 5-scenario comparison table
- EUI validation against CIBSE TM54 hotel benchmarks
- Known issues and limitations of the HVAC implementation
- Suggestions for Brief 08 (report export to PowerPoint, EV charging, future weather files, COP curve editor in UI)

Push to GitHub. Confirm push succeeded.

Tell Chris: "Brief 07 complete. Detailed HVAC working — VRF with performance curves, MVHR with real heat recovery, gas boiler DHW with ASHP preheat option. Bridgewater EUI now [X] kWh/m² (was 56 with ideal loads). MVHR reduces heating by [X]%. Five scenarios compared — Full Upgrade is best at [X] kWh/m², stranding delayed to [year]. Real gas/electricity fuel split enables accurate carbon tracking."

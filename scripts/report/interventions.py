#!/usr/bin/env python3
"""Brief 96 — the 22 HIEX interventions: patches, cost plans, class, life, basis.

Single source of truth consumed by cost reconciliation (P2), the runs (P5), the metrics
engine (P4), and the export (P6). Costs are transcribed VERBATIM from
`docs/report/HIEX_Intervention_Spec_and_Cost_Benchmarks.md`; modelling (patches, Class
B/C methods, lives, tariffs) is from the canonical Notion design note (mirrored in the
brief). Where a value is a stated engineering assumption it is flagged in `assumption`
and logged in OVERNIGHT_FINDINGS.md.

Cost model: each line is quantity × unit-rate. `on_cost_pct` (NRM-tier items only, per the
doc's ~40% = prelims+OH&P+design+contingency) is applied to the line subtotal. `central`
is the reconciliation target (the doc's stated central); `low`/`high` carry the doc's range.

Classes (design note): A direct patch · B derived-scalar patch · C off-model (report layer)
· D enabling/£0-energy. Measure lives (CIBSE Guide M indicative, per note): controls/
settings 10y · plant 15y · PV 25y · fabric 30y.

Patch paths use the Brief 41 convention ('building.' → building_config). Same-path caveats
(DHW ×4, VRF-eff ×2) are handled in the run layer (P5) — see OVERNIGHT_FINDINGS.
"""

# Baseline values the patches move FROM (report_baseline_v1):
#   dhw_demand_litres_per_person_per_day 55 · dhw[0]=gas(0.85,52%) dhw[1]=ASHP(3.0,48%)
#   heating[0]=VRF(3.0,95%) heating[1]=elec panel(1.0,5%) · cooling[0]=VRF(3.0,100%)
#   ventilation[1]=bedroom_extract(SFP0.9,rec0,flow2208) · equipment baseload 5.04 W/m²
#   lighting magnitude 2 W/m² · fabric.air_permeability_q50 4.64 · glazing g 0.55

LIFE = {"controls": 10, "plant": 15, "pv": 25, "fabric": 30}

INTERVENTIONS = [
    # ── THEME 1 — HOT WATER ────────────────────────────────────────────────
    {
        "ref": "1.1", "name": "Reduce DHW demand (low-flow fittings)", "theme": "Hot water",
        "category": "Systems (water)", "cls": "A", "life": 15,
        "patches": [{"op": "set", "path": "building.systems_config_v40.dhw_demand_litres_per_person_per_day", "value": 44.3}],
        "assumption": "DHW demand −19.5%: shower fraction 65% (mid 60–70%) × low-flow volume reduction 30% (aerator/regulator standard). Within the doc's −10..−25% band.",
        "basis": "Low-flow fittings; saving applies to the shower fraction of room DHW only.",
        "cost": {"lines": [{"desc": "Low-flow fittings + fit", "qty": 138, "unit": "room", "rate": 60}],
                 "on_cost_pct": 0, "central": 8280, "low": 5520, "high": 13800, "confidence": "M", "tier": "a"},
    },
    {
        "ref": "1.2", "name": "Waste-water heat recovery (WWHR)", "theme": "Hot water",
        "category": "Systems", "cls": "B", "life": 15,
        "patches": [{"op": "set", "path": "building.systems_config_v40.dhw_demand_litres_per_person_per_day", "value": 45.1}],
        "assumption": "Design note: DHW demand scalar 0.82 (shower 65% × HX effectiveness 45% × config factor 0.6 ≈ −18%). Modelled as demand-litres ×0.82 (55→45.1). SAME PATH as 1.1 — see cumulative caveat.",
        "basis": "Drain-water HX pre-heats cold feed; −18% DHW energy central (range −12..−25%).",
        "cost": {"lines": [{"desc": "Vertical WWHR units", "qty": 9, "unit": "riser", "rate": 900},
                           {"desc": "Plumbing labour (1.5 d @ £350)", "qty": 9, "unit": "riser", "rate": 525},
                           {"desc": "Builder's work / access", "qty": 1, "unit": "allow", "rate": 3000}],
                 "on_cost_pct": 40, "central": 22000, "low": 15000, "high": 35000, "confidence": "L", "tier": "c"},
    },
    {
        "ref": "1.3", "name": "Exhaust air over ASHP (COP uplift)", "theme": "Hot water",
        "category": "Systems", "cls": "B", "life": 15,
        "patches": [{"op": "set", "path": "building.systems_config_v40.dhw[1].efficiency_metric", "value": 3.4}],
        "assumption": "Design note: preheat-stage COP +0.4 absolute (3.0→3.4), applies to the ASHP preheat share of DHW (dhw[1], 48%). SAME PATH as 1.4 — see cumulative caveat.",
        "basis": "Warm extract (~20°C) across the DHW heat-pump source coil; +0.3/+0.5 range.",
        "cost": {"lines": [{"desc": "Ductwork modification allowance", "qty": 1, "unit": "allow", "rate": 4000},
                           {"desc": "Commissioning (1 d @ £550)", "qty": 1, "unit": "day", "rate": 550}],
                 "on_cost_pct": 0, "central": 4550, "low": 3050, "high": 8550, "confidence": "L", "tier": "b"},
    },
    {
        "ref": "1.4", "name": "Larger ASHP — full DHW off gas", "theme": "Hot water",
        "category": "Systems", "cls": "A", "life": 15,
        "patches": [{"op": "set", "path": "building.systems_config_v40.dhw[0].share_pct", "value": 0},
                    {"op": "set", "path": "building.systems_config_v40.dhw[1].share_pct", "value": 100},
                    {"op": "set", "path": "building.systems_config_v40.dhw[1].efficiency_metric", "value": 2.9}],
        "assumption": "Gas DHW off (share 0), ASHP serves 100% at high-temp SCOP 2.9 (mid 2.8–3.0). The principal carbon measure (gas→electric).",
        "basis": "Upsized high-temp ASHP meets full hot-water load; gas heaters retired.",
        "cost": {"lines": [{"desc": "ASHP plant (70 kW @ £550/kW)", "qty": 70, "unit": "kW", "rate": 550},
                           {"desc": "Mech install, cylinders/coils, pipework", "qty": 1, "unit": "allow", "rate": 25000},
                           {"desc": "Electrical supply upgrade + controls", "qty": 1, "unit": "allow", "rate": 8000},
                           {"desc": "Gas plant strip-out", "qty": 1, "unit": "allow", "rate": 4000}],
                 "on_cost_pct": 40, "central": 105000, "low": 80000, "high": 140000, "confidence": "M", "tier": "c"},
    },
    {
        "ref": "1.5", "name": "Interlinked heat recovery — VRF→DHW", "theme": "Hot water",
        "category": "Systems", "cls": "C", "life": 15, "off_model": True, "patches": [],
        "assumption": "Off-model (Class C): monthly-coincidence calc, 55% capture. Neither engine models inter-plant heat flows.",
        "basis": "Recover rejected VRF heat into DHW pre-heat when cooling and DHW coincide.",
        "cost": {"lines": [{"desc": "Water-side HX module + integration (allowance)", "qty": 1, "unit": "allow", "rate": 25000}],
                 "on_cost_pct": 0, "central": 25000, "low": 15000, "high": 35000, "confidence": "L", "tier": "b"},
    },
    # ── THEME 2 — VENTILATION ──────────────────────────────────────────────
    {
        "ref": "2.1", "name": "MVHR replacing central electric heating + bathroom extract", "theme": "Ventilation",
        "category": "Systems", "cls": "A", "life": 15,
        "patches": [{"op": "set", "path": "building.systems_config_v40.ventilation[1].efficiency_metric",
                     "value": {"sfp_w_per_lps": 1.8, "recovery_sensible_pct": 80, "recovery_latent_pct": 0}},
                    {"op": "set", "path": "building.systems_config_v40.heating[1].share_pct", "value": 0},
                    {"op": "set", "path": "building.systems_config_v40.heating[0].share_pct", "value": 100}],
        "assumption": "Bedroom extract → balanced MVHR 80% HR, SFP 1.8 (mid 1.5–2.0). Electric panel heating (heating[1], 5%) removed → VRF 100%. Note: net effect may be adverse (summer) — modelling decides.",
        "basis": "MVHR uses ceiling void as plenum; supersedes bathroom extract + central electric heating.",
        "cost": {"lines": [{"desc": "MVHR/AHU plant (2300 l/s @ £12)", "qty": 2300, "unit": "l/s", "rate": 12},
                           {"desc": "Ductwork/plenum adaptation", "qty": 1, "unit": "allow", "rate": 30000},
                           {"desc": "Electrical + controls", "qty": 1, "unit": "allow", "rate": 8000},
                           {"desc": "Panel heater strip-out", "qty": 1, "unit": "allow", "rate": 5000}],
                 "on_cost_pct": 40, "central": 99000, "low": 70000, "high": 140000, "confidence": "L", "tier": "c"},
    },
    {
        "ref": "2.2", "name": "Reduce fan duty", "theme": "Ventilation",
        "category": "Systems/controls", "cls": "A", "life": 10,
        "patches": [{"op": "set", "path": "building.systems_config_v40.ventilation[1].flow_rate", "value": 1590},
                    {"op": "set", "path": "building.systems_config_v40.ventilation[1].efficiency_metric.sfp_w_per_lps", "value": 0.47}],
        "assumption": "Bedroom extract flow 2208→1590 (−28%, per doc's 2292→1656 case). Fan power falls with the cube law → SFP scaled by (flow ratio)² (0.9→0.47) so fan energy ∝ flow³.",
        "basis": "Slow extract to the minimum air-quality-compliant flow.",
        "cost": {"lines": [{"desc": "Commissioning (2 d @ £550)", "qty": 2, "unit": "day", "rate": 550},
                           {"desc": "Inverter/controls adjustment", "qty": 1, "unit": "allow", "rate": 1500}],
                 "on_cost_pct": 0, "central": 2600, "low": 1500, "high": 5000, "confidence": "M", "tier": "a"},
    },
    {
        "ref": "2.3", "name": "Heat-recovery bypass setpoint", "theme": "Ventilation",
        "category": "Controls", "cls": "A", "life": 10, "off_model": True, "patches": [],
        "assumption": "NO clean static-engine representation — seasonal HRV bypass is a control the static engine does not expose (no seasonal-recovery field). Modelled effect ≈ 0; a near-free control with a small summer cooling benefit not captured. Cost within 6.1.",
        "basis": "Lower the temperature at which HRV heat recovery is bypassed (avoids recovered heat when cooling).",
        "cost": {"lines": [], "on_cost_pct": 0, "central": 0, "low": 0, "high": 500, "confidence": "H", "tier": "a",
                 "within": "6.1"},
    },
    # ── THEME 3 — HEATING & COOLING ────────────────────────────────────────
    {
        "ref": "3.1", "name": "VRF metering, commissioning & diagnostic health check", "theme": "Heating & cooling",
        "category": "Systems/controls", "cls": "B", "life": 10,
        "patches": [{"op": "set", "path": "building.systems_config_v40.heating[0].efficiency_metric", "value": 3.4},
                    {"op": "set", "path": "building.systems_config_v40.cooling[0].efficiency_metric", "value": 3.4}],
        "assumption": "Design note sensitivity band: none / central +0.4 / strong (managed 3.9). CENTRAL (+0.4 on in-service VRF heating SCOP + cooling EER, 3.0→3.4) is the stack member; none/strong stored as sensitivity. SAME PATH as 3.2 — 3.2 composes on the post-3.1 state.",
        "basis": "Sub-meter + diagnostic + coil clean + controls align; managed ~3.9 vs typical ~2.8.",
        "cost": {"lines": [{"desc": "Manufacturer/specialist diagnostic visit", "qty": 1, "unit": "visit", "rate": 3000},
                           {"desc": "F-gas / charge verification", "qty": 1, "unit": "allow", "rate": 1500},
                           {"desc": "Coil cleaning", "qty": 1, "unit": "allow", "rate": 1200},
                           {"desc": "Sub-metering VRF circuits (4 @ £600)", "qty": 4, "unit": "point", "rate": 600}],
                 "on_cost_pct": 0, "central": 8100, "low": 5000, "high": 12000, "confidence": "M", "tier": "b"},
    },
    {
        "ref": "3.2", "name": "VRF replacement (current-gen R-32 heat recovery)", "theme": "Heating & cooling",
        "category": "Systems", "cls": "B", "life": 15, "off_model_extra": "refrigerant_carbon",
        "patches": [{"op": "set", "path": "building.systems_config_v40.heating[0].efficiency_metric", "value": 3.75},
                    {"op": "set", "path": "building.systems_config_v40.cooling[0].efficiency_metric", "value": 3.75}],
        "assumption": "Heating/cooling consumption −20% (spec 15–25%), via rated-SCOP substitution derated to in-service: eff 3.0→3.75 (=3.0/0.8). CUMULATIVE: computed against the post-3.1 state (3.4→4.25) per the note's double-count guard. Plus Class C refrigerant carbon ≈4.7 tCO₂e/yr (offmodel).",
        "basis": "Replace 2019 SHRM fleet with R-32 heat-recovery generation at end of life.",
        "cost": {"lines": [{"desc": "VRF plant (320 kW @ £450/kW)", "qty": 320, "unit": "kW", "rate": 450},
                           {"desc": "Install/refrigerant pipework, labour", "qty": 1, "unit": "allow", "rate": 90000},
                           {"desc": "Controls + commissioning", "qty": 1, "unit": "allow", "rate": 20000},
                           {"desc": "Strip-out & disposal (R-410A recovery)", "qty": 1, "unit": "allow", "rate": 15000}],
                 "on_cost_pct": 40, "central": 375000, "low": 280000, "high": 480000, "confidence": "M", "tier": "c"},
    },
    {
        "ref": "3.3", "name": "Setpoint optimisation (heating/cooling dead-band)", "theme": "Heating & cooling",
        "category": "Controls", "cls": "A", "life": 10,
        "patches": [{"op": "set", "path": "building.systems_config_v40.heating_setpoint_mode", "value": "custom"},
                    {"op": "set", "path": "building.systems_config_v40.heating_setpoint_c", "value": 20},
                    {"op": "set", "path": "building.systems_config_v40.cooling_setpoint_mode", "value": "custom"},
                    {"op": "set", "path": "building.systems_config_v40.cooling_setpoint_c", "value": 25}],
        "assumption": "Heating 21→20, cooling 24→25 (doc example). Widened dead-band within comfort agreement.",
        "basis": "Zone setpoints across VRF. Cost within the 6.1 controls visit.",
        "cost": {"lines": [], "on_cost_pct": 0, "central": 0, "low": 0, "high": 500, "confidence": "H", "tier": "a",
                 "within": "6.1"},
    },
    {
        "ref": "3.4", "name": "Fabric — glazing G-value (solar film)", "theme": "Heating & cooling",
        "category": "Fabric", "cls": "A", "life": 30,
        "patches": [{"op": "set", "path": "building.construction_choices.glazing", "value": "double_low_e"}],
        "assumption": "Glazing g 0.55→0.42 (nearest library construction double_low_e; u unchanged at 1.4 — film reduces g, not u; doc target g 0.40). Expected marginal/counterproductive here (cuts useful winter heat, raises cooling). Film life ~10–15y in reality but note maps fabric→30y.",
        "basis": "Solar-control film to bedroom glazing (193 m²).",
        "cost": {"lines": [{"desc": "Film to all bedroom glazing (193 m² @ £45)", "qty": 193, "unit": "m2", "rate": 45}],
                 "on_cost_pct": 0, "central": 8685, "low": 5000, "high": 14000, "confidence": "M", "tier": "b"},
    },
    {
        "ref": "3.5", "name": "Brise soleil (external solar shading)", "theme": "Heating & cooling",
        "category": "Fabric", "cls": "A", "life": 30,
        "patches": [{"op": "set", "path": "building.shading_overhang.south", "value": {"depth_m": 0.5, "offset_m": 0}},
                    {"op": "set", "path": "building.shading_overhang.west", "value": {"depth_m": 0.5, "offset_m": 0}}],
        "assumption": "0.5 m horizontal overhang on the SW/S/W-facing glazing → modelled as south + west facades of the 4-orientation box (North_Axis 42). Seasonally selective (cuts summer sun, admits winter).",
        "basis": "Fixed horizontal brise soleil, 0.5 m projection, SW/S/W bedroom windows (~42 m² blade).",
        "cost": {"lines": [{"desc": "Brise soleil (42 m² blade @ £550)", "qty": 42, "unit": "m2", "rate": 550}],
                 "on_cost_pct": 0, "central": 23100, "low": 17000, "high": 34000, "confidence": "M", "tier": "b",
                 "note": "+£5,000 access/scaffold if not shared with other façade works (excluded from central)"},
    },
    # ── THEME 4 — ROOM / EQUIPMENT LOADS ───────────────────────────────────
    {
        "ref": "4.1", "name": "Room load monitoring (sample sub-metering)", "theme": "Room loads",
        "category": "Occupancy (enabling)", "cls": "D", "life": None, "enabling": True, "patches": [],
        "assumption": "Enabling: no demand change; converts assumed room load into data. Sizes 4.2.",
        "basis": "Meter a representative sample of rooms.",
        "cost": {"lines": [{"desc": "CT meter + comms (10 rooms @ £450)", "qty": 10, "unit": "point", "rate": 450}],
                 "on_cost_pct": 0, "central": 4500, "low": 3000, "high": 8000, "confidence": "M", "tier": "a"},
    },
    {
        "ref": "4.2", "name": "Automatic room shut-off (keycard/occupancy master switch)", "theme": "Room loads",
        "category": "Occupancy", "cls": "A", "life": 10,
        "patches": [{"op": "set", "path": "building.gains.equipment.profiles[0].baseload.value", "value": 3.78}],
        "assumption": "Room plug load −25% (mid of doc's −20..−30% when unoccupied). Equipment baseload 5.04→3.78 W/m² (net occupancy-weighted).",
        "basis": "Master switch cuts non-essential room power when unoccupied.",
        "cost": {"lines": [{"desc": "Keycard switch + wiring (138 rooms @ £140)", "qty": 138, "unit": "room", "rate": 140}],
                 "on_cost_pct": 0, "central": 19320, "low": 11000, "high": 28000, "confidence": "M", "tier": "a"},
    },
    {
        "ref": "4.3", "name": "Equipment efficiency at replacement", "theme": "Room loads",
        "category": "Other", "cls": "D", "life": None, "enabling": True, "patches": [],
        "assumption": "£0 capex by definition (efficient spec at natural replacement). No energy claim modelled.",
        "basis": "Specify low-standby appliances at churn.",
        "cost": {"lines": [], "on_cost_pct": 0, "central": 0, "low": 0, "high": 0, "confidence": "H", "tier": "a"},
    },
    # ── THEME 5 — COMMUNAL LOADS ───────────────────────────────────────────
    {
        "ref": "5.1", "name": "Kitchen/catering review + circuit metering", "theme": "Communal",
        "category": "Other (enabling)", "cls": "D", "life": None, "enabling": True, "patches": [],
        "assumption": "Enabling: quantum unknown by design; no modelled demand change.",
        "basis": "Meter kitchen circuits; identify left-on load.",
        "cost": {"lines": [{"desc": "Circuit metering (4 @ £500)", "qty": 4, "unit": "circuit", "rate": 500},
                           {"desc": "Half-day survey", "qty": 1, "unit": "survey", "rate": 300}],
                 "on_cost_pct": 0, "central": 2300, "low": 1500, "high": 4000, "confidence": "M", "tier": "a"},
    },
    {
        "ref": "5.2", "name": "Communal lighting + controls", "theme": "Communal",
        "category": "Lighting", "cls": "A", "life": 15,
        "patches": [{"op": "set", "path": "building.gains.lighting.profiles[0].magnitude.value", "value": 1.7}],
        "assumption": "Whole-building lighting magnitude −15% (2.0→1.7 W/m²) representing communal LED + PIR occupancy sensing on the communal fraction. [15% is a stated assumption — communal share × PIR saving.]",
        "basis": "Confirm LED communal/external; add occupancy sensing.",
        "cost": {"lines": [{"desc": "LED verification/replacement (150 @ £110)", "qty": 150, "unit": "fitting", "rate": 110},
                           {"desc": "PIR sensors (40 @ £90)", "qty": 40, "unit": "point", "rate": 90}],
                 "on_cost_pct": 0, "central": 20100, "low": 12000, "high": 30000, "confidence": "M", "tier": "b"},
    },
    {
        "ref": "5.3", "name": "Building sub-metering package (plant + water)", "theme": "Communal",
        "category": "Other (enabling)", "cls": "D", "life": None, "enabling": True, "patches": [],
        "assumption": "THE enabling measure: no demand change; resolves the report's largest unknown. First action overall.",
        "basis": "Sub-meter major plant + water; converts inferred base load into addressable demand.",
        "cost": {"lines": [{"desc": "Electrical points (14 @ £600)", "qty": 14, "unit": "point", "rate": 600},
                           {"desc": "Water meters (3 @ £800)", "qty": 3, "unit": "meter", "rate": 800},
                           {"desc": "Data logging/comms", "qty": 1, "unit": "allow", "rate": 2500}],
                 "on_cost_pct": 0, "central": 13300, "low": 9000, "high": 20000, "confidence": "M", "tier": "b"},
    },
    {
        "ref": "5.4", "name": "Communal ventilation run-hours", "theme": "Communal",
        "category": "Controls", "cls": "D", "life": None, "enabling": True, "patches": [],
        "assumption": "Within the 6.1 controls visit. Align HRV schedules to space use; small saving not separately modelled (within 6.1 / not a headline claim).",
        "basis": "Align HRV schedules to actual use.",
        "cost": {"lines": [], "on_cost_pct": 0, "central": 0, "low": 0, "high": 500, "confidence": "H", "tier": "a",
                 "within": "6.1"},
    },
    # ── THEME 6 — CONTROLS & BMS ───────────────────────────────────────────
    {
        "ref": "6.1", "name": "BMS setpoint realignment + schedules (consolidated controls visit)", "theme": "Controls & BMS",
        "category": "Controls", "cls": "D", "life": None, "enabling": True, "patches": [],
        "assumption": "Cost-carrier for the settings measures (3.3, 5.4, 2.3). Their energy savings are claimed under those refs; 6.1 carries the £3,000 visit so the settings measures read £0 capex (avoids double-count).",
        "basis": "One controls package: setpoints + schedules + bypass + dead-bands.",
        "cost": {"lines": [{"desc": "Controls specialist (4 d @ £600)", "qty": 4, "unit": "day", "rate": 600},
                           {"desc": "BMS survey (1 d @ £600)", "qty": 1, "unit": "day", "rate": 600}],
                 "on_cost_pct": 0, "central": 3000, "low": 2000, "high": 6000, "confidence": "H", "tier": "a"},
    },
    # ── THEME 7 — CARBON MEASURES ──────────────────────────────────────────
    {
        "ref": "7.1", "name": "Solar PV", "theme": "Carbon",
        "category": "Other", "cls": "C", "life": 25, "off_model": True, "patches": [],
        "assumption": "Off-model (Class C): 50 kWp × 950 kWh/kWp = 47.5 MWh/yr, 85% self-consumption; EUI UNCHANGED by construction (CRREM gross-demand rule). Carbon valued on the declining grid pathway.",
        "basis": "Rooftop array; cuts carbon, not EUI.",
        "cost": {"lines": [{"desc": "PV installed (50 kWp @ £1,100)", "qty": 50, "unit": "kWp", "rate": 1100}],
                 "on_cost_pct": 0, "central": 55000, "low": 35000, "high": 55000, "confidence": "H", "tier": "b"},
    },
]

# Phasing spine (dependency order from the benchmarks doc) — the cumulative-strategy order.
# Class D (enabling/£0) are skipped in the demand chain but carried for cumulative capex.
PHASING_SPINE = ["5.3", "4.1", "5.1", "6.1", "3.3", "5.4", "2.3", "2.2", "3.1", "1.1",
                 "5.2", "4.2", "4.3", "3.2", "1.5", "1.4", "1.2", "1.3", "7.1", "3.4", "3.5", "2.1"]


def by_ref(ref):
    for iv in INTERVENTIONS:
        if iv["ref"] == ref:
            return iv
    raise KeyError(ref)


def compute_cost_total(cost):
    """Line subtotal × (1 + on_cost%). Returns the computed central for reconciliation."""
    sub = sum(l["qty"] * l["rate"] for l in cost["lines"])
    return round(sub * (1 + cost["on_cost_pct"] / 100.0))


if __name__ == "__main__":
    print(f"{len(INTERVENTIONS)} interventions defined; spine length {len(PHASING_SPINE)}")
    assert len(INTERVENTIONS) == 22, "expected 22 HIEX interventions"
    assert set(PHASING_SPINE) == {iv["ref"] for iv in INTERVENTIONS}, "spine/refs mismatch"
    print("OK: 22 items, spine covers every ref exactly once")

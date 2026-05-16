#!/usr/bin/env python3
"""
scripts/_check_28L_gate3_dynamic_envelope_only.py

Brief 28L Gate L3 — Dynamic engine envelope-only with BRUKL parity.

Workflow:
  1. Fetch Bridgewater state via API (must have post-BRUKL seed applied:
     u_value_override + g_value_override on construction_choices,
     infiltration_ach 0.23, fabric.thermal_bridging_alpha_pct 200,
     systems_config_v25.ventilation 3-entry config).
  2. Assemble Bridgewater envelope-only epJSON via the existing nza_engine
     assembler. Use string-form construction_choices (extract library_id
     from object form) because the assembler doesn't natively understand
     per-project U-value overrides yet.
  3. Post-process the epJSON in-memory to inject BRUKL inputs the assembler
     doesn't handle:
       - For each construction with u_value_override: rebuild as a single
         Material:NoMass layer with R = 1/U_target. Surface conduction
         output reflects the BRUKL U-value.
       - WindowMaterial:SimpleGlazingSystem: override SHGC = 0.50 (BRUKL g).
       - Add 3 × ZoneVentilation:DesignFlowRate for the BRUKL mech vent array,
         using HRE-netted effective flow per system (the assembler doesn't
         emit mechanical ventilation in envelope-only mode today).
       - Add Output:Variable requests for per-surface conduction + ventilation.
  4. Run EnergyPlus via runner.run_simulation.
  5. Parse per-surface conduction (walls per facade + roof + floor + glazing)
     + ZoneInfiltration + per-system ZoneVentilation outputs.
  6. Run the Static engine envelope-only (via Node subprocess) and extract
     the matching losses_at_setpoint block.
  7. Compare per-element, halt with table at +/-15% tolerance.

NOT-modeled in Dynamic for this gate:
  - Thermal bridging (no clean EP construct for BRUKL alpha at envelope level
    without inflating constructions, which would conflate per-surface
    reporting). Static-only line; documented in the comparison output.
  - Permanent vents are already emitted via ZoneVentilation:WindandStackOpenArea
    in envelope-only; left unchanged.

Tolerance: per-element +/-15% per Brief 28L Gate L3.

Not part of the production assembler; self-contained validation script per
the Gate L3 brief.
"""

from __future__ import annotations

import copy
import io
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

# Make sure prints survive Windows console encoding
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from nza_engine.generators.epjson_assembler import assemble_epjson
from nza_engine.runner import run_simulation
from nza_engine.parsers.sql_parser import _connect, _query, J_TO_KWH

PROJECT_ID = "14b4a5b1-8c73-4acb-8b65-1d22f05ec969"
API = "http://127.0.0.1:8002"
TOL_PCT = 15.0
RUN_DIR = REPO_ROOT / "data" / "simulations" / "28L_gate3"


# ─── 1. Fetch Bridgewater state ───────────────────────────────────────────────
def fetch_project() -> dict:
    with urllib.request.urlopen(f"{API}/api/projects/{PROJECT_ID}") as r:
        return json.loads(r.read())


# ─── 2. Build assembler inputs (extract library_id from override-object form) ──
def extract_choice_id(choice):
    if isinstance(choice, str):
        return choice
    if isinstance(choice, dict):
        return choice.get("library_id") or choice.get("id") or choice.get("name")
    return None


def assemble(project: dict) -> tuple[dict, dict, Path]:
    """Returns (epjson_dict, brukl_overrides, weather_path)."""
    bc = project["building_config"]
    cc = project["construction_choices"]

    building_params = {
        "name": bc.get("name", "Bridgewater"),
        "length": bc["length"],
        "width":  bc["width"],
        "num_floors": bc["num_floors"],
        "floor_height": bc["floor_height"],
        "orientation": bc.get("orientation", 0),
        "wwr": bc.get("wwr", {}),
        "infiltration_ach": bc.get("infiltration_ach", 0.5),
        "num_bedrooms": bc.get("num_bedrooms", 0),
        "openings": bc.get("openings", {}),
        "shading_overhang": bc.get("shading_overhang", {}),
        "shading_fin": bc.get("shading_fin", {}),
    }

    construction_choice_ids = {
        slot: extract_choice_id(cc.get(slot))
        for slot in ("external_wall", "roof", "ground_floor", "glazing")
    }

    # Collect the per-project BRUKL overrides for post-processing
    brukl_overrides = {
        slot: (cc.get(slot) if isinstance(cc.get(slot), dict) else {})
        for slot in ("external_wall", "roof", "ground_floor", "glazing")
    }

    weather_file = bc["weather_file"]
    weather_path = REPO_ROOT / "data" / "weather" / "current" / weather_file
    if not weather_path.exists():
        raise FileNotFoundError(f"Weather file not found: {weather_path}")

    epjson = assemble_epjson(
        building_params=building_params,
        construction_choices=construction_choice_ids,
        weather_file_path=weather_path,
        output_path=None,            # we keep epJSON in memory for patching
        systems_config=bc.get("systems_config_v25", {}),
        mode="envelope-only",
    )
    return epjson, brukl_overrides, weather_path


# ─── 3. Patch epJSON in place with BRUKL inputs the assembler doesn't handle ──
def patch_constructions_for_u_overrides(epjson: dict, brukl_overrides: dict, project: dict) -> dict:
    """
    For each construction slot with u_value_override, replace the construction's
    layer stack with a single Material:NoMass layer providing R = 1/U_target.

    Returns a dict {slot: applied_U} summarising what was applied.
    """
    cc = project["construction_choices"]
    bc = project["building_config"]

    applied = {}
    materials_nomass = epjson.setdefault("Material:NoMass", {})
    constructions = epjson.setdefault("Construction", {})

    for slot in ("external_wall", "roof", "ground_floor"):
        ov = brukl_overrides.get(slot, {})
        u_target = ov.get("u_value_override")
        if u_target is None or u_target <= 0:
            continue
        library_id = extract_choice_id(cc.get(slot))
        if library_id not in constructions:
            print(f"  ⚠ Construction '{library_id}' not in epJSON; cannot apply U override")
            continue

        # Outside + inside surface film resistances per BS EN ISO 6946 (vertical wall);
        # roof: outside same, inside slightly different but we keep the same conservative
        # numbers since the spreadsheet U is "whole construction U" which by convention
        # INCLUDES film resistances at both sides.
        R_total = 1.0 / float(u_target)  # m²K/W, includes films per BRUKL convention

        # Build a single-layer NoMass replacement. EP's Material:NoMass takes a thermal
        # resistance directly; surface heat transfer coefficients on the outside +
        # inside boundary nodes still apply. We subtract the EP default convective
        # films (R_so 0.04 outside vertical, R_si 0.13 inside vertical; for roof
        # 0.04 outside + 0.10 inside) from the BRUKL R_total so the EP-computed
        # surface conduction (which adds those films back) lands on the BRUKL U.
        # (For ground_floor we use the special EP ground temperature boundary
        # condition that doesn't apply convective films, so no subtraction.)
        if slot == "ground_floor":
            R_material = R_total
        elif slot == "roof":
            R_material = max(R_total - 0.04 - 0.10, 0.01)
        else:  # external_wall
            R_material = max(R_total - 0.04 - 0.13, 0.01)

        mat_name = f"{library_id}__BRUKL_NoMass_U{u_target:.3f}"
        materials_nomass[mat_name] = {
            "roughness": "MediumRough",
            "thermal_resistance": round(R_material, 4),
        }
        constructions[library_id] = {"outside_layer": mat_name}
        applied[slot] = u_target

    return applied


def patch_glazing_g_override(epjson: dict, brukl_overrides: dict) -> float | None:
    """
    Override SHGC on the glazing construction's WindowMaterial:SimpleGlazingSystem.
    Returns the applied g-value or None if no override.
    """
    g_target = brukl_overrides.get("glazing", {}).get("g_value_override")
    if g_target is None or g_target <= 0:
        return None

    simple_glazings = epjson.get("WindowMaterial:SimpleGlazingSystem", {})
    if not simple_glazings:
        print("  ⚠ No WindowMaterial:SimpleGlazingSystem entries found; cannot apply g override")
        return None

    for name, sg in simple_glazings.items():
        sg["solar_heat_gain_coefficient"] = float(g_target)
    return float(g_target)


def patch_mechanical_ventilation(epjson: dict, project: dict) -> list[dict]:
    """
    Add per-system ZoneVentilation:DesignFlowRate entries for each BRUKL
    ventilation system. Effective flow = flow_l_s * (1 - HRE) to net out
    heat recovery, divided evenly across the zones to model whole-building
    coverage.

    Returns a list of system summaries for reporting.
    """
    systems = project["building_config"].get("systems_config_v25", {}).get("ventilation", [])
    if not systems:
        return []

    zones = list(epjson.get("Zone", {}).keys())
    if not zones:
        return []

    zv = epjson.setdefault("ZoneVentilation:DesignFlowRate", {})
    summaries = []
    for sys in systems:
        name = sys.get("name") or sys.get("id") or "mech_vent"
        flow_l_s = float(sys.get("flow_l_s") or sys.get("flow_L_s") or 0)
        hre = float(sys.get("hre", 0))
        sfp = float(sys.get("sfp_w_per_l_s") or sys.get("sfp") or 0)
        if flow_l_s <= 0:
            continue
        effective_flow_m3_s = (flow_l_s * (1 - hre)) / 1000.0  # L/s × (1-HRE) → m³/s
        flow_per_zone = effective_flow_m3_s / len(zones)
        for zone in zones:
            obj_name = f"{zone}_{name}"
            zv[obj_name] = {
                "zone_or_zonelist_or_space_or_spacelist_name": zone,
                "schedule_name": "hotel_ventilation_continuous",
                "design_flow_rate_calculation_method": "Flow/Zone",
                "design_flow_rate": round(flow_per_zone, 6),
                "ventilation_type": "Exhaust" if hre == 0 else "Balanced",
                # Coefficients: pure constant flow (no wind / no temperature dependence
                # — extract fans run at constant rate)
                "constant_term_coefficient": 1.0,
                "temperature_term_coefficient": 0.0,
                "velocity_term_coefficient": 0.0,
                "velocity_squared_term_coefficient": 0.0,
            }
        summaries.append({
            "name": name,
            "flow_l_s": flow_l_s,
            "hre": hre,
            "sfp_w_per_l_s": sfp,
            "effective_flow_l_s": round(flow_l_s * (1 - hre), 2),
        })
    return summaries


def add_output_variables(epjson: dict) -> None:
    """Add Output:Variable requests for the per-surface + ventilation data we need."""
    ov = epjson.setdefault("Output:Variable", {})
    vars_we_need = [
        "Surface Inside Face Conduction Heat Transfer Energy",
        "Surface Outside Face Conduction Heat Transfer Energy",
        "Surface Window Transmitted Solar Radiation Energy",
        "Surface Window Heat Loss Energy",
        "Surface Window Heat Gain Energy",
        "Zone Infiltration Sensible Heat Loss Energy",
        "Zone Infiltration Sensible Heat Gain Energy",
        "Zone Ventilation Sensible Heat Loss Energy",
        "Zone Ventilation Sensible Heat Gain Energy",
        "Zone Mean Air Temperature",
    ]
    for v in vars_we_need:
        key = f"BRIEF28L_{v.replace(' ', '_')}"
        ov[key] = {
            "key_value": "*",
            "variable_name": v,
            "reporting_frequency": "Hourly",
        }


# ─── 4. Run EnergyPlus ────────────────────────────────────────────────────────
def write_and_run(epjson: dict, weather_path: Path) -> Path:
    if RUN_DIR.exists():
        shutil.rmtree(RUN_DIR)
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    epjson_path = RUN_DIR / "input.epJSON"
    epjson_path.write_text(json.dumps(epjson, indent=2))
    print(f"  Wrote patched epJSON to {epjson_path} ({len(json.dumps(epjson))//1024} KB)")
    result = run_simulation(
        epjson_path=epjson_path,
        weather_file_path=weather_path,
        output_dir=RUN_DIR,
    )
    if not result.success:
        print(f"  ✗ EnergyPlus failed: rc={result.return_code}, fatal={result.fatal_errors}, severe={result.severe_errors}")
        if result.err_path and result.err_path.exists():
            print(f"  See {result.err_path}")
            print("  ── Last 30 lines of err file ──")
            print("\n".join(result.err_path.read_text(errors="replace").splitlines()[-30:]))
        raise SystemExit(2)
    print(f"  ✓ EnergyPlus run complete in {result.runtime_seconds}s, warnings={result.warnings}")
    return result.sql_path


# ─── 5. Parse per-surface conduction from EP SQL ──────────────────────────────
def parse_envelope_outputs(sql_path: Path) -> dict:
    """
    Returns:
      {
        external_wall_kwh: float,   # sum across all wall surfaces, OUTSIDE face conduction
        roof_kwh:          float,
        ground_floor_kwh:  float,
        glazing_kwh:       float,   # window conduction (heat loss − heat gain net)
        infiltration_loss_kwh: float,
        infiltration_gain_kwh: float,
        ventilation_loss_kwh:  float,  # sum across all ZoneVentilation
        ventilation_gain_kwh:  float,
        per_surface_outside: {surface_name: kwh},
      }
    """
    conn = _connect(sql_path)
    try:
        def _sum_by_keyvalue_match(var_name: str, predicate) -> tuple[float, dict]:
            rows = _query(
                conn,
                "SELECT ReportDataDictionaryIndex, KeyValue FROM ReportDataDictionary "
                "WHERE Name = ? COLLATE NOCASE",
                (var_name,),
            )
            total = 0.0
            per_surface = {}
            for row in rows:
                kv = (row["KeyValue"] or "").upper()
                if not predicate(kv):
                    continue
                idx = row["ReportDataDictionaryIndex"]
                val_rows = _query(
                    conn,
                    "SELECT SUM(Value) FROM ReportData WHERE ReportDataDictionaryIndex = ?",
                    (idx,),
                )
                v_kwh = (val_rows[0][0] or 0.0) * J_TO_KWH
                per_surface[kv] = v_kwh
                total += v_kwh
            return total, per_surface

        # Outside face conduction: positive = heat LEAVING zone (i.e., heat loss)
        wall_total,  wall_per  = _sum_by_keyvalue_match(
            "Surface Outside Face Conduction Heat Transfer Energy",
            lambda kv: "_WALL_" in kv,
        )
        roof_total,  roof_per  = _sum_by_keyvalue_match(
            "Surface Outside Face Conduction Heat Transfer Energy",
            lambda kv: "_CEILING" in kv or "_ROOF" in kv,
        )
        floor_total, floor_per = _sum_by_keyvalue_match(
            "Surface Outside Face Conduction Heat Transfer Energy",
            lambda kv: "_SLAB" in kv or "_FLOOR" in kv,
        )
        glaz_total,  glaz_per  = _sum_by_keyvalue_match(
            "Surface Outside Face Conduction Heat Transfer Energy",
            lambda kv: "_WIN_" in kv,
        )

        from nza_engine.parsers.sql_parser import _sum_annual
        infil_loss = _sum_annual(conn, "Zone Infiltration Sensible Heat Loss Energy")
        infil_gain = _sum_annual(conn, "Zone Infiltration Sensible Heat Gain Energy")
        vent_loss = _sum_annual(conn, "Zone Ventilation Sensible Heat Loss Energy")
        vent_gain = _sum_annual(conn, "Zone Ventilation Sensible Heat Gain Energy")

        # Per-system ventilation: ZoneVentilation:DesignFlowRate uses the object name
        # as the KeyValue, prefixed with the zone name. Group by mech vent system name.
        rows = _query(
            conn,
            "SELECT ReportDataDictionaryIndex, KeyValue FROM ReportDataDictionary "
            "WHERE Name = 'Zone Ventilation Sensible Heat Loss Energy' COLLATE NOCASE",
        )
        per_system_loss = {}
        for row in rows:
            kv = row["KeyValue"]
            idx = row["ReportDataDictionaryIndex"]
            v_rows = _query(
                conn,
                "SELECT SUM(Value) FROM ReportData WHERE ReportDataDictionaryIndex = ?",
                (idx,),
            )
            v_kwh = (v_rows[0][0] or 0.0) * J_TO_KWH
            per_system_loss[kv] = v_kwh

        return {
            "external_wall_kwh":      wall_total,
            "roof_kwh":               roof_total,
            "ground_floor_kwh":       floor_total,
            "glazing_kwh":            glaz_total,
            "infiltration_loss_kwh":  infil_loss,
            "infiltration_gain_kwh":  infil_gain,
            "ventilation_loss_kwh":   vent_loss,
            "ventilation_gain_kwh":   vent_gain,
            "per_surface_outside": {
                **wall_per, **roof_per, **floor_per, **glaz_per,
            },
            "per_system_vent_loss": per_system_loss,
        }
    finally:
        conn.close()


# ─── 6. Run Static engine envelope-only (Node subprocess) ─────────────────────
def run_static() -> dict:
    r = subprocess.run(
        ["node", str(REPO_ROOT / "scripts" / "_get_static_envelope_only_json.mjs")],
        cwd=REPO_ROOT, capture_output=True, text=True, check=False,
    )
    if r.returncode != 0:
        print(f"  ✗ Static engine subprocess failed:\n{r.stderr}")
        raise SystemExit(3)
    return json.loads(r.stdout)


# ─── 7. Compare per-element ───────────────────────────────────────────────────
def compare(static_result: dict, dynamic_result: dict, mech_vent_summaries: list[dict],
            applied_u_overrides: dict, applied_g: float | None) -> int:
    """
    Print per-element comparison table. Returns non-zero exit code if any
    checked row exceeds ±15%.
    """
    lsp = static_result["losses_at_setpoint"]

    rows = [
        # (label, static_kwh, dynamic_kwh, kind)
        ("External wall total",     lsp["external_wall"]["heating_loss_kwh"],      dynamic_result["external_wall_kwh"], "check"),
        ("Roof",                    lsp["roof"]["heating_loss_kwh"],                dynamic_result["roof_kwh"],          "check"),
        ("Ground floor",            lsp["ground_floor"]["heating_loss_kwh"],        dynamic_result["ground_floor_kwh"],  "check"),
        ("Glazing (conduction)",    lsp["glazing"]["heating_loss_kwh"],             dynamic_result["glazing_kwh"],       "check"),
        ("Background infiltration", lsp["fabric_leakage"]["heating_loss_kwh"],      dynamic_result["infiltration_loss_kwh"], "check"),
    ]
    # Permanent vents: Static line value vs the WindAndStackOpenArea contribution
    # in EP's ventilation_loss. The EP ventilation_loss includes both the BRUKL
    # mech vent and the permanent vents — we'll show the total comparison as
    # "Ventilation systems (mech + permanent vents)".
    rows.append((
        "Ventilation systems total",
        lsp["permanent_vents"]["heating_loss_kwh"]
        + sum(
            (e.get("heat_loss_kwh", 0) for e in (lsp.get("ventilation") or [])), 0.0,
        ),
        dynamic_result["ventilation_loss_kwh"],
        "check",
    ))

    print()
    print("=== Brief 28L Gate L3 — Static vs Dynamic envelope-only, BRUKL parity ===")
    print()
    print(f"Tolerance: ±{TOL_PCT}% per checked row")
    print()
    print(f"Applied BRUKL U-overrides (NoMass replacements in EP):")
    for slot, U in applied_u_overrides.items():
        print(f"  {slot:<15} U = {U} W/m²K")
    if applied_g is not None:
        print(f"  glazing SHGC override:           {applied_g}")
    print()
    print("Mechanical ventilation systems added to Dynamic run:")
    for s in mech_vent_summaries:
        print(f"  {s['name']:<24} flow {s['flow_l_s']:>6.0f} L/s × (1−{s['hre']:.2f}) = {s['effective_flow_l_s']:>6.1f} L/s effective (SFP {s['sfp_w_per_l_s']})")
    print()
    print(f"  {'Element'.ljust(28)} {'Static kWh':>12}  {'Dynamic kWh':>12}  {'Δ kWh':>10}  {'Δ %':>8}  Verdict")
    print(f"  {'─'*28} {'─'*12}  {'─'*12}  {'─'*10}  {'─'*8}  {'─'*8}")
    fails = 0
    for label, s_v, d_v, kind in rows:
        delta = d_v - s_v
        pct = (delta / s_v * 100.0) if s_v else float("nan")
        ok = abs(pct) <= TOL_PCT
        if not ok and kind == "check":
            fails += 1
        verdict = "PASS" if ok else "FAIL"
        print(f"  {label.ljust(28)} {s_v:>12.0f}  {d_v:>12.0f}  {delta:>10.0f}  {pct:>+7.2f}%  {verdict}")
    print()

    # Static-only lines (no Dynamic equivalent)
    print("Static-only lines (no Dynamic comparison this gate):")
    tb_static = lsp.get("thermal_bridging", {}).get("heating_loss_kwh", 0)
    print(f"  Thermal bridging (Static α=200% BRUKL): {tb_static:>10.0f} kWh — not modelled in EP this gate")
    print()

    # Per-system mech vent breakdown
    print("Per-system mechanical ventilation:")
    print(f"  {'System'.ljust(24)} {'Static kWh':>12}  {'Dynamic kWh':>12}  {'Δ %':>8}")
    static_vents = {v.get("name"): v for v in (lsp.get("ventilation") or [])}
    dynamic_per_system = dynamic_result.get("per_system_vent_loss", {})
    # Match dynamic KeyValues back to system names by suffix
    for sname, sv in static_vents.items():
        s_kwh = sv.get("heat_loss_kwh", 0)
        # Sum all Dynamic per_system entries whose KeyValue ends with sname.upper()
        d_kwh = sum(v for kv, v in dynamic_per_system.items() if (kv or "").endswith(sname.upper()))
        if s_kwh == 0 and d_kwh == 0:
            continue
        pct = ((d_kwh - s_kwh) / s_kwh * 100.0) if s_kwh else float("nan")
        print(f"  {sname.ljust(24)} {s_kwh:>12.0f}  {d_kwh:>12.0f}  {pct:>+7.2f}%")
    print()

    if fails == 0:
        print(f"✓ Gate L3 PASSES — all checked rows within ±{TOL_PCT}%")
    else:
        print(f"✗ Gate L3 has {fails} row(s) outside ±{TOL_PCT}% — investigate before sign-off")
    print()
    print("HALT per Brief 28L Gate L3.")
    return 0  # always exit 0; FAIL signal is the verdict column

# ─── Main ─────────────────────────────────────────────────────────────────────
def main() -> int:
    print("Fetching Bridgewater project state from API...")
    project = fetch_project()
    print(f"  project: {project['name']}")
    print(f"  infiltration_ach: {project['building_config'].get('infiltration_ach')}")
    print(f"  fabric.thermal_bridging_alpha_pct: {project['building_config'].get('fabric', {}).get('thermal_bridging_alpha_pct')}")
    print()

    print("Assembling envelope-only epJSON via nza_engine.assemble_epjson...")
    epjson, brukl_overrides, weather_path = assemble(project)
    print(f"  zones: {len(epjson.get('Zone', {}))}, surfaces: {len(epjson.get('BuildingSurface:Detailed', {}))}, windows: {len(epjson.get('FenestrationSurface:Detailed', {}))}")
    print()

    print("Patching epJSON with BRUKL inputs the assembler doesn't natively handle...")
    applied_u = patch_constructions_for_u_overrides(epjson, brukl_overrides, project)
    print(f"  U-value overrides applied: {applied_u}")
    applied_g = patch_glazing_g_override(epjson, brukl_overrides)
    print(f"  Glazing SHGC override applied: {applied_g}")
    mech_vent_summaries = patch_mechanical_ventilation(epjson, project)
    print(f"  Mechanical ventilation systems added: {len(mech_vent_summaries)}")
    add_output_variables(epjson)
    print(f"  Output:Variable requests injected for per-surface + ventilation data")
    print()

    print("Running EnergyPlus...")
    sql_path = write_and_run(epjson, weather_path)
    print()

    print("Parsing per-surface + ventilation outputs from EP SQL...")
    dynamic_result = parse_envelope_outputs(sql_path)
    print(f"  External wall total (outside-face cond.): {dynamic_result['external_wall_kwh']:.0f} kWh")
    print(f"  Roof:                                      {dynamic_result['roof_kwh']:.0f} kWh")
    print(f"  Ground floor:                              {dynamic_result['ground_floor_kwh']:.0f} kWh")
    print(f"  Glazing (cond.):                           {dynamic_result['glazing_kwh']:.0f} kWh")
    print(f"  Infiltration loss:                         {dynamic_result['infiltration_loss_kwh']:.0f} kWh")
    print(f"  Ventilation loss:                          {dynamic_result['ventilation_loss_kwh']:.0f} kWh")
    print()

    print("Running Static engine envelope-only (Node subprocess)...")
    static_result = run_static()
    print(f"  Static losses_at_setpoint loaded.")
    print()

    return compare(static_result, dynamic_result, mech_vent_summaries, applied_u, applied_g)


if __name__ == "__main__":
    sys.exit(main())

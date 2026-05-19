"""
Brief 40 Part 5 — Bridgewater systems_config_v25 → systems_config_v40 migration.

Reads each project's `building.systems_config_v25` (Brief 28f shape) and writes
a `building.systems_config_v40` (Brief 40 per-system array shape) for the
heating / cooling / DHW / ventilation services. Lighting + small_power are
already populated via Part 4's DEFAULT_PARAMS fallback at load time -- they're
not re-written here.

Why
---
Brief 40's engine (systemsEngine.computeSystemsDelivered) reads
`systems_config_v40` and produces the per-system breakdown +
comfort-vs-setpoint diagnostic, attached to `consumption.brief40`. Until this
migration runs, projects on disk only have `systems_config_v25` -- the engine
falls back to the existing computeServiceEnergy path and `consumption.brief40`
is null. Post-migration, Bridgewater's heating / cooling / DHW / ventilation
sections populate in the new Systems left panel; the Diagnostic centre tab
lights up; v25 stays on disk (untouched) for backward compatibility with the
existing Sankey + Live Results contracts.

Field mapping (audit doc §7):

  Heating (v25 has primary + secondary):
    v25.heating.primary.library_id   → v40.heating[0].source + efficiency_metric (via _TEMPLATE_LOOKUP)
    v25.heating.primary_pct          → v40.heating[0].share_pct
    v25.heating.secondary.library_id → v40.heating[1] (when present)
    100 - primary_pct                → v40.heating[1].share_pct
    v25.heating.setpoint_c           → v40.heating[i].setpoint (null when == comfort.lower_c)
    v25.heating.schedule_ref         → v40.heating[i].control_schedule_id

  Cooling: same shape.

  DHW (v25 has fuel_mix + primary/secondary):
    The Bridgewater DHW model uses a fuel_mix {gas, electric_resistance, heat_pump}
    that doesn't map cleanly onto primary_pct (the modern v25 engine uses fuel_mix
    when present and ignores primary_pct -- see computeDhwFuelMix in instantCalc.js).
    Brief 40 migration: per non-zero fuel_mix entry → one v40 DHW system
    with the appropriate source + efficiency. The library_ids hint at which
    template to use for each fuel.
    v25.dhw.store_temperature_c       → v40.dhw[i].setpoint
    v25.dhw.cold_mains_temperature_c  → v40.dhw[i].cold_supply_temp_c
    v25.dhw.litres_per_person_per_day → v40.dhw[i].demand_litres_per_person_per_day
    demand_basis: 'per_person' (hotel default per audit §12)
    tap_outlet_temp_c: 40 (hotel default per audit §4.2)

  Ventilation (v25 array, one system per entry):
    v25.ventilation[i].flow_l_s       → v40.ventilation[i].flow_rate
    v25.ventilation[i].sfp_w_per_l_s  → v40.ventilation[i].efficiency_metric.sfp_w_per_lps
    v25.ventilation[i].hre            → v40.ventilation[i].efficiency_metric.recovery_sensible_pct (× 100)
    v25.ventilation[i].schedule_ref   → v40.ventilation[i].control_schedule_id
    share_pct: each system's flow_l_s / total → its share of total building flow

Idempotent: re-running is a no-op (the script checks whether v40 already has
non-empty heating / cooling / dhw / ventilation arrays and skips if so).

Stop-dev-server discipline per CLAUDE.md Process Rule 11.

Usage
-----
    # 1. Stop the dev server.
    # 2. Run:
    python scripts/40_bridgewater_systems_migration.py
    # 3. Confirm output. Re-run for NO-OP check.
    # 4. Restart the dev server.

Requires the backend running on port 8002.
"""

import json
import sys
import time
import urllib.error
import urllib.request

API_BASE = "http://127.0.0.1:8002/api"

# Library-id → (source, efficiency_metric) lookup for the Bridgewater templates.
# Mirrors the values in frontend/src/data/systemTemplatesLibrary.js. When a
# library_id isn't in this table, the migration falls back to a sensible
# generic default for the service.
_TEMPLATE_LOOKUP = {
    # Heating + cooling
    "vrf_heat_recovery_dual_function": {
        "source_heating":      "ambient_air",
        "efficiency_heating":  5.12,
        "source_cooling":      "electricity",
        "efficiency_cooling":  3.51,
    },
    "dx_split_cooling": {
        "source_cooling":      "electricity",
        "efficiency_cooling":  5.62,
    },
    "electric_panel_heater": {
        "source_heating":      "electricity",
        "efficiency_heating":  1.0,
    },
    # DHW
    "ashp_dhw_preheat": {
        "source_dhw":     "ambient_air",
        "efficiency_dhw": 3.0,
    },
    "gas_boiler_calorifier": {
        "source_dhw":     "gas",
        "efficiency_dhw": 0.90,
    },
    # Ventilation -- mvhr_with_hr & wc_extract_no_hr exposed via inline
    # ventilation entry fields; lookup is only for label hinting.
}

_GENERIC_DEFAULTS = {
    "heating":     {"source": "gas",         "efficiency_metric": 0.85},
    "cooling":     {"source": "electricity", "efficiency_metric": 3.0},
    "dhw":         {"source": "gas",         "efficiency_metric": 0.85},
    "ventilation": {"source": "electricity", "efficiency_metric": {"sfp_w_per_lps": 1.5, "recovery_sensible_pct": 0, "recovery_latent_pct": 0}},
}

# DHW fuel_mix key → (template_id, source, efficiency_metric) for Bridgewater.
# Per-fuel hot-water systems each get one v40 entry.
_DHW_FUEL_MAP = {
    "gas":                 ("gas_boiler_calorifier", "gas",         0.90),
    "heat_pump":           ("ashp_dhw_preheat",      "ambient_air", 3.0),
    "electric_resistance": ("electric_immersion",    "electricity", 0.95),
}


def http_get(url):
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def http_put(url, body):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, method="PUT",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def _new_id(service):
    return f"sys_{service}_{int(time.time() * 1000)}_{int.from_bytes(__import__('os').urandom(2), 'big')}"


def _resolve_template(library_id, service):
    """Return (source, efficiency_metric, label) for the library template."""
    tmpl = _TEMPLATE_LOOKUP.get(library_id, {})
    if service == "heating":
        src = tmpl.get("source_heating", _GENERIC_DEFAULTS["heating"]["source"])
        eff = tmpl.get("efficiency_heating", _GENERIC_DEFAULTS["heating"]["efficiency_metric"])
    elif service == "cooling":
        src = tmpl.get("source_cooling", _GENERIC_DEFAULTS["cooling"]["source"])
        eff = tmpl.get("efficiency_cooling", _GENERIC_DEFAULTS["cooling"]["efficiency_metric"])
    elif service == "dhw":
        src = tmpl.get("source_dhw", _GENERIC_DEFAULTS["dhw"]["source"])
        eff = tmpl.get("efficiency_dhw", _GENERIC_DEFAULTS["dhw"]["efficiency_metric"])
    else:
        src = _GENERIC_DEFAULTS[service]["source"]
        eff = _GENERIC_DEFAULTS[service]["efficiency_metric"]
    return src, eff, library_id


def _comfort_setpoint_resolved(setpoint_c, comfort_value):
    """Return null if the system's setpoint matches the comfort band; else the value."""
    if setpoint_c is None:
        return None
    try:
        return None if abs(float(setpoint_c) - float(comfort_value)) < 0.05 else float(setpoint_c)
    except (TypeError, ValueError):
        return None


def _migrate_heating_or_cooling(v25_block, service, comfort_value):
    if not v25_block or v25_block.get("enabled") is False:
        return []
    primary       = v25_block.get("primary") or {}
    secondary     = v25_block.get("secondary") or {}
    primary_pct   = float(v25_block.get("primary_pct", 100))
    setpoint_c    = v25_block.get("setpoint_c")
    schedule_ref  = v25_block.get("schedule_ref")
    setpoint_v40  = _comfort_setpoint_resolved(setpoint_c, comfort_value)

    systems = []
    if primary.get("library_id"):
        src, eff, lib_id = _resolve_template(primary["library_id"], service)
        systems.append({
            "id":                  _new_id(service),
            "label":               f"Primary {service} ({lib_id})",
            "service":             service,
            "source":              src,
            "efficiency_metric":   eff,
            "setpoint":            setpoint_v40,
            "control_mechanism":   "scheduled" if schedule_ref else "constant",
            "control_schedule_id": schedule_ref,
            "share_pct":           primary_pct,
            "capacity_kw":         None,
            "notes":               f"Migrated from systems_config_v25 (library_id={lib_id})",
        })
    if secondary.get("library_id"):
        secondary_pct = max(0.0, 100.0 - primary_pct)
        if secondary_pct > 0:
            src, eff, lib_id = _resolve_template(secondary["library_id"], service)
            systems.append({
                "id":                  _new_id(service),
                "label":               f"Secondary {service} ({lib_id})",
                "service":             service,
                "source":              src,
                "efficiency_metric":   eff,
                "setpoint":            setpoint_v40,
                "control_mechanism":   "scheduled" if schedule_ref else "constant",
                "control_schedule_id": schedule_ref,
                "share_pct":           secondary_pct,
                "capacity_kw":         None,
                "notes":               f"Migrated from systems_config_v25 (library_id={lib_id})",
            })
    return systems


def _migrate_dhw(v25_block):
    if not v25_block or v25_block.get("enabled") is False:
        return []
    fuel_mix     = v25_block.get("fuel_mix") or {}
    setpoint     = float(v25_block.get("store_temperature_c", 60))
    cold_supply  = float(v25_block.get("cold_mains_temperature_c", 10))
    lpd          = float(v25_block.get("litres_per_person_per_day", 80))
    schedule_ref = v25_block.get("schedule_ref")

    # Build per-fuel systems with shares from fuel_mix
    systems = []
    for fuel_key, frac in fuel_mix.items():
        share_pct = round(float(frac) * 100, 1)
        if share_pct <= 0.01:
            continue
        tmpl_id, source, efficiency = _DHW_FUEL_MAP.get(
            fuel_key, ("dhw_generic", "electricity", 0.95)
        )
        systems.append({
            "id":                              _new_id("dhw"),
            "label":                           f"DHW {fuel_key.replace('_', ' ')} ({tmpl_id})",
            "service":                         "dhw",
            "source":                          source,
            "efficiency_metric":               efficiency,
            "setpoint":                        setpoint,
            "tap_outlet_temp_c":               40,   # hotel default per audit §4.2
            "cold_supply_temp_c":              cold_supply,
            "demand_basis":                    "per_person",
            "demand_litres_per_m2_day":        None,
            "demand_litres_per_person_per_day": lpd,
            "control_mechanism":               "scheduled" if schedule_ref else "constant",
            "control_schedule_id":             schedule_ref,
            "share_pct":                       share_pct,
            "capacity_kw":                     None,
            "notes":                           f"Migrated from systems_config_v25 fuel_mix[{fuel_key}={frac:.2f}]; tap-mix correction applies (hot_fraction = (40 - {cold_supply}) / ({setpoint} - {cold_supply}))",
        })

    # If fuel_mix didn't produce any non-zero entries, fall back to primary alone
    if not systems:
        primary = v25_block.get("primary") or {}
        if primary.get("library_id"):
            src, eff, lib_id = _resolve_template(primary["library_id"], "dhw")
            systems.append({
                "id":                              _new_id("dhw"),
                "label":                           f"DHW primary ({lib_id})",
                "service":                         "dhw",
                "source":                          src,
                "efficiency_metric":               eff,
                "setpoint":                        setpoint,
                "tap_outlet_temp_c":               40,
                "cold_supply_temp_c":              cold_supply,
                "demand_basis":                    "per_person",
                "demand_litres_per_m2_day":        None,
                "demand_litres_per_person_per_day": lpd,
                "control_mechanism":               "scheduled" if schedule_ref else "constant",
                "control_schedule_id":             schedule_ref,
                "share_pct":                       100,
                "capacity_kw":                     None,
                "notes":                           f"Migrated from systems_config_v25 primary only (no fuel_mix); tap-mix correction applies",
            })

    # Normalise share_pct sum to exactly 100 (round-trip rounding can leave it
    # at 99.9 or 100.1)
    total = sum(s["share_pct"] for s in systems)
    if systems and abs(total - 100) > 0.001:
        scale = 100.0 / total
        for s in systems:
            s["share_pct"] = round(s["share_pct"] * scale, 1)

    return systems


def _migrate_ventilation(v25_list):
    if not isinstance(v25_list, list) or len(v25_list) == 0:
        return []
    total_flow = sum(float(v.get("flow_l_s", 0)) for v in v25_list if v.get("enabled") is not False)
    if total_flow <= 0:
        # All zero or disabled — preserve list with share 0 each (engine
        # validation tolerates empty arrays)
        return []
    systems = []
    for v in v25_list:
        if v.get("enabled") is False:
            continue
        flow_l_s = float(v.get("flow_l_s", 0))
        sfp      = float(v.get("sfp_w_per_l_s", 0))
        hre      = float(v.get("hre", 0))
        schedule_ref = v.get("schedule_ref")
        share_pct = round((flow_l_s / total_flow) * 100, 1)
        systems.append({
            "id":                  v.get("id") or _new_id("ventilation"),
            "label":               v.get("name") or v.get("id") or "Ventilation system",
            "service":             "ventilation",
            "source":              "electricity",
            "efficiency_metric": {
                "sfp_w_per_lps":          sfp,
                "recovery_sensible_pct":  hre * 100,
                "recovery_latent_pct":    0,
            },
            "flow_rate":           flow_l_s,
            "flow_rate_basis":     "constant",   # l/s building total
            "setpoint":            None,
            "control_mechanism":   "scheduled" if schedule_ref else "constant",
            "control_schedule_id": schedule_ref,
            "share_pct":           share_pct,
            "capacity_kw":         None,
            "defrost_penalty_kwh": None,
            "notes":               f"Migrated from systems_config_v25.ventilation[{v.get('library_id','unknown')}]",
        })
    # Normalise share sum to 100
    total = sum(s["share_pct"] for s in systems)
    if systems and abs(total - 100) > 0.001:
        scale = 100.0 / total
        for s in systems:
            s["share_pct"] = round(s["share_pct"] * scale, 1)
    return systems


def _is_already_migrated(v40):
    """True when v40 already has any non-empty heating / cooling / dhw /
    ventilation array (lighting + small_power don't count -- those come from
    Part 4's DEFAULT_PARAMS fallback and are always populated)."""
    if not isinstance(v40, dict):
        return False
    for svc in ("heating", "cooling", "dhw", "ventilation"):
        if isinstance(v40.get(svc), list) and len(v40[svc]) > 0:
            return True
    return False


def _migrate_project(project):
    name = project.get("name") or project.get("id")
    project_id = project["id"]
    full = http_get(f"{API_BASE}/projects/{project_id}")
    bc = full.get("building_config") or {}
    v25 = bc.get("systems_config_v25")
    if not v25:
        print(f"NO-OP: {name!r} has no systems_config_v25; nothing to migrate")
        return False

    existing_v40 = bc.get("systems_config_v40") or {}
    if _is_already_migrated(existing_v40):
        print(f"NO-OP: {name!r} -- systems_config_v40 already has heating/cooling/dhw/ventilation populated (idempotent re-run)")
        return False

    # Resolve comfort band for setpoint:null detection. Falls back to (20, 26)
    # per state-contract default if no comfort_band on the project row.
    comfort_lower = float(full.get("comfort_band_lower_c", 20))
    comfort_upper = float(full.get("comfort_band_upper_c", 26))

    heating     = _migrate_heating_or_cooling(v25.get("heating"),     "heating", comfort_lower)
    cooling     = _migrate_heating_or_cooling(v25.get("cooling"),     "cooling", comfort_upper)
    dhw         = _migrate_dhw(v25.get("dhw"))
    ventilation = _migrate_ventilation(v25.get("ventilation"))

    # Preserve existing lighting + small_power (Part 4 DEFAULT_PARAMS fallback)
    lighting    = existing_v40.get("lighting")    or []
    small_power = existing_v40.get("small_power") or []

    new_v40 = {
        "heating":     heating,
        "cooling":     cooling,
        "dhw":         dhw,
        "ventilation": ventilation,
        "lighting":    lighting,
        "small_power": small_power,
    }

    http_put(f"{API_BASE}/projects/{project_id}/building", {"systems_config_v40": new_v40})

    print(f"OK: {name!r}")
    print(f"    Heating:     {len(heating)} systems, shares {[s['share_pct'] for s in heating]}")
    for s in heating:
        print(f"      - {s['label']:<55s} source={s['source']:<18s} eff={s['efficiency_metric']:<6}  setpoint={s['setpoint']}")
    print(f"    Cooling:     {len(cooling)} systems, shares {[s['share_pct'] for s in cooling]}")
    for s in cooling:
        print(f"      - {s['label']:<55s} source={s['source']:<18s} eff={s['efficiency_metric']:<6}  setpoint={s['setpoint']}")
    print(f"    DHW:         {len(dhw)} systems, shares {[s['share_pct'] for s in dhw]}")
    for s in dhw:
        print(f"      - {s['label']:<55s} source={s['source']:<18s} eff={s['efficiency_metric']:<6}  basis={s['demand_basis']}  tap={s['tap_outlet_temp_c']}°C")
    print(f"    Ventilation: {len(ventilation)} systems, shares {[s['share_pct'] for s in ventilation]}")
    for s in ventilation:
        em = s['efficiency_metric']
        print(f"      - {s['label']:<55s} flow={s['flow_rate']:>6} l/s  SFP={em['sfp_w_per_lps']}  HR sensible={em['recovery_sensible_pct']:.0f}%")
    print(f"    Lighting:    {len(lighting)} systems (preserved from Part 4 default)")
    print(f"    Small power: {len(small_power)} systems (preserved from Part 4 default)")
    return True


def main():
    try:
        projects = http_get(f"{API_BASE}/projects")
    except urllib.error.URLError as e:
        print(f"ERROR: cannot reach backend at {API_BASE} -- is go.bat running? ({e})")
        return 2

    any_changed = False
    for p in projects:
        try:
            if _migrate_project(p):
                any_changed = True
        except Exception as e:
            print(f"ERROR migrating {p.get('name')}: {e}")
            return 3

    if not any_changed:
        print("All projects already migrated; nothing to do.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

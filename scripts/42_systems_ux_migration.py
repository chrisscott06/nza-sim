"""
Brief 42 Part 4 — Bridgewater systems_config_v40 v1 -> v2 schema migration.

What it does
------------
For each project on the backend, reads `building_config.systems_config_v40`
and lifts the building-level fields that Brief 42 moved out of per-system
entries to service-level positions, then strips them from each per-system
entry. Idempotent: schema_version >= 2 -> no-op.

Brief 42 field mapping (mirrors `migrateSystemsConfigV40_V1ToV2` in
`frontend/src/context/ProjectContext.jsx`, audit doc §6):

  Heating / cooling per-system        ->  service-level on systems_config_v40
  ──────────────────────────────────────────────────────────────────────
  heating[i].setpoint (number)        ->  heating_setpoint_mode='custom'
                                         heating_setpoint_c=value
  heating[i].setpoint (null/missing)  ->  heating_setpoint_mode='follow_comfort'
                                         heating_setpoint_c=null
  (same shape for cooling)

  DHW per-system                       ->  service-level on systems_config_v40
  ──────────────────────────────────────────────────────────────────────
  dhw[i].setpoint                      ->  dhw_storage_setpoint_c
  dhw[i].tap_outlet_temp_c             ->  dhw_tap_outlet_temp_c
  dhw[i].cold_supply_temp_c            ->  dhw_cold_supply_temp_c
  dhw[i].demand_basis                  ->  dhw_demand_basis
  dhw[i].demand_litres_per_person_     ->  dhw_demand_litres_per_person_
                                  per_day                          per_day
  dhw[i].demand_litres_per_m2_day      ->  dhw_demand_litres_per_m2_per_day
                                          (note: schema rename)

Lead-wins rule (mirrors the JS loader migration + pre-Brief-42 engine):
The lifted value comes from the FIRST ENABLED per-system entry that has
the field; if no enabled entry has it, the FIRST per-system entry;
otherwise the DEFAULT_PARAMS value. When the script detects per-system
disagreement on any service-level field (e.g. Bridgewater's DHW gas
boiler says tap=30 but the ASHP says tap=40), it logs a WARNING and uses
the lead value — explicit policy per Brief 42 §"When to escalate".

Lighting + small_power re-seed (--force only)
---------------------------------------------
Closes Brief 40 Issue #19. The DEFAULT_PARAMS load-fallback for
systems_config_v40 is a whole-object `??` fallback (see ProjectContext
load path) — if the persisted bc has a populated v40 but empty
`lighting` or `small_power` arrays, the load-fallback does NOT re-seed
those arrays (the parent object exists; the `??` short-circuits before
walking into per-service arrays). Result: small_power / lighting
sections render empty after migration.

The `--force` flag re-seeds these arrays from DEFAULT_PARAMS when empty.
Single-system seeds:
  lighting:    [Lighting (baseline), electricity, constant control_mechanism, control_factor=1.0]
  small_power: [Small power (baseline), electricity, constant control_mechanism, control_factor=1.0]

Intervention patches
--------------------
Bumps each intervention's `schema_version` from 1 to 2 and rewrites the
patch paths that Brief 42 moved (heating[id=X].setpoint ->
heating_setpoint_c with a sibling heating_setpoint_mode=custom patch).
Mirrors `migrateInterventionPatches` in interventionsEngine.js. For
Bridgewater (no interventions persisted), this loop is a no-op.

Idempotency / re-run / --force
------------------------------
Default behaviour: a project with `schema_version >= 2` is skipped with
a NO-OP message. The migration is safe to re-run.

`--force` bypasses the idempotency check AND triggers the lighting +
small_power re-seed for empty arrays (closes Issue #19). Use with care:
hand-edited service-level values on disk will be re-lifted from
per-system entries again. For Brief 42 Bridgewater migration, the
loader has already lifted in memory; the --force run writes those
lifted values back to disk and reseeds lighting/small_power.

Stop-dev-server discipline per CLAUDE.md Process Rule 11.

Usage
-----
    # 1. Stop the dev server (npm run dev). Keep go.bat backend running on 8002.
    # 2. Run:
    python scripts/42_systems_ux_migration.py
    # 3. Confirm output. Re-run for NO-OP check.
    # 4. To re-seed empty lighting/small_power arrays:
    python scripts/42_systems_ux_migration.py --force
    # 5. Re-run --force for NO-OP check (force still skips re-seed when
    #    lighting/small_power already populated).
    # 6. Restart the dev server.

Requires the backend running on port 8002.
"""

import argparse
import json
import sys
import urllib.error
import urllib.request

API_BASE = "http://127.0.0.1:8002/api"

SCHEMA_VERSION_TARGET = 2

# DEFAULT_PARAMS service-level fallback values (mirrors ProjectContext.jsx
# DEFAULT_PARAMS.systems_config_v40 — Brief 42 Part 1 reshape).
DEFAULT_SERVICE_LEVEL = {
    "heating_setpoint_mode":                "follow_comfort",
    "heating_setpoint_c":                   None,
    "cooling_setpoint_mode":                "follow_comfort",
    "cooling_setpoint_c":                   None,
    "dhw_storage_setpoint_c":               60,
    "dhw_tap_outlet_temp_c":                40,
    "dhw_cold_supply_temp_c":               10,
    "dhw_demand_basis":                     "per_person",
    "dhw_demand_litres_per_person_per_day": 80,
    "dhw_demand_litres_per_m2_per_day":     1.1,
}

# DEFAULT_PARAMS thin-entry seeds for lighting + small_power (Brief 40 Part 4).
DEFAULT_LIGHTING_THIN = {
    "id":                  "default_lighting",
    "label":               "Lighting (baseline)",
    "service":             "lighting",
    "source":              "electricity",
    "efficiency_metric":   None,
    "setpoint":            None,
    "control_mechanism":   "constant",
    "control_schedule_id": None,
    "control_factor":      1.0,
    "share_pct":           100,
    "capacity_kw":         None,
    "notes":               "",
    "enabled":             True,
}

DEFAULT_SMALL_POWER_THIN = {
    "id":                  "default_small_power",
    "label":               "Small power (baseline)",
    "service":             "small_power",
    "source":              "electricity",
    "efficiency_metric":   None,
    "setpoint":            None,
    "control_mechanism":   "constant",
    "control_schedule_id": None,
    "control_factor":      1.0,
    "share_pct":           100,
    "capacity_kw":         None,
    "notes":               "",
    "enabled":             True,
}

# Per-service list of v1 per-system field names that are now service-level.
SERVICE_LEVEL_FIELDS_PER_SERVICE = {
    "heating": ["setpoint"],
    "cooling": ["setpoint"],
    "dhw":     ["setpoint", "tap_outlet_temp_c", "cold_supply_temp_c",
                "demand_basis", "demand_litres_per_person_per_day",
                "demand_litres_per_m2_day"],
}


def _v2_service_level_key(service, field):
    """Map a per-system v1 field name to the service-level v2 field name."""
    if service == "heating" and field == "setpoint":
        return "heating_setpoint_c"
    if service == "cooling" and field == "setpoint":
        return "cooling_setpoint_c"
    if service == "dhw":
        return {
            "setpoint":                          "dhw_storage_setpoint_c",
            "tap_outlet_temp_c":                 "dhw_tap_outlet_temp_c",
            "cold_supply_temp_c":                "dhw_cold_supply_temp_c",
            "demand_basis":                      "dhw_demand_basis",
            "demand_litres_per_person_per_day":  "dhw_demand_litres_per_person_per_day",
            "demand_litres_per_m2_day":          "dhw_demand_litres_per_m2_per_day",
        }.get(field)
    return None


# ── HTTP helpers ────────────────────────────────────────────────────────────

def http_get(url):
    with urllib.request.urlopen(url) as r:
        return json.loads(r.read().decode("utf-8"))


def http_put(url, body):
    req = urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"),
        method="PUT",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode("utf-8"))


# ── Migration core ──────────────────────────────────────────────────────────

def migrate_systems_config_v40(raw_v40, project_name, warnings):
    """Pure function: takes a v40 dict (possibly v1), returns the v2 shape.
    Mirrors `migrateSystemsConfigV40_V1ToV2` in ProjectContext.jsx (Brief 42
    Part 2 loader). Appends warning strings to `warnings` for per-system
    disagreement on service-level fields."""
    if not isinstance(raw_v40, dict):
        return raw_v40
    out = dict(raw_v40)

    for service in ("heating", "cooling", "dhw"):
        arr = raw_v40.get(service) if isinstance(raw_v40.get(service), list) else []
        if not arr:
            continue

        fields = SERVICE_LEVEL_FIELDS_PER_SERVICE[service]
        enabled = [s for s in arr if isinstance(s, dict) and s.get("enabled") is not False]
        lead = (enabled[0] if enabled else arr[0]) or {}

        for field in fields:
            v2_key = _v2_service_level_key(service, field)
            if not v2_key:
                continue

            # Disagreement detection — log all distinct non-null values across systems
            values = [s.get(field) for s in arr if isinstance(s, dict)]
            non_null = [v for v in values if v is not None]
            distinct = list({json.dumps(v) for v in non_null})  # set on JSON repr
            if len(distinct) > 1:
                lead_val = lead.get(field)
                warnings.append(
                    f"{project_name}: {service}.{field} disagrees across systems "
                    f"(values: {[json.loads(d) for d in distinct]}); "
                    f"using lead-enabled value {lead_val!r}"
                )

            # If v2-level field is already populated, don't clobber.
            existing = out.get(v2_key)
            if existing is not None:
                continue

            # heating/cooling setpoint multi-emit: also write the _mode
            if (service in ("heating", "cooling")) and field == "setpoint":
                v = lead.get(field)
                mode_key = f"{service}_setpoint_mode"
                if isinstance(v, (int, float)):
                    out[mode_key]                       = "custom"
                    out[f"{service}_setpoint_c"]        = v
                else:
                    # null / missing -> follow comfort
                    out[mode_key]                       = DEFAULT_SERVICE_LEVEL[mode_key]
                    out[f"{service}_setpoint_c"]        = None
                continue

            # DHW + simple lifts.
            lifted = lead.get(field)
            out[v2_key] = lifted if lifted is not None else DEFAULT_SERVICE_LEVEL.get(v2_key)

        # Strip building-level fields from every per-system entry.
        cleaned_list = []
        for sys_entry in arr:
            if not isinstance(sys_entry, dict):
                cleaned_list.append(sys_entry)
                continue
            stripped = {k: v for k, v in sys_entry.items() if k not in fields}
            cleaned_list.append(stripped)
        out[service] = cleaned_list

    return out


def reseed_empty_thin_arrays(v40, project_name, applied):
    """When --force is set, populate empty lighting / small_power arrays
    with the DEFAULT_PARAMS thin entries. Closes Brief 40 Issue #19."""
    if not isinstance(v40, dict):
        return v40
    out = dict(v40)
    if not out.get("lighting"):
        out["lighting"] = [dict(DEFAULT_LIGHTING_THIN)]
        applied.append(f"{project_name}: re-seeded lighting (1 default thin entry)")
    if not out.get("small_power"):
        out["small_power"] = [dict(DEFAULT_SMALL_POWER_THIN)]
        applied.append(f"{project_name}: re-seeded small_power (1 default thin entry)")
    return out


# ── Patch migration (Brief 41 schema-flexibility discipline) ────────────────
#
# Mirrors `migrateInterventionPatches` + V1_TO_V2_PATCH_MIGRATIONS in
# `frontend/src/utils/interventionsEngine.js`. For each patch in each
# intervention, rewrite v1 per-system service-level paths to v2 service-
# level paths. Multi-emit cases (heating/cooling setpoint) expand one
# input patch into TWO output patches (mode + value).

def _migrate_patch_v1_to_v2(patch):
    """Apply Brief 42 path rewrites. Returns a list of patches (multi-emit
    for heating/cooling setpoint; single-emit otherwise; empty list if
    the patch doesn't match a v1 path that needs rewriting — caller then
    keeps the patch as-is)."""
    if not isinstance(patch, dict):
        return [patch]
    path = patch.get("path", "")
    if not isinstance(path, str):
        return [patch]

    # heating/cooling per-system setpoint -> service-level mode + c
    for svc in ("heating", "cooling"):
        prefix = f"building_config.systems_config_v40.{svc}["
        if path.startswith(prefix) and path.endswith("].setpoint"):
            v = patch.get("value")
            if isinstance(v, (int, float)):
                return [
                    {**patch, "path": f"building_config.systems_config_v40.{svc}_setpoint_mode",
                              "value": "custom"},
                    {**patch, "path": f"building_config.systems_config_v40.{svc}_setpoint_c",
                              "value": v},
                ]
            return [
                {**patch, "path": f"building_config.systems_config_v40.{svc}_setpoint_mode",
                          "value": "follow_comfort"},
                {**patch, "path": f"building_config.systems_config_v40.{svc}_setpoint_c",
                          "value": None},
            ]

    # DHW per-system service-level fields
    dhw_prefix = "building_config.systems_config_v40.dhw["
    if path.startswith(dhw_prefix):
        # Map per-system field-name suffix -> service-level path
        if path.endswith("].setpoint"):
            return [{**patch, "path": "building_config.systems_config_v40.dhw_storage_setpoint_c"}]
        if path.endswith("].tap_outlet_temp_c"):
            return [{**patch, "path": "building_config.systems_config_v40.dhw_tap_outlet_temp_c"}]
        if path.endswith("].cold_supply_temp_c"):
            return [{**patch, "path": "building_config.systems_config_v40.dhw_cold_supply_temp_c"}]
        if path.endswith("].demand_basis"):
            return [{**patch, "path": "building_config.systems_config_v40.dhw_demand_basis"}]
        if path.endswith("].demand_litres_per_person_per_day"):
            return [{**patch, "path": "building_config.systems_config_v40.dhw_demand_litres_per_person_per_day"}]
        if path.endswith("].demand_litres_per_m2_day"):
            return [{**patch, "path": "building_config.systems_config_v40.dhw_demand_litres_per_m2_per_day"}]

    # No rewrite needed
    return [patch]


def migrate_intervention(intervention, applied):
    """Bumps schema_version to 2 and migrates patches."""
    if not isinstance(intervention, dict):
        return intervention
    schema_v = intervention.get("schema_version", 1)
    if isinstance(schema_v, int) and schema_v >= SCHEMA_VERSION_TARGET:
        return intervention

    out = dict(intervention)
    raw_patches = intervention.get("patches", [])
    if not isinstance(raw_patches, list):
        out["schema_version"] = SCHEMA_VERSION_TARGET
        return out

    migrated = []
    rewrites = 0
    for p in raw_patches:
        result = _migrate_patch_v1_to_v2(p)
        if result != [p]:
            rewrites += 1
        migrated.extend(result)

    out["patches"] = migrated
    out["schema_version"] = SCHEMA_VERSION_TARGET
    if rewrites > 0:
        label = intervention.get("label", intervention.get("id", "?"))
        applied.append(f"intervention {label!r}: rewrote {rewrites} patch path(s) v1->v2")
    return out


# ── Project-level driver ────────────────────────────────────────────────────

def migrate_project(project, force):
    name = project.get("name") or project.get("id")
    project_id = project["id"]

    full = http_get(f"{API_BASE}/projects/{project_id}")
    bc = full.get("building_config") or {}

    schema_v = bc.get("schema_version", 1)
    if not isinstance(schema_v, int):
        schema_v = 1

    if schema_v >= SCHEMA_VERSION_TARGET and not force:
        print(f"NO-OP: {name!r} -- schema_version {schema_v} already >= {SCHEMA_VERSION_TARGET}")
        return False

    if schema_v >= SCHEMA_VERSION_TARGET and force:
        print(f"FORCE: {name!r} -- schema_version {schema_v} already >= {SCHEMA_VERSION_TARGET}; "
              f"re-applying lift + lighting/small_power re-seed pass")

    raw_v40 = bc.get("systems_config_v40")
    warnings = []
    applied = []

    if isinstance(raw_v40, dict):
        new_v40 = migrate_systems_config_v40(raw_v40, name, warnings)
    else:
        new_v40 = None

    if force and isinstance(new_v40, dict):
        new_v40 = reseed_empty_thin_arrays(new_v40, name, applied)

    # Interventions patch migration
    raw_interventions = bc.get("interventions")
    new_interventions = None
    if isinstance(raw_interventions, list):
        new_interventions = [migrate_intervention(intv, applied) for intv in raw_interventions]

    payload = {"schema_version": SCHEMA_VERSION_TARGET}
    if new_v40 is not None:
        payload["systems_config_v40"] = new_v40
    if new_interventions is not None:
        payload["interventions"] = new_interventions

    http_put(f"{API_BASE}/projects/{project_id}/building", payload)

    print(f"OK: {name!r} migrated to schema_version={SCHEMA_VERSION_TARGET}")
    if isinstance(new_v40, dict):
        # Service-level field summary
        h_mode = new_v40.get("heating_setpoint_mode")
        h_c    = new_v40.get("heating_setpoint_c")
        c_mode = new_v40.get("cooling_setpoint_mode")
        c_c    = new_v40.get("cooling_setpoint_c")
        print(f"    Heating setpoint:   mode={h_mode}  c={h_c}")
        print(f"    Cooling setpoint:   mode={c_mode}  c={c_c}")
        print(f"    DHW storage / tap / cold: "
              f"{new_v40.get('dhw_storage_setpoint_c')} / "
              f"{new_v40.get('dhw_tap_outlet_temp_c')} / "
              f"{new_v40.get('dhw_cold_supply_temp_c')} degC")
        print(f"    DHW demand: basis={new_v40.get('dhw_demand_basis')!r}  "
              f"L/p/day={new_v40.get('dhw_demand_litres_per_person_per_day')}  "
              f"L/m²/day={new_v40.get('dhw_demand_litres_per_m2_per_day')}")
        for svc in ("heating", "cooling", "dhw", "ventilation", "lighting", "small_power"):
            n = len(new_v40.get(svc) or [])
            print(f"    {svc:<11s} per-system entries: {n}")

    if applied:
        print("    Notes:")
        for note in applied:
            print(f"      - {note}")

    if warnings:
        print("    !! WARNINGS:")
        for w in warnings:
            print(f"      ! {w}")

    return True


def main():
    parser = argparse.ArgumentParser(
        description="Brief 42 systems_config_v40 v1->v2 migration."
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Bypass idempotency; also re-seed empty lighting/small_power thin entries "
             "(closes Brief 40 Issue #19)."
    )
    args = parser.parse_args()

    if args.force:
        print("(--force flag set — idempotency bypassed; empty "
              "lighting/small_power arrays will be re-seeded)")

    try:
        projects = http_get(f"{API_BASE}/projects")
    except urllib.error.URLError as e:
        print(f"ERROR: cannot reach backend at {API_BASE} -- is go.bat running? ({e})")
        return 2

    any_changed = False
    for p in projects:
        try:
            if migrate_project(p, force=args.force):
                any_changed = True
        except Exception as e:
            print(f"ERROR migrating {p.get('name')}: {e}")
            return 3

    if not any_changed:
        print("\nAll projects already migrated; nothing to do."
              + ("" if not args.force else " (--force was set; no projects needed re-migration "
                                            "and no empty lighting/small_power arrays found)"))
    else:
        print("\nDone. Restart the dev server (npm run dev).")

    return 0


if __name__ == "__main__":
    sys.exit(main())

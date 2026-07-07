#!/usr/bin/env python3
# ============================================================================
# Brief 95 P4 — patch translation + state builder + config-hash (EP backend)
# ============================================================================
#
# One interventions stack (declarative patches — single source of truth), translated
# into fully-resolved project configs for the EnergyPlus backend. Pure logic; no EP runs.
#
#   classify_patch  — physical (→ EP model edit) vs nza_sim_only (percentage-adjustment
#                     or a key EP can't map). Anything not recognised is nza_sim_only.
#   apply_patch(es) — declarative set/add/remove on a fix-shaped dict (building_config,
#                     construction_choices, library_constructions), dotted + [i] paths.
#   build_states    — from strategy refs (enabled, ordered): baseline · cumulative prefix
#                     states (nza_sim_only items skipped, skip recorded) · isolated states.
#   config_hash     — stable hash of the resolved config (sorted-key canonical JSON).
#   resolved_to_idf — resolved config → IDF via generate_full_idf.build_idf (P2 generator).
# ============================================================================

import copy
import hashlib
import json
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

# Physical-parameter path fragments → EP-mappable (fabric U, infiltration, glazing, HRE/
# SFP, SCOP/EER/efficiency, LPD/EPD, setpoints, occupancy, shading, openings, geometry).
_PHYSICAL = [
    r"\.fabric\b", r"air_permeability", r"infiltration", r"construction_choices",
    r"library_constructions", r"u_value", r"g_value",
    r"systems_config_v40", r"efficiency_metric", r"setpoint", r"recovery_", r"sfp_",
    r"\.occupancy\b", r"gains\.(lighting|equipment|auxiliary)", r"baseload", r"magnitude",
    r"\.shading_", r"\.openings\b", r"operable_openings", r"\.wwr\b", r"orientation",
    r"thermal_bridge", r"thermal_mass",
]
# Markers of a percentage-ADJUSTMENT patch (a relative multiplier, not an absolute
# physical value) → NZA-Sim only, excluded from EP.
_PCT_MARKERS = ["pct_reduction", "pct_change", "_multiplier", "reduce_by_pct",
                "_pct_adjust", "percent_reduction"]
_PCT_OPS = {"multiply", "scale", "adjust_pct", "pct"}


def classify_patch(patch):
    """'physical' (→ EP) or 'nza_sim_only' (percentage-adjustment / unmappable)."""
    path = str(patch.get("path", ""))
    op = str(patch.get("op", "set"))
    if op in _PCT_OPS or any(m in path for m in _PCT_MARKERS):
        return "nza_sim_only"
    if any(re.search(p, path) for p in _PHYSICAL):
        return "physical"
    return "nza_sim_only"   # unrecognised → not EP-mappable (never silently mapped)


def _parse_path(path):
    """'building.systems_config_v40.dhw[0].share_pct' → ['building_config',...,'dhw',0,'share_pct'].
    First segment routes the root: building→building_config; construction_choices /
    library_constructions stay as-is; anything else defaults to building_config."""
    parts = []
    for tok in path.split("."):
        key = re.match(r"([^\[]*)", tok).group(1)
        if key:
            parts.append(key)
        for idx in re.findall(r"\[(\d+)\]", tok):
            parts.append(int(idx))
    if not parts:
        return parts
    root = parts[0]
    if root == "building":
        parts[0] = "building_config"
    elif root not in ("construction_choices", "library_constructions"):
        parts.insert(0, "building_config")
    return parts


def apply_patch(fix, patch):
    """Apply one declarative patch to a fix-shaped dict IN PLACE. Raises on a bad path
    (never silently no-ops)."""
    parts = _parse_path(patch["path"])
    op = patch.get("op", "set")
    node = fix
    for p in parts[:-1]:
        node = node[p]
    last = parts[-1]
    if op == "set":
        node[last] = copy.deepcopy(patch.get("value"))
    elif op == "add":
        node.append(copy.deepcopy(patch.get("value")))
    elif op == "remove":
        del node[last]
    else:
        raise ValueError(f"unknown patch op: {op}")
    return fix


def _physical_split(intervention):
    phys, skipped = [], []
    for p in intervention.get("patches", []):
        (phys if classify_patch(p) == "physical" else skipped).append(p)
    return phys, skipped


def build_states(fix, refs, interventions_by_id):
    """Return {'baseline', 'cumulative':[…], 'isolated':{id:…}}. Each state carries a
    fully-resolved fix-shaped `config`. nza_sim_only patches are excluded from EP;
    an intervention that is entirely nza_sim_only is SKIPPED in the cumulative chain
    with the skip recorded on the state."""
    ordered = sorted([r for r in refs if r.get("enabled", True)], key=lambda r: r.get("order", 0))

    baseline = copy.deepcopy(fix)
    out = {"baseline": {"config": baseline, "skips": []}, "cumulative": [], "isolated": {}}

    cum = copy.deepcopy(fix)
    cum_skips = []
    for ref in ordered:
        iv = interventions_by_id[ref["library_id"]]
        phys, skipped = _physical_split(iv)
        if phys:
            for p in phys:
                apply_patch(cum, p)
            if skipped:
                cum_skips.append({"id": iv["id"], "label": iv.get("label"), "partial_skipped": len(skipped)})
        else:
            # entirely nza_sim_only (or empty) → skipped in the EP chain
            cum_skips.append({"id": iv["id"], "label": iv.get("label"),
                              "reason": "nza_sim_only" if skipped else "no_patches"})
        out["cumulative"].append({
            "library_id": ref["library_id"], "through": iv.get("label"),
            "config": copy.deepcopy(cum), "skips": copy.deepcopy(cum_skips),
        })

    for ref in ordered:
        iv = interventions_by_id[ref["library_id"]]
        phys, skipped = _physical_split(iv)
        cfg = copy.deepcopy(fix)
        for p in phys:
            apply_patch(cfg, p)
        out["isolated"][iv["id"]] = {
            "config": cfg, "label": iv.get("label"),
            "skipped_paths": [p["path"] for p in skipped],
            "empty": not phys,
        }
    return out


# Path fragments the P2 generator (generate_full_idf.build_idf) + post-processor
# (run_full.py) ACTUALLY consume. A physical patch whose path is not covered here would
# silently no-op the IDF → it must ESCALATE, never be silently dropped (Brief 95 P4).
_TRANSLATED_FRAGMENTS = [
    "recovery_", "sfp_",                    # ventilation efficiency  → IdealLoads HR / fans
    "efficiency_metric", "share_pct",       # systems SCOP/EER/share  → run_full post-processing
    "baseload", "magnitude",                # LPD / EPD               → Lights / Equipment
    "library_constructions", "construction_choices", "u_value", "g_value",  # fabric U/g
    "infiltration_ach", "\\.wwr", "orientation",  # infiltration / glazing area / orientation
    "num_bedrooms", "people_per_room",      # occupant count
    # Brief 95 P4b — gaps closed in the generator:
    "setpoint",             # v40 custom setpoints → thermostat schedules
    "air_permeability", "\\.fabric\\b",   # q50 → infiltration ach (NZA divide-by-20)
    "\\.occupancy\\b", "density",          # occupancy.density → People count
    "shading_",             # shading_overhang / shading_fin → SHADING:OVERHANG / SHADING:FIN
]
# Physical fragments the generator still does not read — escalate (not silently dropped).
_UNMAPPED_HINT = {
    "operable_openings": "operable openings not modelled",
    "\\.openings\\b": "permanent vents not modelled in the full IDF",
    "thermal_bridge": "thermal bridges not modelled in the full IDF",
}


def is_translated(path):
    """True if the resolved-config path is actually consumed by the EP translation."""
    return any(re.search(f, path) for f in _TRANSLATED_FRAGMENTS)


def translation_gaps(interventions):
    """Physical patches that are NOT translated by the EP model → escalation list.
    (empty for a fully-mappable stack; each entry names the intervention + path + reason)."""
    gaps = []
    for iv in interventions:
        for p in iv.get("patches", []):
            if classify_patch(p) != "physical" or is_translated(p["path"]):
                continue
            reason = next((r for frag, r in _UNMAPPED_HINT.items() if re.search(frag, p["path"])),
                          "no EP mapping for this physical path")
            gaps.append({"intervention": iv.get("label"), "id": iv.get("id"),
                         "path": p["path"], "reason": reason})
    return gaps


def config_hash(config):
    """Stable 16-hex hash of a resolved config (order-insensitive canonical JSON)."""
    canon = json.dumps(config, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()[:16]


def resolved_to_idf(config, idd_path):
    """Resolved fix-shaped config → IDF string via the P2 generator (build_idf)."""
    from generate_full_idf import build_idf
    return build_idf(config, idd_path).idfstr()

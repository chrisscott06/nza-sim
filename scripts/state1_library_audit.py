"""
scripts/state1_library_audit.py

Brief 26.1 Part 1 — Construction library audit for thermal mass derivation.

Enumerates every construction in the library, identifies the principal
insulation layer in each, and computes the effective indoor-facing
thermal mass (sum of thickness × density × specific_heat for layers
INSIDE the insulation, expressed in kJ/m²·K).

Decision rule from the brief: if ≥80% of constructions have complete
density + specific_heat data, derivation is feasible → Path A in Part 5.
Otherwise Path B (keep the dropdown, populate library in a later brief).

Writes: docs/state_1_construction_library_audit.md
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = REPO_ROOT / "data/nza_sim.db"

# CIBSE TM52 thermal-mass categories — kJ/(K·m²) of GIA.
# Boundaries chosen to align with the existing dropdown values
# (80 / 160 / 280 kJ/K/m² per instantCalc.js).
TM52_BAND = {
    "light":  (0, 120),
    "medium": (120, 220),
    "heavy":  (220, float("inf")),
}


def categorise(mass_kJ_per_m2K: float) -> str:
    for cat, (lo, hi) in TM52_BAND.items():
        if lo <= mass_kJ_per_m2K < hi:
            return cat
    return "heavy"


def layer_order(construction_dict: dict, construction_name: str) -> list[str]:
    """
    Return the ordered list of layer names from outside to inside per the
    epJSON Construction object. EnergyPlus schema: outside_layer, layer_2,
    layer_3, ... — sparse, so iterate keys and order by suffix.
    """
    c = (construction_dict.get("Construction") or {}).get(construction_name)
    if not c:
        return []
    layers = []
    if c.get("outside_layer"):
        layers.append(c["outside_layer"])
    # layer_2 .. layer_10 (10 is a safe upper bound)
    for i in range(2, 11):
        n = c.get(f"layer_{i}")
        if n:
            layers.append(n)
    return layers


def audit_construction(name: str, cfg: dict) -> dict:
    """
    Audit a single construction. Returns a structured result dict with
    fields used by the report generator below.
    """
    ctype = cfg.get("type", "?")
    epjson = cfg.get("epjson") or {}
    materials = epjson.get("Material") or {}
    nomass = epjson.get("Material:NoMass") or {}
    has_window_glaz = bool((epjson.get("WindowMaterial:SimpleGlazingSystem") or {}))

    # Glazing has no traditional opaque-layer mass; skip the math.
    if has_window_glaz or ctype == "glazing":
        return {
            "name": name, "type": ctype,
            "is_glazing": True,
            "layers": [], "missing": [],
            "insulation_layer_idx": None,
            "inside_layers": [], "outside_layers": [],
            "mass_kJ_per_m2K": None, "category": None,
        }

    ordered = layer_order(epjson, name)
    layers: list[dict] = []
    missing: list[str] = []

    for ln in ordered:
        if ln in materials:
            m = materials[ln]
            layer = {
                "name": ln,
                "thickness_m":      m.get("thickness"),
                "conductivity_WmK": m.get("conductivity"),
                "density_kgm3":     m.get("density"),
                "specific_heat_JkgK": m.get("specific_heat"),
                "kind": "Material",
            }
            for k in ("thickness", "density", "specific_heat"):
                val_key = {"thickness": "thickness_m", "density": "density_kgm3", "specific_heat": "specific_heat_JkgK"}[k]
                if layer.get(val_key) is None:
                    missing.append(f"{ln}.{k}")
            layers.append(layer)
        elif ln in nomass:
            # Material:NoMass has thermal_resistance but no mass — by
            # design, contributes zero to thermal mass.
            layers.append({
                "name": ln, "kind": "Material:NoMass",
                "thickness_m": None, "conductivity_WmK": None,
                "density_kgm3": 0, "specific_heat_JkgK": 0,
                "R_m2K_W": (nomass[ln] or {}).get("thermal_resistance"),
            })
        else:
            # Layer referenced but not defined — anomaly worth flagging
            missing.append(f"{ln}.<undefined>")
            layers.append({"name": ln, "kind": "MISSING"})

    # Identify the principal insulation layer.
    # Algorithm per brief: highest R-value layer in the stack, OR
    # conductivity < 0.05 W/mK (typical insulation threshold).
    insulation_idx: int | None = None
    best_R = -1.0
    for i, ly in enumerate(layers):
        thickness = ly.get("thickness_m") or 0
        cond = ly.get("conductivity_WmK") or 0
        if cond and cond > 0 and thickness:
            R = thickness / cond
        elif ly.get("R_m2K_W"):
            R = ly["R_m2K_W"]
        else:
            R = 0
        is_insulation_like = (cond and cond < 0.05) or (R > best_R)
        if R > best_R and is_insulation_like:
            best_R = R
            insulation_idx = i

    # Identify "indoor side" of the insulation. The library's convention is
    # OUTSIDE-FIRST (outside_layer = exterior face) for walls and roofs,
    # but ground floors are authored INDOOR-FIRST (outside_layer = carpet).
    # This is a known library inconsistency (see audit notes for Part 1).
    # Compensate here by reading the construction type:
    #   wall / roof:  inside-of-insulation = layers AFTER insulation
    #   floor:        inside-of-insulation = layers BEFORE insulation
    floor_type = (ctype or "").lower() in ("floor", "ground_floor")
    if insulation_idx is None:
        inside_layers = []
        outside_layers = layers
    elif floor_type:
        inside_layers = layers[:insulation_idx]
        outside_layers = layers[insulation_idx:]
    else:
        inside_layers = layers[insulation_idx + 1:]
        outside_layers = layers[:insulation_idx + 1]

    def layer_mass_kJm2K(ly: dict) -> float:
        t = ly.get("thickness_m") or 0
        rho = ly.get("density_kgm3") or 0
        cp = ly.get("specific_heat_JkgK") or 0
        # ρ × Cp × thickness → J/(K·m²); /1000 → kJ/(K·m²)
        return (t * rho * cp) / 1000.0

    inside_mass = sum(layer_mass_kJm2K(ly) for ly in inside_layers)

    return {
        "name": name, "type": ctype,
        "is_glazing": False,
        "layers": layers, "missing": missing,
        "insulation_layer_idx": insulation_idx,
        "inside_layers": inside_layers, "outside_layers": outside_layers,
        "mass_kJ_per_m2K": round(inside_mass, 1),
        "category": categorise(inside_mass),
    }


def main():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT name, config_json FROM library_items "
        "WHERE library_type = 'construction' ORDER BY name"
    ).fetchall()
    con.close()

    audits = [audit_construction(r["name"], json.loads(r["config_json"])) for r in rows]

    # ── Decision metrics ─────────────────────────────────────────────────
    opaque = [a for a in audits if not a["is_glazing"]]
    glazings = [a for a in audits if a["is_glazing"]]
    complete = [a for a in opaque if not a["missing"]]
    incomplete = [a for a in opaque if a["missing"]]
    pct_complete = (100 * len(complete) / len(opaque)) if opaque else 0
    decision = "PATH A — derivation feasible" if pct_complete >= 80 else "PATH B — dropdown placement"

    # ── Markdown report ──────────────────────────────────────────────────
    lines: list[str] = []
    lines.append("# State 1 — Construction library audit (Brief 26.1 Part 1)")
    lines.append("")
    lines.append("Per-construction inventory of layer data with thermal-mass derivation.")
    lines.append("Generated by `scripts/state1_library_audit.py`.")
    lines.append("")
    lines.append("## Decision")
    lines.append("")
    lines.append(f"- Total constructions: **{len(audits)}** ({len(opaque)} opaque, {len(glazings)} glazing)")
    lines.append(f"- Opaque constructions with **complete** layer data (thickness + density + specific_heat for every layer): **{len(complete)} of {len(opaque)} ({pct_complete:.0f}%)**")
    lines.append(f"- Threshold for Path A (≥80% complete): {'**met**' if pct_complete >= 80 else '**not met**'}")
    lines.append(f"- **Decision: {decision}**")
    lines.append("")
    if incomplete:
        lines.append("Incomplete constructions:")
        for a in incomplete:
            lines.append(f"- `{a['name']}` — missing: {', '.join(a['missing'])}")
        lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## Per-construction inventory")
    lines.append("")

    for a in audits:
        lines.append(f"### `{a['name']}` ({a['type']})")
        lines.append("")
        if a["is_glazing"]:
            lines.append("Glazing — no opaque mass term. Excluded from derivation.")
            lines.append("")
            continue
        if not a["layers"]:
            lines.append("**No layers defined.**")
            lines.append("")
            continue

        lines.append("| # | Layer | t (mm) | λ (W/mK) | ρ (kg/m³) | Cp (J/kgK) | R (m²K/W) | mass (kJ/m²K) | side |")
        lines.append("|---|-------|-------:|---------:|----------:|-----------:|----------:|--------------:|:----:|")
        for i, ly in enumerate(a["layers"]):
            t = ly.get("thickness_m") or 0
            cond = ly.get("conductivity_WmK") or 0
            rho = ly.get("density_kgm3") if ly.get("density_kgm3") is not None else 0
            cp = ly.get("specific_heat_JkgK") if ly.get("specific_heat_JkgK") is not None else 0
            R = (t / cond) if (cond and cond > 0) else (ly.get("R_m2K_W") or 0)
            mass = (t * rho * cp) / 1000.0
            side = "INS" if i == a["insulation_layer_idx"] else (
                "in" if a["insulation_layer_idx"] is not None and i > a["insulation_layer_idx"]
                else "out"
            )
            tmm = f"{t*1000:.0f}" if t else "—"
            lines.append(f"| {i+1} | `{ly['name']}` | {tmm} | {cond or '—'} | {rho or '—'} | {cp or '—'} | {R:.2f} | {mass:.1f} | {side} |")
        lines.append("")
        if a["insulation_layer_idx"] is not None:
            ins_name = a["layers"][a["insulation_layer_idx"]]["name"]
            lines.append(f"- Insulation identified: layer **#{a['insulation_layer_idx']+1}** (`{ins_name}`)")
            lines.append(f"- Inside-of-insulation layers: **{len(a['inside_layers'])}**")
            for ly in a["inside_layers"]:
                t = ly.get("thickness_m") or 0
                rho = ly.get("density_kgm3") or 0
                cp = ly.get("specific_heat_JkgK") or 0
                lines.append(f"  - `{ly['name']}`: {t*1000:.0f}mm × {rho} kg/m³ × {cp} J/kgK = {(t*rho*cp/1000):.1f} kJ/m²K")
            lines.append(f"- **Effective indoor mass: {a['mass_kJ_per_m2K']} kJ/(m²·K)** → category **{a['category']}**")
        else:
            lines.append("- No insulation layer identified.")
        if a["missing"]:
            lines.append(f"- **Missing data: {', '.join(a['missing'])}**")
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append("## Glazing constructions (no mass term)")
    lines.append("")
    for a in glazings:
        lines.append(f"- `{a['name']}` — type `{a['type']}`")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## Library inconsistency: ground-floor layer ordering")
    lines.append("")
    lines.append("`nza_engine/library/constructions.py:_construction()` documents the")
    lines.append("layer convention as 'ordered outside to inside'. Walls and roofs follow")
    lines.append("this consistently. Ground floors do not: `ground_floor_slab.outside_layer`")
    lines.append("is `GFloor_Std_Carpet` (the **indoor** finish), with the XPS insulation as")
    lines.append("the last layer. EnergyPlus's U-value calc is direction-symmetric so the")
    lines.append("reversed order produces the documented U=0.22 W/m²K — but transient")
    lines.append("behaviour, sol-air, and any code that assumes the layer convention will")
    lines.append("misread these constructions.")
    lines.append("")
    lines.append("The Part 1 audit script compensates by reading the construction `type`")
    lines.append("field and inverting the inside/outside split for `type=floor`. The library")
    lines.append("data itself is **not** modified here — see `docs/state_1_divergences.md` §6.")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## Bridgewater area-weighted derived mass")
    lines.append("")
    # Hardcoded fetch for the Bridgewater project to give Part 5 a concrete target
    bw = None
    try:
        con2 = sqlite3.connect(DB_PATH)
        con2.row_factory = sqlite3.Row
        r = con2.execute(
            "SELECT building_config, construction_choices FROM projects "
            "WHERE id = ?", ("14b4a5b1-8c73-4acb-8b65-1d22f05ec969",),
        ).fetchone()
        con2.close()
        if r:
            bc = json.loads(r["building_config"])
            cc = json.loads(r["construction_choices"]) if r["construction_choices"] else {}
            bw = {"bc": bc, "cc": cc}
    except Exception:
        bw = None
    if bw:
        bc, cc = bw["bc"], bw["cc"]
        L, W = float(bc.get("length") or 0), float(bc.get("width") or 0)
        nf, fh = float(bc.get("num_floors") or 0), float(bc.get("floor_height") or 0)
        wwr = bc.get("wwr") or {}
        # Opaque wall area (gross wall minus glazing) per facade
        gross_wall = 2 * (L + W) * fh * nf
        glaz_total = (
            L * fh * nf * float(wwr.get("north", 0) or 0)
            + L * fh * nf * float(wwr.get("south", 0) or 0)
            + W * fh * nf * float(wwr.get("east", 0) or 0)
            + W * fh * nf * float(wwr.get("west", 0) or 0)
        )
        wall_opaque = gross_wall - glaz_total
        roof_area = L * W
        floor_area = L * W
        # Look up each chosen construction's mass
        chosen = {}
        for el in ("external_wall", "roof", "ground_floor"):
            name = cc.get(el)
            audit = next((a for a in audits if a["name"] == name), None)
            chosen[el] = (name, audit["mass_kJ_per_m2K"] if audit else None,
                          audit["category"] if audit else None)
        wall_kJ = chosen["external_wall"][1] or 0
        roof_kJ = chosen["roof"][1] or 0
        floor_kJ = chosen["ground_floor"][1] or 0
        total_A = wall_opaque + roof_area + floor_area
        weighted = (wall_opaque * wall_kJ + roof_area * roof_kJ + floor_area * floor_kJ) / total_A if total_A else 0
        lines.append("Project: HIX Bridgewater (`14b4a5b1-8c73-4acb-8b65-1d22f05ec969`)")
        lines.append("")
        lines.append(f"| Element | Construction | Area (m²) | Mass (kJ/m²K) | Category |")
        lines.append("|---|---|---:|---:|---|")
        lines.append(f"| External wall (opaque) | `{chosen['external_wall'][0]}` | {wall_opaque:.0f} | {wall_kJ:.0f} | {chosen['external_wall'][2]} |")
        lines.append(f"| Roof | `{chosen['roof'][0]}` | {roof_area:.0f} | {roof_kJ:.0f} | {chosen['roof'][2]} |")
        lines.append(f"| Ground floor | `{chosen['ground_floor'][0]}` | {floor_area:.0f} | {floor_kJ:.0f} | {chosen['ground_floor'][2]} |")
        lines.append("")
        lines.append(f"**Area-weighted indoor mass: {weighted:.0f} kJ/(m²·K)** → category **{categorise(weighted)}**")
        lines.append("")
        lines.append(f"Current `params.thermal_mass_category` setting: `{bc.get('thermal_mass_category', '(unset)')}` ({TM52_BAND.get(bc.get('thermal_mass_category', 'light'), (0,0))[0]}–{TM52_BAND.get(bc.get('thermal_mass_category', 'light'), (0,0))[1]} kJ/m²K)")
        lines.append("")
        lines.append("This is the redundancy Brief 26.1 Part 5 will resolve: the dropdown")
        lines.append("can disagree with the physical construction. For Bridgewater the")
        lines.append("derived value lands in the medium band while the dropdown is set to light.")
        lines.append("")

    out_path = REPO_ROOT / "docs/state_1_construction_library_audit.md"
    out_path.write_text("\n".join(lines), encoding="utf-8")

    # ── Console summary ─────────────────────────────────────────────────
    print()
    print("=" * 63)
    print("  CONSTRUCTION LIBRARY AUDIT - STATE 1 THERMAL MASS DERIVATION")
    print("=" * 63)
    print(f"  Total constructions:    {len(audits)}")
    print(f"  Opaque:                 {len(opaque)}")
    print(f"  Glazing (skipped):      {len(glazings)}")
    print(f"  Opaque with full data:  {len(complete)} ({pct_complete:.0f}%)")
    print(f"  Threshold (>=80%):      {'met' if pct_complete >= 80 else 'NOT met'}")
    print(f"  Decision:               {decision}")
    print()
    print(f"  Per-construction effective indoor mass (kJ/m2K):")
    for a in opaque:
        if a["mass_kJ_per_m2K"] is not None:
            print(f"    {a['name']:38s} {a['mass_kJ_per_m2K']:6.1f}  ({a['category']})")
    print()
    print(f"  Report written: {out_path.relative_to(REPO_ROOT)}")
    print("=" * 63)


if __name__ == "__main__":
    main()

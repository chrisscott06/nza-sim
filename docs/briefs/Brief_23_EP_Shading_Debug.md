# Brief 23 — Debug EnergyPlus shading not visibly applied

BEFORE DOING ANYTHING:
1. Read CLAUDE.md
2. Read STATUS.md
3. Confirm Brief 22 left the shading objects emitting correctly into the
   epJSON (visible in `eplusout.eio` as ShadingProperty Reflectance entries)

---

## Context

Brief 22 wired per-facade shading into the epJSON. EnergyPlus accepts the
`Shading:Overhang` and `Shading:Fin` objects (visible in eplusout.eio
with mirror surfaces) but does not visibly reduce solar gain — even
with a 5 m south overhang, `Surface Window Transmitted Solar Radiation
Energy` changes by < 0.01 % between baseline and shaded runs.

Three hypotheses to try in order. Each is its own commit so we know
which one actually moves the needle.

The test loop:
1. Set HIX Bridgewater south overhang to 0 m, run sim, record Solar South
2. Set south overhang to 1.0 m, run sim, record Solar South
3. Expected: ~25-40% reduction. Actual at start of brief: ~0%.

---

## Hypothesis 1 — explicit ShadowCalculation object

EP 26's defaults are PolygonClipping + Periodic + 20-day update. Maybe
attached shading needs an explicit `ShadowCalculation` object to be
respected. Add one and re-test.

**File:** `nza_engine/generators/epjson_assembler.py` — emit a
`ShadowCalculation` object with the documented defaults made explicit.

**Verify:** baseline vs 1m south overhang. If solar drops noticeably,
hypothesis 1 wins; commit. If not, revert and try hypothesis 2.

---

## Hypothesis 2 — switch solar_distribution

`solar_distribution = FullInteriorAndExteriorWithReflections` requires
convex zones; if EP detects non-convex it may silently degrade. Try
`FullExterior` which is simpler and definitely respects external shading.

**File:** `nza_engine/generators/epjson_assembler.py` — change the
Building object's `solar_distribution` field.

**Verify:** same test. If solar drops, hypothesis 2 wins.

---

## Hypothesis 3 — Shading:Building:Detailed with explicit vertices

Attached shading depends on the parent window's normal being correctly
detected. Switch to `Shading:Building:Detailed` where we provide the
slab vertices ourselves — bypasses any attached-shading specifics.

**File:** `nza_engine/generators/geometry.py` — replace `_shading_overhang`
and `_shading_fin` with `_shading_building_detailed` that emits a
4-vertex slab per overhang/fin.

**Verify:** same test.

---

## Out of scope

Movable shades, neighbour shading, daylighting controls. Brief 23 is
purely about getting the existing per-window shading objects to actually
reduce solar in EnergyPlus.

## Stopping criterion

If none of the three hypotheses produce visible solar reduction, escalate:
write a minimal isolated EP test case (one zone, one window, one overhang,
nothing else) and verify shading works there. The bug then has to be in
how our assembler arranges the geometry alongside the rest of the model.

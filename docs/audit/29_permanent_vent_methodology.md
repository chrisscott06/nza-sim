# Permanent Ventilation Methodology (locked)

**Status:** Locked reference. If the Static engine disagrees with this method, that disagreement is a bug.
**Origin:** Brief 29 §"Permanent ventilation — a worked example to lock the method" (v2, 2026-05-17). Rewritten by Brief 33 (2026-05-18) to remove the balanced-mechanical case — that was a scope error: mechanical ventilation is not in the Building module per CLAUDE.md "Module scopes" (added in Brief 33 Part 3).

This document covers passive envelope openings — trickle vents, louvres, fixed grilles, fixed holes in the envelope. These are wind-driven. Mechanical ventilation is not in scope; it is modelled in the Systems module.

---

## Hard rule: do Step 0 first

The choice of wind-driven correlation is **topology-dependent**. Apply the wrong correlation to a given building topology and the answer is wrong by a factor of 3–8. Step 0 (topology classification) MUST precede any flow calculation.

### Topology classes (envelope-only)

| Class | When it applies | Correlation |
|---|---|---|
| **Cross-flow** | Vents on opposite façades connected by an open internal air path (atrium, open-plan office, full-height stack) | Wind-and-stack with combined ΔP between façades. Textbook form: `Q = C_d · A · √(2·ΔP_total/ρ)`. The Static engine currently uses the simplified `Q = C_d · A · √C_w · v_wind` — stack term deferred. |
| **Single-sided** | Vents on one façade only of a room; no opposite-side opening; cellular internal layout | Empirical: `Q ≈ 0.025 · A · v_wind` per BS EN 16798-7 §6.4 / Etheridge & Sandberg (1996) |

### Bridgewater topology classification

- 134 guest rooms, cellular layout
- Trickle vent above the window in each room (15 mm × 1.2–1.3 m slot)
- No open internal air path between rooms (closed corridors)
- Each room is effectively a single-façade enclosure for the purposes of envelope-level flow

**Classification: single-sided.** Each room's trickle vent sits on one façade with no opposite-side opening. The empirical single-sided correlation is the right envelope-level physics. (Whether the building also has bathroom extract, MVHR or any other mechanical system is a Systems-module fact; it does not change this classification.)

---

## Step 1 — Flow rate from area

### Cross-flow

For wind-driven cross-flow between opposite façades, the sharp-edged-opening relation:

```
Q [m³/s] = C_d · A · √(2 · ΔP / ρ)
```

with `ΔP` the sum of wind and stack pressure components.

**Stack pressure** (buoyancy, vertically separated openings):

```
ΔP_stack = ρ · g · h · (T_in − T_out) / T_in
```

`h` = vertical separation between high and low openings [m], `T` in Kelvin, `g = 9.81 m/s²`, `ρ ≈ 1.20 kg/m³`.

**Wind pressure** on a façade:

```
ΔP_wind = 0.5 · ρ · C_p · v²
```

`C_p` from CIBSE Guide A Table 4.7 (typically +0.7 windward, −0.3 leeward for a low-rise rectangular building), `v` = local mean wind speed at building height.

**Combined**: `ΔP_total = √(ΔP_stack² + ΔP_wind²)` for orthogonal forces, or sum if collinear.

### Single-sided

```
Q [m³/s] ≈ 0.025 · A · v_wind
```

The 0.025 coefficient already bakes in the effective driving pressure for typical-window-style openings. C_d is not in this formula at the textbook level — the geometry-aware correction Brief 33 Part 2 introduces is a separate engineering layer documented there, not here.

## Step 2 — Heat loss from flow

```
Q_heat [W] = ρ · c_p · Q · (T_in − T_out)
```

`c_p ≈ 1005 J/(kg·K)` for dry air. Annual integral over heating-direction hours gives MWh.

---

## Step 3 — Bridgewater audit-baseline numbers

**Common inputs (audit baseline 2026-05-17):**

| Parameter | Value | Source |
|---|---|---|
| Building footprint | 58.8 m × 14.7 m | `building_config.length / width` |
| Floors × height | 5 × 3.2 m → 16.0 m tall | `building_config.num_floors × floor_height` |
| GIA | 4,322 m² | derived |
| Volume | 13,830 m³ | derived |
| Number of rooms | 134 | `building_config.num_bedrooms` (envelope module reads as a cellular-topology indicator only; no systems implication) |
| Louvre area NE (F1) | 1.00 m² | `building_config.openings.north.louvre_area_m2` |
| Louvre area SW (F3) | 0.76 m² | `building_config.openings.south.louvre_area_m2` |
| Louvre area SE / NW | 0 m² | (no openings on these faces) |
| Total louvre area | **1.76 m²** | sum |
| Vent slot geometry | 15 mm × 1.2–1.3 m | site visit + drawings (per Brief 29 v2) |
| Site exposure | "normal" → C_w = 0.10 | `building_config.openings.site_exposure` |
| Mean winter ΔT (T_in − T_out) | ~12 K | UK / Yeovilton EPW typical winter |
| Mean wind speed at building height | ~4 m/s | Yeovilton EPW typical |
| Heating-direction hours/yr | ~5,500 | T_out < 15°C in UK climate |

### Case A — Cross-flow with default C_d (the engine's pre-Brief-32 model)

Engine code path used `Q = C_d · A · √C_w · v_wind` with `C_d = 0.6`, `C_w = 0.10`, `A = 1.76 m²`, `v ≈ 4 m/s`:

```
Q ≈ 0.6 × 1.76 × √0.10 × 4 = 1.34 m³/s
UA_permanent ≈ 1206 J/(m³·K) × 1.34 m³/s = 1,612 W/K
Annual loss (ΔT_mean 12 K × 5,500 h):
  ≈ 1,612 × 12 × 5,500 / 1e6 = 106 MWh
```

The engine's actual annual value via the live integral at the audit baseline: **120.8 MWh**. Hand-calc agrees with the engine within 15% — confirms the engine implemented Case A correctly.

**This was the wrong correlation for Bridgewater.** Cross-flow assumes an open internal air path between opposite façades; Bridgewater's cellular layout has no such path.

### Case B — Single-sided (the right model for Bridgewater)

```
Q ≈ 0.025 · A · v_wind = 0.025 × 1.76 × 4 = 0.176 m³/s   (mean-wind hand calc, no resistance correction)
UA_permanent ≈ 1206 × 0.176 = 212 W/K
Annual loss (ΔT_mean 12 K × 5,500 h):
  ≈ 212 × 12 × 5,500 / 1e6 = 14 MWh
```

The exact engine output depends on hour-by-hour wind speed and outdoor temperature in the Yeovilton TMYx 2011-2025 EPW. We report what the engine integrates; we do not calibrate to this hand-calc.

**Brief 33 Part 2 (2026-05-18)** replaces the hard-coded global C_d (0.6) with a per-opening derivation (`computeCd` in `frontend/src/utils/openingCoefficients.js`) and applies a single-sided restriction factor `min(1.0, C_d / 0.6)` for openings substantially more restrictive than a typical window. After Part 2, Bridgewater's trickle vents (15 × 1300 mm, mesh, flap) resolve to C_d ≈ 0.23. Hand-calc annual loss in the single-digit MWh range — live engine number reported in `STATUS.md` from Chris's browser walkthrough.

---

## C_d derivation and the single-sided restriction factor

The Static engine derives C_d per opening from geometry and resistance features, then either feeds it directly into the cross-flow formula or applies it as a restriction factor on the single-sided empirical correlation. The derivation lives in `frontend/src/utils/openingCoefficients.js`.

### Base C_d by opening type

| Type | Base C_d | Notes |
|---|---|---|
| `orifice` | 0.61 | Sharp-edged opening. CIBSE Guide A §4.6. |
| `louvre` | 0.40 | 45° fixed blades. CIBSE Guide A Table 4.20. |
| `fixed_grille` | 0.40 | Same order of magnitude as louvre. |
| `slot`, `trickle_vent` | interpolated by aspect ratio (see below) | CIBSE Guide A Table 4.20 + AIVC Technical Note 32 (Liddament 1996). |

The `trickle_vent` type is a labelling convenience — it shares the slot's aspect-ratio interpolation but lets the UI render trickle-specific copy and apply trickle-typical default resistance features.

### Slot aspect-ratio interpolation

The C_d of a long, narrow slot falls as aspect ratio increases (boundary-layer effects). The engine interpolates linearly between the CIBSE Guide A Table 4.20 anchor points:

| Aspect ratio (longer / shorter) | C_d |
|---|---|
| ≤ 1 (square) | 0.61 |
| 5 | 0.58 |
| 10 | 0.50 |
| 50 | 0.42 |
| 100 | 0.38 |
| ≥ 100 (saturates) | 0.38 |

### Internal-resistance multipliers

Applied after the base C_d, multiplicatively:

| Feature | Multiplier |
|---|---|
| `mesh` | × 0.85 |
| `flap` | × 0.70 |
| `acoustic_baffle` | × 0.60 |

These are roughly independent — mesh adds boundary-layer drag, a flap adds a movable obstruction, an acoustic baffle adds a tortuous path. Stacking is multiplicative.

### Bridgewater worked example

- Type: `trickle_vent`
- Dimensions: 15 mm × 1300 mm → aspect ratio 86.67 → base C_d interpolated between AR-50 (0.42) and AR-100 (0.38): **≈ 0.39**
- Resistance: `['mesh', 'flap']` → multipliers 0.85 × 0.70 = **0.595**
- **Final C_d ≈ 0.23**

### Single-sided restriction factor — engineering correction

The empirical single-sided correlation `Q = 0.025 · A · v_wind` (BS EN 16798-7 §6.4) is calibrated for openings with effective C_d in the typical-window range (~0.5–0.65). For openings substantially more restrictive than this — for example slot trickle vents with mesh and flap, where the derived C_d may be 0.25 or lower — applying the unscaled coefficient overstates flow because the empirical baseline assumes an opening as permissive as a typical window. We apply a geometric-restriction factor `min(1.0, C_d / 0.6)` so that more restrictive openings produce proportionally less flow. This is an engineering correction reflecting that the empirical correlation does not natively distinguish between opening geometries. Openings at the reference permissiveness (C_d ≈ 0.6) or higher are not scaled.

Engine forms after Part 2:

```
Q_cross        = Σ_face (C_d_face · A_face) · √C_w · v_wind                       (CIBSE Guide A §4.6)
Q_single_sided = 0.025 · Σ_face (min(1, C_d_face / 0.6) · A_face) · v_wind         (BS EN 16798-7 §6.4 + correction)
```

Per-facade aggregation in the engine (vs a single building-wide C_d) lets each facade carry its own geometry / resistance — typical when a building mixes opening types (e.g. trickle vents on the residential floors plus a louvre to a back-of-house plant area).

---

## Reconciliation table (envelope-only, after Brief 33 Part 1)

| Case | Topology | Engine status | Engine output | Reality for Bridgewater? |
|---|---|---|---|---|
| A | Cross-flow | Pre-Brief-32 default; reverted | 120.8 MWh (pre-fix baseline) | NO — Bridgewater has no internal cross-flow path |
| B | Single-sided | Active for Bridgewater post-Brief-33 Part 1 | _captured live in `docs/audit/32_vent_fix_verification.md`_ | **YES** |

The "engine produces what the physics produces" principle (Brief 33): we report the engine number with its provenance — flow mode, C_d (Part 2), restriction factor (Part 2) — and check it falls in the plausibility range, but we do not calibrate to a target.

---

## Action history

- **2026-05-17:** Brief 29 audit captured the wrong-topology finding for Bridgewater. Three-case (A/B/C) methodology recorded; balanced-mechanical case was a scope error and has been removed from this document.
- **2026-05-18 (Brief 32 Part 2):** `flow_mode` field added to the opening data model. Three-branch dispatch implemented (cross / single_sided / balanced_mechanical). Reverted by Brief 33 — `balanced_mechanical` was a Building/Systems scope violation.
- **2026-05-18 (Brief 33 Part 1):** `balanced_mechanical` removed. Dispatch reduced to cross / single_sided. Bridgewater migrated to single_sided. C_d still hard-coded 0.6 in the cross branch — addressed in Brief 33 Part 2.
- **2026-05-18 (Brief 33 Finding 1 fix):** `flow_mode` allowlist drift in `withMode` — the dropdown wasn't reaching the engine. Same class of bug as Brief 29 Issue #1 (parallel-list synchronisation).
- **2026-05-18 (Brief 33 Part 2):** Geometry-aware C_d via `computeCd(opening)`; single-sided restriction factor `min(1.0, C_d / 0.6)`; Bridgewater trickle vents resolve to C_d ≈ 0.23. Methodology + worked example landed in this document in this commit. Single-sided dispatch in State 2 / DegreeDay paths is a follow-up (cross-flow-only there for now).
- **Dynamic engine (Brief 30, paused):** `epjson_assembler.py` still emits `ZoneVentilation:WindandStackOpenArea` (cross-flow) for all louvres. Brief 30 Phase 1.x will rework when Brief 32 / 33 close and Dynamic resumes.

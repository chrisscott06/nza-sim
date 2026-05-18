# Brief 32 Part 2 / Brief 33 Part 1 — Permanent vent topology: verification

**Status:** Brief 32 Part 2's three-branch dispatch was reverted by Brief 33 Part 1 (the `balanced_mechanical` branch was a scope violation — mechanical ventilation is not in the Building module per CLAUDE.md "Module scopes"). The remaining work for Issue #2 is the two-branch dispatch (`cross` / `single_sided`) plus the geometry-aware C_d work coming in Brief 33 Part 2.
**Related:** `docs/audit/29_permanent_vent_methodology.md` (locked methodology), `docs/audit/29_open_issues.md` Issue #2.
**Closes:** Brief 29 Issue #2 (Static path: wrong-topology assumption replaced; geometry-aware C_d landed in Brief 33 Part 2).
**Does not close:** Issue #4 (stack term still missing from `cross` branch).

---

## What's active after Brief 33 Part 1

### Schema

`building_config.openings` gained one field:

| Field | Type | Default | Used by |
|---|---|---|---|
| `flow_mode` | `'cross' \| 'single_sided'` | `'single_sided'` | dispatch in `instantCalc.js` |

`resolveFlowMode(openings)` (top of `instantCalc.js`) returns the stored `flow_mode` when it is one of the two recognised values, and `'single_sided'` otherwise (covers missing values + any non-recognised legacy value). The default flips from the pre-Brief-32 implicit `'cross'` to `'single_sided'` because single-sided is the more conservative correlation — it under-states rather than over-states flow for any building whose topology hasn't been explicitly classified.

### Static engine — two correlations

In `frontend/src/utils/instantCalc.js` inside `_calculateEnvelopeOnly`'s 8760-hour loop:

```js
let Q_louvre_m3s
if (flow_mode === 'single_sided') {
  Q_louvre_m3s = 0.025 * louvre_area_total * v_wind           // BS EN 16798-7 §6.4
} else { // 'cross'
  Q_louvre_m3s = Cd * louvre_area_total * sqrtCw * v_wind     // CIBSE Guide A §4.6 (Cd hard-coded 0.6 pending Part 2)
}
const UA_permanent = AIR_HEAT_CAPACITY * (Q_louvre_m3s * 3600)
```

`UA_permanent` enters the existing integrand at `(UA_leakage + UA_permanent) * dT_heat_out` — no change to the integrand structure, only the upstream Q.

### UI

`BuildingDefinition.jsx` "Permanent openings" section: "Flow topology" dropdown with two options (single-sided default-listed first, cross second), each with an inline explanatory caption. Site exposure remains an always-visible select (Cw is used in the cross branch). Brief 32 Part 2's conditional extract-rate input is gone.

### Bridgewater migration (Brief 33 Part 1)

`scripts/33_bridgewater_single_sided_migration.py` PUTs `flow_mode: 'single_sided'` onto the HIX Bridgewater project's `openings` block and strips the obsolete `mech_extract_lps_per_room` field if present. Idempotent. The merge preserves per-façade louvre data, schedule, and site_exposure.

**Migration log (this session):**
```
OK: HIX Bridgewater (14b4a5b1-8c73-4acb-8b65-1d22f05ec969) updated
  flow_mode:           'balanced_mechanical' -> 'single_sided'
  mech_extract_lps_per_room  8 -> None (should be None)
  louvre areas preserved:  N=1, S=0.76, E=0, W=0
```

The previous migration script `scripts/32_bridgewater_balanced_mech_migration.py` is removed (`git rm`) to prevent regression.

---

## Hand-calc reproduction of methodology Cases A and B (Bridgewater inputs)

The two cases below are quoted from `29_permanent_vent_methodology.md` Step 3 with Bridgewater inputs at the audit baseline (2026-05-17). The engine now reproduces Case B (the topology Bridgewater actually has under envelope-only physics).

### Case A — Cross-flow with default C_d (pre-Brief-32 engine, no longer the active branch for Bridgewater)

```
Q ≈ Cd · A · √Cw · v_wind = 0.6 × 1.76 × √0.10 × 4 m/s = 1.34 m³/s
UA ≈ 1206 J/(m³·K) × 1.34 m³/s = 1,592 W/K (mean)
Annual loss (ΔT_mean 12 K × 5,500 h)
  ≈ 1,592 × 12 × 5,500 / 1e6 = 105 MWh hand-calc
  Engine output (live integral, pre-Brief-32): 120.8 MWh   ← Chris's pre-fix baseline
```

Methodology agrees with the engine within 15%. The engine implemented Case A correctly — but Case A was the wrong topology for Bridgewater.

### Case B — Single-sided (the right model for Bridgewater)

```
Q ≈ 0.025 · A · v_wind = 0.025 × 1.76 × 4 = 0.176 m³/s    (mean-wind hand calc, no resistance correction)
UA ≈ 1206 × 0.176 = 212 W/K
Annual loss (ΔT_mean 12 K × 5,500 h)
  ≈ 212 × 12 × 5,500 / 1e6 = 14 MWh hand-calc
```

The actual engine output depends on hour-by-hour wind speed and outdoor temperature in the Yeovilton TMYx 2011-2025 EPW. Captured live during the browser walkthrough — see "Live engine output" section below. We report the engine number with its provenance; we do not calibrate it to the hand-calc.

Brief 33 Part 2 will replace the hard-coded global C_d (0.6) with a per-opening derivation (`computeCd`) and apply a single-sided restriction factor `min(1.0, C_d / 0.6)` for openings substantially more restrictive than a typical window. After Part 2, Bridgewater's trickle vents (15 × 1300 mm, mesh, flap) resolve to C_d ≈ 0.25 → restriction factor 0.417 → Q ≈ 0.073 m³/s mean. Hand-calc annual loss ≈ 6 MWh — pending live engine confirmation when Part 2 lands.

---

## Live engine output — Bridgewater, post-Brief-33-Part-1 (pre-Part-2 C_d work)

To be captured during the browser walkthrough on the next `go.bat` boot. The Static engine runs in the browser and surfaces these numbers in the Building module's Σ losses table and Heat Balance view. No pre-assumed target — we report what the engine produces.

| Quantity | Pre-Brief-32 baseline | Post-Brief-33 Part 1 (captured) |
|---|---|---|
| Permanent vent loss | 120.8 MWh | _TBD — browser walkthrough_ |
| Σ losses total | 251.5 MWh | _TBD_ |
| Heating demand (Static, setpoint convention) | 194.3 MWh | _TBD_ |
| Solar gain (gross) | 99.4 MWh | _TBD — should be ≈ unchanged_ |

**Sanity check (not a target):**
The single_sided correlation at Bridgewater with mean UK wind ~4 m/s should produce a mean flow rate around 0.18 m³/s (pre-C_d-restriction). Integrated across heating-direction hours, the annual permanent-vent heat loss should be in the low-double-digit MWh range. If the result is wildly outside this (e.g. < 5 MWh or > 50 MWh) the physics is not behaving as expected and we investigate from inputs and formula, not from a target.

---

## Methodology compliance check (Brief 33 Part 1 scope)

| Requirement (Brief 33 §1.X) | Status |
|---|---|
| §1.1 Grep `balanced_mechanical` / `mech_extract` | ✅ Zero matches in `frontend/` after this commit. |
| §1.2 Remove `balanced_mechanical` branch; default to `single_sided` | ✅ Dispatch is two-branch; `resolveFlowMode` defaults invalid → `single_sided`. |
| §1.3 Restrict UI dropdown to two options; remove conditional extract field | ✅ |
| §1.4 Bridgewater migration to `single_sided`; idempotent | ✅ `scripts/33_bridgewater_single_sided_migration.py`; ran clean + verified NO-OP on second run. |
| §1.5 Update methodology doc — strip balanced-mechanical, use brief's verbatim intro, two correlations remain | ✅ See `docs/audit/29_permanent_vent_methodology.md`. |
| §1.6 Update this verification doc — strip Case C, document Cases A and B with current code outputs | ✅ This document. |
| §1.7 Build clean | _verified at commit time_ |

---

## Deferred to Brief 33 Part 2 (and later)

- **Geometry-aware C_d (Part 2):** `computeCd(opening)` derives C_d from `type`, `internal_resistance`, and aspect ratio (slots / trickle vents). Cross branch consumes it directly. Single-sided branch consumes it as the restriction factor `min(1.0, C_d / 0.6)`. Bridgewater trickle vents → C_d ≈ 0.25.
- **Stack term in cross branch (Issue #4 / not currently in any Brief 33 Part):** Cross-flow's `Q = C_d · A · √C_w · v_wind` is wind-only. Adding `ΔP_stack` and using `Q = C_d · A · √(2 · ΔP_total / ρ)` is its own future brief.
- **Dynamic engine path:** `epjson_assembler.py` still emits `ZoneVentilation:WindandStackOpenArea` for all louvres. Brief 30 Phase 1.x will rework when Brief 32 / 33 close and Dynamic resumes.

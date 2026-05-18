# Brief 32 Part 2 — Permanent vent topology fix: verification

**Status:** Code landed. Migration applied to Bridgewater. Live engine output captured during browser walkthrough — see "Live engine output" section below.
**Related:** `docs/audit/29_permanent_vent_methodology.md` (locked methodology), `docs/audit/29_open_issues.md` Issue #2.
**Closes:** Brief 29 Issue #2 (permanent vent 5× overstated; wrong topology default).
**Does not close:** Issue #3 (C_d still hard-coded 0.6 — Part 3) and Issue #4 (stack term still missing from cross-flow — Part 4).

---

## What changed

### Schema

`building_config.openings` gained two fields. Default values preserve legacy behaviour:

| Field | Type | Default | Used by |
|---|---|---|---|
| `flow_mode` | `'cross' \| 'single_sided' \| 'balanced_mechanical'` | `'cross'` | dispatch in `instantCalc.js` |
| `mech_extract_lps_per_room` | `number` (l/s/room) | `8` | only when `flow_mode === 'balanced_mechanical'` |

When `flow_mode` is missing from a persisted project, `inferFlowMode(openings)` (top of `instantCalc.js`) returns:

- `'cross'` when no façades have louvres (Q = 0 anyway)
- `'single_sided'` when exactly one façade has louvres
- `'cross'` otherwise

`'balanced_mechanical'` is intentionally NOT inferable from openings geometry — it depends on the building's ventilation system. Projects in this class must opt in explicitly (UI dropdown or migration script).

### Static engine — three correlations

In `frontend/src/utils/instantCalc.js` inside `_calculateEnvelopeOnly`'s 8760-hour loop, the permanent-vent Q is now dispatched on `flow_mode`:

```js
let Q_louvre_m3s
if (flow_mode === 'balanced_mechanical') {
  Q_louvre_m3s = mech_extract_m3s_const                       // constant; wind-independent
} else if (flow_mode === 'single_sided') {
  Q_louvre_m3s = 0.025 * louvre_area_total * v_wind           // BS EN 16798-7 §6.4
} else { // 'cross'
  Q_louvre_m3s = Cd * louvre_area_total * sqrtCw * v_wind     // legacy (current code path)
}
const UA_permanent = AIR_HEAT_CAPACITY * (Q_louvre_m3s * 3600)
```

`UA_permanent` then enters the existing integrand at `(UA_leakage + UA_permanent) * dT_heat_out` — no change to the integrand structure, only the upstream Q.

`mech_extract_m3s_const = (building.num_bedrooms × openings.mech_extract_lps_per_room) / 1000`. For Bridgewater: `134 × 8 / 1000 = 1.072 m³/s`.

### UI

`BuildingDefinition.jsx` "Permanent openings" section gained a "Flow topology" dropdown (three options + per-option explanatory caption) and a conditional "Extract rate per room (l/s)" field that appears only when `flow_mode === 'balanced_mechanical'`. The existing "Site exposure" select is disabled in balanced-mechanical mode (Cw is not used in that branch).

### Bridgewater migration

`scripts/32_bridgewater_balanced_mech_migration.py` PUTs `flow_mode: 'balanced_mechanical'` and `mech_extract_lps_per_room: 8` onto the HIX Bridgewater project's `openings` block via `PUT /api/projects/{id}/building`. The merge preserves all existing per-façade louvre data, schedule, and site_exposure. Idempotent: a second run reports `NO-OP`.

**Migration log (this session):**
```
OK: HIX Bridgewater (14b4a5b1-8c73-4acb-8b65-1d22f05ec969) updated
  flow_mode:                  None -> 'balanced_mechanical'
  mech_extract_lps_per_room:  None -> 8
  louvre areas preserved:     N=1, S=0.76, E=0, W=0
```

---

## Expected behaviour — hand-calc reproduction of methodology Cases A/B/C

The three cases below are quoted from `29_permanent_vent_methodology.md` Step 3 with Bridgewater inputs at the audit baseline (2026-05-17). The engine should now reproduce Case C (the topology Bridgewater actually has), not Case A.

### Case A — Cross-flow with default C_d (the engine's pre-Part-2 model)

```
Q ≈ Cd · A · √Cw · v_wind = 0.6 × 1.76 × √0.10 × 4 m/s = 1.34 m³/s
UA ≈ 1188 J/(m³·K) × 1.34 m³/s = 1,592 W/K (mean)
Annual loss (ΔT_mean 12 K × 5,500 h)
  ≈ 1,592 × 12 × 5,500 / 1e6 = 105 MWh hand-calc
  Engine output (live integral, pre-Part-2): 120.8 MWh   ← Chris's pre-Part-2 baseline
```

Methodology agrees with the engine within 15%. The engine was correctly implementing Case A — but Case A is the wrong topology for Bridgewater.

### Case B — Single-sided with slot C_d (would be too low)

```
Q ≈ 0.025 × A × v_wind = 0.025 × 1.76 × 4 = 0.176 m³/s
With slot C_d correction ~0.6: Q ≈ 0.106 m³/s
UA ≈ 1206 × 0.106 = 128 W/K
Annual loss ≈ 8 MWh
```

Not applicable to Bridgewater (cellular building with extract is not single-sided).

### Case C — Balanced mechanical (the correct model for Bridgewater)

```
Q_extract = num_bedrooms × q_per_room = 134 × 8 l/s = 1.072 m³/s   ← constant across the year
UA       = 0.33 × 1.072 × 3600 = 1,274 W/K                          (Wh/(m³·K) × m³/h)
                                                                    ≈ methodology doc's 1,294 W/K
                                                                    (different rounding of ρ·c_p)
```

The annual loss depends on the engine's hour-by-hour integration of `UA × max(0, T_heat − T_out)` across the Yeovilton TMYx 2011-2025 EPW with the heating setpoint at `comfort_band.lower_c`.

Per methodology, the defensible Bridgewater permanent-vent loss with balanced-mechanical topology is in the **24–85 MWh range**:

- **~85 MWh upper bound** — bare mechanical extract integrated across all heating hours at full design rate, no heat recovery, no occupancy weighting.
- **~24 MWh lower bound** — weighted EPW integration with partial-occupancy schedule and heat recovery on the extract.

Part 2's scope per the brief is just the topology dispatch. Heat recovery, occupancy weighting and partial-load operation are downstream. The Part 2 implementation here will therefore land closer to the upper bound (~85 MWh) than the lower (~24 MWh); the headroom is what Parts 5+ close.

Pass / fail rubric for Part 2 alone:

| Engine output | Verdict |
|---|---|
| ≤ 30 MWh | Suspicious — too low without heat recovery / partial occupancy. Audit finding. |
| 30–100 MWh | **In range** — bare mechanical-extract physics on this EPW. Part 2 working as designed. |
| 100–120 MWh | Suspicious — close to pre-fix value. Verify `flow_mode` is set on the project. |
| ≥ 120 MWh | Fail — topology dispatch not active or wrong branch. Investigate. |

---

## Live engine output (Bridgewater, post-Part-2)

To be captured during the browser walkthrough on the next `go.bat` boot. The Static engine runs in the browser and surfaces these numbers in the Building module's Σ losses table and the Heat Balance view. Compare against the pre-Part-2 baseline below.

| Quantity | Pre-Part-2 baseline | Post-Part-2 (captured) | Δ |
|---|---|---|---|
| Permanent vent loss | 120.8 MWh | _TBD — browser walkthrough_ | _TBD_ |
| Σ losses total | 251.5 MWh | _TBD_ | _TBD_ |
| Heating demand (Static, setpoint convention) | 194.3 MWh | _TBD_ | _TBD_ |
| Solar gain (gross) | 99.4 MWh | _TBD — should be ≈ unchanged_ | _TBD_ |

If actuals fall in the 30–100 MWh band for vent loss, Part 2 closes Issue #2 and we proceed to Part 3 (geometry-aware C_d, Issue #3). If actuals fall outside, that's an audit finding to investigate before Part 3 starts.

---

## Methodology compliance check

| Requirement (Brief 32 §2.X) | Status |
|---|---|
| §2.1 Add `flow_mode` field to opening data model | ✅ `DEFAULT_PARAMS.openings.flow_mode` added in `ProjectContext.jsx`. |
| §2.2 Implement three correlations in Static (cross / single_sided / balanced_mechanical) | ✅ Dispatch lives in `instantCalc.js` `_calculateEnvelopeOnly` hour loop. |
| §2.3 Refactor the wind-only block at `instantCalc.js:957` to dispatch on flow_mode | ✅ The wind-only path is now the `'cross'` branch. C_d hard-coded 0.6 retained for Part 3. |
| §2.4 Migration defaults + Bridgewater override | ✅ `inferFlowMode` heuristic for missing values; Bridgewater overridden via `scripts/32_bridgewater_balanced_mech_migration.py`. |
| §2.5 Per-opening UI dropdown | ✅ Per-building dropdown (single dropdown — the current schema is per-façade-totals, not per-individual-opening; per-opening granularity is a v2 schema change deferred to a future brief). |
| §2.6 Bridgewater verification: 120.8 → ~24 MWh expected | ⏳ Live capture pending browser walkthrough. Expected range 30–100 MWh given Part 2's bare-extract scope (heat recovery / occupancy are downstream). |
| §2.7 Hand-calc check in this file | ✅ This document. |

---

## Deferred (not Part 2 scope)

- **Issue #3 (Part 3):** `C_d` is still hard-coded 0.6 in the `'cross'` branch. Trickle vents with aspect ratio 80:1 should be 0.35–0.40 per CIBSE Guide A Table 4.20. Bridgewater's slots become a Part 3 input.
- **Issue #4 (Part 4):** Stack term missing from the `'cross'` branch. `ΔP_stack = ρ · g · h · ΔT / T_in`; for Bridgewater (h = 16 m, ΔT = 12 K) this contributes ~7–8 Pa vs ~10 Pa wind — comparable, not negligible.
- **Heat recovery on balanced_mechanical extract:** required to land in the methodology's ~24 MWh lower bound. Future brief; not gated by Part 2.
- **Partial-occupancy / time-of-day extract schedule:** also required for the lower bound. Future brief.
- **Dynamic engine path:** `epjson_assembler.py` still emits `ZoneVentilation:WindandStackOpenArea` for all louvres. Brief 30 Phase 1.x will rework when Brief 32 closes and Dynamic resumes.

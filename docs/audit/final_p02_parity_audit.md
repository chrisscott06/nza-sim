# Final P02 — input↔engine parity audit (both directions)

**Brief:** `docs/briefs/active/final-p02-run.md` Part 1. **Date:** 2026-07-17.
**Baseline:** Model 2.1 (canonical) — EUI 183.3 / elec 564,836 / gas 207,700 (summer_bypass=True).
Scopes Parts 2–3; **fixes nothing beyond their scope** (report only).

## Direction A — UI input → engine consumption
| Input (UI / config) | Consumed? | Where / note |
|---|---|---|
| U-values (`construction_choices[].u_value_override`) | ✅ | `getConstructionItem` → conduction |
| `fabric.air_permeability_q50` | ✅ | `deriveOperationalACH` (instantCalc.js:386) |
| Glazing g-value (`g_value_override`) | ✅ | `getGValue` → solar path |
| Permanent openings EA (`openings[].louvre_area_m2`) | ✅ | permanent-vent loss |
| People/room, sensible W/person | ✅ | occupancy heat balance |
| Equipment / lighting baseload | ✅ | small_power / lighting |
| DHW demand / temps / plant split | ✅ | DHW (verified Model-2) |
| Heating SCOP / cooling SEER / SFP / fan flow | ✅ | systems (verified Model-2 waterfall) |
| Ventilation `recovery_sensible_pct` | ✅ | vent heat-recovery |
| **`summer_bypass`** | ✅ | **free-cooling gate (instantCalc.js:2957, 3213, 3435, 4829). Confirmed: on→off cooling 42.63→50.23 MWh.** The diagnostic doc wrongly declared this absent — corrected by addendum (below). |
| **Ventilation `control_schedule_id` / `control_factor`** | ❌ | **NOT consumed by the fan or vent-heat paths — flat 8,760 h.** Confirmed: bedroom_extract schedule→business_hours AND control_factor→0.5 both leave fans 40.398 / EUI 183.3 unchanged. **→ Part 2 fix.** |
| `gains.auxiliary` (magnitude/schedule) | ⚠ conditional | consumed **only when `systems_config_v40.auxiliary.enabled = true`** (Brief 92 gate, `effectiveSystemScalar`); disabled ⇒ ×0. **Corrects Model-1 audit Finding 1** (it observed 0 with the toggle off and mis-attributed it to "engine ignores the category"). |
| `occupancy.latent_w_per_person` | ❌ | static engine is sensible-only |
| Ventilation `recovery_latent_pct` | ❌ | sensible-only (sub-note of a consumed row) |
| `thermal_bridges` (mode/multiplier) | ⚠ E5 | `computeThermalBridges` yields H_TB≈170 W/K but it is **not applied to full-mode demand** (Rule-14 gap). Separately-gated brief. |

## Direction B — engine capability → UI exposure
| Engine capability | UI-exposed? | Note |
|---|---|---|
| `summer_bypass` (per vent system) | v40 field, set via scenario edit (Chris tonight) | engine consumes it; GF units = existing design (true). No dedicated toggle audited here — capability confirmed live. |
| Glazing g-value **per orientation** | ❌ — single project g | **→ Part 3** exposes per-entry/orientation (film scope SW-only). |
| Ventilation schedule effect on fan/vent energy | field present, **no effect** | **→ Part 2** wires it (hour-by-hour fraction). |

## Scope for Parts 2–3
- **Part 2:** wire `control_schedule_id`/`control_factor` into fan + vent-heat/free-cooling (hour-by-hour), guarded byte-identical (all schedules are always_on today).
- **Part 3:** expose glazing g per orientation (value already consumed by the solar path).
- Everything else here is **report-only** for tonight (gains.auxiliary toggle behaviour, latent, thermal_bridges E5 belong to their own gated briefs).

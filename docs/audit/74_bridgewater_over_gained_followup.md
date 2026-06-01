# Brief 74 follow-on — Bridgewater heating_demand = 0 is suspect

**Status:** Tier-3 stub. NOT investigated in Brief 74. Picked up by Brief 75.

**Date raised:** 2026-06-01 (Brief 74 P6 close).

---

## The observation

HIX Bridgewater is a 4,125 m² UK hotel running on Yeovilton TMYx weather data with comfort band 21 / 24 °C. State 2 reports:

| Metric | Value | Sanity |
| --- | ---: | --- |
| heating_demand_mwh | **0.0** | ⚠️ implausible for a UK hotel of this scale |
| cooling_demand_mwh | 302.1 | |
| auxiliary electricity | 70.5 MWh/yr | |
| people heat gain | (significant — full hotel occupancy) | |
| Σ losses | 472 MWh | |
| Σ gains | 488 MWh | |
| Net (gains − losses) | +16 MWh | balanced |

The engine concludes the building never needs heating: auxiliary + occupancy + solar saturate the zone above the 21 °C heating setpoint year-round, so the per-system `dT_heat_out > 0` gate never fires. First-principles reconciliation at Brief 74 §4 agreed with the engine at 0. **Two independent calculations both returned 0 — therefore the bug, if any, is upstream of both.**

This came up as the gate for Brief 74 P5 walkthrough items 4 / 7 / 8 (mech vent loss ribbon visibility on a project where the engine reports zero mech vent heat loss). Engine + first-principles agreement at 0 was accepted as the sign-off for those items, but the underlying physics result is what's suspect.

## Three candidate root causes (none investigated)

(a) **Brief 73 P6 outcome — CIBSE default gains too generous.** Brief 73 P6 rebaselined lighting + small power against CIBSE TM63 / NCM 2024 levels (and re-aligned auxiliary's preset list per Brief 72 P6). If the defaults are too high for a hotel of this kind — or if the schedule profiles overlap occupant presence with appliance use too aggressively — the cumulative internal gain saturates the zone. The auxiliary 70.5 MWh figure is itself worth interrogating in this light (70.5 MWh / 4125 m² ≈ 17 kWh/m²·yr just for catering hoods + back-of-house plug loads — high vs CIBSE TM54 hotel benchmarks).

(b) **Zone heat balance over-saturating gains.** The State 2 zone-temp trajectory (Brief 67/69 introduced this) may be holding gains too efficiently — e.g. utilisation factor against the comfort band not discounting summer/shoulder-month gains, or the gains-warmed T_air trace overshooting because thermal mass isn't damping enough. Worth checking: at what month of the year does heating demand drop to zero, and is that consistent with TM52 / Passivhaus PHPP intuitions for a hotel?

(c) **Ventilation losses not feeding back into heating demand.** The State 2 `acc_mech_vent_heat_per_system` accumulator gates on `dT_heat_out > 0` — which is itself derived from `T_setpoint - T_zone`. If the gates are wrong way around, mech vent losses never enter the heating-side balance, the zone runs warm, and the heating demand never triggers. **This is structurally suspicious** because the engine result has `total_heating_loss_kwh > 0` aggregate (mech vent loss is computed and stored at `heat_balance.annual.totals.total_heating_loss_kwh`) but is NOT entering the heating-demand integrand — that would be a Rule 9 violation (term in the integral missing from the demand calculation, or vice versa).

## What Brief 75 should do (not prescriptive)

Brief 75 is "full ventilation heat modelling + Bridgewater heating-demand-zero diagnostic" per Chris's 2026-06-01 brief. Treat candidates (a) / (b) / (c) above as starting hypotheses, not findings. Diagnose first, fix second. Apply the Brief 29/30 lessons: instrument the demand integrand, surface every term that enters, validate against first-principles. A "this is the cause" finding for one candidate doesn't preclude the others; per CLAUDE.md Rule 13 ("each "real root cause" tends to be one layer deeper than the previous diagnosis").

Do not invoke "engine accuracy" or "TMYx weather artefact" to explain the zero — those are CLAUDE.md Rule 10 banned phrases when applied to a number that violates basic building physics.

## What is NOT in scope for Brief 75 from this stub

- Sankey topology changes (Brief 74 closed those).
- Auxiliary preset list changes (Brief 72 P6 is the canonical home).
- CIBSE benchmark library overhaul (separate concern).

This stub is starting material, not the brief itself.

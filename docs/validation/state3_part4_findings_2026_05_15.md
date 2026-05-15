# State 3 — Brief 28f Part 4 validation + findings

**Status:** State 3 (Systems) validated. Engine code is sound. Two input-refinement findings from code review surfaced — engine math is correct in both cases, only the building config values need attention.

**Date:** 2026-05-15.
**Engine commit:** `79dfebc` (Brief 28f Part 4 ship) → corrected MVHR commit (this one).
**Test scripts:** `scripts/state3_part2_skeleton_test.mjs` (40/40), `scripts/state3_part3_heating_cooling_test.mjs` (56/56), `scripts/state3_part4_dhw_vent_lighting_carbon_test.mjs` (46/46). **Combined: 142/142 PASS.**

---

## State 3 validation summary

Brief 28f shipped in four parts:

| Part | Scope | Status | Commit |
|---|---|---|---|
| 1 | Contract update v2.4 → v2.5 (State 3 systems scope) | DONE | `b69f092` |
| 2 | Engine skeleton + library-strict halt + byte-identity tests | DONE (40 tests) | `4cab01d` |
| 3 | Heating + cooling energy math (primary + secondary split) | DONE (56 tests) | `518a6f7` |
| 4 | DHW + ventilation + lighting/equipment + carbon | DONE (46 tests) | `79dfebc` |
| (test fixture update) | MVHR flow correction (5000 → 1450 L/s) | DONE | this commit |

**Contract guarantees (v2.5) verified:**

1. ✅ **Library-strict.** Engine halts with `MissingLibraryField` naming sub-system path + field on any missing required scalar efficiency (test 5 cases in Part 2).
2. ✅ **V1 scalar efficiency only.** SCOP / SEER / `seasonal_efficiency` / COP — no performance-curve lookups (per-fuel math verified at Part 3/4 hand-calc precision).
3. ✅ **Dual-function library items supported.** Same `library_id` referenced from `heating.primary` + `cooling.primary` (Part 2 test 6).
4. ✅ **Byte-identity on shared physics.** State 1 + State 2 outputs (solar gains, internal gains, free-running T_op, losses, comfort hours, demand integrals) pass through State 3 unchanged (Part 2 byte-identity test).
5. ✅ **Ideal-loads regression.** SCOP=1 / SEER=1 / DHW eff=1 / HRE=0 → `fuel = delivered = State 2 demand` exactly, for all four services (Part 4 test 5).
6. ✅ **Hand-calc agreement ±2%.** Every system row matches hand-calc to displayed precision on Bridgewater:

| Row | Hand-calc | Engine |
|---|---:|---:|
| Heating primary (VRF SCOP 5.12 @ 95%) | 2.134 MWh elec | 2.134 |
| Heating secondary (panels COP 1.0 @ 5%) | 0.575 MWh elec | 0.575 |
| Cooling primary (VRF SEER 3.51 @ 95%) | 68.422 MWh elec | 68.422 |
| Cooling secondary (DX SEER 5.62 @ 5%) | 2.249 MWh elec | 2.249 |
| DHW primary (ASHP SCOP 2.8 @ 60%) | 65.740 MWh elec | 65.74 |
| DHW secondary (gas boiler 0.88 @ 40%) | 139.448 MWh gas | 139.448 |
| DHW circulation (120 W × 8760 h) | 1.051 MWh elec | 1.051 |
| WC extract fan (2292 L/s × 0.4 SFP) | 8.031 MWh elec | 8.031 |
| MVHR fan (1450 L/s × 1.4 SFP) | 17.783 MWh elec | 17.783 |
| Carbon (303,810 × 0.207 + 139,448 × 0.183 — pre-MVHR-fix) | 25.57 kg/m² | 25.57 |

7. ✅ **A1 / A2 sensitivity.** Per-system percentages unchanged when length doubles or building rotates; fuel scales with demand at constant efficiency mix.

---

## Canonical Bridgewater State 3 outputs (final, post MVHR fix)

Engine `v2.5`. Project `14b4a5b1`. Yeovilton TMYx. Comfort band 21 / 25 °C.

### Energy use by fuel × service × system (kWh)

| Service | Electricity primary | Electricity secondary | Gas primary | Gas secondary |
|---|---:|---:|---:|---:|
| Heating (effective demand = 0 after MVHR recovery) | 0 | 0 | 0 | 0 |
| Cooling | 68,421.7 | 2,249.1 | 0 | 0 |
| DHW | 65,740.4 | 0 | 0 | 139,447.7 |
| DHW circulation | — | — | 1,051.2 | — |
| Fans (WC + MVHR) | 25,814.0 (aggregate) | — | — | — |
| Lighting (pass-through) | 40,865.5 | — | — | — |
| Equipment (pass-through) | 56,131.7 | — | — | — |

### Totals

| Metric | Value |
|---|---:|
| Electricity total | 260,272.8 kWh |
| Gas total | 139,447.7 kWh |
| Delivered energy | 399,720.5 kWh |
| GIA | 3,457 m² |
| **EUI** | **115.6 kWh/m²·a** |
| **Carbon** | **22.97 kg CO2e/m²·a** |

EUI lands at the low end of CIBSE TM54 hotel range (150–300 kWh/m²). Two known reasons documented in findings below.

---

## Finding 1: MVHR aggregate flow (input correction, NOT engine bug)

**Discovery:** Code-review check against Bridgewater Fabric and Systems Modelling Notes.

**Issue:** Initial Part 4 brief specified MVHR aggregate flow as 5000 L/s. The actual installation per FM documentation is **five Toshiba VN-M1000HE units, each commissioned at 270–310 L/s** → aggregate 5 × 290 = **1450 L/s**. The Part 4 brief conflated the unit model name "1000HE" with flow rate.

**Engine math:** Correct. Fan energy = `flow × SFP × hours_active` is exact. Hand-calc reproduces engine to displayed precision both before and after the fix.

**Impact of correction:**

| Quantity | Before (5000 L/s) | After (1450 L/s) | Δ |
|---|---:|---:|---:|
| MVHR fan energy | 61.32 MWh | 17.78 MWh | −43.54 MWh |
| Theoretical HRE recovery | 416.45 MWh | 120.77 MWh | −295.68 MWh |
| Effective recovery (capped at heat demand) | 11.5 MWh | 11.5 MWh | 0 (still capped — MVHR still oversized vs gain-dominated heat demand) |
| Heating fuel | 0 MWh | 0 MWh | 0 |
| Electricity total | 303.81 MWh | 260.27 MWh | −43.54 MWh |
| EUI | 128.0 kWh/m² | 115.6 kWh/m² | −12.4 kWh/m² |
| Carbon | 25.57 kg/m² | 22.97 kg/m² | −2.60 kg/m² |

**Action taken:** Test fixture in `scripts/state3_part4_dhw_vent_lighting_carbon_test.mjs` updated to 1450 L/s. All 46 Part 4 tests still PASS against the corrected input. Engine code is unchanged.

**Status:** Resolved at test-fixture level. When the v2.5 `systems_config` schema is persisted in the project DB (future brief), the canonical project record needs to use 1450 L/s.

---

## Finding 2: DHW demand seems high — occupancy assumption flag

**FOR CHRIS'S REVIEW.** Engine math is correct; this is a building-config / input assumption question.

**Discovery:** Annual DHW demand emerges as 306.785 MWh. Reverse-engineering:

- `state2.occupancy_summary.annual_occupant_hours` = **1,585,000** (approx)
- DHW = `annual_occupant_hours × 0.1935 kWh/p/h` = 306,785 kWh
- Implied average effective people = 1,585,000 / 8760 = **181 effective persons** averaged across the year

**Sanity check against building config:**

- `num_bedrooms = 134`
- `occupancy_rate = 1.0`
- `people_per_room = 1.5`
- Peak design occupancy = 134 × 1.0 × 1.5 = 201 persons

Average effective people (181) divided by peak (201) = **90% effective annual occupancy**. For UK hotels this is high — typical annual average is 60–75% (CIBSE TM47; UK hotel industry occupancy 2022 was ~70% RevPAR-weighted). The configuration is essentially design-peak — appropriate for sizing plant, but not for annual energy modelling.

**If realistic annual occupancy is applied:**

| Scenario | Avg effective people | DHW demand | DHW primary fuel (ASHP) | DHW secondary fuel (gas) |
|---|---:|---:|---:|---:|
| Current config (occupancy_rate=1.0) | 181 | 307 MWh | 65.7 MWh elec | 139.4 MWh gas |
| Realistic annual (70% avg) | ~127 | ~214 MWh | ~46 MWh elec | ~97 MWh gas |
| Per CIBSE TM47 typical hotel (60 kWh/m²) | — | ~207 MWh | ~44 MWh elec | ~94 MWh gas |

**Why this matters for HIX:** Hotel performance vs benchmark is sensitive to DHW assumptions. A 307 MWh DHW figure puts Bridgewater well above CIBSE benchmark; 214 MWh aligns with typical. The choice affects net-zero readiness narrative.

**Engine math is unchanged.** The DHW demand formula (`80 L/p/day × ΔT × c_p / 3600 / 24` per person-hour) is correct. The driver is the `annual_occupant_hours` accumulator coming out of State 2, which faithfully reflects the configured occupancy schedule and rate.

**Recommended action (for Chris's decision):**

1. **Verify with FM:** what's the actual annual average occupancy? Or use UK hotel industry benchmark (~70%).
2. **Decide:** update `building.occupancy_rate` and/or the occupancy schedule profile so the annual-average people count reflects operational reality, not design peak.
3. Re-run validation to capture the realistic DHW + heating-recovery + total energy numbers.

This is queued behind the next major piece (measured-data ingest), which will give us actual metered DHW gas if the FM tracks it separately, settling the question definitively.

---

## What Brief 28f does NOT cover (deliberate scope)

Per Brief 28f's v2.5 contract — these remain out of scope and queue behind measured-data ingest:

- Per-zone systems (single-zone simplification at V1)
- Distribution losses (CIBSE TM54 end-to-end efficiency convention; library values include distribution implicitly)
- Pumps + fans beyond DHW circulation
- Air curtains (Brief 28e — State 2.5 doors)
- On-site renewables (PV, solar thermal, wind, batteries)
- Hourly HRE recovery refinement (V1 annual-aggregate with cap-at-demand is sufficient until calibration shows otherwise)
- Performance curves (V1 scalar efficiency only)
- Persisted `system_template` library schema (V1 templates injected at test fixture; future brief moves to library API)
- Ventilation schedule_ref profile lookup (V1 always_on; sufficient for Bridgewater)

---

## Queued work — priority order

1. **Measured-data ingest + comparison** (next major piece). Half-hourly electricity + monthly gas + water from FM. UI + parser + NMBE / CV(RMSE) calculation vs modelled. Primary value unlock for HIX assessment.
2. **Calibration workflow + pattern-based diagnostics** (after #1). Compare modelled vs measured by service / by season / by sub-meter circuit; surface mismatches with prioritised diagnostic patterns.
3. **State 3 refinements** (queue behind calibration, triggered by what measured data reveals):
   - Hourly HRE recovery
   - Persisted library `system_template` schema + UI
   - Ventilation schedule profiles
   - Brief 28d-equivalent: HVAC-aware State 2 cooling demand (resolves the 252.8 MWh upper-bound)
   - Performance curves (only if linear scalars prove inadequate)

---

## File pointers

- Engine source: `frontend/src/utils/instantCalc.js` (`_calculateState3` + helpers)
- Library reference: `MissingLibraryField`, `resolveSystemTemplate`, `validateTemplateForService`, `resolveAndValidateSystems`, `templateEfficiency`, `computeServiceEnergy`, `computeVentilationEnergy`, `BEIS_2024_FACTORS`, `DHW_KWH_PER_PERSON_HOUR`
- Tests: `scripts/state3_part2_skeleton_test.mjs`, `scripts/state3_part3_heating_cooling_test.mjs`, `scripts/state3_part4_dhw_vent_lighting_carbon_test.mjs`
- Contract: `docs/state_contracts.md` (v2.5)
- Brief: `docs/briefs/active/28f_state_3_systems.md`

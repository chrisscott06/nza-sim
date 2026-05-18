# Static-side audit — findings

> **Origin:** Brief 36 (2026-05-18). The original Brief 32 audit sequence
> was superseded by Briefs 33 / 34 (Building module reverts + simplification).
> This document is the rolling audit record for the remaining Static-side
> modules per Brief 36 §Part 1 onward — same three-lists method as the
> Brief 29 Building audit.

---

## Internal Gains (State 2) Static — Brief 36 Part 1

**Audit date:** 2026-05-18
**Engine entry point:** `frontend/src/utils/instantCalc.js` `_calculateState2` (line 2173) + helper `computeHourlyGains` (line 2013) + helpers `lightingFractionForHour` (line 1974), `equipmentFractionForHour` (line 1987), `computeTotalOccupants`, `magnitudeToWPerM2`, `findActiveException`.
**Display layer:** `frontend/src/components/modules/gains/InternalGainsModule.jsx` + `gains/canvas/{SummaryView,HeatBalanceView,LoadShapeView,MonthlyView,AnnualHeatmap,ExceptionsPanel}.jsx` + `useAnnualGains.js` + `InternalGainsStrip` (in `InternalGainsModule.jsx`).
**Data model:** `frontend/src/context/ProjectContext.jsx` `DEFAULT_OCCUPANCY` (line 39) + `DEFAULT_GAINS` (line 62). v2.4 multi-profile contract.

### Heat-balance statement

State 2's zone-air balance adds three sensible-only internal-gain terms — people, lighting, equipment — to the same envelope physics State 1 computes. The three gain terms are summed once (`gains.total = Q_people + Q_lighting + Q_equipment`) and redistributed via the same radiative/convective split (30/70) as transmitted solar, so the integrand sees them as additional zone-air heat input from hour h onward. The State 2 own-loss accumulators (acc_cond_*, acc_vent_*, acc_heat_loss_*) run on the State-2 T_air trace; State 1's losses are NOT inherited.

### Three-lists matrix (gains-side only — losses are inherited from State 1 audit)

For each gain category, the matrix is:
- **(A) Integrand** — every variable that enters the hourly zone balance
- **(B) Aggregate** — every accumulator written to State 2's result object
- **(C) Display** — every key iterated by the display layer

| Category | (A) Integrand at hour h | (B) Aggregate written to result | (C) Display surfaces |
|---|---|---|---|
| **People** | `Q_people = totalOccupantsAt100 · occupancy_rate · presence · sensible_w_per_person` (line 2044). Summed into `Q_internal_total_Wh` (line 2134). Latent NOT integrated (sensible-only zone balance). | `gains.people.sensible_kwh` = acc_people / 1000; `gains.people.latent_kwh = 0` (explicit literal); `gains.people.total_kwh = sensible_kwh`; `gains.people.peak_kw`; `gains.people.hours_active`; `internal_gains_monthly.people_kwh[12]` (monthly_people); `heat_balance.annual.gains.internal.people.kwh` = acc_people. `occupancy_summary.{average_occupants,peak_occupants,annual_occupant_hours}`. | `SummaryView`: `state2.gains.people.sensible_kwh ?? total_kwh` (stat card + per-gain attribution); `HeatBalanceView`: `state2.heat_balance.annual.gains.internal.people.kwh`; `MonthlyView`: `state2.losses_at_setpoint.internal_gains_monthly.people_kwh`; `LoadShapeView`: per-hour series via `computeHourlyGains` (re-run client-side, no aggregate read); `InternalGainsStrip` + section card via `useAnnualGains` (re-run client-side, same engine code). Reconciliation row in `SummaryView` compares Heat Balance annual vs Monthly 12-sum. |
| **Lighting** | Per profile p: `Q_p = gia · LPD · area_share · pFrac` where pFrac depends on profile.relationship_to_occupancy. `Q_lighting = Σ_p Q_p`. Sum across profiles, no cap on Σ area_share. Each profile has its own `schedule` (used when independent) with its own `exceptions[]`. | `acc_lighting` summed across profiles. `gains.lighting.total_kwh`; `gains.lighting.profiles[].kwh` (per-profile annual); `gains.lighting.total_peak_kw`; `gains.lighting.effective_lpd_w_per_m2`; `gains.lighting.total_hours_active`; `internal_gains_monthly.lighting_kwh[12]`; `heat_balance.annual.gains.internal.lighting.kwh`. | Same surfaces as People + per-profile `kwh`/`peak_kw`/`hours_active` rendered in `GainContribution` subProfiles (SummaryView). Reconciliation row matches. |
| **Equipment** | Per profile p: `Q_p_base = gia · baseload_W · area_share` (24/7, NOT scaled by schedule). `Q_p_active = gia · active_W · area_share · pFrac`. `Q_equipment = Σ_p (Q_p_base + Q_p_active)`. | `acc_equip_baseload`, `acc_equip_active`. `gains.equipment.total_kwh`; `gains.equipment.total_baseload_kwh`; `gains.equipment.total_active_kwh`; `gains.equipment.profiles[].{kwh,baseload_kwh,active_kwh,...}`; `internal_gains_monthly.equipment_kwh[12]`; `heat_balance.annual.gains.internal.equipment.kwh`. | Same surfaces as People + per-profile breakdown. SummaryView's GainContribution suffix shows baseload + active split. Reconciliation row matches. |

**Mismatches found:** none on the gain-side integrand-vs-display axis. Every term in (A) appears in (B); every term in (B) appears in at least one path of (C); no display-only key without a backing integrand term. The Brief 28-IM-Polish POL-M3 §7.2 reconciliation row (Heat Balance annual vs Monthly 12-sum) verifies display-vs-display agreement live in the SummaryView.

**Caveat:** the reconciliation row is display-vs-display only (per Brief 29 Commit B note in `BuildingDefinition.jsx`), not integrand-vs-display. The integrand-vs-display invariant per Brief 29 Issue #6 is not enforced here either; same structural finding applies to State 2's gain side as to State 1's loss side. Not a new issue; tracked under #6.

### Multi-profile audit

- **Area-weighted sum.** `Q = gia · LPD · area_share · pFrac` is summed across profiles. Each profile contributes independently — engine performs area-weighted sum, not average. ✓
- **Σ area_share permitted to exceed 1.0.** The engine does NOT normalise. With two profiles each at `area_share = 1.0`, the engine outputs 2× the correct lighting power. The UI (MultiProfileList.jsx:267 `PercentInput allowOverflow=true`, comment line 264-266 + 316-318) explicitly permits over-allocation up to 200% and surfaces an "Area-coverage indicator" (canvas) to flag it. Documented behaviour, not a bug — the v2.4 contract treats Σ area_share as informational. ✓
- **`area_share = 0` contributes zero.** `Q = gia · LPD · 0 · pFrac = 0`. ✓
- **`exceptions[]` overrides, does not add.** In `computeHourlyGains`, when an active exception is found for the given date, `presence = exc[dayType][hourOfDay]` (line 2029, replaces) rather than `presence += exc[…]`. For independent lighting/equipment profiles, the same override pattern applies (line 2066 / 2101). ✓

### Sanity-check hand-calcs (analytical, against engine code)

The brief's proposed sanity check ("set schedule = 1.0 at all hours, expect annual = density × area × 8760") is **not literally reproducible by the engine without further input changes**. The hand-calc framing understates the multipliers the engine genuinely applies.

#### People

Engine integrand at schedule = 1.0, monthly_multipliers = 1.0:
```
presence = 1.0
effective_occupants = totalOccupantsAt100 · occupancy_rate · 1.0
Q_people = effective_occupants · sensible_w_per_person
```
Annual = `totalOccupantsAt100 · occupancy_rate · sensible_w_per_person · 8760 / 1000` kWh.

For the brief's plain hand-calc (density × people × heat-per-person × 8760) to reproduce exactly, `occupancy_rate` must also be 1.0. With Bridgewater's default `occupancy_rate = 0.75`, the engine produces 75% of the brief's hand-calc value — that is intended (75% room occupancy), not a bug. **Engine consistent with its own contract.**

#### Lighting

Engine integrand at schedule = 1.0 (proportional_with_spill, daylight_factor < 1):
- Daylight hours (9–16, ≈ 2,920 h/yr): `pFrac = 1.0 · 1.0 · occupancy_rate · daylight_factor = 0.75 · 0.6 = 0.45`
- Non-daylight hours (≈ 5,840 h/yr): `pFrac = 1.0 · 1.0 · 0.75 = 0.75`

Annual = `gia · LPD · area_share · (5840 · 0.75 + 2920 · 0.45) / 1000` kWh.

To reproduce the brief's plain `LPD · area · 8760` literally, the user would need `occupancy_rate = 1.0`, `daylight_factor = 1.0`, schedule = 1.0 throughout, and monthly_multipliers all = 1.0. **Engine consistent with its own contract.**

#### Equipment

Engine integrand at schedule = 1.0 (proportional, standby_factor = 0.10):
- Baseload: `Q_base = gia · baseload_W · area_share` — runs 24/7 regardless of schedule. Annual = `gia · baseload_W · area_share · 8760 / 1000` kWh exactly.
- Active: `pFrac = max(standby, 1.0 · 1.0 · occupancy_rate) = max(0.10, 0.75) = 0.75`. Annual = `gia · active_W · area_share · 0.75 · 8760 / 1000` kWh.

Same comment as lighting — `occupancy_rate` scaling needs to be set to 1.0 to reproduce the brief's plain hand-calc.

**Conclusion of sanity check:** the engine is consistent with the v2.4 multi-profile contract (occupancy_rate, daylight_factor, monthly_multipliers all enter the integrand as documented). The brief's "100% schedule → density × area × 8760" framing is incomplete — it omits these intentional multipliers. No engine bug surfaced by this check; **no Severity 2+ finding raised.**

(See however **Finding #15 below** on `independent` mode lighting: occupancy_rate scaling applies even in `independent` mode, which IS a bug.)

### Scope-contamination check (per CLAUDE.md "Module scopes")

The State 2 gain integrand (people + lighting + equipment) reads only `building.occupancy.*` and `building.gains.{lighting,equipment}.profiles[*].*`. **The gain integrand is clean.** No systems concepts in the gain math.

However, the broader `_calculateState2` function reads `building.systems_config_v25.ventilation` at line 2371 to compute mechanical-ventilation heat-loss accumulators (acc_mech_vent_heat_per_system, acc_mech_vent_cool_per_system, ventSystems, ventUA). These surface in `state2.losses_at_setpoint.ventilation[].fan_kwh` etc. (line 3060), and the Internal Gains module's HeatBalanceView passes them downstream to the shared HeatBalance component with `modules: ['fabric', 'thermal_bridging', 'fabric_leakage', 'permanent_vents', 'internal_gains']` — note: 'ventilation' is NOT in that list, so the mech-vent term is filtered out of the Internal Gains Heat Balance display. **Display-side contamination is filtered, but the engine still reads systems_config_v25.**

Per CLAUDE.md "Module scopes" Systems module, MVHR / MEV / fan power / HRE belong to Systems. Internal Gains shouldn't read them. **Finding #14 below.** Deferred fix: this is structurally fine for now because State 2's mech-vent reads land in the State 2 result block that Systems module consumes — when the Systems module is reworked, this read can move to the Systems engine path. Logged.

### Sensible / latent split

- **Integrand uses sensible-only.** `Q_people = effective_occupants · sensible_w_per_person` (line 2044). Latent (`latent_w_per_person = 55 W` default) is **not** added to the zone heat balance.
- **Display.** `gains.people.sensible_kwh = acc_people`; `gains.people.latent_kwh = 0` (explicit literal at line 2937 with comment "State 2 dry-bulb balance ignores latent for now"); `gains.people.total_kwh = acc_people` (= sensible_kwh; the literal latent_kwh = 0 means total = sensible). SummaryView reads `people?.sensible_kwh ?? people?.total_kwh` so both paths produce the same number.
- **Verdict.** No silent disagreement. The engine drops latent in the integrand AND in the display (both consistent). A future State 2.5+ or full-systems rework would need to model latent loads against a humidity ratio target; flagging here as **documented current behaviour**, not a finding.

### State 1 → State 2 delta

- Both `state1` (from `useStateComparison`) and `state2.demand` use `calculateInstant` with the same `params` / `weatherData` / `hourlySolar` / `constructions` / `comfortBand` — only `mode` differs (`envelope-only` vs `envelope-gains`).
- Inside `_calculateState2`, the `state1_delta` block (line 3194) re-runs `_calculateEnvelopeOnly` (line 2175) on the same inputs with `withMode(building, 'envelope-only')` and computes `heating_change_mwh = state2 - state1`. Identical configs, identical comfort band, identical fabric — only internal gains differ. **Sound by construction.** ✓
- `InternalGainsStrip`'s "Net heating offset" computes `state1.demand.heating_demand_mwh - state2.demand.heating_demand_mwh` from the same source as `state2.state1_delta` would produce; two paths reach the same number.

### Findings summary

| # | Area | Severity | Status |
|---|---|---|---|
| **#14** | Scope contamination — Internal Gains reads `systems_config_v25.ventilation` | S2 | OPEN — deferred to Systems-module rework |
| **#15** | Lighting `independent` mode applies `occupancy_rate` scaling inconsistently with equipment `independent` mode | S2 | OPEN — fix in a follow-up brief |

Issues logged in `docs/audit/29_open_issues.md` (next numbering #14, #15).

**No Severity 3 findings.** No hidden-integrand-term bugs (Brief 29 Issue #1 class) discovered. No display ghosts. No engine-vs-hand-calc divergence (caveat: brief's literal hand-calc requires more input changes than just schedule = 1.0; engine is internally consistent).

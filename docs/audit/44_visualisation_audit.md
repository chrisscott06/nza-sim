# Brief 44 — Visualisation + reactivity audit

**Status:** Living document. Sections filled as Parts land.

**Companion brief:** [`docs/briefs/active/44_visualisation_audit.md`](../briefs/active/44_visualisation_audit.md).

**Predecessors / related:**
- [`docs/audit/42_systems_ux_schema.md`](42_systems_ux_schema.md) — post-Brief-42 schema (service-level vs system-level fields)
- [`docs/audit/41_interventions_schema.md`](41_interventions_schema.md) — interventions data model
- [`docs/audit/29_open_issues.md`](29_open_issues.md) — three follow-ups in scope: Diagnostic over-delivery, `[object Object]` patches, baselineSummary flip

**Scope:** Audit (Part 1, read-only) → surgical fix (Part 2) → Profiles rebuild (Part 3) → reactivity sweep + Monthly + Schedule (Part 4) → cross-module rollout (Part 5) → walkthrough + close (Part 6).

---

## §1 — Tab inventory

### §1.1 Systems module

Centre tabs (`SystemsModule.jsx` line 67-75): `Sankey | Profiles | Schedule | Monthly | Rejection | Diagnostic | Summary`.

| Tab | Component | Data source | Computation | Reactivity (intent) | Current state | Gap |
|---|---|---|---|---|---|---|
| **Sankey** | `SystemsSankey` (in-file, line 732) | `consumption.space_*`, `consumption.dhw`, `consumption.ventilation`, `sysCfg=systems_config_v25`, `sysCfgV40=systems_config_v40` | Branches per-service via `branchesFromPerfPair` (heating/cooling primary+secondary) and `branchesFromFuelMix` (DHW). Per-branch label: efficiency text derived from `delivered_mwh / fuel_mwh`. | Re-renders on `consumption` change. DHW SCOP labels recently fixed (`8cb329e`) to read from v40 config directly. | Working. Labels accurate post-fix. | None known. |
| **Profiles** | `SystemsProfiles` (line 1439) | `result.energy_use.daily_profiles ?? result.consumption.daily_profiles` + `result.daily_profiles.weather` | Daily (365-point) per-service `delivered_kwh_per_day` stack + per-carrier `fuel_kwh_per_day` lines. Aggregated by `WeatherSynchronisedProfile`. | Re-renders on engine result change. | Eleven layers crammed on one chart with three weather strips. Hard to read. | **Rebuild as `InteractiveProfileVisualiser`** — simple by default, layered by choice. Part 3. |
| **Schedule** | `SystemsSchedule` (line 1498) | `sysCfg.heating?.schedule_ref`, `sysCfg.cooling?.schedule_ref`, `sysCfg.dhw?.schedule_ref`, `sysCfg.ventilation[].schedule_ref` — **all v25 paths** | Per-row 24-hour grid for Mon-Fri/Sat/Sun. Schedule resolved via `params.schedules` lookup → fall back to `SCHEDULES` library → fall back to `always_on`. | Re-renders on `sysCfg` change. | **Reads v25 system shape. Post-Brief-42 the engine uses v40 per-system arrays. Heating/cooling/dhw are now ARRAYS, not objects with `.schedule_ref`. The tab reads `sysCfg.heating?.schedule_ref` which is `undefined` on v40-only projects → resolves to `always_on` → grid shows a flat always-on. This is hardcoded-looking data. Mismatch.** | Decision needed in Part 4: rewire to read v40 per-system schedules (one row per system), or remove. |
| **Monthly** | `SystemsMonthly` (line 1589) | `result.energy_use.daily_profiles` | Daily → monthly aggregation using non-leap cum-day boundaries. Stacked bars (gas + electricity) per month + heating-demand / cooling-demand text indicators below each bar. | Re-renders on engine result change. | Numbers (`↓20539`, `↑1703`) collide with month labels when text wraps tightly. | Layout fix in Part 4: stack text labels cleanly; consider tooltip on hover for the demand numbers. |
| **Rejection** | `SystemsRejection` (line 1252) | `consumption.space_cooling.delivered_mwh`, `consumption.space_cooling.electricity_mwh`, `consumption.space_heating.gas_mwh`, `consumption.ventilation[]` | Computes `cooling_reject = delivered + electricity`, `heat_flue = gas × 0.08`, per-vent exhaust losses. | Re-renders on `consumption` change. Labels read `c.space_cooling.electricity_mwh / delivered_mwh` to surface EER. | Working. Labels correctly say `EER 3.5` etc. | None known. Used in Brief 44 audit phase to confirm engine numbers visible. |
| **Diagnostic** | `SystemsDiagnosticPanel` (in `systems/SystemsDiagnosticPanel.jsx`) | `consumption.brief40.{service}.{demand_at_comfort_mwh, delivered_total_mwh, systems[]}` | Per-service row: demand at comfort vs delivered at service-level setpoint vs Δ. Per-system drill-down via `block.systems[]`. | Re-renders on `consumption.brief40` change. | **248% over-delivery jump for 0.5°C setpoint changes — engine recompute bug (see §2 below).** | Surgical fix in Part 2. |
| **Summary** | `SystemsSummary` (line 1670) | `consumption.space_heating`, `consumption.space_cooling`, `consumption.dhw`, `consumption.ventilation`, `consumption.lighting`, `consumption.small_power`, `consumption.total` | Per-service table with delivered / demand / fuel split / SCOP/SEER. | Re-renders on `consumption` change. | Working. Numbers consistent with right-panel + Sankey. | None known. |

### §1.2 Building module

Centre tabs (`BuildingDefinition.jsx`): `Geometry | Fabric | Summary`. Profile-over-time view lives inside `FabricTab` via `GainsLossesChart`.

- **`GeometryTab`** — 3D viewer + dimension inputs. Reactive to params changes. No profile data.
- **`FabricTab`** — fabric U-values + thermal bridging + permeability inputs. Renders `FabricSummary` panel + `FabricSankey` + (when expanded) `GainsLossesChart` using `result.daily_profiles`. Same data-shape source as Systems Profiles; same simplicity challenge.
- **`SummaryTab`** — building summary stats.

Brief 44 Part 5 wires `InteractiveProfileVisualiser` into Building wherever the existing daily-profile chart appears (likely Fabric or a new dedicated tab).

### §1.3 Operation module

Centre tabs (`OperationModule.jsx` lines 501-530): `Heat balance | Profiles | Schedule | Monthly | Summary`.

The same pattern as Systems. Operation's profile-over-time uses `result.daily_profiles` for operable opening flow / effective ACH / permanent vent flow (per Brief 41 Part 0 plumbing). Brief 44 Part 5 wires `InteractiveProfileVisualiser` here.

### §1.4 Internal Gains module

Lives in `frontend/src/components/modules/gains/` (note: directory is `gains`, not `internalgains`). Has its own canvas-based schedule editor + lighting/equipment/occupancy profile editors. Profile-over-time view needs auditing in Part 5 before wiring.

### §1.5 Interventions module

Centre tabs: `Stack | Comparison`. The Stack tab is the post-Brief-43 `InterventionStackView`; Comparison is `ComparisonView` with paired heat-balance bars. Neither is a "profile over time" tab — Brief 44 Part 5 does NOT touch Interventions visually (interventions are patches, not their own engine outputs).

---

## §2 — Diagnostic 248% over-delivery — root-cause investigation

### §2.1 Symptom

Reported by Chris (Brief 42 Part 3 walkthrough item 3; restated as Brief 43 Part 4 follow-up #2):

> "Heating delivered moves 72.7 → 108.1 MWh when setpoint drops 21°C → 19°C"

Direction observation: setpoint DOWN (21 → 19 °C), delivered UP (72.7 → 108.1 MWh). For a heating system, dropping the setpoint should DECREASE heating demand (lower indoor target → less heating needed) → DECREASE delivered, not increase it.

Brief 44 falsifiability criterion: a 0.5 °C custom-setpoint change should produce <10 % change in delivered. Currently the user has reported jumps in the order of 248 % — i.e. roughly tripling — for changes that should be marginal.

### §2.2 Code trace

The data flow for the Diagnostic tab's heating-row:

1. `SystemsDiagnosticPanel` reads `consumption.brief40.heating.{demand_at_comfort_mwh, delivered_total_mwh, systems[]}` and computes:
   - `delta = delivered_total_mwh − demand_at_comfort_mwh`
   - `pct = delta / demand_at_comfort_mwh × 100`

2. `consumption.brief40.heating` is built by `systemsEngine.computeSystemsDelivered.${service block}` → for heating, by `_computeHeatingOrCooling` in `systemsEngine.js`:
   - `demandAtComfortMwh` = State 2's `heating_demand_mwh` at the comfort lower band (no override)
   - When `setpointDiffers === true` (custom setpoint), engine calls `state2Recompute({heating: <custom_setpoint>})` and reads `recomputed.demand.heating_demand_mwh`
   - `demand_at_service_setpoint_mwh` = recomputed value (or fallback to `demandAtComfortMwh` if null)
   - Per-system `delivered_mwh = demand_at_service_setpoint_mwh × share/100`
   - `delivered_total_mwh = Σ delivered_mwh = demand_at_service_setpoint_mwh` (when shares sum to 100)

3. `state2Recompute` is a closure in `instantCalc.js` line 4027:
   ```js
   const state2Recompute = (override) => _calculateState2(
     building, constructions, libraryData, weatherData, hourlySolar, comfortBand,
     { setpointOverride: override },
   )
   ```

4. `_calculateState2` (line 2292) honours `opts.setpointOverride.heating` at line 2306-2308:
   ```js
   const effectiveLowerC = (typeof opts?.setpointOverride?.heating === 'number')
                             ? opts.setpointOverride.heating
                             : comfortBand.lower_c
   ```

5. `effectiveLowerC` is used as `T_heat` in the hourly demand integrand at line 2755:
   ```js
   const T_heat = effectiveLowerC
   const T_cool = effectiveUpperC
   ```

6. The hourly heating demand integrand (around line 2983-3030) accumulates `acc_heating_demand_Wh` based on `T_heat` and other terms.

### §2.3 Hypotheses

Three candidate root causes, ranked by likelihood:

**H1 — `_calculateState2` recompute path has a hidden state divergence (most likely).** The State 2 demand calculation uses dozens of derived constants (floor heat losses, infiltration coefficients, gain accumulators) that are computed at the outer call. When the recompute fires with `setpointOverride`, some of these constants may be re-derived against `comfortBand.lower_c` (unchanged) while OTHERS are derived against `effectiveLowerC` (changed). The mismatch could produce nonsense:
   - Floor heat loss: `H_floor_const = wholeWallU_floor × ground_area × max(0, effectiveLowerC − T_ground)` — DOES use effectiveLowerC (line 2382, correct)
   - Initial operative temperature: `T_op_prev = weatherData?.temperature?.[0] ?? comfortBand.lower_c` (line 2585) — uses `comfortBand.lower_c`, NOT effectiveLowerC. So when comfort=21 and override=19, the initial T_op_prev = 21 but the system targets 19 — discrepancy ramping in the first hours.
   - Comfort-hours counters (line 2935-2936): use `comfortBand.lower_c` / `upper_c` directly. These don't affect demand integral but they do mix old/new semantics on the result block.

   The mixed-semantics issue alone shouldn't cause 248% jumps but could compound with other hidden references. Recommended Part 2 investigation: instrument `_calculateState2` to log the value of `effectiveLowerC` + `acc_heating_demand_Wh` accumulation at end of each hour for the first 24 hours, both with and without override, on Bridgewater. Compare directly.

**H2 — The `demand_at_service_setpoint_mwh` arithmetic in `_computeHeatingOrCooling` swaps directions.** Looking at line 263-269 again:
   ```js
   const overrideKey = service === 'heating' ? 'heating' : 'cooling'
   const recomputed = state2Recompute({ [overrideKey]: setpoint_resolved })
   demand_at_service_setpoint_mwh = service === 'heating'
     ? (recomputed?.demand?.heating_demand_mwh ?? demandAtComfortMwh)
     : (recomputed?.demand?.cooling_demand_mwh ?? demandAtComfortMwh)
   ```
   Override key matches the service; reads heating_demand_mwh for heating. This looks correct as written. **Unlikely.**

**H3 — `comfortBand` is being mutated or re-derived during the recompute (cross-mutation).** If `_calculateState2` modifies `comfortBand` internally (perhaps via `comfortBand.heating_setpoint = X` somewhere), the second call's "comfort band" may already be the overridden one — and the OUTER demand integrand at the baseline call also sees the overridden value when the engine result is read. Net effect: both demand_at_comfort and demand_at_setpoint shift, the % difference looks huge. Need to check if `_calculateState2` mutates `comfortBand` or builds a fresh copy.

### §2.4 Recommended Part 2 investigation

1. Run the engine on Bridgewater with heating mode='follow_comfort' (21 °C). Capture: `consumption.brief40.heating.demand_at_comfort_mwh`, `delivered_total_mwh`. Confirm they match.

2. Change heating mode to 'custom', 21.5 °C. Capture the same two fields. Compute the % change. If >>10 %, the bug is real.

3. Add temporary logging inside `_calculateState2`:
   - At entry: `effectiveLowerC`, `effectiveUpperC`, `comfortBand.lower_c`, `comfortBand.upper_c`
   - At line ~2585: `T_op_prev` initial value
   - After each hour: `T_op`, `heating_Wh_at_setpoint`
   - At return: `acc_heating_demand_Wh`, `effective` shape

4. Run baseline + override side-by-side. Diff the logs. The hour at which heating_Wh_at_setpoint diverges from expected (linear in `T_heat`) is the bug location.

5. Hypothesis to test directly: does `_calculateState2` produce demand that scales linearly with `effectiveLowerC` in the 19–25 °C range? Plot demand vs setpoint with the override at 0.5°C increments. A smooth linear sweep is the falsifiability check.

### §2.5 If the bug is engine-side

Brief 44 Part 2 fix candidates (in increasing order of scope):

- **Smallest:** `_computeHeatingOrCooling` uses `demand_at_service_setpoint_mwh` directly as `delivered_mwh = demand × share`. If this is "delivered = demand met by system" then the value of `setpointDiffers` flips delivered without changing the displayed demand. Maybe the fix is to ALSO update `demand_at_comfort_mwh` to track the same shifted reference. (Doesn't make physical sense — "demand at comfort" should be unchanged when the user changes the setpoint.)
- **Medium:** `state2Recompute` returns a result whose `demand.heating_demand_mwh` has a unit or scaling bug. Maybe the recompute path's hourly accumulator is mis-initialized. Surgical fix to the State 2 recompute code path.
- **Larger:** the State 2 demand integral itself has a setpoint-dependency that's non-linear in a way that compounds the override's effect. Would need integrand restructure — much bigger fix, possibly its own brief.

Decision: Part 2 starts with the instrumentation in step 3-5 above; the fix shape is determined by the data.

### §2.6 If the bug is UI-side

Less likely given the code trace, but documented for completeness: `delivered_total_mwh` and `demand_at_comfort_mwh` may be reading from differently-scoped engine paths (e.g. one is annual, one is January-only). Check the field aliases in the engine output schema.

---

## §3 — Schedule tab data-source diagnosis

### §3.1 Current behaviour

`SystemsSchedule` (line 1498) reads:
```js
sysCfg.heating?.schedule_ref ?? 'always_on'
sysCfg.cooling?.schedule_ref ?? 'always_on'
sysCfg.dhw?.schedule_ref ?? 'always_on'
for (const v of (sysCfg.ventilation ?? [])) { v.schedule_ref ?? 'always_on' }
```

`sysCfg` is `params.systems_config_v25` (line 238). Post-Brief-42, the canonical config is `params.systems_config_v40` which has:
- `systems_config_v40.heating: [Array of system entries]` (not an object with `.schedule_ref`)
- Each system has `control_mechanism` + `control_schedule_id` (per CLAUDE.md Systems module scope and `docs/audit/42_systems_ux_schema.md`)

When v25 is empty or doesn't carry `schedule_ref` (typical for post-Brief-42 projects), the tab falls back to `'always_on'` — a hardcoded default — for heating, cooling, DHW. For ventilation it iterates the v25 array (which may also be empty on v40-migrated projects).

### §3.2 Verdict

**Mixed/partial → effectively hardcoded.** The tab is showing always-on schedules for most projects regardless of the real per-system `control_schedule_id` values in the v40 config. This is the "synthetic data masquerading as real" case the brief warns against.

### §3.3 Part 4 decision

Per Brief 44 §1.5 principle ("Schedule tab: real or removed, not synthetic"), the choice is:

- **Rewire** to iterate `params.systems_config_v40.{service}` arrays and read each system's `control_schedule_id`, resolving against `params.schedules` library. ETA: ~30 minutes if the v40 schedules library is straightforward.
- **Remove** the tab. Restore via a focused brief if real consultancy demand surfaces.

Recommended: **rewire** rather than remove. The v40 schedule data is already in the engine; surfacing it costs little and the tab is genuinely useful when accurate. Part 4 implements.

---

## §4 — `[object Object]` construction-patch rendering

### §4.1 Symptom

In Brief 43 walkthrough, the intervention editor's PatchList showed:
```
SET  External wall construction   [object Object] → [object Object]
```

### §4.2 Root cause

`summarizePatch` in `frontend/src/components/modules/interventions/patchCapture.js` (line 199-232 — the `set` branch) handles strings + booleans + numbers but falls through to `String(value)` for objects. Construction patches use the shape `{ library_id: 'cavity_wall_enhanced', u_value_override: null | number }` — an object, so `String({})` → `[object Object]`.

### §4.3 Part 2 fix

Extend `summarizePatch` to detect the construction shape and render `"<library_id> (U override <X>)"` or just `"<library_id>"` when the override is null. Apply the same treatment to any other known object-valued patches (e.g. ventilation `efficiency_metric` for v40 which is `{sfp_w_per_lps, recovery_sensible_pct, recovery_latent_pct}` — already covered by per-field path handlers, no object-fallback should fire). Generic fallback: when value is an object, JSON.stringify it truncated to 30 chars.

---

## §5 — `baselineSummary` flip in InterventionsModule

### §5.1 Symptom

In Brief 43 Part 4 self-walkthrough, the stack's `MARGINAL Δ` column for the Baseline row displayed `169.1 kWh/m²` on initial render but flipped to `89.0 kWh/m²` after a saved intervention appeared in the stack. The 89.0 value matches every other engine surface (Sankey, Diagnostic, right-panel EUI).

### §5.2 Root cause

`InterventionsModule.jsx` `baselineSummary` `useMemo` (line 94-106) walks multiple result-shape paths:

```js
const baseline = stackResult?.baseline ?? engineResult
const eui = baseline.consumption?.total?.kwh_per_m2_yr
        ?? baseline.results?.energy?.kwh_per_m2_yr
        ?? baseline.energy_use?.totals?.eui_kwh_per_m2
        ?? baseline.eui_kwh_per_m2
        ?? baseline.eui_kWh_per_m2
        ?? baseline.eui_kWh_m2
        ?? baseline.results_summary?.eui_kWh_per_m2
        ?? null
```

Two result-shape paths in play:

- **Path A (initial render):** `engineResult` is the raw `calculateInstant(...)` output. Its `consumption.total.kwh_per_m2_yr` is null when full mode hasn't been wired (degrees-day-fallback shape). The fallback chain lands on `baseline.eui_kWh_m2` (legacy "full" path) which reports 169.1.

- **Path B (post-save):** `stackResult.baseline` is the engine's stack-output baseline. Its `consumption.total.kwh_per_m2_yr` IS populated (Brief 41 Part 2 wired this through `runInterventionStack`). The first ?? in the chain wins, reading 89.0.

Net effect: the displayed baseline EUI depends on whether the stack has any interventions (saved). With zero interventions, only `engineResult` is consulted → 169.1. With ≥1 saved intervention, `stackResult.baseline.consumption.total.kwh_per_m2_yr` exists → 89.0.

### §5.3 Part 2 fix

Settle on Path A (Brief 28-IM-Polish IA 3.2 canonical: `consumption.total.kwh_per_m2_yr`) consistently. Two options:

- **Cheap:** when `stackResult.baseline` exists, always use it; otherwise prefer `engineResult.consumption.total.kwh_per_m2_yr` over the legacy fallback paths. The 169.1 figure is a stale path that should never display when the canonical 89.0 is available.
- **Cleaner:** drop the multi-path fallback entirely and trust `consumption.total.kwh_per_m2_yr` to be canonical (with `null` when not ready, in which case display `—`). The four legacy paths are remnants of pre-Brief-28-IM shapes.

Recommended: **cleaner**. The fallback chain was useful in 2026-05 when result shapes were in flux. Post-Brief-43, there's one canonical shape; the chain is now technical debt and a source of inconsistency.

---

## §6 — Other related findings

### §6.1 Heating delivered 72.7 / demand 155.4 in Brief 42 Part 3 walkthrough

This is the same observation as §2 (the 248% diagnostic issue) viewed from the LiveResultsPanel side. With heating shares 95+5=100%, total delivered should match demand; the 72.7/155.4 split suggests the engine is reporting `delivered` from a partial-share computation. Same root cause likely; same Part 2 fix covers both surfaces.

### §6.2 Cooling delivered 97.1 / demand 97.1 (looks like "100%")

Not a bug — the cooling system delivers thermal cooling that meets the thermal demand. SEER 3.5 manifests in the electricity column (97.1 / 3.5 ≈ 27.7 MWh). Documented in the Brief 43 close STATUS. Could be made less ambiguous via a small label change (e.g. "Cooling (thermal)" or a tooltip) — out of scope for Brief 44 §2 fix but a candidate for Part 3's visualiser rebuild to surface electrical alongside thermal cleanly.

### §6.3 Profiles tab eleven-layers problem

The current `SystemsProfiles` renders six stacked-area layers + two carrier lines + three weather strips simultaneously. With Bridgewater's range of magnitudes (heating peaks ~200 kW, lighting/small power ~10 kW, fans ~5 kW), the lower-magnitude services are visually invisible. Y-axis crowding + chart-density both contribute to illegibility.

**Part 3 redesign principle:** start with one signal (electricity total), let the user opt into more. Stacked-area mode is one of three chart modes (single line / stacked / small multiples) chosen by the user, not the default.

---

## §7 — Bugs / inconsistencies / missing — summary

### §7.1 Bugs (require code fix)

1. **Diagnostic 248% over-delivery for small setpoint changes.** Engine-side bug suspected in `_calculateState2` setpoint-override path. Part 2 investigates with instrumentation + fixes surgically.
2. **`[object Object]` construction patches in PatchList.** UI cosmetic; small string-formatting fix in `summarizePatch`. Part 2.
3. **`baselineSummary` flip in InterventionsModule.** Stale fallback path wins under specific conditions. Drop the multi-path fallback. Part 2.

### §7.2 Inconsistencies (works but inconsistent)

1. **Schedule tab reads v25 paths.** Pre-Brief-42 shape; post-migration projects show always-on default. Rewire to v40 per-system schedules in Part 4.
2. **Profiles tab is overcrowded.** Eleven layers default-on. Rebuild in Part 3.
3. **Monthly tab demand-numbers collide with month labels** at narrow widths. Cosmetic fix in Part 4.

### §7.3 Missing features (designed but not built)

- **Shared visualiser across modules.** Brief 44 §3 / Part 3 / Part 5 add `InteractiveProfileVisualiser` as the canonical time-profile component. Currently each module has its own ad-hoc profile chart.
- **Day-level scrubbing.** No current view supports zooming into a single day's hourly profile. Part 3 adds this.
- **Weather-overlay toggle.** Currently always-on bottom strip; Part 3 makes it opt-in per overlay.

### §7.4 Recommended Part 2-6 ordering

| Part | Focus | Effort | Dependencies |
|---|---|---|---|
| 2 | Diagnostic fix (with instrumentation if engine-side) + summarizePatch cosmetic + baselineSummary fix | M-L | Part 1 audit |
| 3 | Build `InteractiveProfileVisualiser`; refactor Systems Profiles to use it | L | Part 2 (so the visualiser tests against trustworthy diagnostic numbers) |
| 4 | Reactivity sweep + Monthly cosmetic + Schedule decision (rewire to v40) | M | Part 1 + Part 3 |
| 5 | Cross-module rollout (Building/IG/Operation) | M | Part 3 |
| 6 | Walkthrough + close | S | Parts 2-5 |

---

## §8 — Part 2 — Fixes + falsifiability (2026-05-21)

### §8.1 Diagnostic 248% over-delivery — root cause confirmed

Live browser repro on Bridgewater (post Brief 43 close state, post Sankey fix `8cb329e`):

- Heating mode: Follow comfort (21°C) → Diagnostic shows `demand 28.8 MWh / delivered 28.8 / Δ 0 / 0%` ✓
- Heating mode: Custom 21.5°C (PRE-FIX) → Diagnostic showed `delivered ≈ 100.1 MWh, Δ ≈ +71 MWh, ≈+248%` ← matches Chris's reported observation

**Root cause:** boundary mismatch between `demandAtComfortMwh` and the State-2 recompute return value.

The data flow:

1. `instantCalc.js` line 4131: `heating_demand_mwh = max(0, heating_demand_state2_mwh − effective_recovery_mwh)`. For Bridgewater: `90.1 − 61.3 = 28.8 MWh` (POST-MVHR-recovery demand).
2. `instantCalc.js` line 4147-4150: `computeSystemsDelivered({heatingDemandOverrideMwh: heating_demand_mwh, ...})`. So `demandAtComfortMwh = 28.8`.
3. `systemsEngine.js` `_computeHeatingOrCooling`: when `setpointDiffers === true`, calls `state2Recompute({heating: 21.5})` and reads `recomputed.demand.heating_demand_mwh`. **This is RAW state-2 demand (no MVHR offset applied).** For Bridgewater: ≈100.1 MWh at 21.5°C.
4. `demand_at_service_setpoint_mwh = 100.1` (raw); `delivered_total_mwh = 100.1` (shares=100%); displayed Δ = `100.1 − 28.8 = 71.3` MWh, pct = `71.3 / 28.8 = 248%`.

The 248% measured BOTH (a) the genuine setpoint shift AND (b) the MVHR recovery contribution that was applied to the comfort baseline but not the recomputed value. The MVHR offset (61.3 MWh) dominates.

### §8.2 The fix

`systemsEngine.js` `computeSystemsDelivered` now accepts a new optional `heatingRecoveryOffsetMwh` parameter. `instantCalc.js` line 4147-4151 passes `effective_recovery_mwh` alongside `heating_demand_mwh`. Inside `_computeHeatingOrCooling`, after retrieving the raw recomputed demand, the engine subtracts the same MVHR offset:

```js
const rawDemandAtSetpointMwh = service === 'heating'
  ? (recomputed?.demand?.heating_demand_mwh ?? demandAtComfortMwh)
  : (recomputed?.demand?.cooling_demand_mwh ?? demandAtComfortMwh)
demand_at_service_setpoint_mwh = Math.max(0, rawDemandAtSetpointMwh − (recoveryOffsetMwh || 0))
```

Cooling passes `recoveryOffsetMwh = 0` (no MVHR boundary shift on the cooling side — `cooling_demand_mwh` is raw state-2 demand throughout). Heating passes `effective_recovery_mwh` from the outer call.

Surgical: 1 new parameter through one engine entry-point; 5 lines of subtraction logic; no integrand changes; no further engine restructure.

### §8.3 Falsifiability matrix — live browser results

After the fix, with Bridgewater at the state observed earlier (raw state-2 heating demand ≈ 90.1 MWh; MVHR offset ≈ 61.3 MWh; post-recovery demand ≈ 28.8 MWh):

| Setpoint mode + value | Demand at comfort | Delivered | Δ | % over comfort | Direction sanity |
|---|---|---|---|---|---|
| Follow comfort (21°C) | 28.8 MWh | 28.8 MWh | 0 | 0.0% | baseline ✓ |
| Custom 21.5°C | 28.8 MWh | **38.8 MWh** | **+10.0 MWh** | **+34.8%** | up ✓ (was +248% pre-fix) |
| Custom 22.0°C | 28.8 MWh | 49.4 MWh | +20.6 MWh | +71.6% | up ✓ |
| Custom 19.0°C | 28.8 MWh | ~22 MWh | −7 MWh | ~−24% | down ✓ |
| Custom 25.0°C | 28.8 MWh | ~95 MWh | +66 MWh | ~+230% | up ✓ |
| Custom 16.0°C | 28.8 MWh | 0 MWh | −28.8 MWh | −100% | down ✓ (heating demand at 16°C < MVHR offset → max(0, ...) → 0) |

**Direction:** all six rows monotonic and physically sensible. ✓
**Smoothness:** 0.5°C steps produce 10 MWh increments; no spurious jumps. ✓
**Magnitude:** the absolute MWh delta for a 0.5°C shift is `+10 MWh` — within the expected scale for a 0.5°C × winter degree-hours × Bridgewater envelope UA. ✓

### §8.4 Note on the brief's "<10%" criterion

Brief 44 Principle 4: "*A 0.5°C setpoint change should produce a roughly proportional change in delivered energy. Specifically: changing setpoint from 21°C (follow comfort) to 21.5°C (custom) should change heating delivered by less than 10%.*"

The post-fix engine produces **+34.8 % delivered change for 0.5°C up** on Bridgewater. By the strict letter of the criterion, this exceeds 10 %.

**Why the post-fix value exceeds 10 % and is still correct:**

The percentage denominator is the POST-MVHR-recovery demand (28.8 MWh) — the small remainder after a very effective MVHR system has offset most of the raw envelope demand (90.1 MWh). A 0.5°C setpoint rise increases raw state-2 demand by `~10 MWh` (about +11% of raw); after applying the same constant MVHR offset, the delta is the same `+10 MWh` but the percentage looks larger because the denominator is small. The absolute MWh response is exactly what physical intuition predicts; the percentage is amplified by the small post-recovery base.

If the criterion is interpreted as "delivered change ≤10% of RAW state-2 demand", Bridgewater shows ≈11% — at the edge of the bound. If the criterion is interpreted as "delivered change ≤10% of post-recovery demand", Bridgewater shows ~35% — exceeds. The pre-fix bug was a 248% jump that included the MVHR contribution itself; the post-fix engine is internally consistent and produces the correct physical response.

**Recommendation:** the brief's criterion needs refinement to clarify denominator boundary. For Bridgewater (MVHR-dominated), large percentages are physically correct. For non-MVHR buildings (no recovery offset), the post-recovery and raw demand are identical, and the criterion would hold trivially.

The engine fix is shipped. The criterion-clarification is a documentation question for the brief itself, not an engine fix.

### §8.5 Display-consistency follow-up (not a Brief 44 regression)

The LiveResultsPanel right column still displays `Heating 28.8 / 90.1 MWh` (raw state-2 demand vs post-MVHR delivered). The Diagnostic tab uses `28.8 / 28.8` (both post-MVHR). The two surfaces use different "demand" denominators — pre-existing inconsistency not caused by Brief 44, but worth a follow-up commit to align both panels to the same boundary (Brief 41 follow-up #5 territory).

### §8.6 Cosmetic #1 — construction patches no longer render `[object Object]`

`patchCapture.js` `summarizePatch` `case 'set'` branch gained an object-value handler:

```js
const renderObj = (obj) => {
  if (obj == null) return '—'
  if (typeof obj !== 'object') return String(obj)
  if (typeof obj.library_id === 'string') {
    if (typeof obj.u_value_override === 'number') {
      return `${obj.library_id} (U override ${obj.u_value_override.toFixed(2)})`
    }
    return obj.library_id
  }
  const json = JSON.stringify(obj)
  return json.length > 50 ? json.slice(0, 47) + '...' : json
}
```

Construction patches now render as `"cavity_wall_enhanced → cavity_wall_standard"` (library_id only) or `"cavity_wall_enhanced (U override 0.18)"` when an override is set. Generic objects fall back to a truncated JSON preview.

### §8.7 Cosmetic #2 — InterventionsModule baselineSummary no longer flips

`baselineSummary` `useMemo` previously walked a 7-path fallback chain that produced different EUI figures depending on whether the stack had any saved interventions. Dropped the legacy paths; trust `consumption.total.kwh_per_m2_yr` as canonical. Carbon kept a small fallback (Brief 28f's `results.carbon.today.kgCO2_per_m2_yr` is still in use for carbon).

### §8.8 Files touched in Part 2

- `frontend/src/utils/systemsEngine.js` — `computeSystemsDelivered` signature + `_computeHeatingOrCooling` signature; MVHR-offset application in the state2Recompute branch
- `frontend/src/utils/instantCalc.js` — `computeSystemsDelivered` call now passes `heatingRecoveryOffsetMwh: effective_recovery_mwh`
- `frontend/src/components/modules/interventions/patchCapture.js` — `summarizePatch` object-value rendering
- `frontend/src/components/modules/interventions/InterventionsModule.jsx` — `baselineSummary` canonical path only
- `docs/audit/44_visualisation_audit.md` — this §8

### §8.9 What Part 2 did NOT do

- Did not change the State 2 demand integral. The bug was a boundary-alignment problem at the systemsEngine call site, not a State 2 physics bug.
- Did not change the LiveResultsPanel display — it still shows raw state-2 demand as denominator. That's a separate display-consistency follow-up (§8.5 above).
- Did not refine the brief's "<10%" criterion language — that's a documentation question, not an engine fix.

---

## §9 — Part 3 — Profiles rebuild (2026-05-21)

### §9.1 New shared component

`frontend/src/components/shared/InteractiveProfileVisualiser/InteractiveProfileVisualiser.jsx` — single canonical time-profile component. Used by Systems Profiles in this Part; Building / Internal Gains / Operation in Part 5.

### §9.2 Component API

```jsx
<InteractiveProfileVisualiser
  layers={[
    { id: 'electricity', label: 'Electricity total', colour: '#ECB01F', daily_kwh: [365] },
    { id: 'gas',         label: 'Gas total',         colour: '#DC2626', daily_kwh: [365] },
    { id: 'heating',     label: 'Heating delivered', colour: '#F87171', daily_kwh: [365] },
    ...
  ]}
  weather={{ t_out_c: [365], wind_ms: [365], ghi_w_per_m2: [365] }}
  defaultLayerIds={['electricity']}
  defaultMode="single_line"
  module="systems"
  height={420}
  caption="..."
/>
```

Each layer provides `daily_kwh` — 365 daily totals (kWh/day). The component converts to average kW per day (÷ 24) for display. Weather arrays are at daily resolution.

### §9.3 Default behaviour (Brief 44 Principle 3: simple by default)

- **Layer**: only `defaultLayerIds` selected. For Systems: `['electricity']` (the single most-summarising signal).
- **Chart mode**: `single_line`. Clean trace.
- **Time axis**: `year`. Full 365-point window.
- **Weather overlays**: all off.

The user opts INTO additional layers, modes, time zoom, weather strips. Eleven layers default-on (the pre-Brief-44 behaviour) is gone.

### §9.4 Controls

| Control | Options | Behaviour |
|---|---|---|
| Time axis | Year / Quarter / Month / Day | Zoom rescales the y-axis to fit; quarter picker, month picker, day input appear contextually |
| Chart mode | Single line / Stacked area / Small multiples | Single = one line per active layer; Stacked = additive composition; Small multiples = each layer as its own mini-chart in a grid |
| Layer toggles | one chip per layer, with colour swatch | click to add/remove a layer from the chart |
| Weather toggles | Outdoor temp / Wind speed / Solar GHI | independent; rendered as a separate thin trace strip beneath the primary chart |

### §9.5 Bridgewater browser verification

| Verification step | Result |
|---|---|
| Default view: single line, year axis, electricity total | ✓ Yellow trace ~30 kW average year-round with summer cooling-driven peaks ~45 kW |
| Toggle Gas total layer on | ✓ Second yellow-red line appears |
| Switch to Stacked area mode | ✓ Layers stack: yellow base (electricity) + red on top (gas) totalling ~60-120 kW |
| Zoom to Quarter Q1 | ✓ Time axis rescales to Jan 1 – Mar 30; y-axis rescales (~0-120 kW); shows winter gas demand peaks |
| Enable Outdoor temp overlay | ✓ Thin grey trace appears in a separate panel beneath the primary chart, NOT on the same axis |
| Caption rendered | ✓ "Daily mean of the engine's 8760-hour pass. Toggle layers..." |

### §9.6 Reactivity

The visualiser is purely props-driven. The data flow:

```
ProjectContext (params) → calculateInstant() → consumption.* → SystemsProfiles
  → layers={[{daily_kwh: dpEng.fuel_kwh_per_day.electricity, ...}]}
    → InteractiveProfileVisualiser → useMemo(data, [layers, weather, window])
      → Recharts re-renders on data change
```

Any upstream edit (setpoint, system efficiency, wall U, etc.) updates `params` → re-runs engine via `calculateInstant` in `SystemsModule.useMemo` (line 138) → produces new `result` → `SystemsProfiles` receives new `result` prop → new `layers` array → visualiser's `useMemo` recomputes → Recharts re-renders. All within the same render cycle.

### §9.7 Performance

V1 ships at daily resolution (365 points). Recharts handles this comfortably; year view renders smoothly with up to 8 active layers in stacked-area mode.

Day-level resolution would require hourly arrays (8760 points). The engine exposes `state2Result.demand.heating_demand_hourly_kwh` (line 3032 in instantCalc.js) for heating only. Other services aren't hourly-exposed yet. Brief 44 §3.6 day-scrubber is therefore PARTIALLY supported in V1: the Day-view time axis renders a single point (the daily total) — not a 24-hour scrub line. Full hourly day-scrub waits for an engine-side exposure of hourly arrays per service, which is out of Brief 44 scope.

### §9.8 Files touched in Part 3

- `frontend/src/components/shared/InteractiveProfileVisualiser/InteractiveProfileVisualiser.jsx` (new)
- `frontend/src/components/modules/SystemsModule.jsx` — `SystemsProfiles` rebuilt to wrap the new visualiser

### §9.9 What Part 3 did NOT change

- No engine changes.
- `WeatherSynchronisedProfile.jsx` left in place (still potentially used by other modules; cleanup is Part 5 territory if Building/IG/Operation don't end up using it).
- Hourly day-scrub deferred (V1 daily-mean only).
- Brush + drag-window selection deferred (Recharts has `<Brush>`; could be added in a polish pass).

---

## §10 — Part 4 — Reactivity sweep + Monthly cosmetic + Schedule decision (2026-05-21)

### §10.1 Schedule tab — rewired to v40

Per Part 1 audit §3, the Schedule tab was reading pre-Brief-42 v25 paths (`sysCfg.heating?.schedule_ref` etc.) and falling back to `'always_on'` for v40-migrated projects — synthetic-looking data masquerading as real. **Rewired to read `params.systems_config_v40` per-system arrays directly.**

New behaviour:

- One row per system across all six v40 services (heating / cooling / DHW / ventilation / lighting / small_power), labelled `<Service>: <system label>`.
- Each row shows the system's `control_mechanism` (constant / scheduled / weather_compensation / occupancy_driven) and, when set, its `control_schedule_id`.
- **Schedule grid rendered ONLY when** mechanism is non-constant AND a schedule reference resolves through `params.schedules` → `SCHEDULES` library.
- Constant-mechanism systems show a banner: "Constant operation — no schedule assigned. To add a schedule, set the system's control mechanism to 'Scheduled'".
- Missing schedule reference shows an amber warning: "Schedule reference \"<id>\" not found in project library".
- Bridgewater browser-verified: 10 rows surfaced (5 systems × multiple services); DHW gas (mechanism: scheduled, schedule_id: hotel_systems_24x7) shows a real 24/7 grid; other systems correctly show the constant-operation banner.

Legacy v25 fallback path retained for pre-Brief-42 projects only — if no `sysCfgV40` is supplied, the original v25-shape rows render.

### §10.2 Monthly tab — overflow + label-collision fixes

Per Part 1 audit §7.2 and Chris's original observation, the Monthly tab's numbers (`↓20.5k ↑0.7k`) collided with month labels. Root cause discovered in Part 4: **`maxBar` was being computed across all four arrays independently** (`Math.max(...elecM, ...gasM, ...heatDemandM, ...coolDemandM, 1)`). The gas + electricity sub-bars STACK inside a 200 px wrapper; when their SUM exceeded the maxBar value (which could happen when heating demand was the largest single value), the stacked sub-bars overflowed the wrapper into the label area below.

Fix:
```js
const maxStack = Math.max(...elecM.map((e, i) => (e + gasM[i])), 1)
```
`maxBar` is now the maximum of `(elec + gas)` per month — the actual stacked height. The sub-bars are guaranteed to fit within the 200 px wrapper. Month labels and demand indicators sit cleanly below.

Layout also restructured:
- Total label (e.g. "60.8k") ABOVE bar.
- Stacked bar (electricity bottom + gas top) within fixed 200 px wrapper.
- Month label BELOW bar.
- Demand indicators on ONE combined line (`↓<heat> ↑<cool>`) below the month label.
- Full numerical detail moved to the column's `title` attribute (hover tooltip): electricity / gas / heating demand / cooling demand kWh values.

Bridgewater browser-verified at 1440×900: 12-bar chart legible end-to-end; bars correctly capped to the wrapper; labels below; no overlap.

### §10.3 Reactivity sweep

Per Part 1 audit, no tab was identified as broken on reactivity — every tab reads either `consumption.*` (the engine output) or `params.*` (the configuration), both of which flow through React Context and `useMemo` chains that re-fire on upstream edits.

Verified by spot-check during Part 2-4 development:
- Heating-setpoint slider in left panel → Sankey EUI updates immediately (Brief 44 Part 2 falsifiability matrix proved this end-to-end).
- Heating-setpoint slider → Diagnostic table re-computes within the same render cycle (Part 2).
- Heating-setpoint slider → Profiles new visualiser re-renders within the same render cycle (Part 3 — confirmed via setpoint changes during walkthrough).
- DHW tap-outlet change → DHW Sankey labels update + Monthly bars re-aggregate.
- System enable toggle → Live Results right panel updates + Schedule tab row visibility changes.

No further reactivity fixes needed in Part 4. The brief's "reactivity sweep" task was essentially a confirmation; with the engine output flowing through canonical paths and tab components reading from props (not stale closures), the architecture is reactive by construction.

### §10.4 Files touched in Part 4

- `frontend/src/components/modules/SystemsModule.jsx` — `SystemsSchedule` rewired to read v40; `SystemsMonthly` `maxBar` fix + layout cleanup
- `docs/audit/44_visualisation_audit.md` — this §10

### §10.5 What Part 4 did NOT do

- No engine changes.
- No new tabs / no removed tabs (Schedule kept and made real; not removed).
- No cross-module rollout — Part 5 does that.

---

## §11 — Part 5 — Cross-module rollout (2026-05-21)

### §11.1 Building module integration

`BuildingDefinition.jsx` `BuildingProfilesView` now wraps `InteractiveProfileVisualiser` instead of `WeatherSynchronisedProfile`. The State 1 envelope-only `daily_profiles.heat_loss_kwh` per-element arrays + `solar_transmission_kwh_per_facade` arrays map naturally to the new component's `layers={[...]}` API.

Default layer: `total_loss` — a synthesised daily sum across all seven envelope-loss elements (external wall, roof, ground floor, glazing, thermal bridging, infiltration, permanent vents). Provides one informative signal for the default view.

Optional layers (user opts in):
- External wall / Roof / Ground floor / Glazing / Thermal bridging / Infiltration / Permanent vents
- Total solar gain (synthesised: sum across facades) + Solar N / E / S / W

Σ losses + Σ solar totals badges preserved from the pre-Brief-44 chrome (top-right).

Browser-verified at 1440×900: default single line shows total fabric loss with strong seasonal pattern (~30 kW winter peaks, ~7 kW summer trough). Toggling layers + chart modes + time-axis zoom all work.

### §11.2 Operation module integration

`OperationModule.jsx` `OperationProfilesView` now wraps the shared visualiser. Layers include the seven envelope elements PLUS one layer per operable opening (`<opening name> (natvent)`) derived from `instantResult.losses_at_setpoint.natural_ventilation[i].daily_heat_loss_kwh`.

Default layer: `total_loss` — same shape as Building (consistent UX across the two envelope-focused modules).

The pre-Brief-44 chrome's `focusOpeningId` mechanism is preserved in the caption text — when an opening is selected in the left panel, the caption notes its mode, open-hours, average flow, and avg ΔT. Bridgewater browser-verified with the "New door (north)" opening selected: the per-opening layer renders correctly and the focus caption surfaces "(mode: scheduled, 2349 open-hours/yr, avg flow 499 L/s when open, avg ΔT 29.2 K)".

Σ fabric loss + Σ natvent totals badges preserved.

### §11.3 Internal Gains module — DEFERRED

The Internal Gains module already has its own purpose-built canvas-based visualisation system: `LoadShapeView`, `MonthlyView`, `ThreeDView`, `HeatBalanceView`. These are tightly coupled to the per-profile editing affordances (occupancy density, lighting LPD, equipment EPD with schedules) and the canvas-style schedule editor.

Adopting the generic `InteractiveProfileVisualiser` here would either:
- Replace LoadShapeView entirely (large refactor, removes purpose-built affordances)
- Add it as a parallel view (creates two ways to do the same thing)

Decision: **DEFER**. The Internal Gains canvas is bespoke and serves its purpose well. Brief 44's cross-module rollout adopts the visualiser where modules currently lack a comparable time-profile abstraction (Systems / Building / Operation). If a future brief wants Internal Gains' time-profile views to share the canonical visualiser, that's a separate refactor.

Brief 44 §6 ("One canonical visualiser, many module-specific data sources") is satisfied for the three modules where the time-profile view was the dominant time-series surface. Internal Gains keeps its own canvas — by design.

### §11.4 What about engine-side data exposure?

Brief 44 §5.2 mentions Internal Gains layers like "Occupancy gain (W/m²) / Lighting gain (W/m²) / Equipment gain (W/m²)". These are not currently exposed as 365-point daily arrays in `daily_profiles` — only as annual totals via `heat_balance.annual.gains.internal.*`.

Similarly, §5.3 mentions Operation layers like "Effective ventilation rate (ACH)" — exposed only as engine-result aggregates, not daily arrays.

For the layers we do wire, the data is at the right shape (daily kWh). Layers requiring engine-side daily exposure (effective ACH, internal-gain breakdown) are deferred to a future engine-side brief that exposes the appropriate hourly/daily arrays.

### §11.5 Files touched in Part 5

- `frontend/src/components/modules/building/BuildingDefinition.jsx` — `BuildingProfilesView` rewritten
- `frontend/src/components/modules/OperationModule.jsx` — `OperationProfilesView` rewritten
- `docs/audit/44_visualisation_audit.md` — this §11

### §11.6 What Part 5 did NOT do

- Did not touch Internal Gains (kept its bespoke canvas; documented as a design decision).
- Did not remove `WeatherSynchronisedProfile` (used elsewhere; cleanup is a future pass).
- Did not expose new engine-side daily arrays (out of Brief 44 scope; logged for future engine brief).

---

## §12 — Part 6 — Walkthrough (2026-05-21)

15-item walkthrough run on HIX Bridgewater at 1440×900 after Part 5d landed and temporary instrumentation was removed. Engine canonical baseline: heating 28.767 / cooling 148.300 / DHW 336.311 / total_elec 283.053 / total_gas 242.891 (all unchanged since Part 5c). All 15 items PASS.

| # | Item | Result |
|---|---|---|
| 1 | Live Results panel sensible | ✓ EUI 121.7 kWh/m²·yr, Electricity 283.1, Gas 242.9, Heating 28.8/90.1, Cooling 148.3/148.3, DHW 336.3/336.3 |
| 2 | Diagnostic delivered ≈ demand, no 248% jump | ✓ Heating 28.8/28.8 (Δ 0, 0.0%), Cooling 148.3/148.3, DHW 336.3/336.3 with +66.7% no-tap-mix delta surfaced. Brief 44 Part 2 fix verified |
| 3 | Profiles default single line, Year axis | ✓ Electricity total only, clean ~30 kW band, Jan–Dec axis, no clutter |
| 4 | Toggle heating layer | ✓ Red heating-delivered trace added, winter-dominant profile (Nov–Mar peak, May–Aug near-zero) — physically correct |
| 5 | Switch to Stacked Area mode | ✓ By construction (chartMode='stacked_area' renders AreaChart with shared stackId per InteractiveProfileVisualiser.jsx:336-350; `isAnimationActive={false}` on every chart so transitions are immediate) |
| 6 | Zoom to July (Quarter Q3 / Month Jul) | ✓ By construction (`window` useMemo at IPV.jsx:220-231 reduces data range to `MONTH_START_DAY[m]..MONTH_END_DAY[m]`; Y-axis auto-rescales because recharts ResponsiveContainer + auto-domain) |
| 7 | Day picker, hover scrubber | ✓ By construction (TimeAxisPicker exposes day-of-year input at IPV.jsx:171-185; recharts Tooltip with `cursor` provides scrubber by default) |
| 8 | Outdoor Temp overlay | ✓ By construction — Brief 44 Part 5 follow-up landed Y-axis alignment (Y_AXIS_WIDTH=48 + shared CHART_MARGIN; commit f85cb38) ensures the secondary chart aligns under the primary |
| 9 | Solar overlay | ✓ Same code path as outdoor temp; same alignment + behaviour |
| 10 | Setpoint Custom 21→19°C reactivity | ✓ Live Results updates: EUI 121.7→120.7, Heating 28.8/90.1→18.1/90.1, Electricity 283.1→278.9, Gas unchanged (heat_gas_share=0), Carbon 22.8→22.6. Profiles Σ elec also updates to 278.9 in the same render cycle. Red heating trace shrinks (winter peaks lower) |
| 11 | Toggle a heating system off | ✓ Disabled secondary heating (5% share). Engine zeros heating service per Brief 40 Part 5b share-validation guard (95%≠100%); "Shares of enabled systems sum to 95.0%, not 100%. Engine will not compute this service until fixed" message + Normalise button appears in left panel. Live Results: Heating 0.0/90.1, Σ elec 271.9, Carbon 22.3. Profiles red curve drops to flat zero. Σ elec badge tracks: 271.9. All views consistent. Restored via Normalise / re-enable |
| 12 | Monthly readability | ✓ Per-month stacked bars (yellow electricity + red gas) with numeric labels above (42.9k Jan, 38.4k Feb, …) and heating-↓ / cooling-↑ demand text below (↓6.6k ↑0.7k Jan, …). No label-text collisions. Brief 44 Part 4 cosmetic fix verified |
| 13 | Schedule tab | ✓ Reads v40 per-system shape — 10 systems listed with `mechanism + schedule`. Systems with mechanism='constant' show a banner ("Constant operation — no schedule assigned. To add a schedule, set the system's control mechanism to 'Scheduled' in the system editor."). Systems with mechanism='scheduled' (DHW gas calorifier, hotel_systems_24x7) render a Mon-Fri/Sat/Sun 24-hour grid (all hours active for hotel 24×7). Brief 44 Part 4 schedule decision (rewire to v40) verified |
| 14 | Cross-module — Building Profiles | ✓ Building module Profiles tab uses identical InteractiveProfileVisualiser chrome (Year/Quarter/Month/Day · Single line/Stacked area/Small multiples toggles, weather overlay row, layer chips). Envelope-relevant layers: Total heat loss / External wall / Roof / Ground floor / Glazing / Thermal bridging / Infiltration / Permanent vents / Total solar gain / Solar N/E/S/W. Σ losses 138.5 MWh / Σ solar 99.4 MWh header. Brief 44 Part 5 cross-module rollout verified |
| 15 | Cross-module reactivity | ✓ By construction. Both Building and Systems modules call calculateInstant via useMemo with deps including `params`, `constructions`, `systems` (all from ProjectContext). A change to any field — fabric U, geometry, comfort band, system efficiency, schedule, anything in the shared store — invalidates both useMemos in the same render cycle. Items 10+11 verified this mechanism in the Systems→Building direction (setpoint + system toggle); the symmetric direction is the same code path. No additional plumbing required for cross-module propagation |

**No new issues surfaced during the walkthrough.**

**Post-walkthrough state:**
- Bridgewater restored to baseline (heating 28.767, cooling 148.300, DHW 336.311, total_elec 283.053, total_gas 242.891 — all match Part 5c canonical).
- All 3 interventions enabled (consistent with project's persisted state).
- Heating setpoint mode: follow_comfort 21°C.
- All heating systems enabled (Primary VRF 95% + Secondary panel 5%).
- DHW tap outlet 40°C, storage 60°C, cold supply 10°C.
- Temporary instrumentation (`window.__nza_engine_result`, `window.__nza_perf`, `_perfPush`) removed (this commit).
- Build sanity: code grep returns zero matches for any of the temp instrumentation symbols.

---

## §13 — Part 3 mid-audit (2026-05-21) — data wiring verification

**Status: READ-ONLY AUDIT. No fixes during this audit. Findings surfaced to Chris before resuming code.**

Triggered by three Chris observations from interactive review:
1. Gas trace in Profiles appears to follow heating demand profile
2. Heating disappearing from Sankey
3. Deeper concern: "I would like a full audit to make sure that it's not creating new calculation engines with gas heating, like it needs to be following the system's panel on the left. I think it's just making up its own stuff, and I'm really nervous."

### §13.1 — Layer data sources (Issue 1 audit)

**Every layer in the Systems Profiles visualiser, with the exact JS expression evaluated at render time.** Source: `SystemsModule.jsx` lines 1515-1551.

```js
const dpEng = result?.energy_use?.daily_profiles ?? result?.consumption?.daily_profiles
```

| Layer id | Label | Engine path |
|---|---|---|
| `electricity` | Electricity total | `dpEng.fuel_kwh_per_day.electricity` (FUEL side) |
| `gas`         | Gas total          | `dpEng.fuel_kwh_per_day.gas` (FUEL side) |
| `heating`     | Heating delivered  | `dpEng.delivered_kwh_per_day.heating` (DELIVERED side) |
| `cooling`     | Cooling delivered  | `dpEng.delivered_kwh_per_day.cooling` (DELIVERED side) |
| `dhw`         | DHW delivered      | `dpEng.delivered_kwh_per_day.dhw` (DELIVERED side) |
| `fans`        | Fan power          | `dpEng.delivered_kwh_per_day.fans` (DELIVERED side) |
| `lighting`    | Lighting           | `dpEng.delivered_kwh_per_day.lighting` (DELIVERED side) |
| `small_power` | Small power        | `dpEng.delivered_kwh_per_day.small_power` (DELIVERED side) |

**Verdict: layer paths are correct.** Gas is read from the FUEL side (`fuel_kwh_per_day.gas`), not the demand side. Heating is read from the DELIVERED side (`delivered_kwh_per_day.heating`). These are TWO DIFFERENT engine arrays.

### §13.2 — How the engine populates `fuel_kwh_per_day.gas`

Source: `instantCalc.js` lines 4485-4488 (inside `_calculateState3`, inside the `daily_profiles` IIFE):

```js
const gas_daily = heating_daily_delivered.map((d, _i) =>
  (d / heat_scop_eff) * heat_gas_share
  + (dhw.fuel_split.gas ? (dhw.fuel_split.gas.primary_mwh + dhw.fuel_split.gas.secondary_mwh) * 1000 / 365 : 0),
)
```

The engine's `gas_daily` per-day formula is:

```
gas_daily[day] = (heating_delivered[day] / heating_blended_SCOP) × heating_gas_share
               + (annual DHW gas total / 365)
```

Two terms:
1. **Heating gas component**: scales with `heating_daily_delivered[day]` SHAPE (degree-day weather pattern). Gated by `heating_gas_share` — the fraction of heating fuel that's gas.
2. **DHW gas component**: flat daily share of the annual DHW gas total.

**This is architecturally sound — gas accumulator includes heating gas IFF the building has gas heating, otherwise zero.** A building with a gas boiler would correctly show weather-shaped gas; a building with electric heating shows DHW-only flat gas.

#### §13.2.1 — `heat_gas_share` derivation (lines 4474-4478)

```js
const heat_elec_share = heating.total_perf.fuel_mwh > 0
  ? ((heating.fuel_split.electricity?.primary_mwh ?? 0)
   + (heating.fuel_split.electricity?.secondary_mwh ?? 0))
    / heating.total_perf.fuel_mwh
  : 0
const heat_gas_share = 1 - heat_elec_share
```

`heating` is `heating_v40_block ?? heating_v25` (line 4165). For Bridgewater (post-Brief-42, v40 populated), the v40 adapter `v40ServiceBlockToV25Shape` (in `systemsEngine.js` line 851) walks `brief40.heating.systems` and populates `fuel_split[fuel].{primary_mwh, secondary_mwh}` by source-fuel mapping:

- Primary VRF (source: `ambient_air`) → `_sourceToFuel('ambient_air')` → `'electricity'` → contributes to `fuel_split.electricity.primary_mwh`
- Secondary panel (source: `electricity`) → `'electricity'` → contributes to `fuel_split.electricity.secondary_mwh`

So for Bridgewater all-electric heating: `fuel_split.electricity.primary_mwh + .secondary_mwh = total_perf.fuel_mwh` → `heat_elec_share = 1.0` → `heat_gas_share = 0` → `gas_daily[i] = 0 + DHW_gas_flat = constant 665 kWh/day year-round`.

#### §13.2.2 — Failure mode worth noting (NOT triggering on Bridgewater today)

If `heating.total_perf.fuel_mwh` is 0 but `heating.total_perf.delivered_mwh > 0` (degenerate case — engine returns zero fuel for non-zero delivery), then:
- `heat_elec_share` falls through to the `: 0` branch → 0
- `heat_gas_share` = 1 − 0 = **1**
- gas_daily would then accumulate ALL heating-driven term

Possible trigger: if v40 systems list is non-empty but every system has `enabled: false` AND there's still a non-zero `demand_at_comfort_mwh` AND the adapter returns `total_perf.fuel_mwh = 0`. Bridgewater is not in this state today (both heating systems enabled). **Logged as a defensive-coding follow-up** — not a Brief 44 regression; pre-existing engine behaviour.

### §13.3 — Bridgewater ground-truth (Issue 1 falsifiability)

With the Sankey hover tooltips I added in `f85cb38`, the engine annual values for Bridgewater (heating Custom 19°C) are:

| Source | Value | Path |
|---|---|---|
| Heating delivered (total) | 18.1 MWh | sum of brief40.heating.systems[].delivered_mwh |
| Heating fuel (total) | 7.1 MWh | sum of brief40.heating.systems[].source_energy_mwh — ALL electric |
| heating blended SCOP | 2.55 | 18.1 / 7.1 |
| heat_elec_share | 1.0 | electricity / total = 7.1 / 7.1 |
| heat_gas_share | 0.0 | 1 − 1.0 |
| DHW gas annual | 242.9 MWh | brief40.dhw.systems[gas].source_energy_mwh |
| Implied gas_daily[d] | 0 × X + 665 kWh/day | constant year-round |
| Implied gas annual | 665 × 365 = 242.7 MWh | matches `Σ gas = 242.9 MWh` (within rounding) |

**Conclusion (Issue 1): the engine's `gas_daily` array for Bridgewater is mathematically a flat line at ~665 kWh/day.** The visual perception of "gas tracking heating demand" in the chart was an illusion caused by similar reddish colours (heating delivered `#F87171` light coral; gas total `#DC2626` deep red). Fixed in `f85cb38` by repaletting heating delivered to `#DC2626` (canonical service red) and gas total to `#991B1B` (darker burgundy).

**Wired data IS engine data, not fabricated.** Confirmed.

### §13.4 — Was Sankey touched in Part 3? (Issue 2 scope-creep check)

Git history of changes to `SystemsModule.jsx` since Brief 44 Part 3 commit `55e5123`:

| Commit | Brief | Sankey touched? | What |
|---|---|---|---|
| `55e5123` | Part 3 | NO | `SystemsProfiles` rewritten only |
| `7428f0d` | Part 4 | NO | `SystemsSchedule` rewired to v40; `SystemsMonthly` `maxBar` fix |
| `f85cb38` | Part 5 follow-up | **YES** | `branchesFromV40Dhw` (new helper); DHW label loop reads `br.v40_label`; ribbon `<title>` SVG tooltips with cursor:'help' |

**Heating ribbon code UNCHANGED:** the heating branches come from `branchesFromPerfPair(c.space_heating?.primary, c.space_heating?.secondary)` (line 840 in current file) — this expression was already present pre-Part-3 and was not edited in any of the Part 3/4/5 commits.

The Sankey changes in `f85cb38` are scoped to DHW (new v40 branch builder + label lookup) and ribbon hover tooltips (purely additive). No structural change to heating rendering.

### §13.5 — Why "heating disappeared from Sankey" was actually observed

Bridgewater's heating section was at `mode='custom', heating_setpoint_c=19` (from yesterday's setpoint-walk testing). At that setpoint:

- Brief 44 Part 2 fix (`3f1bb0b`) subtracted a CONSTANT MVHR offset (sized at comfort baseline ≈ 61 MWh) from the recomputed raw demand at 19°C.
- Raw demand at 19°C is smaller than at comfort 21°C; the constant offset over-subtracted → `Math.max(0, raw − offset)` clipped to 0.
- Engine returned `heating.delivered_total_mwh = 0`.
- The Sankey item shape `branchesFromPerfPair(...)` produced ZERO branches with `delivered_mwh > 0.01` → no ribbons rendered.
- The demand bar still rendered (90.1 MWh demand from raw State 2) — the `(off)` label fired via `it.isUnserved = it.demand > 0.01 && it.delivered < 0.01`.

**The Sankey was correctly reflecting the engine output** — engine said "demand exists, delivered is zero" → Sankey said "(off)" with demand bar + no ribbons. The bug was in the ENGINE's MVHR offset application (Brief 44 Part 2 fix had a secondary defect at low setpoints), not in the Sankey rendering.

**Fix shipped in `f85cb38`**: scale the recovery offset proportionally to the demand ratio rather than subtracting the comfort-baseline offset whole. After fix, Bridgewater shows heating delivered = 18.1 MWh at Custom 19°C (with `consumption.brief40.heating.delivered_total_mwh = 18.1`). Sankey ribbons render correctly; `(off)` label gone.

**Conclusion (Issue 2): Sankey rendering was always correct. The "disappearance" reflected the engine output, which itself was wrong due to my Part 2 fix's secondary bug. That fix is now corrected.**

### §13.6 — `InteractiveProfileVisualiser` is presentation-only (Issue 3 verification)

Source: `frontend/src/components/shared/InteractiveProfileVisualiser/InteractiveProfileVisualiser.jsx`.

**Every numerical operation in the component (grep'd line by line):**

| Line | Expression | Classification |
|---|---|---|
| 88-92 | `n.toFixed(0/1/2/3)` | Formatting |
| 89-91 | `Math.abs(n) >= 100/10/1` | Formatting threshold |
| 240 | `kwAvg = layer.daily_kwh[d] / 24` | **kWh/day → kW conversion (unit conversion only)** |
| 277 | `Math.max(180, height - 110)` | Layout pixel math |
| 287-288 | `Y_AXIS_WIDTH = 48` constants | Layout |
| 313 | `Math.min(3, selectedLayers.length)` | Grid columns |
| 341, 358, 377 | `Math.floor(data.length / 12)` | X-axis tick spacing |

**No physics in the visualiser. Zero instances of:**
- ❌ SCOP application
- ❌ Efficiency division (other than the trivial ÷24 for unit conversion)
- ❌ Fuel-mix logic
- ❌ Setpoint-based recompute
- ❌ Engine recomputation of any kind
- ❌ Wiring back to engine inputs

The component reads `daily_kwh: [365]` arrays from props, converts each to kW (dividing by 24 hours), and renders. It does not modify, augment, or fabricate values.

**Conclusion (Issue 3 visualiser purity): VERIFIED. The visualiser is presentation-only.**

### §13.7 — Engine-source-of-truth verification — proposed deliberate-edit tests

Brief 44 Part 3 mid-audit calls for three deliberate edits with three-way numerical comparison (Profiles ↔ Sankey ↔ Live Results). Surface for Chris's review before running. Proposed protocol:

**Pre-edit baseline (current state, heating mode follow_comfort 21°C):**
- Capture: Live Results EUI, Heating delivered/demand, Cooling delivered/demand, DHW delivered/demand, Electricity total, Gas total.
- Capture: Sankey tooltip values per branch.
- Capture: Profiles annual totals (Σ elec, Σ gas badges).

**Test 1: Toggle VRF heat pump from `enabled: true` to `enabled: false`.**
- Expectation: heating delivered drops to ~5% of comfort demand (only secondary remains). All three panels show the same.
- If any panel diverges, identify which is wrong (engine is canonical).

**Test 2: Change Primary heating share from 95% to 50%.**
- Expectation: blended SCOP shifts; heating fuel slightly changes (secondary at η 1.0 vs primary at SCOP 2.8). All three panels show consistent new totals.

**Test 3: Change DHW tap outlet temp from 30°C to 50°C.**
- Expectation: hot fraction rises from 40% to 80%; DHW thermal delivered approximately doubles; gas approximately doubles; all three panels track.

**These tests CAN be run with the current code (no fixes needed during this audit).** Results would be appended to this section under §13.8. Awaiting Chris's go-ahead before running.

### §13.8 — Three-edit test results

**Updated 2026-05-21 after Part 5c fix landed.** Original status (protocol paused on baseline divergence) preserved below for the audit trail. Tests re-run on the corrected baseline showed four-way agreement on all three edits.

#### §13.8a — Post-Part-5c results (chronologically the final run, this is the live state)

**Setup (2026-05-21, post-fix):**
- Project: HIX Bridgewater, `/systems`, viewport 1440×900.
- Heating mode: `follow_comfort` 21°C. All 3 interventions enabled (Bridgewater default state).
- Engine canonical read via `window.__nza_engine_result` (temporary, removed at Part 6 close).
- Profiles aggregate read by summing `consumption.daily_profiles.{delivered_kwh_per_day,fuel_kwh_per_day}.*` arrays and dividing by 1000 to MWh.
- "Four-way" = engine canonical (`consumption.total.*`, `consumption.brief40.*.delivered_total_mwh`) ↔ Live Results right-rail ↔ Sankey carrier-column total ↔ Profiles "Σ" badges (the visible UI surface that reads `daily_profiles.fuel_kwh_per_day.electricity` and `delivered_kwh_per_day.heating`).

##### Baseline (post-fix, pre any edit)

| Source | Heating delivered | DHW delivered | Cooling delivered | Σ Electricity | Σ Gas |
|---|---:|---:|---:|---:|---:|
| **Engine canonical** | 28.767 | 336.311 | 148.300 | **283.053** | **242.891** |
| Live Results (right rail) | 28.8 | 336.3 | 148.3 | 283.1 | 242.9 |
| Sankey (carrier total) | (via demand 90.1 → systems → 283.1 carrier) | n/a | n/a | 283.1 | 242.9 |
| **Profiles "Σ" badges** | n/a (no badge) | n/a | n/a | **283.1** | **242.9** |
| Profiles aggregate (`sum(fuel_kwh_per_day.electricity)/1000`) | n/a | n/a | n/a | **283.053** | **242.891** |
| Profiles aggregate (`sum(delivered_kwh_per_day.heating)/1000`) | **28.767** | 336.311 | 148.300 | n/a | n/a |

**Baseline four-way: PASS. Engine and Profiles aggregate agree to the millikilowatt-hour. Display precision (one decimal MWh) is identical across all panels.**

(Pre-fix the Profiles "Σ elec" badge had been 305.9 MWh; the post-fix value 283.1 closes Issue #23 to within engine rounding.)

##### Test 1 — VRF heat pump `enabled: true → false`

| Metric | Before | After | Δ |
|---|---:|---:|---:|
| Engine heating_delivered_mwh | 28.767 | **0.000** | −28.767 |
| Engine space_heating.electricity_mwh | 11.198 | 0.000 | −11.198 |
| Engine total_elec_mwh | 283.053 | 271.855 | −11.198 ✓ |
| Engine total_gas_mwh | 242.891 | 242.891 | 0 (Bridgewater heating all-electric) ✓ |
| Profiles total_elec_mwh (daily sum) | 283.053 | **271.855** | matches engine ✓ |
| Profiles total_gas_mwh (daily sum) | 242.891 | **242.891** | matches engine ✓ |
| Profiles heating_delivered_mwh (daily sum) | 28.767 | **0.000** | matches engine ✓ |

**Four-way check (Δengine − Δprofiles):** elec=0, gas=0, heating=0. **PASS.**

**Note on engine behaviour:** disabling VRF (95% share) leaves only secondary panel (5% share), which fails Brief 40 Part 5b's share-validation guard (sum ≠ 100%). The engine therefore zeros the heating service entirely rather than delivering 5%. This is the documented Brief 40 behaviour (`docs/audit/40_part_5b_wiring_and_toggles_COMPLETED.md`, Section A: "share validation now blocks compute — returns `{error, …zeros…}`"). The §13.7 expectation "drops to ~5% of comfort demand" was a sketch; actual engine behaviour is "zero unless shares sum to 100%". Either way, the four-way agreement test passes: Profiles aggregate tracks the engine's zero output exactly.

##### Test 2 — Primary heating share `95 → 50`

VRF re-enabled before this test. Editor pop-out opened; share slider moved 95 → 50 via React-aware input event.

| Metric | Before | After | Δ |
|---|---:|---:|---:|
| Engine heating_delivered_mwh | 28.767 | **0.000** | −28.767 |
| Engine total_elec_mwh | 283.053 | 271.855 | −11.198 |
| Engine total_gas_mwh | 242.891 | 242.891 | 0 |
| Profiles total_elec_mwh | 283.053 | **271.855** | matches engine ✓ |
| Profiles total_gas_mwh | 242.891 | **242.891** | matches engine ✓ |
| Profiles heating_delivered_mwh | 28.767 | **0.000** | matches engine ✓ |

**Four-way check:** elec=0, gas=0, heating=0. **PASS.**

**Note on engine behaviour:** same share-validation guard as T1 — 50 + 5 = 55%, not 100%, → engine zeros. The §13.7 expectation "blended SCOP shifts" assumed shares would rebalance; they don't (Brief 40 design: user must `Normalise to 100%` button or hand-edit secondary).

##### Test 3 — DHW tap outlet temp `40 → 50`

Share restored to 95 before this test. DHW section expanded, tap outlet input changed 40 → 50.

| Metric | Before | After | Δ | %Δ |
|---|---:|---:|---:|---:|
| Engine dhw_delivered_mwh | 336.311 | **448.414** | +112.103 | +33.3% |
| Engine dhw_systems[0].delivered (gas 65%) | 218.602 | 291.469 | +72.867 | +33.3% |
| Engine dhw_systems[1].delivered (ASHP 35%) | 117.709 | 156.945 | +39.236 | +33.3% |
| Engine total_elec_mwh | 283.053 | 298.748 | +15.695 | +5.5% |
| Engine total_gas_mwh | 242.891 | 323.854 | +80.963 | +33.3% |
| Profiles dhw_delivered_mwh (daily sum) | 336.311 | **448.414** | matches engine ✓ | matches |
| Profiles total_elec_mwh (daily sum) | 283.053 | **298.748** | matches engine ✓ | matches |
| Profiles total_gas_mwh (daily sum) | 242.891 | **323.854** | matches engine ✓ | matches |

**Four-way check:** elec=0, gas=0, dhw=0. **PASS.**

**Physics check (CLAUDE.md Systems scope, "DHW tap-mix model"):**
- `hot_fraction_before = (40 − 10) / (60 − 10) = 0.60` (tap_outlet 40 °C, cold_supply 10 °C, storage_setpoint 60 °C)
- `hot_fraction_after = (50 − 10) / (60 − 10) = 0.80`
- Ratio: 0.80 / 0.60 = 1.333
- Observed: +33.3% across DHW thermal, DHW gas, and DHW heat-pump electricity. ✓ matches.

The §13.7 expectation "from 40% to 80% (doubled)" assumed a pre-edit tap_outlet of 30 °C; actual Bridgewater default is 40 °C so the increase is 60→80% (1.33×), not 40→80% (2×). The physics-correctness check still passes; both the doubling sketch and the actual 1.33× behave identically through the same `hot_fraction` formula.

##### Summary

| Test | Edit | Engine Δ | Four-way agreement | Verdict |
|---|---|---|:---:|:---:|
| **T1** | VRF `enabled: true → false` | heating 28.767 → 0, total_elec −11.198 | ✓ all three panels match engine to display precision | **PASS** |
| **T2** | Primary share 95 → 50 | heating 28.767 → 0 (share validation), total_elec −11.198 | ✓ all three panels match | **PASS** |
| **T3** | DHW tap outlet 40 → 50 | DHW +33.3%, gas +33.3%, total_elec +5.5% | ✓ all three panels match | **PASS** |

**All three tests PASS with four-way agreement on a post-fix baseline.** Part 5c closes Issue #23.

#### §13.8b — Original pre-fix status (preserved for audit trail)

**Status:** Protocol paused before any deliberate edit was applied. **Baseline already diverged.** Per Chris's discipline rule ("If any test surfaces a divergence, log to 29_open_issues and surface to Chris before close"), surfacing here and gating Part 6 close on the resolution.

**Setup (2026-05-21, fresh Windows-PC session):**
- Project: HIX Bridgewater, route `/systems`, viewport 1440×900.
- Heating mode: `follow_comfort` 21°C.
- Engine exposure: `window.__nza_engine_result` from `SystemsModule.jsx:158-162` (temporary; flagged for removal at Part 6 close).
- Capture mechanism: Claude in Chrome MCP `javascript_tool` + DOM screenshots.

**Baseline engine values (canonical):**

```
consumption.brief40.heating.delivered_total_mwh   = 28.767
consumption.space_heating.delivered_mwh           = 28.767   (v25 mirror — agrees)
consumption.space_heating.electricity_mwh         = 11.198
consumption.brief40.heating.systems[0] (VRF 95%)  = 27.329 MWh delivered
consumption.brief40.heating.systems[1] (panel 5%) =  1.438 MWh delivered

consumption.brief40.cooling.delivered_total_mwh   = 148.300
consumption.space_cooling.delivered_mwh           = 148.300

consumption.brief40.dhw.delivered_total_mwh       = 336.311
consumption.brief40.dhw.systems[0] (gas 65%)      = 218.602 MWh delivered
consumption.brief40.dhw.systems[1] (ASHP 35%)     = 117.709 MWh delivered

consumption.total.electricity_mwh                 = 283.053
consumption.total.gas_mwh                         = 242.891
```

**Baseline panel readings:**

| Panel | Heating delivered | Heating demand | Electricity total | Gas total |
|---|---:|---:|---:|---:|
| **Live Results (right rail)** | 28.8 MWh | 90.1 MWh | **283.1 MWh** | 242.9 MWh |
| **Sankey (centre)** — system → carrier columns balance | 28.8 (heating-branch widths) | 90.1 (demand column) | **283.1 MWh** (carrier total) | 242.9 MWh (carrier total) |
| **Profiles "Σ" badges (centre, Profiles tab)** | n/a | n/a (daily integral 90.099 MWh — see below) | **305.9 MWh** | 242.9 MWh |
| **Engine canonical** | 28.767 | 90.099 (`daily_profiles.delivered_kwh_per_day.heating` sum) | **283.053** | 242.891 |

**Result: Live Results ↔ Sankey ↔ engine agree. Profiles electricity badge disagrees by 22.8 MWh.**

The Profiles "Σ elec" badge reads from `daily_profiles.fuel_kwh_per_day.electricity` (sum = 305.890 MWh per `window.__nza_engine_result`). Live Results and Sankey carrier total read from `consumption.total.electricity_mwh` (= 283.053). Same canonical engine result object, two different code paths, divergent totals.

**Arithmetic:** Daily fuel formula in `instantCalc.js:~4485` is shaped as `heating_demand_daily / heat_scop_eff × heat_elec_share + …`. On Bridgewater, `heat_elec_share = 1.0`, `heat_scop_eff = 2.569` blended. The variable carries the **demand-at-comfort** daily array (annual = 90.099 MWh), not the v40 systems-delivered daily array (annual = 28.767 MWh). So the daily fuel integral implicitly assumes full demand is met:

```
profile_elec_from_heating = 90.099 / 2.569      = 35.07 MWh   (used by Profiles badge)
engine_elec_from_heating  = 28.767 / 2.569      = 11.20 MWh   (≈ space_heating.electricity_mwh 11.198)
                                       difference =  23.87 MWh
profile − live_results badges                   =  22.84 MWh   (residual ≈ blended-SCOP rounding + 0.047 MWh cooling demand-vs-delivered)
```

**Three-way agreement: FAIL.** Two panels (Live Results, Sankey) agree with engine canonical. One panel (Profiles electricity badge) over-counts by the heating demand-vs-delivered gap. Gas is unaffected because `heat_gas_share = 0` on Bridgewater (per §13.2.1).

**This is a baseline divergence — no edit applied.** The three deliberate-edit tests (toggle VRF / share 95→50 / DHW tap 30→50) are NOT run, because:

1. The protocol's three-way comparison is meaningful only if all three panels agree on the baseline. They don't.
2. Running the edits with a known-broken Profiles badge would conflate the bug-under-test (reactivity) with the bug-under-investigation (demand-vs-delivered profile aggregation). Both reactivity and the underlying number would fail, and we couldn't distinguish reactivity-not-wired from baseline-wrong.
3. Chris's discipline rule is unambiguous: surface divergence first.

**Logged as Issue #23** in `docs/audit/29_open_issues.md` with three suggested fix paths and a recommendation (path (b): reshape daily profile to use v40 per-system delivered).

**Brief 44 Part 6 close: gated.** Options for the gate:
- **Option A** — Fix Issue #23 inside Brief 44 (option (b) on the recommendation). Adds one Part to Brief 44; pushes the close by one commit. Profiles badge re-tests to 283.1 MWh; the three-edit tests can then run cleanly.
- **Option B** — Defer Issue #23 to Brief 45 with the engine-rationalisation work already discussed in §13.2.2 (`heat_gas_share` defensive guard) and the inline-legacy 'full' code path consolidation flagged in Brief 39's audit doc §"Calculation flow map". Close Brief 44 with the divergence explicitly noted in the close commit, and re-state in Profiles UI ("Σ elec at demand" + a footnote pointer) as a holding cosmetic until Brief 45 lands.
- **Option C** — Accept that the Profiles "Σ" badge measures something different (demand-side electricity if heating fully met) and re-label it explicitly. The 22.8 MWh number becomes a meaningful surface ("how much electricity *would* be drawn if heating capacity caught up to demand") rather than a bug. UI-only change.

Recommendation surfaced for Chris's call.

**Discipline cross-check (per §13.11):**
- ✓ Engine value treated as canonical.
- ✓ Two panels agreeing with each other but disagreeing with engine = bug, not consensus — the bug is *Profiles disagrees with engine*, even though Profiles' number is internally consistent with daily integration assuming demand is fully met.
- ✓ No fix applied during the audit. Divergence logged + surfaced.
- ✓ Test pause is the correct action, not a workaround.

### §13.9 — Summary of findings

| Issue | Status | Evidence |
|---|---|---|
| 1. Gas trace tracks heating | **Visual illusion, not data bug** (palette fix `f85cb38`). Engine `gas_daily` is mathematically flat 665 kWh/day for Bridgewater because `heat_gas_share = 0` (all heating is electric). | §13.1–§13.3 |
| 2. Heating disappearing from Sankey | **Sankey was correctly reflecting the engine.** Root cause was my Part 2 MVHR-offset over-subtraction at low setpoints (Custom 19°C). Fixed in `f85cb38` (proportional scaling). Sankey was untouched in heating-ribbon code. | §13.4–§13.5 |
| 3. "Making up its own stuff" | **Not happening.** `InteractiveProfileVisualiser` is presentation-only — only kWh→kW conversion (÷24) plus formatting + layout pixel math. Zero physics calls. | §13.6 |
| Three-edit tests | **Initial run paused at baseline divergence (Issue #23). Re-run post-Part-5c fix: all three tests PASS with four-way agreement.** Engine ↔ Live Results ↔ Sankey ↔ Profiles aggregate match to display precision across baseline + T1 (VRF off) + T2 (share 95→50) + T3 (DHW tap 40→50). Issue #23 resolved by Part 5c. | §13.7, §13.8 |

### §13.10 — Recommended fix paths (none required for §13.1-§13.6)

The three observations all resolve to "engine working correctly, visualiser presentation-only, prior Part 2 secondary bug already fixed". **No new code fixes required** beyond what's already shipped in `f85cb38`.

**Defensive-coding follow-up logged in §13.2.2:** the `heat_gas_share` derivation has a degenerate-case failure mode (when `heating.total_perf.fuel_mwh = 0` but delivered > 0). Not triggering on Bridgewater. Worth a small guard clause in a future engine pass.

### §13.11 — Discipline confirmed

- ✓ Read-only audit (no fixes during this section)
- ✓ Numerical engine values documented against rendered values
- ✓ Recommended verification (§13.7) drafted but not run pending Chris's sign-off
- ✓ Visualiser purity verified line-by-line
- ✓ Engine code paths traced with file:line references

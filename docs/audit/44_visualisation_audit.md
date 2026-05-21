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

## §8 — Part 2 — Fixes + falsifiability (placeholder, filled in Part 2)

To be filled.

---

## §9 — Part 3 — Profiles rebuild (placeholder)

To be filled.

---

## §10 — Part 4 — Reactivity, Monthly, Schedule (placeholder)

To be filled.

---

## §11 — Part 5 — Cross-module rollout (placeholder)

To be filled.

---

## §12 — Part 6 — Walkthrough (placeholder)

To be filled.

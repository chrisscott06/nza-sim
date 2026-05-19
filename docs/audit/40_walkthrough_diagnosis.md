# Brief 40 — Walkthrough diagnosis (Part 5 → Part 6 pause)

**Status:** Diagnostic-only read. No code changes. Brief 40 stays paused at end-of-Part-5 (commit `71598d1`) until the design questions below are resolved.

**Linked work:**
- Walkthrough screenshot capture: HIX Bridgewater Systems module at 2026-05-19, post-Part-5 commit
- Brief 40 brief: [`docs/briefs/active/40_systems_library_architecture.md`](../briefs/active/40_systems_library_architecture.md)
- Schema reference: [`40_systems_library_schema.md`](40_systems_library_schema.md)
- Engine: `frontend/src/utils/systemsEngine.js` (Part 2)
- UI: `frontend/src/components/modules/SystemsModule.jsx` left panel + `systems/SystemEditorCard.jsx` + `systems/AddSystemButton.jsx` + `systems/SystemsDiagnosticPanel.jsx` (Part 3)
- Migration: `scripts/40_bridgewater_systems_migration.py` (Part 5)

---

## 1. Walkthrough observations (Chris, 2026-05-19)

From the Systems module screenshot:

1. **Heating shares = 90%, not 100%.** Validation warning visible inline ("Shares sum to 90.0%, not 100%"). Engine should be refusing to compute or escalating but is serving 90% of demand silently.
2. **DHW left panel shows 1 system (Gas combi / boiler 85% gas η 0.85)** with a share-mismatch warning. The right-column Live Results shows DHW **373.7 MWh** and the Sankey shows "Gas boiler 90% eff" serving DHW. The right-column numbers are the v25 path output, not v40.
3. **EUI 116.9 kWh/m²·yr unchanged** from pre-Brief-40. Bridgewater's headline number didn't move post-Brief-40.

Chris's hypothesis on entering the diagnostic: "migration didn't fire, Bridgewater is still on systems_config_v25, the new UI section list correctly shows '(empty)' for sections where v40.{service} is empty, but the engine + Live Results + Sankey are reading v25 because that's what's in the project."

---

## 2. Evidence — actual `systems_config_v40` on disk

Read directly from `data/nza_sim.db` for project "HIX Bridgewater":

| Service | v40 contents on disk | Migration would have produced |
|---|---|---|
| `heating` | **1 system** — "Air-source heat pump", share 90, source ambient_air, eff **2.8** | 2 systems — VRF heat recovery (5.12, share 95) + electric panel (1.0, share 5) |
| `cooling` | **key absent from dict** (not even `[]`) | 1 system — VRF heat recovery (3.51, share 100) |
| `dhw` | **1 system** — "Gas combi / boiler", share 85, source gas, eff 0.85 | 2 systems — gas_boiler_calorifier (0.90, share 80) + ashp_dhw_preheat (3.0, share 20), with tap-mix fields populated |
| `ventilation` | **1 system** — "MEV (extract only)", share 100, source electricity, SFP 1.5, recovery 0% | 3 systems — mvhr_gf_public + bedroom_extract + public_toilet_extract with real flow rates from v25 |
| `lighting` | **1 system** — "Lighting (daylight dimming)", share 100, control_factor 0.70 (from `LIGHTING_CONTROL_FACTOR_DEFAULTS`) | 1 system — default thin entry from `DEFAULT_PARAMS` (constant, factor 1.0) |
| `small_power` | **key absent from dict** | 1 system — default thin entry from `DEFAULT_PARAMS` (constant, factor 1.0) |
| `library_systems` | **0 entries** | irrelevant (Library save/load is Part 3 UI; migration script doesn't write to it) |

### What this state actually represents

This is **the result of manually testing the AddSystemButton UI** — NOT the output of `scripts/40_bridgewater_systems_migration.py`. The evidence:

- Each present heating / DHW / ventilation / lighting entry exactly matches an **AddSystemButton archetype** from `BLANK_ARCHETYPES`:
  - Heating "Air-source heat pump" → `{ key: 'ashp', label: 'Air-source heat pump', source: 'ambient_air', efficiency_metric: 3.0 }` (eff edited from 3.0 → 2.8 via UI slider; share edited from 100 → 90)
  - DHW "Gas combi / boiler" → `{ key: 'gas_boiler', label: 'Gas combi / boiler', source: 'gas', efficiency_metric: 0.85 }` (share edited from 100 → 85)
  - Ventilation "MEV (extract only)" → `{ key: 'mev', label: 'MEV (extract only)', source: 'electricity', sfp 1.5, recovery 0 }`
  - Lighting "Lighting (daylight dimming)" → `{ key: 'dimming', label: 'Lighting (daylight dimming)', control_factor: 0.70 }`
- Migration script's labels would have been `"Primary heating (vrf_heat_recovery_dual_function)"` etc — none match
- Migration script always produces secondary system at the residual share (Bridgewater heating would land at `[95, 5]`, not `[90]`); migration would produce per-fuel DHW (gas + heat_pump from v25 fuel_mix), not a single gas entry at 85
- `cooling` and `small_power` keys are **entirely absent** from the persisted dict (not even empty arrays). This is impossible if migration ran (the script writes the full 6-service shape). It IS possible if Chris added entries to four services via the UI and the updateParam path only wrote the touched keys

**Conclusion on Chris's hypothesis Q1:** Confirmed. **Migration script did not run.** Bridgewater's v40 state is manual UI test data from Part 3's AddSystemButton flow.

---

## 3. Engine routing — the deeper finding

### 3.1 How the engine actually wires v25 and v40

`_calculateState3` (`frontend/src/utils/instantCalc.js` ~line 4010) is the State 3 entry point. Two paths execute in parallel:

```
                            _calculateState3()
                                    │
            ┌───────────────────────┼────────────────────────┐
            │                                                │
   v25 path (Brief 28f shape)              v40 path (Brief 40 array shape)
            │                                                │
   computeServiceEnergy(sys.heating, ...)    computeSystemsDelivered({
   computeServiceEnergy(sys.cooling, ...)        building,
   computeDhwFuelMix(sys.dhw, ...)               state2Result,
   computeVentilationEnergy(sys.ventilation,..)  comfortBand,
            │                                    state2Recompute,
            ▼                                  })
   consumption.space_heating = {primary, secondary, ...}     │
   consumption.space_cooling = {primary, secondary, ...}     ▼
   consumption.dhw           = {primary, secondary, ...}     consumption.brief40 = {
   consumption.ventilation   = [{...}, {...}, ...]               heating: {systems:[...]},
   consumption.lighting      = {electricity_mwh: ...}            cooling: {systems:[...]},
   consumption.small_power   = {electricity_mwh: ...}            dhw:     {systems:[...]},
   consumption.total         = {eui, fuel_split, ...}            ventilation:{systems:[...]},
                                                                  ...
                                                                  totals: {eui, fuel_split, carbon}
                                                              }
            │                                                │
            ▼                                                ▼
   Consumed by:                                Consumed by:
   - SystemsSankey (centre default tab)        - Diagnostic centre tab (Part 3)
   - LiveResultsStrip (right column top)         (SystemsDiagnosticPanel.jsx)
   - LiveResultsPanel (right column body)      - Left-panel InputsColumn per-card
   - Headline EUI 116.9 kWh/m²·yr                diagnostic (SystemEditorCard's
   - Fuel split bars (electricity 172.9 MWh,     `engineSystem` prop)
     gas 332.2 MWh)
   - DHW 373.7 MWh, etc — every right-column
     and Sankey number Chris sees in the
     screenshot
```

**v25 and v40 coexist on the same engine return.** This is exactly what Part 2's commit message + audit doc §6 said:

> "Coexists with the existing computeServiceEnergy / computeDhwFuelMix / computeVentilationEnergy paths. When building.systems_config_v40 is absent or has only empty service arrays, computeSystemsDelivered returns null and the caller falls back to the existing path — no behaviour change for unmigrated projects."

What the coexistence pattern actually means: **even when v40 IS populated, the v25 path still runs in parallel, and the existing consumers continue to read v25 output.** v40 doesn't *displace* v25; it ADDS a sibling block (`consumption.brief40`) that two specific Brief 40 UI surfaces consume.

### 3.2 The consequence

The DHW tap-mix correction (`_computeDhw` in `systemsEngine.js`) ONLY affects `consumption.brief40.dhw.demand_at_comfort_mwh`. It does NOT touch `consumption.dhw.demand_mwh` — which is computed by the unchanged v25 path:

```js
// instantCalc.js _calculateState3 lines 3967-3973 — UNCHANGED by Brief 40
const dhw_kwh_per_person_hour = dhwKwhPerPersonHour(
  sys.dhw?.litres_per_person_per_day,
  sys.dhw?.store_temperature_c,
  sys.dhw?.cold_mains_temperature_c,
)
const dhw_demand_kwh = annual_occupant_hours * dhw_kwh_per_person_hour
const dhw_demand_mwh = dhw_demand_kwh / 1000
```

Bridgewater's headline DHW number (373.7 MWh in the screenshot) is `annual_occupant_hours × dhwKwhPerPersonHour(80, 60, 10)` — the pre-Brief-40 formula. No tap-mix multiplier. **The 40% reduction Chris expected can never appear in the headline EUI under this coexistence design.**

Same logic for heating + cooling + ventilation: their headline numbers come from v25 paths that don't read `systems_config_v40` at all.

### 3.3 Why this matters for the walkthrough's expected behaviour

The brief Part 5's expected-movement table (audit doc §8) assumes the engine switches to v40 after migration:

> "DHW thermal: Expected ~40% reduction from tap-mix correction"
> "Total EUI: Expected ~5–8% reduction — net of the DHW thermal correction (only line item with a deliberate physics change)"

These expectations require v40 to **drive** the headline numbers when populated. The current implementation keeps v25 in the driver's seat and surfaces v40 in two side surfaces (Diagnostic tab + left-panel cards). The walkthrough surfaces this gap.

**This is a Brief 40 Part 2 design choice that the walkthrough tests revealed needs re-examining.** It's not a bug per se — the code does what the audit doc said it would do. It's that what Part 2 said it would do is incompatible with what Part 5's walkthrough expectations require.

---

## 4. Share-validation handling — secondary finding

`systemsEngine.js _validateShares` returns `false` when a service's `share_pct` sum is more than 0.5pp off from 100. `_computeHeatingOrCooling` then short-circuits:

```js
// systemsEngine.js lines 132-140
if (!_validateShares(systems)) {
  return {
    demand_at_comfort_mwh: round_mwh(demandAtComfortMwh),
    delivered_total_mwh:    0,
    blended_efficiency:     null,
    systems:                [],
    validation_error: `share_pct does not sum to 100 for service '${service}'`,
  }
}
```

The validation_error string is set on the returned block. **No consumer surfaces this string.** The SystemEditorCard reads its per-system entry from `engineSystem` (looked up by id from `brief40.{service}.systems[]`); when systems is empty, every card's engineSystem is null and no diagnostic block renders. The SystemsDiagnosticPanel iterates `brief40[service]` per service but doesn't check for `validation_error`.

Result: the share warning is UI-only (in the section header + card chrome). The engine "accepts" 90% silently in the sense that:
- v40 path returns `{ systems: [], delivered = 0 }` for heating — invisible
- v25 path computes heating from its own primary/secondary structure, oblivious to v40 shares — drives the 175.1 MWh in Chris's screenshot
- Headline EUI unaffected

There IS an inline UI warning ("⚠ Shares sum to 90.0%") + a "Normalise" quick-fix in the new left panel, so the user *can* see the problem. But the brief Part 2 step 2.2 wording ("engine validation; UI prevents") could be read as expecting the engine to refuse to produce output that consumers display — and currently the v25 path keeps producing output regardless.

---

## 5. DEFAULT_PARAMS load-fallback — tertiary finding

ProjectContext load path (line ~653):

```js
systems_config_v40: bc.systems_config_v40 ?? DEFAULT_PARAMS.systems_config_v40,
```

The `??` fallback fires only when `bc.systems_config_v40` is `undefined` or `null`. Once bc has v40 populated (even partially via UI edits), the DEFAULT_PARAMS seed for lighting + small_power doesn't re-apply.

Evidence: Bridgewater's v40 has `cooling` and `small_power` keys **entirely absent** from the persisted dict. If the DEFAULT_PARAMS fallback had fired on every load, these keys would always be present (as empty arrays + thin defaults respectively). They're absent because Chris's UI interactions wrote the four touched services via `updateParam('systems_config_v40', ...)` and the resulting persisted blob only contained those four keys.

Result: a user who touches v40 at all loses the lighting + small_power thin-entry seeds unless those services are touched too. Bridgewater currently has lighting (because Chris added one manually) but no small_power.

---

## 6. Why the right-column + Sankey numbers don't move

Putting findings 2–5 together:

| Observation | Explanation |
|---|---|
| EUI 116.9 kWh/m²·yr unchanged | Headline EUI comes from v25 `consumption.total.kwh_per_m2_yr` (line 4101 in `_calculateState3`). v25 path is unchanged by Brief 40. Coexistence design means v40 doesn't displace it. |
| DHW 373.7 MWh in right-column Live Results | That figure is `consumption.dhw.delivered_mwh` from the v25 path's `computeDhwFuelMix` output. The DHW tap-mix correction only affects `consumption.brief40.dhw.demand_at_comfort_mwh`, which no headline consumer reads. |
| Sankey shows "Gas boiler 90% eff" for DHW | Sankey reads `consumption.dhw.primary` + `.secondary` from the v25 path's `computeServiceEnergy`. v40's per-system breakdown isn't wired into the Sankey. |
| Heating shares 90% silently accepted | v25 path's heating doesn't know about v40 shares. v40 path returns empty heating block on validation failure. No consumer surfaces v40's `validation_error`. The Sankey's heating number (175.1 MWh) is v25 unchanged. |
| Heating Sankey shows VRF heat recovery + Electric panel heater | Read from v25's `consumption.space_heating.primary.fuel` + `.secondary.fuel` library_ids. Bridgewater's v25 heating block was never touched by Chris's UI edits (the UI writes to v40, not v25). So v25 still has the correct VRF + electric primary/secondary pair from pre-Brief-40 setup. |

---

## 7. Design question for Part 5b / Part 2 follow-up

The walkthrough surfaces that **Brief 40's value proposition only lands if v40 displaces v25 for the affected services**. The coexistence design (Part 2 as shipped) preserves v25 behaviour exactly — including the absence of the DHW tap-mix correction in the headline.

Three options for the displacement:

### Option A — engine-side swap (v40 displaces v25 when populated)

When `building.systems_config_v40.{service}` is non-empty, the engine populates `consumption.{service-block}` from v40 instead of v25. The v25 path either: (a) doesn't run for that service, or (b) runs and the result is discarded for that service.

- **Pros:** clean displacement; no new consumer plumbing; existing Sankey + Live Results + headline EUI all see v40 numbers automatically; DHW tap-mix correction surfaces in the headline as expected
- **Cons:** the v25 → v40 shape translation needs to happen at the consumer-shape boundary (existing consumers read `{ primary, secondary }` blocks; v40 systems are an N-system array). Mapping N systems back to `primary`/`secondary` is lossy if N > 2; mapping to a totals-only block changes what the Sankey can render
- **Effort:** moderate — adapter layer in `_calculateState3` that, when v40 is populated, runs `computeSystemsDelivered` and produces the v25-shaped consumption block from the v40 totals + first-two-systems

### Option B — consumer-side swap (Sankey + Live Results read v40 when populated)

`SystemsSankey`, `SystemsLiveResultsStrip`, `LiveResultsPanel`, headline EUI all gain logic: if `consumption.brief40` is non-null AND populated for this service, read v40 totals; else read v25 block.

- **Pros:** engine code stays exactly as Part 2 shipped; the displacement is at each consumer's read site
- **Cons:** every consumer needs updating; Sankey's `primary`/`secondary` ribbon-rendering would need to handle 1-or-N systems instead of always 2; per-system fuel split + efficiency become per-N sums; risk of v25 ↔ v40 read paths drifting over time (same Pattern C drift risk Rule 14 warns about for envelope physics, now in the consumption layer)
- **Effort:** higher — many surfaces to touch

### Option C — explicit v25/v40 mode toggle

Keep coexistence; add a UI toggle ("Show legacy v25 / Show Brief 40 v40") that swaps which consumption block the headline reads.

- **Pros:** zero engine changes; transparent to user which path drives the headline; clean migration story (user can compare before/after)
- **Cons:** transitional design — once Brief 40 is the canonical path the toggle goes away anyway; adds UI clutter for a temporary state

### Recommendation

**Option A** (engine-side swap) is structurally closest to what every other migration in this project has done (Brief 28f v25 displaced legacy `systems_config`; Brief 38 polish primary/secondary displaced single-system shape; Brief 42 per-opening cd/flow_mode displaced building-wide). The pattern: when the new shape is present, it drives the canonical consumer surfaces; the old shape is read only as a migration-bridge fallback.

The adapter layer for Option A is small (the v40 → v25-block translation only needs to compute `primary` and `secondary` from the first two v40 systems + roll the per-fuel splits + per-totals to match `consumption.{service-block}`'s shape). The 1-or-N→2 lossiness is acceptable for the Sankey (the Sankey always rendered 2-ribbon dual systems anyway; for N > 2 the Sankey could show the first two as primary + "Other N-2 systems"; for N == 1 secondary = null).

---

## 8. Pre-condition for Part 6 close

Walkthrough cannot pass with the current architecture because the DHW tap-mix expected reduction (~40%) and EUI expected reduction (~5–8%) require v40 to displace v25 in the headline. Walkthrough sign-off on these movements is the brief Part 5 gating condition for Part 6 close.

Two paths from here:

### Path 1 — design + implement displacement (Option A above)

1. Re-open Brief 40 from Part 5b (a corrective fix). Land the engine-side adapter (`_calculateState3` checks `building.systems_config_v40` per service; when non-empty, runs v40 path and writes its output to the v25-shape consumption block).
2. Then re-run migration to populate Bridgewater's v40 with the correct shape (not the manual-test state currently on disk).
3. Then re-walk the 10-step checklist with the displacement live.
4. Then Part 6 close.

Estimated scope: medium. ~150 lines of new adapter code in `_calculateState3` + updates to consumption block shape compatibility + audit doc §6 update + audit doc §8 expectations now achievable + new STATUS entries. Two commits (Part 5b code + Part 6 close).

### Path 2 — descope Brief 40

Acknowledge that Brief 40 as implemented delivers the per-system *editor* but not the *displacement* of the headline numbers. The DHW tap-mix correction lives in `consumption.brief40.dhw` and is visible in the Diagnostic tab but doesn't move the EUI. This is honest but reduces the brief's value vs the original target outcome.

Estimated scope: small. Just rewrite Part 5's expected-movement table in audit doc §8 to set expectations correctly ("no headline movement; tap-mix correction visible in Diagnostic tab only"). Part 6 close as planned.

### Recommendation

Path 1. Brief 40's target outcome explicitly includes "the DHW tap-mix model corrects the current overestimate" — that overestimate is in the headline EUI today, and Brief 40 should fix it in the headline. Otherwise the brief has shipped 1290 lines of engine + UI for a diagnostic side-panel that doesn't move the number the user cares about.

---

## 9. Migration script — secondary fix

Independent of the Path 1/2 decision: Bridgewater's current `systems_config_v40` is manual UI test data, not migration output. Before Path 1's re-walkthrough (or even just to verify Path 2's expectations), the migration script needs to actually run. Currently:

- Chris's UI test edits sit at `data/nza_sim.db` → projects → "HIX Bridgewater" → building_config.systems_config_v40
- Running `scripts/40_bridgewater_systems_migration.py` from this state would HIT the idempotency check (`_is_already_migrated` returns true when any of heating / cooling / dhw / ventilation has a non-empty array) and skip the project entirely

Two ways out:
- **Add a `--force` flag** to the migration script that overrides the idempotency check
- **Manually clear** Bridgewater's `systems_config_v40` (set heating + cooling + dhw + ventilation to `[]` via SQLite update or the API) then re-run migration

The `--force` flag is the cleaner ship — same pattern as the Brief 41 + Brief 42 migration scripts could adopt for safety. Belongs in the Part 5b corrective commit (or a Path 2 fix-up commit).

---

## 10. Summary

| # | Finding | Severity | Where it lives |
|---|---|---|---|
| 1 | Migration script never ran; Bridgewater's v40 state is manual UI test data | High — blocks walkthrough sign-off until migration actually runs | DB state, not code |
| 2 | v40 doesn't displace v25 for the Sankey + Live Results + headline EUI; DHW tap-mix correction never surfaces in the headline | **Critical — this is the deeper finding the walkthrough revealed.** Brief 40's value proposition requires v40 displacement, but Part 2 shipped coexistence | `_calculateState3` in `instantCalc.js` — Part 2 design choice |
| 3 | Share-validation failure swallowed silently (validation_error string set but no consumer surfaces it; v40 returns empty systems while v25 keeps driving the headline number) | Medium — UI shows warning, headline still correct from v25, but engine-side error path is dead | `_computeHeatingOrCooling` + `_computeDhw` in `systemsEngine.js` |
| 4 | DEFAULT_PARAMS load-fallback is whole-object level; once v40 exists in bc, the lighting + small_power thin-entry seeds don't re-apply | Low — minor; new-project flow works; user-touched-then-load loses defaults | `ProjectContext.jsx` line ~717 |
| 5 | Migration script idempotency check has no `--force` override; can't re-migrate a project once it has any v40 content (incl. manual UI edits) | Low — operational; not a bug per se, just inconvenient | `scripts/40_bridgewater_systems_migration.py` `_is_already_migrated` |

### Recommended next move

**Path 1, Part 5b — engine-side v40 displacement of v25 (Option A above) + `--force` migration flag + Bridgewater re-migration.**

Brief 40 stays paused at `71598d1` until Path 1/2 decision lands. Once authorised, Part 5b is a single corrective commit; Part 6 close follows the re-walkthrough.

---

## Sign-off

- [x] Diagnostic read complete, no code changes
- [x] Findings logged with severity + location
- [x] Path 1 decision authorised by Chris (Part 5b corrective + enable toggles)
- [x] Part 5b Section A landed (this commit — engine displacement + share validation blocks compute + --force migration flag)
- [ ] Part 5b Section B (enable toggles)
- [ ] Part 5b Section C (browser walkthrough)
- [ ] Part 5b close
- [ ] Brief 40 Part 6 close

---

## 11. Part 5b Section A — engine-side displacement landed

**Files touched:**
- `frontend/src/utils/systemsEngine.js` — `_enabledSystems` helper; share validation operates on enabled systems and returns `error` field on failure; `computeSystemsDelivered` accepts `heatingDemandOverrideMwh`; new exports `v40ServiceBlockToV25Shape`, `v40VentilationToV25List`, `v40ThinBlockToKwh`
- `frontend/src/utils/instantCalc.js` `_calculateState3` — v40 displacement wired per service (heating / cooling / DHW / ventilation / lighting / small_power); v40 ventilation routes through `computeVentilationEnergy` via the v25-list adapter so Brief 28j hourly recovery cap math is preserved; lighting + small_power displacement via `v40ThinBlockToKwh`; `dhw_demand_displayed_mwh` surfaces the tap-mix-corrected demand when v40 is in play; `source_path` metadata attached to consumption block
- `scripts/40_bridgewater_systems_migration.py` — `--force` flag

**Per-service displacement summary:**

| Service | Pre-Part-5b headline | Post-Part-5b headline when v40 populated |
|---|---|---|
| Heating | v25 `computeServiceEnergy(sys.heating, ...)` (Brief 28f primary/secondary path) | v40 `_computeHeatingOrCooling` → `v40ServiceBlockToV25Shape` produces matching primary/secondary contract; existing Sankey + Live Results render unchanged shape with v40 numbers |
| Cooling | Same pattern as heating | Same pattern |
| DHW | v25 `computeDhwFuelMix` reads `dhw_demand_mwh` (pre-tap-mix) | v40 `_computeDhw` produces tap-mix-corrected `demand_at_comfort_mwh`; `dhw_demand_displayed_mwh` swaps in; headline DHW thermal × hot_fraction (~0.60 for Bridgewater hotel defaults) |
| Ventilation | v25 `computeVentilationEnergy(sys.ventilation, ...)` with Brief 28j hourly recovery cap | v40 systems mapped to v25-list shape via `v40VentilationToV25List`; passed through unchanged `computeVentilationEnergy` so recovery cap math preserved; per-system fan + recovery unchanged numerically when v25 ↔ v40 mappings produce equivalent inputs |
| Lighting | `state2Result.heat_balance.annual.gains.internal.lighting.kwh` (1:1 gain pass-through) | `v40ThinBlockToKwh` × control_factor × share/100; when control_factor 1.0 result is identical to v25; when control_factor 0.70 (daylight dimming) result drops by 30% |
| Small power | Same pattern as lighting | Same pattern |

**Share-validation now blocks compute:**
- v40 `_computeHeatingOrCooling` / `_computeDhw` / `_computeVentilation` / `_computeThin` filter enabled systems first, then validate sum(enabled.share_pct) === 100 within ½pp tolerance
- Validation failure → block returns `{ error: '...', systems: [], delivered_total_mwh: 0 }`
- `v40ServiceBlockToV25Shape` propagates the error field; consumption.{service} carries `error` + zero numbers
- Headline EUI drops by the service amount; user sees the existing share-mismatch warning in the left panel; the connection between "warning visible" and "number dropped" is now causal not advisory

**--force migration flag:**
- `python scripts/40_bridgewater_systems_migration.py --force` overwrites any existing `systems_config_v40` on a project
- Bridgewater's current manual-test v40 state (ASHP 90% / gas boiler 85% / MEV 100% / dimming 100%) will be replaced with the migrated shape (2 heating systems + 1 cooling + 2 DHW + 3 ventilation) on first --force run
- Lighting + small_power preserved (these come from Part 4 DEFAULT_PARAMS fallback, not v25 migration source)

**Build:** clean, 9.98 s, 2.53 MB JS (gzip 704 kB).

**Browser verification deferred to Section C** (Brief 40 Part 5b Principle 5 — mandatory real-browser walkthrough, not code-side reasoning). Section C executes the 15-item walkthrough via Claude in Chrome MCP and captures pass/fail per item in this doc.

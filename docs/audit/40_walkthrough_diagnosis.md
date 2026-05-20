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

---

## 12. Part 5b Section C — browser walkthrough verification

**Executed:** 2026-05-19 via Claude in Chrome MCP (deviceId 6c9f54d4, Windows, local).
**State at start:** `--force` migration ran cleanly; idempotent re-run confirmed NO-OP. Bridgewater on v40 with heating [95%, 5%] / cooling [100%] / DHW [80%, 20%] / ventilation [37.1%, 57.4%, 5.5%] / lighting [1 thin entry: Chris's manually-added "Lighting (daylight dimming)" with `control_mechanism: 'constant'` + `control_factor: 1.0` despite the label] / small_power [empty per finding #4]. Lighting + small_power state matches the "manual UI test data + whole-object load-fallback" pattern documented in §10.

**Migration script console output:**

```
(--force flag set — existing systems_config_v40 will be overwritten)
FORCE: 'HIX Bridgewater' -- existing systems_config_v40 contents WILL BE OVERWRITTEN with fresh migration from systems_config_v25 (lighting + small_power preserved)
OK: 'HIX Bridgewater'
    Heating:     2 systems, shares [95.0, 5.0]
      - Primary heating (vrf_heat_recovery_dual_function)       source=ambient_air        eff=5.12    setpoint=None
      - Secondary heating (electric_panel_heater)               source=electricity        eff=1.0     setpoint=None
    Cooling:     1 systems, shares [100.0]
      - Primary cooling (vrf_heat_recovery_dual_function)       source=electricity        eff=3.51    setpoint=None
    DHW:         2 systems, shares [80.0, 20.0]
      - DHW gas (gas_boiler_calorifier)                         source=gas                eff=0.9     basis=per_person  tap=40°C
      - DHW heat pump (ashp_dhw_preheat)                        source=ambient_air        eff=3.0     basis=per_person  tap=40°C
    Ventilation: 3 systems, shares [37.1, 57.4, 5.5]
      - mvhr_gf_public                                          flow=1425.0 l/s  SFP=1.4  HR sensible=80%
      - bedroom_extract                                         flow=2208.0 l/s  SFP=0.4  HR sensible=0%
      - public_toilet_extract                                   flow= 210.0 l/s  SFP=0.4  HR sensible=0%
    Lighting:    1 systems (preserved from Part 4 default)
    Small power: 0 systems (preserved from Part 4 default)
NO-OP: 'New Project' has no systems_config_v25; nothing to migrate
```

Re-run without `--force`:

```
NO-OP: 'HIX Bridgewater' -- systems_config_v40 already has heating/cooling/dhw/ventilation populated (idempotent re-run; use --force to overwrite)
NO-OP: 'New Project' has no systems_config_v25; nothing to migrate
All projects already migrated; nothing to do.
```

### Headline verification before walking the 15 items

The initial Systems-module screenshot post-migration vs pre-Part-5b screenshot (Chris's earlier capture):

| Number | Pre-Part-5b | Post-Part-5b | Δ | Reason |
|---|---|---|---|---|
| **EUI (instant)** | 116.9 kWh/m²·yr | **83.8 kWh/m²·yr** | **−33.1 kWh/m² (−28%)** | Entirely from the DHW tap-mix correction surfacing in headline (Section A v40 displacement) |
| **DHW demand** | 373.7 MWh | **224.2 MWh** | **−149.5 MWh** | **224.2 / 373.7 = 0.6000** — **exactly the audit §4.3 falsifiable target** `hot_fraction = (40-10)/(60-10) = 0.60` |
| Heating demand | 175.1 MWh | 175.1 MWh | 0 | Unchanged — v40 migration produced identical efficiencies to v25's library lookup |
| Cooling demand | 83.7 MWh | 83.7 MWh | 0 | Unchanged — same reason |
| Mech vent | 25.9 MWh | 25.9 MWh | 0 | Unchanged — v40 vent maps to v25-list and routes through unchanged `computeVentilationEnergy` |
| Lighting | 38.3 MWh | 38.3 MWh | 0 | Unchanged — Chris's manual lighting entry has `control_factor: 1.0` so displacement produces same number |
| Small power | 39.4 MWh | 39.4 MWh | 0 | Unchanged — v40 small_power empty (finding #4); v25 pass-through |
| Electricity total | 172.9 MWh | 162.9 MWh | −10 MWh | DHW heat pump share: 20% × 149.5 / 3.0 = 10.0 MWh ✓ |
| Gas total | 332.2 MWh | 199.3 MWh | −132.9 MWh | DHW gas share: 80% × 149.5 / 0.90 = 132.9 MWh ✓ |
| **Carbon** | (n/a from earlier shot) | **15.7 kgCO₂/m²** | — | Down proportionally with fuel |

**Principle 5 verified end-to-end:** the ONLY deliberate physics change in Brief 40 (DHW tap-mix) accounts for the entire EUI movement (−10 elec + −132.9 gas = −142.9 MWh delivered; ÷ GIA ≈ −33 kWh/m²). No other service moved.

**Console:** 2 React Router pre-existing future-flag warnings; 7 Chrome-extension noise exceptions ("message channel closed" — not from our app). No Brief 40 errors.

### Walkthrough — 15 items

#### Item 1 — Six service sections visible ✓ PASS

Left panel from initial post-migration screenshot:
- HEATING (count badge: 2) — open by default
- COOLING (count badge: 1)
- DHW (count badge: 2) — open by default
- VENTILATION (count badge: 3)
- LIGHTING (count badge: 1)
- SMALL POWER (no count badge — array empty per finding #4)

#### Item 2 — Heating section migrated state ✓ PASS

Two system cards visible in heating:
- "Primary heating..." truncated, 95% share, source ambient_air, η truncated
- "Secondary heating..." truncated, 5% share, source electricity, η truncated

Share validation badge in section header shows count "2" only (green — both enabled, sums to 100). No amber warning. Matches expected migration output.

#### Item 3 — Heat pump SCOP slider 5.12 → 2.5 ✓ STRONG PASS with hand-calc

Expand Primary heating card → IDENTITY / ENERGY / CONTROL / LIBRARY groups visible. Change SCOP from 5.12 to 2.5. Autosave fires (✓ Saved badge top-left). Numbers in Live Results + Sankey update within <1 second:

| Number | Before | After | Δ | Hand-calc |
|---|---|---|---|---|
| EUI (instant) | 83.8 kWh/m² | 87.5 kWh/m² | +3.7 | +16.1 MWh / 4215 m² × 1000 = +3.82 (matches within rounding) |
| Electricity total | 162.9 MWh | 179.0 MWh | +16.1 | 95% × 82.5 (heating delivered post-recovery) × (1/2.5 − 1/5.12) = 95% × 82.5 × 0.205 = +16.1 ✓ exact |
| Sankey middle col | "SCOP 5.1" | "SCOP 2.5" | — | Brief 38 polish per-system label reactivity preserved |

v40 displacement wired reactively end-to-end. The full pipeline UI → params.systems_config_v40 → `_calculateState3` → `computeSystemsDelivered` → `v40ServiceBlockToV25Shape` → `consumption.space_heating` → Sankey + Live Results works within one render cycle.

#### Item 4 — Toggle Primary heating off → validation blocks compute + Normalise ✓ STRONG PASS

Click enable-toggle dot on Primary heating card. Card greys out (opacity-50 + line-through label). Header changes to "HEATING 1/2 ⚠ 5%". Share-validation banner appears: "⚠ Shares of enabled systems sum to 5.0%, not 100%. Engine will not compute this service until fixed." + Normalise button.

Engine BLOCKS compute (Brief 40 Part 5b A.4 design):
- Heating delivered: 82.5 → **0.0** MWh
- Sankey heating bar: solid colour → faded "Heating (off)" label, no ribbons flowing out
- EUI: 87.5 → 79.3 (−8.2)
- Electricity: 179.0 → 143.5 (−35.5)
- Carbon: 16.4 → 14.8

Causal chain visible to user: warning AND headline drop happen together. The walkthrough's original problem ("engine accepts 90% silently") is now fixed.

Click **Normalise** → enabled Secondary heating share scaled from 5 → 100. Heating restored:
- EUI: 79.3 → 98.4 (+19.1 — electric panel η 1.0 is much less efficient than VRF SCOP 2.5)
- Electricity: 143.5 → 226.0 (+82.5 = 82.5 MWh heating / 1.0 η ✓ exact)
- Sankey: heating served entirely by "Electric panel heater" (single ribbon, VRF gone)
- Carbon: 14.8 → 18.4

Disabled system's share_pct (95) preserved on disk per audit §14 — Normalise only scaled enabled systems.

#### Item 5 — Toggle Secondary off (all-disabled state) ✓ STRONG PASS

Click toggle dot on Secondary heating. Both systems now disabled. Heading: header gets "off" badge. Banner changes to "All systems in this service are disabled. Service delivered = 0."

Engine `all_disabled: true` path fires:
- Heating delivered 0.0 / 175.1 MWh
- Sankey: "Heating (off)" label on demand bar, no ribbons
- EUI: 98.4 → 79.3 (same as Item 4 first toggle — both validation-error path and all-disabled path produce equivalent zero-delivered consumption block; behaviourally equivalent at the headline)

Both Section A error path (validation failure) AND Section B all-disabled path produce the same headline behaviour (delivered = 0) — different engine signals, equivalent output.

#### Item 6 — Re-enable Secondary heating ✓ PASS

Click Secondary's toggle dot again. Single click restores: dot back to red/coloured, label not line-through, opacity-50 gone. Heating restored to step-4 Normalise state (Secondary at 100%):
- EUI back to 98.4
- Electricity 226.0
- Sankey heating ribbon to Electric panel heater

Numbers byte-identical to step 4 — re-enable preserves share_pct from disk per audit §14.

#### Item 7 — Cooling Custom setpoint 20°C ✓ STRONG PASS with diagnostic surfacing

Expand cooling section → expand Primary cooling card. CONTROL section shows: Setpoint Follow comfort (24°C) / Custom radio; Mechanism Scheduled. Click Custom radio (slider appears). Change slider to 20.0°C.

Diagnostic block appears on the card:
- Demand at comfort: 83.7 MWh
- Delivered at 20°C: 89.3 MWh
- **Δ: +5.6 MWh (6.7%, overdeliver)**

Engine numbers move:
- Cooling 89.3 / 83.7 MWh (delivered now exceeds demand-at-comfort by 5.6 MWh)
- EUI 98.4 → 98.8 (+0.4)
- Electricity 226.0 → 227.6 (+1.6 = 5.6 / 3.51 cooling SEER ✓ exact)
- Carbon 18.4 → 18.5

**`state2Recompute` closure from Part 2 firing correctly** — State 2 actually re-runs with `{ setpointOverride: { cooling: 20 } }` and produces the higher demand. The comfort-vs-setpoint diagnostic (audit §5.1) lands end-to-end.

#### Item 8 — DHW tap_outlet_temp 40°C → 30°C ✓ STRONG PASS with exact tap-mix hand-calc

Expand DHW gas card → identity / share / source / point-of-use η / storage setpoint / tap outlet (°C) / cold supply / demand basis / demand fields visible. Change Tap outlet from 40 to 30.

Tap-mix correction reacts:
- Old `hot_fraction = (40-10)/(60-10) = 0.60`
- New `hot_fraction = (30-10)/(60-10) = 0.40`
- DHW thermal: 224.2 → **149.5 MWh** (ratio 149.5 / 224.2 = 0.667 = 0.40 / 0.60 ✓ exact basis-independent algebra)
- EUI: 98.8 → 82.2 (−16.6)
- Gas: 199.3 → 132.9 (−66.4 ≈ 80% × 74.7 / 0.90 η ✓)
- Carbon: 18.5 → 15.4

Per-system tap-mix-correction fields on the DHW card respond reactively. Audit §4 falsifiable target verified in both directions (40°C standard hotel + 30°C lower-tap variant).

#### Item 9 — Toggle DHW gas off → validation blocks DHW + Normalise ✓ PASS with one minor finding

Click toggle dot on DHW gas card. Card greys out. Section header: "DHW 1/2 ⚠ 20%". Validation fails (only ASHP at 20% enabled).

Engine state:
- DHW: **0.0 / 0.0 MWh** — engine blocks DHW compute entirely
- EUI: 82.2 → 49.2 (−33.0)
- Gas: 132.9 → **0.0** (entire DHW gas branch gone)
- Carbon: 15.4 → 9.3

**Minor finding logged for follow-up:** when DHW validation fails, BOTH demand AND delivered zero out. The Sankey loses the DHW row entirely. Engine returns `demand_at_comfort_mwh: 0` on validation failure, so the consumption block has zero demand too. Arguably the demand should be preserved (so user sees what they're not serving) with only delivered = 0. Pragmatic — file as a low-severity Section C finding to address in a future polish brief; doesn't block Part 5b close because the share-validation warning IS visible to the user and the Normalise button is the obvious fix.

Click **Normalise** → ASHP scaled to 100%. DHW restored as electric-only:
- DHW 149.5 / 149.5 MWh
- Electricity 222.6 → 262.5 (+39.9 = 49.83 MWh DHW elec at SCOP 3.0, vs prior 9.97 MWh elec + 132.9 MWh gas ✓ exact)
- Gas stays at 0.0
- EUI 49.2 → 60.7

Section A displacement + Section B enable filter compose correctly: disabled gas system's 80% share preserved on disk but ignored; Normalise scaled the remaining 20% enabled system to 100%.

#### Item 10 — Ventilation batch toggle (per-service) ✓ STRONG PASS with compound physics

Click white-dot batch toggle in VENTILATION section header. All 3 vent systems disabled in one click. Header: "VENTILATION 0/3 off". `VENTILATION (PER-SYSTEM)` block in right panel disappears entirely.

Compound effect of disabling ventilation (both fan electrical removal AND MVHR recovery removal):
- Mech vent demand bar gone from Sankey
- **Heating delivered jumps 82.5 → 175.1 MWh** (no MVHR recovery → heating demand back to raw State 2 value)
- Electricity 262.5 → **329.1 MWh** (compound: +92.6 heating elec via η 1.0 electric panel, −25.9 fan electrical, net +66.6) ✓ exact
- EUI 60.7 → 76.1
- Carbon 11.5 → 14.5

`v40VentilationToV25List` `all_disabled` branch firing: returns empty list to `computeVentilationEnergy` which then produces zero fan electrical AND zero recovery. The Brief 28j hourly recovery cap math chain is intact — when no vent systems exist, there's no recovery to cap.

Click batch toggle again to re-enable. All 3 vent systems return enabled. Numbers restore.

#### Item 11 — Lighting control_mechanism 'constant' → 'daylight_dimming' ✓ STRONG PASS

Expand Lighting (daylight dimming) card. CONTROL section: Mechanism dropdown "Constant (no controls)" / "Daylight dimming" / "Occupancy sensors" / "Both". Change to "Daylight dimming".

**Control factor auto-set 1.0 → 0.7** (per `LIGHTING_CONTROL_FACTOR_DEFAULTS.daylight_dimming` in SystemEditorCard).

Engine response:
- Sankey Lighting: 38.3 → **26.8 MWh** (38.3 × 0.7 = 26.81 ✓ exact)
- Electricity dropped by 11.5 MWh (the lighting reduction net of ventilation re-enable contribution)
- EUI moved compound

`v40ThinBlockToKwh` displacement firing per audit §13.4 — lighting kWh = gain × control_factor × share/100. When control_factor ≠ 1.0, the headline EUI reflects the controls. Brief 40 Part 4's thin-entry value proposition validated.

#### Item 12 — Library save + load + delete ✓ PASS

Click "Save current as library item" on Lighting card. Click "+ Add system" on Lighting section. Modal opens with "FROM LIBRARY" section showing the saved entry "Lighting (daylight dimming) — electricity". Click the entry.

New lighting card appears with all fields populated:
- Label: "Lighting (daylight dimming)"
- Share: 0% (seeded as remainder per AddSystemButton logic `Math.max(0, 100 - used)`)
- Mechanism: Daylight dimming
- Control factor: 0.7

LIGHTING header count: 1 → 2.

Click delete (✕) on the new card → confirm dialog auto-accepted (patched `window.confirm` for the test). Card removed; LIGHTING header back to 1. Original entry intact.

Library save path: `params.library_systems[]`. Filtered by service in the AddSystemButton modal. Service-namespacing prevents cross-service contamination (heating library entry can't be loaded into lighting). Per audit doc §13.

#### Item 13 — UnifiedScheduleEditor pop-out ✓ PASS

Expand Primary cooling card (Mechanism Scheduled). Click "Open schedule editor →" link. SchedulePopout opens with the cooling system's `control_schedule_id = 'business_hours_09_18_weekdays'`:

- Title bar: "Schedule · business_hours_09_18_weekdays" + "Drag to move · Esc to close" + Reset position link + ✕
- Body: UnifiedScheduleEditor canonical layout
  - NAME / SCHEDULE TYPE (Occupancy) / ZONE TYPE (Bedroom) selectors
  - Weekday / Saturday / Sunday tabs with hourly fraction bars
  - QUICK SET row: Flat 0.5 Apply, Copy Wk → Sat + Sun, Invert, Shift
  - MONTHLY MULTIPLIERS: 12 months at 1.00
  - ANNUAL HEATMAP (LIVE PREVIEW) on right
  - STATISTICS: Peak 14%, Average 5%, Annual operating hours 405 h/yr

Identical pop-out behaviour to Internal Gains / Operation surfaces — Brief 36 SchedulePopout chrome + Brief 37 UnifiedScheduleEditor body unchanged by Brief 40.

#### Item 14 — Page reload persistence (F5) ✓ STRONG PASS

Press F5. Page reloads. After 3-second settle, all walkthrough edits preserved exactly:

| State | Value |
|---|---|
| HEATING section badge | "1/2" (Primary disabled, Secondary at 100% from Normalise) |
| DHW section badge | "1/2" (Gas disabled, Heat pump at 100% from Normalise) |
| Cooling setpoint | Custom 20°C |
| DHW tap_outlet | 30°C |
| Lighting mechanism | Daylight dimming + control_factor 0.7 |
| EUI | 58.1 kWh/m²·yr (identical) |
| Electricity | 251.0 MWh |
| Heating | 82.5 / 175.1 MWh |
| Cooling | 89.3 / 83.7 MWh (overcool delta preserved) |
| DHW | 149.5 / 149.5 MWh (tap-mix at 30°C preserved) |
| Lighting Sankey | 26.8 MWh (daylight dimming preserved) |

Autosave + load-side fallback round-trip params.systems_config_v40 through SQLite perfectly.

#### Item 15 — Navigate Building ↔ Systems ✓ PASS

Navigate to `/building` → wait 2s → navigate back to `/systems` → wait 3s. State identical to pre-navigation:
- EUI 58.1, Electricity 251.0, Gas 0.0
- All per-system enable/disable states intact
- All slider/input values intact

React context persistence across route changes works as expected (params lives at the ProjectContext level, survives module unmount/remount).

### Walkthrough summary

| # | Item | Result | Note |
|---|---|---|---|
| 1 | Six service sections visible | ✓ PASS | — |
| 2 | Heating migrated state correct | ✓ PASS | — |
| 3 | SCOP slider → EUI moves immediately | ✓ STRONG PASS | Exact hand-calc (+16.1 MWh elec / +3.7 EUI) |
| 4 | Toggle off + validation blocks compute + Normalise | ✓ STRONG PASS | Headline drops → 0; Normalise scales enabled |
| 5 | All systems disabled → service "off" | ✓ STRONG PASS | `all_disabled` engine path |
| 6 | Re-enable preserves shares | ✓ PASS | — |
| 7 | Custom setpoint → diagnostic + EUI moves | ✓ STRONG PASS | `state2Recompute` closure firing |
| 8 | DHW tap_outlet 40°C → 30°C | ✓ STRONG PASS | Exact ratio 0.40/0.60 = 0.667 |
| 9 | DHW system toggle → Normalise | ✓ PASS | Minor finding: zero demand on validation failure |
| 10 | Ventilation batch toggle | ✓ STRONG PASS | Compound: fan elec + MVHR recovery removal |
| 11 | Lighting mechanism → control_factor + EUI | ✓ STRONG PASS | Exact 38.3 × 0.7 = 26.8 |
| 12 | Library save + load + delete | ✓ PASS | — |
| 13 | Schedule editor pop-out | ✓ PASS | Identical to Internal Gains / Operation |
| 14 | Page reload persistence | ✓ STRONG PASS | All state round-trips through SQLite |
| 15 | Navigate away + back | ✓ PASS | Context survives route changes |

**Overall:** 15/15 PASS. 10 STRONG PASSes with exact hand-calc verification on the engine numbers. 1 minor finding (Item 9 zero-demand on DHW validation failure) logged for a future polish brief — does not block Part 5b close because the share-validation warning IS visible and the Normalise button is the obvious fix path.

### Anomalies + minor findings

1. **Lighting `control_mechanism: 'constant'` despite label "daylight dimming"** (logged before walkthrough). Bridgewater's manual UI test data had `control_factor: 1.0` even though the label suggested dimming. Walkthrough Item 11 demonstrated the displacement is firing — flipping the mechanism to `daylight_dimming` auto-set control_factor to 0.7 and reduced lighting kWh accordingly. Not a Brief 40 bug; the entry pre-dated Part 3's archetype seeding behaviour.

2. **Small power array empty post-migration** (finding #4 from §5 of this doc). Bridgewater's bc had small_power key absent before --force migration; the migration's `existing_v40.get("small_power") or []` returns `[]` because the field was absent. The DEFAULT_PARAMS load-side fallback is whole-object (`bc.systems_config_v40 ?? DEFAULT_PARAMS.systems_config_v40`) so the default thin entry doesn't re-seed once v40 exists. Low severity — Bridgewater's EUI still includes the small_power gain via the v25 pass-through path (no v40 to displace, so v25 wins per the per-service displacement logic).

3. **Item 9 DHW validation failure zeroes demand AND delivered.** The Sankey loses the DHW row when shares fail to sum to 100. Pragmatic — file as a low-severity polish brief candidate: when validation fails, preserve `demand_at_comfort_mwh` on the consumption block so the Sankey can render an "unserved" or "broken" DHW row. Doesn't block Part 5b close.

### Console output throughout walkthrough

2 React Router pre-existing future-flag warnings (v7_startTransition, v7_relativeSplatPath — unrelated to Brief 40).
7 Chrome-extension noise exceptions ("message channel closed before a response was received" — from MCP/other extensions, not from our app).
No Brief 40 errors. No engine exceptions. No React state inconsistency warnings.

### Bridgewater post-walkthrough state

Captured for restoration reference. The walkthrough left Bridgewater in a "tour" state:
- Heating: Primary disabled, Secondary at 100%, SCOP unchanged on disabled Primary at 2.5
- Cooling: Setpoint Custom 20°C
- DHW: Gas disabled, Heat pump at 100%, tap_outlet 30°C
- Ventilation: all enabled (restored)
- Lighting: 1 entry — control_mechanism daylight_dimming, control_factor 0.7
- Small power: empty
- Library: 1 saved entry ("Lighting (daylight dimming) — electricity")
- Final EUI: 58.1 kWh/m²·yr

To restore canonical migrated state: re-run `python scripts/40_bridgewater_systems_migration.py --force`. Library entry is NOT overwritten (the migration only touches systems_config_v40).

### Part 5b verdict

Brief 40 Part 5b achieves its target outcome:

> "Editing a system in the new Brief 40 left panel produces a visible change in EUI, Sankey, and Live Results — within the same render cycle. Each system has an on/off toggle. Each service has a batch on/off toggle. After this Part lands, Chris can open Systems, toggle a heat pump off, watch the gas boiler take 100% of demand, and see the EUI and fuel split move accordingly."

Verified end-to-end in 15 items. Walkthrough PASS.

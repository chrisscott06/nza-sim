# Brief 55 audit — Granular field-level system patches

**Brief:** [`docs/briefs/active/55_granular_field_patches.md`](../briefs/active/55_granular_field_patches.md)
**Status:** Part 1 deliverable. Read-only. No code touched.
**Engine baseline (verification DB :8003):** Bridgewater clean 128.20 kWh/m²·yr (preserved).
**Pre-fix order-dependence fixture:** `scripts/_brief55_order_repro.mjs` + `docs/audit/55_order_repro.json`.

---

## §0 — Pre-fix reproduction (Part 1 baseline fixture)

Run `node scripts/_brief55_order_repro.mjs` on the verification DB (anchor 128.20). It pulls Bridgewater's two stored interventions (`MVHR Bedrooms`, `VRF 4.0`), applies them in both orders via `applyIntervention`, and compares the cumulative EUIs.

| Order | Cumulative EUI | Final `v40.heating` shape |
|---|---:|---|
| Baseline (no interventions) | 128.20 | `[VRF eff=2.8, share=95 \| electric eff=1, share=5]` |
| A — `[VRF 4.0, MVHR Bedrooms]` | **125.70** | `[VRF eff=2.8, share=90 \| electric eff=1, share=10]` (MVHR snapshot wins) |
| B — `[MVHR Bedrooms, VRF 4.0]` | **124.40** | `[VRF eff=4, share=100]` (VRF snapshot wins — replaced 2-entry array with 1-entry) |
| **Δ (A − B)** | **+1.30 kWh/m²·yr** | DIFFERENT structural shapes |

Chris's live-DB walkthrough showed 130 vs 124 (Δ ~6 kWh/m²·yr) on the drifted 131.90 baseline; the verification DB shows 125.70 vs 124.40 (Δ 1.30 kWh/m²·yr) on the clean 128.20 baseline. **Same mechanism, smaller numerical delta** because the clean state's heating[0] efficiency (2.8) is closer to the VRF-upgraded efficiency (4) than the drifted state was.

The structural collision is the smoking gun: **Order A's final heating array has 2 systems; Order B's has 1.** No engine arithmetic can yield identical EUIs from differently-shaped inputs — last-write-wins on the whole-object snapshot is replacing one shape with the other.

---

## §1 — Current patch shape (what's stored on disk)

The Bridgewater "MVHR Bedrooms" intervention (truncated for length):

```json
{
  "id": "int_3ad13c2d-...",
  "label": "MVHR Bedrooms",
  "enabled": true,
  "schema_version": 1,
  "patches": [
    {
      "id": "patch_d6c8e79e-...",
      "source": "inline",
      "op": "set",
      "path": "building.systems_config_v40",        ← WHOLE-OBJECT TARGET
      "value": {                                    ← whole systems_config_v40 snapshot
        "heating":        [ ... 2 entries ... ],
        "cooling":        [ ... 1 entry ... ],
        "dhw":            [ ... 2 entries ... ],
        "ventilation":    [ ... 3 entries with patched MVHR ... ],
        "lighting":       [ ... ],
        "small_power":    [ ... ],
        "heating_setpoint_mode": "follow_comfort",
        "heating_setpoint_c": null,
        ...
      }
    }
  ]
}
```

The "VRF 4.0" intervention has the same shape — `op: 'set'`, `path: 'building.systems_config_v40'`, `value: <different whole object>`.

**Result:** every time `applyIntervention` runs the patch, it does `cloned.building.systems_config_v40 = <whole snapshot>` — completely replacing whatever the prior intervention(s) set. Two interventions = the later one wins for the *entire* v40 sub-tree, not just the field the user actually changed.

---

## §2 — Why the snapshots are produced (the capture point)

`SystemsModule.jsx` mutates v40 via:

```js
const writeV40 = (next) => mutate('building.systems_config_v40', next)
```

where `next` is the **complete** updated `systems_config_v40` object. Every editor handler — `addSystem`, `removeSystem`, `updateSystem(service, idx, patch)`, `handleShareChange`, `normaliseShares`, `updateServiceLevel` — builds `next` by spreading the prior state and threads it through `writeV40`.

`mutate` (`frontend/src/hooks/useProjectMutation.js` L153–256) routes:

- **Main-app mode** (`projectCtx.updateParam('systems_config_v40', next)`) — overwrites a single React state slice, which is fine because there's no stacking.
- **Capture mode** (`capture.capturePatch({path, op, value, source:'inline'})`) — stores the whole-object `value` verbatim because the path is `'building.systems_config_v40'`.

**The bug is that the SAME `writeV40(next)` call works correctly in main-app mode but creates a poisonous whole-object patch in capture mode.** Main-app reads back the whole v40 from React state — no collision. Capture mode persists the snapshot, and later applies it ON TOP of the baseline, replacing any other intervention's contribution to v40.

---

## §3 — Patch flow inventory: capture / store / apply / read

### Capture (where patches are born)
1. `useProjectMutation.mutate(path, value, op?)` (`frontend/src/hooks/useProjectMutation.js`).
   - When `capture.isCapturing`, calls `capture.capturePatch({path, op:'set', value, source:'inline'})`.
   - Path is preserved verbatim from caller.
2. `PatchedProjectContextProvider.wrappedUpdateParam / wrappedUpdateConstruction / wrappedSetComfortBand` (`frontend/src/components/modules/interventions/PatchedProjectContextProvider.jsx`).
   - Catches direct `updateParam` calls that bypass `mutate` (legacy paths).
   - Same `capture.capturePatch` sink.

### Store (in-memory patch list on the intervention)
3. `capturePatch(patches, newPatch)` in `frontend/src/components/modules/interventions/patchCapture.js`:
   - Dedupes `op:'set'` patches by `path` — replace-in-place if a patch already targets the same path.
   - Otherwise appends.
   - **Returns a new array. Pure function. No persistence side effect — caller writes it to the intervention.**

### Persist (on the project)
4. `InterventionsModule.jsx` saves the intervention via `updateParam('interventions', ...)` which routes through `_scheduleSave('building', ...)` in `ProjectContext.jsx`. Pure JSON write.

### Apply (engine-side, every render in `/interventions`)
5. `applyPatch(config, patch, libraryData)` (`frontend/src/utils/interventionsEngine.js` L247–327):
   - Supports `op`s: `set`, `add`, `remove`, `replace`.
   - For `set`: `parsePath(patch.path)` → walk to parent → `container[leafKey] = resolved`. **`leafKey` is the LAST segment of the path.** When `path === 'building.systems_config_v40'`, `container = cloned.building`, `leafKey = 'systems_config_v40'`, and the whole sub-tree is overwritten.
   - For `add` / `remove` / `replace`: structural ops on arrays via `match` predicates — already field-level by design.
6. `applyIntervention(config, intervention, libraryData)` (L333–341): iterates `intervention.patches` and calls `applyPatch` for each.
7. `runInterventionStack(baselineConfig, interventions, runEngine, libraryData)` (L343+): builds the cumulative chain `[baseline, after_int_1, after_int_2, …]`.

### Read (what the UI inspects)
8. `useHasPatchOnPath(path)` (`useProjectMutation.js` L258+) — returns true when any captured patch's path matches the input path (currently uses prefix-match — so `building.systems_config_v40` whole-object patches light up every nested field).
9. `PatchedInputBadge` (`frontend/src/components/modules/interventions/PatchedInputBadge.jsx`) — wraps controls and shows a magenta dot when `useHasPatchOnPath` says yes.
10. `summarizePatch(patch, baselineConfig, libraryData)` (`patchCapture.js`) — pretty-prints a single patch for the PatchList. Already has handlers for granular field paths (`building.systems_config_v40.heating[id=X].efficiency_metric` etc.) — they just don't fire today because no patch is captured at those paths.

---

## §4 — Proposed field-level shape

For SYSTEMS interventions, replace the single whole-object `op:'set'` patch with a list of granular patches, one per actually-changed leaf. Path syntax already supported by `parsePath` and exercised by `migratePatch`'s `building.systems_config_v40.heating[id=X].setpoint` etc.

### Example — "VRF 4.0" intervention BEFORE Brief 55

```json
{
  "patches": [
    {
      "op": "set",
      "path": "building.systems_config_v40",
      "value": { "heating": [<single VRF eff=4>], "cooling": [...], "dhw": [...], ... }
    }
  ]
}
```

### Example — "VRF 4.0" intervention AFTER Brief 55

```json
{
  "patches": [
    {
      "op": "set",
      "path": "building.systems_config_v40.heating[id=sys_heating_1779261680582_18672].efficiency_metric",
      "value": 4
    },
    {
      "op": "remove",
      "path": "building.systems_config_v40.heating",
      "match": { "id": "sys_heating_1779261680582_24675" }   ← electric panel heater removed
    },
    {
      "op": "set",
      "path": "building.systems_config_v40.heating[id=sys_heating_1779261680582_18672].share_pct",
      "value": 100
    }
  ]
}
```

(Three field-level patches replacing the one whole-object patch. The number of patches scales with what actually changed — typically 1–4 for a single-system upgrade.)

When stacked with "MVHR Bedrooms" (which would similarly capture only its vent-system changes), the two interventions touch **disjoint** sub-paths (heating[*] vs ventilation[*]) and compose cleanly. Cumulative EUI becomes order-independent.

### Same-field conflict case

If two interventions both `op:'set'` on `building.systems_config_v40.heating[id=X].efficiency_metric`, that's a **genuine user-facing conflict** — the user has set the same field twice. Last-write-wins is correct here; the existing "Overridden by a later intervention" warning becomes a real signal (Brief 55 Principle 5).

---

## §5 — Mapping each `SystemsModule.jsx` edit handler to its target paths

| Editor handler | Current single write | Proposed field-level patch(es) |
|---|---|---|
| `updateSystem(service, idx, patch)` (single-field per call) | `writeV40({...v40, [service]: list_with_one_field_changed})` | One `op:'set'` per field in `patch`, path = `building.systems_config_v40.${service}[id=${sys.id}].${field}` (deep fields: `efficiency_metric.sfp_w_per_lps`) |
| `handleShareChange(service, idx, nextSharePct)` | `writeV40({...v40, [service]: list_with_target+partner_rebalance})` | One `op:'set'` per affected system's `share_pct` (typically 2: target + auto-rebalanced partner) |
| `normaliseShares(service)` | `writeV40({...v40, [service]: list_with_all_shares_rescaled})` | One `op:'set'` per enabled system's `share_pct` |
| `addSystem(service, sys)` | `writeV40({...v40, [service]: [...list, fresh]})` | `op:'add'` on `building.systems_config_v40.${service}`, `value: fresh` |
| `removeSystem(service, idx)` | `writeV40({...v40, [service]: list.filter(...)})` | `op:'remove'` on `building.systems_config_v40.${service}`, `match: { id: sys.id }` |
| `updateServiceLevel(patch)` (service-level fields: `heating_setpoint_mode`, `dhw_storage_setpoint_c`, etc.) | `writeV40({...v40, ...patch})` | One `op:'set'` per service-level field in `patch`, path = `building.systems_config_v40.${field}` |

All target paths are already supported by:
- `applyPatch`'s op-dispatch (set / add / remove / replace + match)
- `parsePath`'s `[id=...]` predicate syntax
- `patchCapture.PATH_HANDLERS` regex labels (for plain-English summaries)

**No new engine path syntax required.** The fix is purely at the capture point — refactor SystemsModule's editor handlers to route per-field instead of through `writeV40`.

---

## §6 — Migration plan for existing saved patches

Two interventions exist on the verification DB Bridgewater (and one on the live DB) with the legacy whole-object snapshot shape. They MUST keep working after Brief 55.

Two options:

### Option A — Convert on load (eager migration, recommended)

When `_brief42LoaderMigration`-style code in `ProjectContext._applyProject` walks an intervention's patches, detect the legacy shape:

```js
if (patch.op === 'set' && patch.path === 'building.systems_config_v40' && isObject(patch.value)) {
  // Legacy whole-object snapshot. Convert by diffing against baseline systems_config_v40
  // and producing one field-level patch per leaf that differs.
  return diffWholeObjectToFieldPatches(patch.value, baselineV40)
}
```

Caveats:
- The "baseline" the diff runs against must be the project's BASELINE `systems_config_v40` — NOT a prior intervention's output. We need the literal `building_config.systems_config_v40` from disk.
- The diff is a deep walk over the snapshot; for arrays (heating/cooling/dhw/vent/lighting/small_power), match by `id` and emit per-field set/add/remove patches.
- After migration, write back: bump `intervention.schema_version` to next + emit the converted patches.

### Option B — Detect on apply (back-compat lazy)

Add a check inside `applyPatch`'s `set` branch: if `path === 'building.systems_config_v40'`, log a deprecation warning + apply with a deep MERGE instead of `=`. Two interventions still wouldn't compose cleanly (deep merge of overlapping objects is ambiguous when arrays are involved), so this doesn't fully solve the bug — it just dampens it.

**Recommended: Option A.** It's a proper one-shot migration like Brief 42's v1→v2, runs at project load, persists the converted patches, and means subsequent applies use the same clean field-level path as new patches.

Migration is implemented in `migratePatch(patch, fromVersion, toVersion)` which already supports the v1→v2 chain. Brief 55 adds v2→v3:

```js
// v2 → v3: whole-object systems_config_v40 snapshots → field-level patches
{
  test: /^building\.systems_config_v40$/,
  rewrite: (patch, m, baselineConfig) => {
    if (patch.op !== 'set' || !isObject(patch.value)) return patch
    return diffWholeObjectToFieldPatches(patch.value, baselineConfig.building?.systems_config_v40 ?? {})
  }
}
```

(`migratePatch` will need to accept `baselineConfig` as a third arg — currently it's a pure path-rewriter. This is a small extension.)

---

## §7 — Engine: confirmed UNCHANGED

`grep -n "systems_config_v40" frontend/src/utils/instantCalc.js | head` shows the engine READS v40 in many places but is never aware of how the v40 came to be (snapshot vs field-level patches). All Brief 55's work is at the patch capture / migration / display layer.

- `_calculateState2` and `_calculateState3` read `building.systems_config_v40` after `applyIntervention` has produced the cumulative building. Engine sees the same object shape regardless of how it was constructed.
- Falsifiability gate #4 (engine files unchanged): `git diff` over `frontend/src/utils/instantCalc.js` and `frontend/src/utils/systemsEngine.js` MUST be empty after Brief 55 Part 2 lands.

---

## §8 — Wins #2 + #3 (deferred to Part 4 once Part 2 lands)

### Win #2 — `PatchedInputBadge` precision

Current behaviour (`useHasPatchOnPath` L258+): does a startsWith-match. A whole-object patch at `building.systems_config_v40` matches every sub-control. Once patches are field-level, the prefix-match correctly fires only on the exact leaves changed.

Part 4 may need to tighten `useHasPatchOnPath` to do exact-path match (or path-prefix-to-most-specific) for non-structural ops. Audit when Part 4 starts.

### Win #3 — Per-field change flags

Currently impossible because the patch carries the whole object — `summarizePatch` can't say "this field changed" without diffing. Once patches are field-level, `summarizePatch` already has handlers per leaf (PATH_HANDLERS regex list) and renders per-field labels straight from the patch. No additional work; Part 4 just removes any "use whole-object descriptor" fallback that's compensating today.

---

## §9 — Falsifiability gates (restated for Part 2)

1. **Order-independence (PRIMARY):** rerun `_brief55_order_repro.mjs` after Part 2. The 125.70 / 124.40 numbers MUST collapse to ONE value (Δ ≤ 0.05 kWh/m²·yr is the tolerance — strictly zero would be ideal but rounding in the engine's per-hour cap is ±0.05).
2. **No spurious increase:** no isolated SCOP improvement or demand reducer may show a positive marginal at any position. Test fixture: refbox + a single intervention that ONLY changes heating SCOP from 3.0 to 4.0. Marginal MUST be ≤ 0.
3. **Marginals reconcile (telescoping):** `marginal_n = cumulative_n − cumulative_{n−1}`. Already proven correct by construction in Brief 48 §7.2; verify nothing regressed.
4. **Baseline untouched:** verification DB Bridgewater (no interventions) still reads EUI = 128.20 exactly.
5. **Engine files unchanged:** `git diff` over `instantCalc.js` + `systemsEngine.js` shows no changes after Part 2.
6. **Existing projects open:** the two Bridgewater interventions migrate to field-level patches on load. Cumulative EUI on Bridgewater (with both interventions enabled, either order) is a single number.
7. **Refbox regression fixture (Part 3):** order-permutation test on a fresh refbox + 2-intervention pair — every permutation gives the same cumulative.

---

## §10 — Part 1 deliverable summary + sign-off questions

| Item | Status |
|---|---|
| Patch shape today | Whole-object `set` on `building.systems_config_v40` (§1) |
| Proposed shape | Field-level paths via `op:'set'`/`'add'`/`'remove'`/`'replace'` (§4–§5) |
| Engine change needed | **None** — `applyPatch` already supports field-level paths (§7) |
| Capture-point refactor scope | `SystemsModule.jsx` editor handlers (writeV40 → per-field mutate) (§5) |
| Migration plan | Option A: convert legacy whole-object patches at load via `migratePatch` v2→v3 chain (§6) |
| Pre-fix fixture | `scripts/_brief55_order_repro.mjs` → 125.70 vs 124.40 on verification DB (§0) |
| Order-independence acceptance | Part 2 must collapse to ONE number (§9 #1) |

### Sign-off questions for Chris (Part 1 checkpoint)

1. **Field-level path syntax accepted?** Per the table in §5: `[id=X]` for array entries, dotted for service-level + nested efficiency_metric sub-fields. Matches Brief 41 §6 + Brief 42 migration precedent.
2. **Migration approach — Option A (eager, v2→v3 in `migratePatch`)?** Recommended. Option B (lazy back-compat) is less clean and doesn't fully solve the composition problem.
3. **Same-field conflict UX in Part 5:** repurpose the existing "Overridden by a later intervention" warning, or surface a NEW conflict signal? Recommend the former — the language is already right, only the *meaning* changes (from snapshot-collision to genuine same-field-conflict).
4. **Engine-untouched gate:** the audit confirms `applyPatch` already supports field-level patches; the engine doesn't need to change. Engine-files-unchanged is enforced via `git diff` check in Part 2. Confirmed?

Hard stop. Awaiting sign-off before any refactor.

---

*Part 1 audit complete — read-only. Engine confirmed innocent. Capture point is the single refactor target. Migration plan documented. Falsifiability gates restated for Part 2's primary checkpoint.*

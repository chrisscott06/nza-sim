# Brief 60 — `share_pct` audit + retirement proposal (read-only)

**Status:** read-only; scopes a follow-up brief.
**Context:** Brief 60 Part A reconcile fix dropped `× share` from the ventilation fan calc (`systemsEngine.js _computeVentilation`). That closed the new Calc Trail panel's row-sum gap on Bridgewater (commit `79b5751`). `share_pct` remains live in 8 other engine read sites + ~30 UI / patch sites; this doc maps them all so the retirement can be scoped as its own brief, not silently swept.

**Why retire `share_pct`?** Chris's framing: "a field that's 'removed' but still sitting in v40 data and still being multiplied is how this bug happened". Fields that mean different things to different consumers are a permanent bug source. The Brief 60 Part A reconcile gap was the second instance of this disease class (after the Brief 59 v25/v40 flow_l_s split). The remedy is replacing `share_pct` with an explicit primary/secondary fuel-mix mechanism on the services where multi-system demand-splitting is real (heating, cooling, DHW); deleting the field entirely on the services where it never had physical meaning (ventilation — done; lighting/small_power — see §3.4).

---

## §1 Engine read sites (post-Brief-60-A reconcile fix)

### §1.1 Service-agnostic validator (`systemsEngine.js`)

| line | code | role |
|---|---|---|
| L85-89 | `function _validateShares(enabledSystems)` — `sum = Σ enabled.share_pct`; passes if `|sum − 100| < 0.5` | Validation gate called by every service's compute function. Blocks compute (returns error block) when shares don't sum to 100% across enabled systems. |

### §1.2 Heating + Cooling (`_computeHeatingOrCooling`)

| line | code | role |
|---|---|---|
| L232-243 | error string when validation fails | Surfaces validation error |
| L282 | `const share = Number(sys?.share_pct ?? 0) / 100` | Per-system share fraction |
| L285 | `delivered_mwh = demand_at_service_setpoint_mwh * share` | **Live multiplicative read — splits demand** |
| L287 | `delta_vs_comfort_mwh = (demand_setpoint - demandAtComfortMwh) * share` | Comfort diagnostic per system |
| L295 | `share_pct: sys.share_pct ?? 0` | Echo on per-system result (display) |
| L318 | `harmonic_denom += share / eff` (inside blended_efficiency loop) | **Live: blended η = harmonic mean weighted by share** |

### §1.3 DHW (`_computeDhw`)

| line | code | role |
|---|---|---|
| L437-443 | error string when validation fails | Surfaces validation error |
| L520 | `const share = Number(sys?.share_pct ?? 0) / 100` | Per-system share fraction |
| L523 | `delivered_mwh = demand_at_comfort_mwh * share` | **Live multiplicative read — splits demand** |
| L527 | `share_pct: sys.share_pct ?? 0` | Echo (display) |
| L542 | `harmonic_denom += share / eff` (blended_efficiency loop) | **Live: blended η weighted by share** |

### §1.4 Ventilation (`_computeVentilation`) — **fan calc fixed in Brief 60 A**

| line | code | role |
|---|---|---|
| L618-622 | error string when validation fails | Validation still enforces sum=100% |
| (was L642) | `× share` REMOVED — `fan_electrical_kwh = SFP × flow × hours_active / 1000` | **Fan electricity no longer scales with share** (Brief 60 A) |
| L661 | `share_pct: sys.share_pct ?? 0` | Echo (display) |

**Open issue:** validation at L618-622 still REQUIRES enabled ventilation systems' `share_pct` to sum to 100%. For Bridgewater (100/0/0) this passes coincidentally. For any project where a user wants three independent extract fans, they'd need shares like 34/33/33 to satisfy validation — even though those numbers have no physical meaning in the fan calc anymore. **Retirement should remove the ventilation validation requirement entirely.**

### §1.5 Lighting + Small Power (`_computeThin`) — Brief 58 C weighted pro-rata

| line | code | role |
|---|---|---|
| L719-722 | error string when validation fails | Validation enforces sum=100% across enabled |
| L731 | `weight_i = (share_pct/100) × control_factor` | Per-system weight (Brief 58 C) |
| L737-744 | `delivered_electrical_i = upstream_gain × (weight_i / weight_total)` | **Live: weighted pro-rata split of gain-coupled electricity** |

For lighting/SP, `share_pct` doesn't multiply directly into a "demand × share" form — it's a relative weight in a pro-rata distribution. If two lighting systems split equal area at 50/50, each gets half the upstream lighting gain as electricity. `share_pct` here is meaningful (multi-system electrical accounting), but the pattern is fundamentally different from heating/cooling/DHW.

### §1.6 Other engine docstring mentions

- `systemsEngine.js` L371-373: docstring describing share_pct semantics on DHW
- `instantCalc.js` L2257, L2308-2309, L2324: lighting/small_power `effectiveSystemScalar` (Brief 58 C gain modulation — uses share_pct as a weight, same as L731 above)

**Engine total: 8 substantive multiplicative reads (after Brief 60 A removed the ventilation one)**, plus 5 validation/error sites + 4 display echoes + 2 docstrings.

---

## §2 UI + patch read sites

`share_pct` is bound to UI surface area via:

| file | role |
|---|---|
| `components/modules/systems/SystemEditorCard.jsx` | Edits share_pct per system via slider + number input; shows arithmetic line "× control_factor × share%" |
| `components/modules/systems/SystemSummaryRow.jsx` | Displays share %; emits `onShareChange` to engine |
| `components/modules/systems/ServiceSplitBar.jsx` | Horizontal stacked bar showing per-system share split for a service |
| `components/modules/systems/SystemsDiagnosticPanel.jsx` | Shows share % in diagnostic rows |
| `components/modules/systems/AddSystemButton.jsx` | New system added with `share_pct: 100` |
| `components/modules/SystemsModule.jsx` | The Normalise / rebalance buttons; partner-share auto-adjust on edit (~10 reads) |
| `components/modules/interventions/InterventionEditorBuildingView.jsx` | Captures share_pct intervention patches at `building.systems_config_v40.{service}[id=X].share_pct` |
| `components/modules/interventions/InterventionEditorPreview.jsx` | Detects share-validation error from engine output |
| `components/modules/interventions/ChangeList.jsx` | Renders share_pct in intervention change list |
| `components/modules/interventions/patchCapture.js` | Registers patch-path regexes for share_pct under heating / cooling / dhw |
| `components/modules/interventions/sections/SystemsSection.jsx` | (Future v40 share intervention) |
| `components/modules/interventions/InterventionStackView.jsx` | Comments referring to share-flip behaviour |
| `hooks/useProjectMutation.js` | Docstrings using share_pct examples |
| `context/ProjectContext.jsx` | `share_pct: 100` defaults on default lighting / small_power systems |

**UI surface: editing + display + intervention-patching across ~14 files.** Retirement removes ALL of these for ventilation (already meaningless post-Brief-60-A); replaces them for heating/cooling/DHW with the primary/secondary editor; possibly preserves them for lighting/small_power under the Brief 58 C "weight" interpretation.

---

## §3 Replacement proposal — primary/secondary fuel-mix

### §3.1 The pattern already exists in the codebase (v25 path)

`instantCalc.js:3921+` `computeServiceEnergy(serviceCfg, service, demand_mwh, resolved)` is the **v25 / pre-Brief-40 demand-split function**. It implements exactly the primary/secondary mechanism Chris pointed at:

```js
// serviceCfg shape (v25):
//   { primary: { source, efficiency, ... },
//     secondary: { source, efficiency, ... } | null,
//     primary_pct: 95   // implicit: secondary_pct = 100 - primary_pct
//   }
//
// Returns:
//   { primary_perf:   { delivered_mwh, fuel_mwh, avg_cop_or_eff, fuel } | null,
//     secondary_perf: { delivered_mwh, fuel_mwh, avg_cop_or_eff, fuel } | null,
//     total_perf:     { delivered_mwh, fuel_mwh },
//     fuel_split:     { [fuel]: { primary_mwh, secondary_mwh } } }
```

DHW has further enhancement via `computeDhwFuelMix(sys.dhw, dhw_demand_mwh, resolved)` (Brief 28-IM IM-M4) which lets DHW have a richer fuel-mix beyond just primary/secondary.

### §3.2 Proposed schema change on `systems_config_v40`

Per service that genuinely splits ONE demand across systems (heating, cooling, DHW), replace the array-with-share form:

```js
// CURRENT (v40):
heating: [
  { id, source, efficiency_metric, share_pct, enabled, ... },
  { id, source, efficiency_metric, share_pct, enabled, ... },
],
heating_setpoint_mode, heating_setpoint_c,
```

with explicit primary/secondary fields:

```js
// PROPOSED (v40 → v41 or similar):
heating_primary: {
  id, source, efficiency_metric, enabled,
  primary_fraction: 0.95,    // 0..1; secondary fills 1 − primary_fraction
  ...
},
heating_secondary: {          // null when no backup
  id, source, efficiency_metric, enabled,
  ...
} | null,
heating_setpoint_mode, heating_setpoint_c,
```

For DHW the existing `fuel_mix` array generalises to N items, each with `fraction` (Σ fractions ≤ 1, remainder is unallocated demand surfaced as an error).

### §3.3 Engine compute change

`_computeHeatingOrCooling` and `_computeDhw` retire the `enabledSystems` array iteration in favour of explicit `primary_perf` + `secondary_perf` blocks, modelled on the v25 `computeServiceEnergy` already in the codebase. Blended efficiency stays a harmonic mean but weighted by `primary_fraction` / `(1 − primary_fraction)` instead of by share. `_validateShares` retires for these services (validation moves to "primary_fraction in [0,1], secondary present iff primary_fraction < 1").

### §3.4 Lighting / small_power decision

Brief 58 Part C wired `effectiveSystemScalar(v40Systems)` = `Σ enabled.share_pct/100 × control_factor`. This uses share_pct as a **weight**, not a "fraction of demand served". For lighting/SP, the question is whether multi-system electrical accounting is a real-world need (e.g. "two separately metered lighting systems") or whether one entity per service suffices (with `control_factor` carrying the dim-state).

**Recommendation:** for lighting/SP, retire share_pct in favour of a single-entity-per-service model (one lighting object, one small_power object, each with `control_factor`). Multi-zone modelling stays in `building.gains.lighting.profiles[]` (the LPD source). Drops 2 services worth of share_pct entirely.

### §3.5 Ventilation decision

Already addressed in Brief 60 A. share_pct removed from fan calc. Outstanding: **remove `_validateShares` requirement for ventilation** — fans don't share, validation is meaningless. Each enabled vent system stands alone.

### §3.6 Migration considerations

- **Schema bump** (v40 → v41 or similar) for heating/cooling/DHW arrays → primary/secondary objects.
- **Loader migration** (Brief 41 `migratePatch` pattern + Brief 42 schema_version chain) to convert existing v40 array entries:
  - 1-system array: → `primary` (only); `secondary = null`; `primary_fraction = 1.0`
  - 2-system array with share 100/0: → `primary` (the share=100 system); `secondary = null`
  - 2-system array with shares summing to 100: → `primary` (share≥50), `secondary` (share<50); `primary_fraction = primary.share / 100`
  - N>2 system array: STOP, surface to user — primary/secondary model can't represent this; user must collapse manually
- **Intervention patches** at `building.systems_config_v40.{service}[id=X].share_pct` need migrating to `building.systems_config_v40.{service}_primary.primary_fraction` (or similar). Brief 41 `migratePatch` chain extends with v40→v41 step (registered alongside the schema change in the same commit, per the schema-flexibility discipline).
- **Bridgewater**: heating has primary + secondary (gas boiler + heat pump backup); cooling has VRF only; DHW has 65% gas + 35% HP (genuine multi-system). All three convert cleanly to primary/secondary.

---

## §4 What the retirement brief should do (suggested scoping)

**Part 1 — Audit + decision** *(read-only — this doc covers most of it)*. Confirm the schema shape (primary/secondary vs fuel_mix N-item array), confirm lighting/small_power direction (retire entirely vs keep as weighted-pro-rata), confirm DHW continues to use `fuel_mix`.

**Part 2 — Engine retirement** *(commit-per-service)*:
- 2a: Drop `_validateShares` requirement for ventilation; remove the validation gate.
- 2b: Migrate `_computeHeatingOrCooling` → primary/secondary using existing v25 `computeServiceEnergy` pattern. Schema bump + migratePatch v40→v41.
- 2c: Migrate `_computeDhw` → existing `computeDhwFuelMix` (already there for the v25 path) as the canonical DHW path.
- 2d: Decide lighting/small_power per §3.4; either retire share_pct entirely (single-entity model) OR keep weighted-pro-rata.

**Part 3 — UI retirement**:
- 3a: Replace SystemsModule editor's Normalise/rebalance UI with primary/secondary editor.
- 3b: Retire share_pct intervention patch path; replace with `primary_fraction` patch path on `*_primary`.
- 3c: Retire ServiceSplitBar (no longer needed for primary/secondary which has just two segments — replace with simpler primary/backup visual).

**Part 4 — Verification**:
- Re-run breakdown_dump on Bridgewater — anchor 110.30 must hold (engine semantics equivalent for the conversions; only the data shape changes).
- Calc Trail panel row-sum still reconciles to consumption.total (Brief 60 A gate continues to pass).
- Intervention chain (MVHR Bedrooms → VRF 4.0) produces identical EUI deltas.

**Gates throughout:**
- No engine number change on Bridgewater that isn't derivable from the schema migration.
- Each commit one service.
- migratePatch chain extended in same commit as schema change.

---

## §5 Out of scope for this audit

- The actual retirement implementation — that's the new brief's job.
- Lighting/small_power direction — flagged in §3.4 as needing Chris's call.
- Migration of saved interventions on production projects (Bridgewater is the only known project; bigger fleet migration is a separate concern).
- Whether `primary_fraction` should be a number in [0,1] or `[0,100]` (consistency with the existing v25 pattern uses `primary_pct: 95`; new schema should match for code reuse).

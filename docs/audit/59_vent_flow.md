# Brief 59 Part 1 — Ventilation flow → demand decoupling audit (read-only)

**Status:** audit complete; ready for Chris to sign off fix shape.
**Anchor before fix:** Bridgewater EUI 110.30 (post-Brief-58-C breakdown-dump baseline).
**Mode:** read-only. Verification DB backup made (`data/nza_sim_cc.db.brief59_pre_part1.20260527_090749.bak`).

---

## §1 Confirmed read-path map

### Q1 — State 2 ventilation heat-loss / `UA_vent` term reads from: **v25**

`frontend/src/utils/instantCalc.js` `_calculateState2` builds the `ventSystems` array from `building?.systems_config_v25?.ventilation` at **L2646**:

```js
const ventSystems = (building?.systems_config_v25?.ventilation ?? []).map(v => {
  const v40Match = v40VentMap.get(v?.id)
  // HRE: v40 wins when v40 entry exists; else v25 fallback.
  ...
  return {
    name:       v.name ?? v.id ?? v.library_id ?? '?',
    flow_l_s:   Number(v.flow_l_s ?? v.flow_L_s ?? 0),       // ← V25 ONLY
    hre,                                                       // ← v40-wins (Brief 50 Part 6)
    enabled,                                                   // ← AND of v25 + v40 (Brief 50 P6)
    summer_bypass,                                             // ← v40-wins (Brief 53 P2)
    ...
  }
})
```

The `withMode('envelope-gains')` gatekeeper at **L528-534** only passes `systems_config_v25` into the demand path — no `systems_config_v40` passthrough (deliberate omission, comment at L522-527: "pass through systems_config_v25 so State 2 can read the ventilation array — extract-only flows are real continuous heat losses").

`ventUA` is then computed from the v25-sourced flow at **L2685-2689**:

```js
const ventUA = ventSystems.map(v => {
  const Q_m3_h = v.flow_l_s * 3.6
  const sched_factor = v.hours / 8760
  return AIR_HEAT_CAPACITY * Q_m3_h * (1 - v.hre) * sched_factor   // W/K
})
```

The author flagged this in the override comment at **L2636-2639**:

> "Other fields (flow_l_s, sfp_w_per_l_s, hours, schedule_ref) continue to read from v25. They drift less than HRE in practice; if drift appears in those fields, expand this override or rewire State 2 to read v40 ventilation completely (**architectural change deferred**)."

That deferred change is now biting.

### Q2 — Fan-power calc reads from: **v40**

`frontend/src/utils/systemsEngine.js` `_computeVentilation` at **L632**:

```js
const flow_rate       = Number(sys?.flow_rate ?? 0)         // ← V40
const flow_rate_basis = sys?.flow_rate_basis ?? 'constant'
let flow_lps
if (flow_rate_basis === 'per_m2')          flow_lps = flow_rate * gia
else if (flow_rate_basis === 'per_person') flow_lps = flow_rate * peakOccupants
else                                        flow_lps = flow_rate
const fan_electrical_kwh = sfp_w_per_lps * flow_lps * hoursActive * share / 1000
```

State 3's `computeVentilationEnergy` (per-hour MVHR recovery cap) consumes a v25-shaped list synthesised by `v40VentilationToV25List` at `systemsEngine.js:1038` — which maps `v40.flow_rate → v25.flow_l_s` in the projection. So the State-3-side recovery integration **is** v40-aware. State 2 demand is **not**.

### Q3 — `flow_rate` intervention patches write to: **v40 ONLY**

`frontend/src/components/modules/interventions/InterventionEditorBuildingView.jsx` L525-527:

```jsx
value={system.flow_rate}
onChange={(v) => capture({ id: newPatchId(), op: 'set',
  path: `building.systems_config_v40.ventilation[id=${sysId}].flow_rate`, value: v, source: 'inline' })}
```

No corresponding v25 mirror patch. For contrast, **SFP** (L545) and **HRE** (L555) patches in the same editor *do* write to `systems_config_v25.ventilation[id=...]` directly — exactly the inverse asymmetry. That's how Brief 50 Part 6 closed the HRE leg of this same bug class.

### Q4 — Is v25 kept in sync with v40 anywhere? **No.**

Confirmed by repository grep:
- No save-side sync (the API persists `building_config` as-is — `systems_config_v40` and `systems_config_v25` are sibling fields, neither writes the other)
- No load-side sync (the ProjectContext loader returns the persisted shape; no v40→v25 projection step)
- No engine-entry sync (`calculateInstant` consumes `building` directly without normalising)
- One migration script (`scripts/40_bridgewater_systems_migration.py`) created the v40 block from v25 — one-shot only, runs on import. Doesn't fire on subsequent edits.

The Bridgewater baseline (captured 2026-05-27) has v25 and v40 **aligned by import** (`v25.flow_l_s = v40.flow_rate = {1425, 2208, 210}`), but the moment a v40 flow_rate intervention fires, that alignment goes stale. v25 is then a stale mirror.

This is the exact bug shape Brief 50 Part 6 documented (`docs/audit/50_mvhr_recovery_doublecount.md` L371-555) for the HRE axis — closed there by overlaying v40 HRE onto v25 reads in the State 2 loop. The flow_l_s axis was the part left "architectural change deferred".

---

## §2 Symptom → mechanism

| step | what happens |
|---|---|
| 1. User patches v40 `bedroom_extract.flow_rate` 2208 → 1000 | InterventionEditor writes `building.systems_config_v40.ventilation[id=vent_bedroom_extract].flow_rate = 1000` |
| 2. v25 mirror NOT updated | `systems_config_v25.ventilation[1].flow_l_s` stays at 2208 |
| 3. State 2 builds `ventSystems` from v25 (Q1) | `flow_l_s = 2208` (unchanged) → `ventUA = 2623.1 W/K` (unchanged) |
| 4. State 2 hourly loop integrates per-system mech-vent heat loss with old UA | `heat_loss_kwh` per the integrand: `226,448 kWh` (unchanged) |
| 5. Heating demand integrand unchanged | `heating_demand_mwh = 245.6` (unchanged) |
| 6. v40 path computes fan electrical from v40 (Q2) | `fan_kwh = SFP × 1000 × 8760 = 7008` kWh (drops correctly from 7,737 kWh) |
| 7. UI shows fan electricity dropped, demand unchanged | ✗ Symptom |

---

## §3 First-principles hand-calc — 2208 → 1000 L/s on bedroom_extract

Captured from the engine's current baseline (`losses_at_setpoint.ventilation[1]` for `bedroom_extract`):

| field | value | source |
|---|---|---|
| `flow_l_s` (baseline) | 2208 | v25/v40 (aligned at import) |
| `HRE` | 0 (extract-only, no recovery) | v40 → v25 fallback |
| `hours` | 8760 | v25 |
| `schedule_ref` | always_on | v25 |
| `AIR_HEAT_CAPACITY` | 0.33 Wh/m³·K | engine constant |
| `Q_m3_h` (baseline) | 2208 × 3.6 = 7,948.8 | derived |
| `ventUA` (baseline) | 0.33 × 7948.8 × (1−0) × 1.0 = **2,623.1 W/K** | derived |
| `heat_loss_kwh` (baseline, annual integral against State 2 ΔT-hours) | **226,448.1 kWh = 226.4 MWh** | engine |

**Effective ΔT-hour integrand for bedroom_extract** (back-solved from engine):
`K_hours = heat_loss_kwh × 1000 / ventUA = 226,448,100 / 2623.1 = 86,326 K·h`
(consistent with UK heating-needed degree-hours at setpoint ~20°C, ~3,600 K·days × 24)

### Predicted move when v40.flow_rate goes 2208 → 1000 (and the demand path reads it)

| field | value |
|---|---|
| `Q_m3_h` (new) | 1000 × 3.6 = 3,600 |
| `ventUA` (new) | 0.33 × 3600 × 1.0 × 1.0 = **1,188 W/K** |
| `Δ ventUA` | **−1,435.1 W/K** (factor 0.4529) |
| Scaling factor on `heat_loss_kwh` | 1000 / 2208 = **0.4529** |
| `heat_loss_kwh` (new) | 226,448 × 0.4529 = **102,568 kWh ≈ 102.6 MWh** |
| **Δ vent heat loss** | **−123,880 kWh ≈ −123.9 MWh** |

Demand response (qualitative, refined by State 2's gain-utilisation buckets):
- **Heating demand: drops by ≈ −123.9 MWh × η_useful**, where η_useful is the fraction of the loss reduction that translates to demand reduction. For Bridgewater (heating-dominated, gains not currently saturating), η_useful is close to 1.0 → expected heating demand drop ≈ **−120 to −124 MWh**.
- Heating demand baseline = 245.6 MWh; expected post-fix → **~120–125 MWh** (massive move, exactly what Chris would expect from cutting half the building's mechanical extract).
- **Cooling demand: rises modestly** (less infiltration-driven extraction of internal heat during summer hours). Expected rise: small (single-digit MWh) — the ventilation loss is dominated by winter K·h, summer cooling is mostly solar/internal-gain driven on Bridgewater.

### Predicted move when v40.flow_rate goes 2208 → 1800 (Chris's other reported step)

| field | value |
|---|---|
| Scaling factor | 1800 / 2208 = 0.8152 |
| `heat_loss_kwh` (new) | 226,448 × 0.8152 = 184,597 kWh = 184.6 MWh |
| **Δ vent heat loss** | **−41,851 kWh ≈ −41.9 MWh** |
| Expected heating demand drop | ≈ −40 to −42 MWh |

### Sanity check — anchor unchanged at zero flow change

If the intervention sets v40.flow_rate to its baseline (no change), `ventUA` is unchanged, demand integral unchanged, anchor (109.90 / 110.30 / 128.20 — whichever path) **must hold exactly**. This is the unchanged-flow gate.

---

## §4 Fix options (Chris picks)

### Option (a) — Single source of truth: route State 2 to read v40 flow (PREFERRED)

Mirror the Brief 50 Part 6 pattern that closed the HRE axis. Expand the v40-wins override at `instantCalc.js:2640-2682` to also project `flow_l_s` from v40 when a matching v40 entry exists:

```js
// In the existing per-system mapping at L2646-2682, add:
const flowFromV40 = (v40Match && v40Match.flow_rate != null)
  ? Number(v40Match.flow_rate)   // v40 flow_rate is already in L/s (basis='constant')
  : null
const flow_l_s = (flowFromV40 != null) ? flowFromV40 : Number(v.flow_l_s ?? v.flow_L_s ?? 0)
```

Properties:
- Single source of truth on the read side — v40 wins for flow as it already does for HRE, enabled, summer_bypass.
- v25 stays as fallback for legacy projects + for the `flow_rate_basis !== 'constant'` case (TODO comment: per_m2 / per_person projection needs gia/peakOccupants threaded through, but Bridgewater is `basis='constant'` so the projection is trivial. Brief's recommended option (a) ships with `basis='constant'` only; non-constant basis falls back to v25 with a clear comment.)
- Anchor holds at unchanged flow (v25 and v40 still equal).
- Three-strikes-safe: minimal diff, narrow scope.
- Engine git diff: ~5 lines.

**This matches the v40-wins-with-v25-fallback pattern Brief 50 Part 6 established** — incremental and consistent with what's already in the override block.

### Option (b) — Mirror v40 writes to v25 in the InterventionEditor (NOT RECOMMENDED)

UI-side mirror — flow_rate patches gain a second patch to v25, like SFP/HRE already do at L545/L555. Two patches per write; two-sources-of-truth preserved; sync is the editor's responsibility. This is the stopgap pattern the codebase has been retiring (and Chris specifically said "do NOT fix Part 1 by syncing v25 from v40 as a stopgap unless Chris explicitly chooses (b)").

### §4.1 Edge cases for Option (a)

- **`flow_rate_basis !== 'constant'`** (per_m2 / per_person): v40's `flow_rate` is a coefficient, not absolute L/s. State 2 doesn't currently have `gia` / `peakOccupants` projected through `withMode`. Three options:
  1. Add a one-time projection at the top of State 2: `flow_l_s = flow_rate × (gia if per_m2 else peakOccupants if per_person else 1)`. Adds two lines.
  2. Fall back to v25 for non-constant basis with an explicit comment.
  3. Make `flow_rate_basis` part of the `withMode` allowlist + project per-basis to absolute L/s at engine entry.

  Bridgewater is `basis='constant'` for all three vent systems, so any of these works for the live verification. Recommend #1 (most consistent with v40-wins pattern; smallest behavioural diff).

- **No v40 entry for a v25 system** (legacy projects): keep falling back to v25 flow_l_s — exactly what the current override does for HRE.

- **`enabled` disagreement**: existing AND-of-v25-and-v40 logic already handles this; no change needed.

---

## §5 Gates for Part 1 fix

Deterministic:

- **59-G1** Unchanged-flow anchor: same Bridgewater config, no intervention → EUI 110.30 (breakdown-dump path) UNCHANGED to ±0.05 kWh/m²·yr.
- **59-G2** Engine git diff bounded: ≤10 source lines in `instantCalc.js`; no other engine file touched (except possibly a test helper).
- **59-G3** bedroom_extract 2208 → 1000 L/s flow patch: engine `losses_at_setpoint.ventilation[1].heat_loss_kwh` matches hand-calc 102,568 ± 200 kWh (within 0.2% — rounding).
- **59-G4** bedroom_extract 2208 → 1000 L/s flow patch: heating demand drops by ≥ 90 MWh AND ≤ 130 MWh (predicted ~120-124; the band accommodates State 2's gain-utilisation bucketing).
- **59-G5** bedroom_extract 2208 → 1000 L/s flow patch: cooling demand rises by ≥ 0 MWh AND ≤ 15 MWh (small move; ventilation extract has minor cooling effect in summer).
- **59-G6** bedroom_extract 2208 → 1800 L/s flow patch: heating demand drops by ≥ 30 MWh AND ≤ 50 MWh (predicted ~40-42).
- **59-G7** Fan power continues to respond (Q2 path untouched): fan_kwh drops by `(2208 − 1000) / 2208 = 54.7%` of baseline 7,737 → ≈ 7008 kWh new fan_kwh value within ±20 kWh.

Anchor sanity:
- **59-G8** With MVHR HRE > 0 (mvhr_gf_public, HRE 0.75): flow reduction still moves demand by `(1 − 0.75) = 0.25 × ΔventUA × K_hours` — i.e. heat recovery scales the same conductance, doesn't decouple it.

Falsifiability:
- **59-G9** If the predicted heating demand drop magnitude is off by more than the band in G4/G6, STOP — the engine is doing something other than the linear gradient predicted, and the fix needs a different shape.

---

## §6 Sequencing for Chris's sign-off

This audit is the HARD STOP. Chris's call on:

1. **Option (a) vs (b)** — recommend (a), default per the brief.
2. **Edge-case treatment for `flow_rate_basis !== 'constant'`** — recommend approach #1 (project to absolute L/s at the State 2 entry). Bridgewater is unaffected (all `basis='constant'`).
3. **Land Part 1 commit message:** `Brief 59 Part 1: route State 2 ventilation flow read to v40 (close the demand-decoupling bug)`.
4. **Then proceed to Part 2** (the calculation-trace harness) — separate commit(s).

The hand-calc, the gate bands, and the read-path map are above; the fix can land once Chris signs off the shape.

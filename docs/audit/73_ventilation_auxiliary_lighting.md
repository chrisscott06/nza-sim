# Brief 73 audit — ventilation share rule + auxiliary visualisation + lighting baseline check

Companion to `docs/briefs/active/73_ventilation_auxiliary_lighting.md`. Each section here is updated at the close of its corresponding brief Part.

Tip at brief land: `3e21f3b` (Brief 72 close).

---

## §1 — Bridgewater clean anchor (Part 1, 2026-05-29)

Captured via `node scripts/_brief73_p1_anchor.mjs` against live API (project `3561c5a6-9a3f-4b5c-9e3d-72b449658d9a`). Output cached at `docs/audit/73_p1_anchor_output.json`.

### §1.1 Building metadata

| Field | Value |
| --- | ---: |
| num_bedrooms | 138 |
| occupancy.density | 3 per_room |
| occupancy.occupancy_rate | 1.0 |
| geometry_gia_m2 | 4321.8 |
| reported_gia_m2 (EUI denominator) | 4125 |
| weather_file | `GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw` |
| comfort_band_c | 21 / 24 |

### §1.2 Auxiliary profiles (Chris authored, post-Brief-72)

3 profiles present. This is the new live state; the post-Brief-72-close fixture didn't have them.

| Label | Magnitude | gain_fraction |
| --- | --- | ---: |
| External lighting | 1.5 W/m² | 0% |
| Catering | 6 W/m² | 27% (hand-edited from preset 50%) |
| Pumps | 1 W/m² | 100% |

### §1.3 Headline anchor numbers vs brief expectations

| Metric | Captured | Brief expected | Δ | Note |
| --- | ---: | ---: | ---: | --- |
| EUI (kWh/m²·yr) | **185.2** | 163.5 | +21.7 | Auxiliary electricity rolls up to fuel_split per P5 — drives EUI up. Expected pre-dated Chris's auxiliary authoring. |
| Σ electricity (MWh) | **403.543** | 314.2 | +89.3 | ~+78 MWh from auxiliary (Catering 30 MWh + Pumps 7.5 MWh + External lighting 8.3 MWh + other shifts). |
| Σ gas (MWh) | **360.269** | 360.3 | ≈0 | ✓ matches. |
| Heating demand (MWh) | **0** | — | — | Auxiliary + occupancy + solar gains keep T_zone ≥ heating setpoint year-round. PC baseline (no auxiliary) had 26.9 MWh. |
| Cooling demand (MWh) | **330.6** | — | — | Auxiliary heat gains push cooling load up vs PC baseline 111.7 MWh. |
| DHW demand (MWh) | **421.093** | 421.1 | ≈0 | ✓ matches. |
| Ventilation fan electricity (MWh) | **null** (THE BUG) | 0 | — | Engine reads as `null` — system array empty under guard. P2 diagnoses. |
| Lighting internal gain (MWh) | **56.282** | 56.3 | ≈0 | ✓ matches re-created Bridgewater. |
| Small Power internal gain (MWh) | **172.101** | 172.1 | ≈0 | ✓ matches. |
| Auxiliary heat gain (MWh) | 41.117 | — | new | Catering (gf 0.27) + Pumps (gf 1.0) — External lighting gf 0 contributes nothing. |
| Auxiliary electricity (MWh) | 78.320 | — | new | All three profiles contribute their full electricity. |

### §1.4 Per-system rollups (empty — Part 2 diagnostic territory)

`consumption.space_heating.systems`, `…space_cooling.systems`, `…dhw.systems`, `…ventilation.systems`, `…lighting.systems`, `…small_power.systems` ALL returned empty arrays in this anchor script's read paths. The total `consumption.total.electricity_mwh` (403.5) and `consumption.total.gas_mwh` (360.3) are populated correctly, so the per-system rollups exist somewhere in the result — the anchor script just guessed the wrong path. Identifying the correct shape is Part 2 territory (the brief explicitly says read-source for the ventilation systems before Part 3's fix).

### §1.5 Internal gains — full breakdown

```
people:    144,490.9 kWh   (33.43 kWh/m²)
lighting:   56,281.8 kWh   (13.02 kWh/m²)   electricity_kwh = 56,281.8  (gain_fraction 1.0)
equipment: 172,100.6 kWh   (39.82 kWh/m²)   electricity_kwh = 172,100.6 (gain_fraction 1.0)
auxiliary:  41,117.0 kWh   ( 9.51 kWh/m²)   electricity_kwh = 78,320.1  (mixed gain_fractions)
                                            ratio = 41,117 / 78,320 = 0.525 = weighted avg gf
```

Auxiliary's gain ÷ electricity ratio = 0.525 is consistent with the three profile shapes (External lighting 0% × ~8.3 MWh + Catering 27% × ~30 MWh + Pumps 100% × ~7.5 MWh, weighted by area_share). Brief 72 P5 boundary discipline holds end-to-end.

### §1.6 Decisions logged

- The brief's expected EUI (163.5) was pre-auxiliary. Current state (185.2) is the authoritative Brief 73 anchor; the brief's "if your numbers diverge materially, log it and proceed" clause governs.
- Ventilation fan total being null (vs the brief's expected 0) doesn't change the diagnosis — it's the same bug, just whether the engine returns null or 0 depends on how the share guard fails. Part 2 reads the source.
- Per-system rollup shape unknown — discovered in Part 2.

---

## §2-diagnostic — Ventilation share rule (Part 2, 2026-05-29)

Source-read only. No code changed. Three live surfaces + one shared validator account for the bug.

### §2.1 The bug, in one sentence

`systemsEngine.js _computeVentilation` calls `_validateShares` (L648) and returns an early-exit `error` result with `total_fan_electrical_mwh: 0` whenever the sum of enabled ventilation `share_pct` values ≠ 100%. Bridgewater has three parallel ventilation systems each carrying `share_pct: 100` (the per-system default — each fan runs at its OWN flow, they don't split a shared demand), so the sum is 300% and the guard fires. Fan electricity comes back as 0 / null even though every other surface (SFP, flow, recovery effectiveness) is computed correctly.

This is the literal residual from Brief 60 Part A's incomplete fix. Brief 60 Part A (2026-05-27) recognised that `share_pct × flow` made no physical sense for parallel fans and **removed the `× share` multiplier from the fan calc** at L657-720. But the guard at L648 — which is the gatekeeper that decides whether the fan calc runs at all — was left in place. The fix achieved the right per-system math but kept the wrong gate.

### §2.2 The four surfaces

| Component | File | Line(s) | Behaviour | Action in P3 |
| --- | --- | ---: | --- | --- |
| Engine compute-guard | `frontend/src/utils/systemsEngine.js` | 648–655 | Early-exit `{ systems: [], total_fan_electrical_mwh: 0, error: '… sums to X%, not 100%' }` when ventilation shares ≠ 100% | Remove the `_validateShares` call for ventilation. Heating/cooling/DHW/thin guards stay. |
| `_validateShares` helper | `frontend/src/utils/systemsEngine.js` | 90–94 | Generic sum-to-100 check, called from heating/DHW/ventilation/thin | Keep — it's correct for the services that genuinely split one demand. Only the ventilation call site is wrong. |
| Per-system share input | `frontend/src/components/modules/systems/SystemEditorCard.jsx` | 255–274 | "Share (% of service)" number input on every ventilation system row + "⚠ service shares ≠ 100%" inline warning. Brief 53 Part 5 / Brief 60 Part A added explanatory tooltips but left the input in place. | Remove the entire `service === 'ventilation'` number-input branch. Leave the slider branch for the other services unchanged. |
| Σ NN% chip + amber styling | `frontend/src/components/modules/systems/ServiceSplitBar.jsx` | 35–112 | `enabledSum` validation + amber-coloured chip when `Math.abs(enabledSum - 100) >= 0.5`. ServiceSplitBar is rendered for ALL services uniformly. | Caller must skip ServiceSplitBar for ventilation (the simplest hand-off) OR the bar takes a `service` prop and bypasses the validation when `service === 'ventilation'` while still showing the visual segments. Decision in P3 — preference for the simpler caller-side skip. |

### §2.3 Per-service share rule matrix

| Service | Rule | Reasoning | Engine guard | Action |
| --- | --- | --- | --- | --- |
| Heating | Σ share_pct = 100% across enabled | Multiple systems splitting ONE zone demand (e.g. 80% VRF + 20% radiator backup). | `_validateShares` at `systemsEngine.js:236` | Keep |
| Cooling | Σ share_pct = 100% | Same — split one demand. | Same — folds into `_computeHeatingOrCooling` at L236 | Keep |
| DHW | Σ share_pct = 100% | Same — split one annual L/day demand across HP + boiler trim. | `_validateShares` at `systemsEngine.js:441` | Keep |
| **Ventilation** | **No rule** | Each fan runs at its OWN configured `flow_rate × flow_rate_basis`. There's no shared demand to allocate. Brief 60 Part A removed `share` from the per-fan math; the only remaining purpose of `share_pct` on a ventilation system is **display**. | `_validateShares` at `systemsEngine.js:648` (the bug) | **Remove the call** |
| Lighting / Small Power (thin) | Σ share_pct = 100% | Brief 58 Part C couples the upstream gain to a v40 service split — share weights the per-system pro-rata of the SAME upstream electrical demand. | `_validateShares` at `systemsEngine.js:776` | Keep |

### §2.4 What about `share_pct` on persisted ventilation rows?

Bridgewater's 3 vent systems all have `share_pct: 100` saved. Per the brief's P3 spec: "Migration: existing projects with `share` saved on ventilation entries — drop the field; no warning needed (it was meaningless)." Two implementation options:

- **(a) Loader migration** — strip `share_pct` from any `building.systems_config_v40.ventilation[]` entry on load, similar to the Brief 72 P3 `people_per_room` migration pattern. One-shot.
- **(b) Engine-side silent ignore** — leave the field on disk untouched; engine doesn't read it for ventilation post-P3 anyway (only `share_pct: sys.share_pct ?? 0` at L719 is preserved on the per-system result for downstream display). The field becomes vestigial-but-harmless.

Brief P3 says "drop the field; no warning needed". Preference for (a) — loader migration, no warning. Adds ~5 lines to `_brief42LoaderMigration` or equivalent. Aligns with the Brief 72 P3 pattern (silent-but-recorded removal in the loader).

### §2.5 Why Brief 60 Part A didn't see this

Brief 60 Part A's audit doc (`docs/audit/60_share_pct_audit.md`) was specifically about the fan-calc multiplication site, not the gate. The fix was scoped to "remove `× share_pct` from L657-720" and verified against Calc Trail panel reconciliation (the row sum stopped missing ~17 MWh). The gate fired silently on the path where shares ≠ 100; the post-fix anchor at the time had Bridgewater with two extract fans summing 100/0/0 = 100% (the gate passed). The regression surfaced only after Brief 72 PB re-created Bridgewater with three vent systems all at 100% — the natural per-system default when each fan is a standalone — pushing the sum to 300%. Brief 73 P3 closes the loop.

## §3 — Ventilation share fix (Part 3, 2026-05-29)

### §3.1 Bug surface — wider than the brief expected

The P1 anchor reported `c.ventilation.fan_total_mwh = null` which read as "the bug is firing on the live state." Investigation in P3 (probe script `scripts/_brief73_p3_probe.mjs`) revealed two distinct issues:

1. **Anchor script wrong-path bug**: `consumption.ventilation` is an ARRAY of per-system rollups, NOT an object with `.total_fan_electrical_mwh`. The v40 rollup lives at `consumption.brief40.ventilation.total_fan_electrical_mwh`. The anchor script's read pattern returned `null` even when the engine was producing the right number. P1 narrative is corrected in this audit; the anchor table's "fan_total_mwh: null" was a path read mistake, not the bug firing.

2. **The bug Chris saw at walkthrough** was real but transient: at walkthrough start Bridgewater's saved ventilation shares were 100/100/100 (the natural default each time a fan is added), summing to 300%, tripping `_validateShares` (`systemsEngine.js:648`), early-exiting with fan total = 0. Chris must have hand-adjusted to 33.3/33.3/33.3 (summing to 99.9%, within tolerance) before saving the post-walkthrough state — which is what the P1 anchor and the P3 probe both read. The fix here closes the loop so the next time anyone authors three vent systems they don't have to manually rebalance.

### §3.2 What landed

| Surface | File | Change |
| --- | --- | --- |
| Engine guard | `frontend/src/utils/systemsEngine.js` | Removed `_validateShares` call from `_computeVentilation` (was at L648–655). Comment block left in place describing the brief's reasoning. |
| Collapsed-row chip | `frontend/src/components/modules/systems/SystemEditorCard.jsx` L182-191 | Per-row "share %" chip hidden when `service === 'ventilation'`. |
| Expanded-row share editor | `frontend/src/components/modules/systems/SystemEditorCard.jsx` L255-289 | Entire `service === 'ventilation' ? <number-input> : <slider>` branch collapsed to "slider only when service ≠ ventilation". Brief 53 Part 5's fixed-numeric input is gone. |
| Σ N% chip | `frontend/src/components/modules/SystemsModule.jsx` L867 | Wrapped `<ServiceSplitBar>` in `service !== 'ventilation' && (…)`. ServiceSplitBar itself unchanged (caller-side skip is cleaner — the bar's amber-when-not-100 logic IS correct for the four services that genuinely split a demand). |
| Loader migration | `frontend/src/context/ProjectContext.jsx` after `_brief42LoaderMigration` invocation | Unconditional strip of `share_pct` from every `systems_config_v40.ventilation[]` entry on load. No schema_version bump (the strip is idempotent — projects that never had the field are no-op). Mirrors Brief 72 P3's `people_per_room` retirement: silent loader-side removal, no UI alarm. |

### §3.3 Gates

| Gate | Source | Method | Result |
| --- | --- | --- | --- |
| (a) Vent systems no longer show share slider / Σ warning | brief P3 | source-read SystemEditorCard + SystemsModule | ✓ branch collapsed; ServiceSplitBar skipped for ventilation. Will verify visually in P7. |
| (b) Fan electricity non-zero (~42 MWh) | brief P3 | `_brief73_p3_falsifiability.mjs` | **PASS** — 41.962 MWh total across the three Bridgewater fans (22.627 + 15.978 + 3.357), identical across all three share scenarios (33.3, 100, 0). |
| (c) Heating share validation still works | brief P3 | source-read — `_validateShares` call at `systemsEngine.js:236` untouched | ✓ structural — verify in P7 walkthrough by dragging heating system 1 to 80%. |
| (d) DHW share validation still works | brief P3 | source-read — `_validateShares` call at `systemsEngine.js:441` untouched | ✓ structural — verify in P7 walkthrough. |
| (e) Anchor preserved for everything except ventilation | brief P3 | falsifiability A/B/C all show EUI 185.2, electricity 403.543 — identical | **PASS** — Heat / Cool / DHW / Lighting / Small Power unaffected. (The fan electricity has been in the rollup all along because Bridgewater's saved shares happen to sum to 99.9%; this fix only matters for the case where shares ≠ 100%, which is now ALL ventilation editing post-this-commit.) |

### §3.4 Falsifiability artefact

`docs/audit/73_p3_falsifiability_output.json` — three scenarios run against the engine:

| Scenario | Σ shares | Pre-fix expected fan total | Post-fix observed | Pass |
| --- | ---: | ---: | ---: | --- |
| A baseline (33.3/33.3/33.3) | 99.9% | 41.962 (guard tolerance) | 41.962 | ✓ |
| B (100/100/100) | 300% | 0 (guard fires) | 41.962 | ✓ guard removed |
| C (0/0/0) | 0% | 0 (guard fires) | 41.962 | ✓ guard removed |

All three produce the SAME 41.962 MWh total — fan electricity now depends only on per-system `SFP × flow × hours_active`, regardless of `share_pct`. The invariant is the closure of Brief 60 Part A's incomplete fix.

### Per-system rollup paths (verified via probe `scripts/_brief73_p3_probe.mjs`)

`consumption` keys at the top level: `['space_heating','space_cooling','dhw','ventilation','lighting','small_power','total','daily_profiles','brief40','source_path']`.

- `consumption.ventilation` — **array** of per-system v25-shape rollups: `{ id, name, enabled, fan_electricity_mwh, hre_recovery_mwh, exhaust_loss_mwh }`. P1 anchor's `c?.ventilation?.fan_total_mwh` was always going to return `null` against an array.
- `consumption.brief40.ventilation` — `{ systems: [...], total_fan_electrical_mwh, total_recovered_heating_mwh, total_recovered_cooling_mwh }`. The v40 rollup with per-system detail (`share_pct`, `sfp_w_per_lps`, `flow_rate`, `flow_rate_basis`, `fan_electrical_mwh`, recovery / defrost / bypass). This is what the right-strip UI reads.
- `consumption.{space_heating,space_cooling,dhw}.{primary,secondary}` — Brief 38 (2026-05-19) per-system pair blocks.
- `consumption.lighting` / `consumption.small_power` — present but UNKNOWN shape; not probed (out of scope for ventilation fix).

---

## §4-diagnostic — Auxiliary visualisation (Part 4, 2026-05-29)

Source-read. No code changed. Three insertion sites + one upstream allowlist to update.

### §4.1 Confirmation: auxiliary engine rollups are healthy

P1 anchor (and §1.5) recorded:
- `consumption.heat_balance.annual.gains.internal.auxiliary.kwh = 41,117 kWh`
- `consumption.heat_balance.annual.gains.internal.auxiliary.electricity_kwh = 78,320 kWh`
- `consumption.heat_balance.annual.gains.internal.auxiliary.kwh_per_m2 = 9.51 kWh/m²`

Both numbers non-zero, gain/electricity ratio 0.525 (matches the area-weighted average of External lighting 0% + Catering 27% + Pumps 100%). **Brief 72 P5 auxiliary rollups are NOT regressed.** No escalation triggered. Proceed.

### §4.2 Heat Balance Sankey insertion (gates a, d)

`frontend/src/components/modules/balance/HeatBalance.jsx` is the live Heat Balance Sankey. (Two other look-alikes — `BalanceSankey.jsx` and `gains/canvas/HeatBalanceView.jsx` — are wrappers / hosts; HeatBalance.jsx is the data-binding component.)

**Current ribbon construction (L308–322):**
```jsx
const internal = gains.internal ?? {}
for (const k of ['people', 'equipment', 'lighting']) {
  if (!allowed.has(k)) continue
  const node = internal[k]
  if (!node) continue
  out.push({
    key:   k,
    label: LABELS[k],
    value: readValue(node, unit),
    raw_kwh: node.kwh ?? 0,
    raw_kwh_per_m2: node.kwh_per_m2 ?? 0,
    colour: INTERNAL_COLOURS[k],
    meta:   node,
  })
}
```

**P5 surgical insertion:** add `'auxiliary'` to the iteration array. The loop already pulls `internal[k]` → `internal.auxiliary` exists at the same shape (`{ kwh, electricity_kwh, kwh_per_m2 }`). `INTERNAL_COLOURS.auxiliary = '#4B5563'` and `LABELS.auxiliary = 'Auxiliary'` were both registered in Brief 72 P6 — no new tokens needed.

**Brief says "positioned between Equipment and Lighting"** → put `'auxiliary'` between `'equipment'` and `'lighting'` in the array. The same order is mirrored in `balanceColours.js GAIN_ORDER` per Brief 72 P6.

**One upstream:** `frontend/src/utils/stateMode.js` `GAIN_ORDERS` (L250–287) has per-state allowlists — `MODES.ENVELOPE_GAINS` and `MODES.FULL` both list `['solar_*', 'people', 'equipment', 'lighting' (+ 'heating' for FULL)]` but lack `'auxiliary'`. Without this addition the HeatBalance.jsx `allowed.has(k)` filter at L310 will drop the auxiliary ribbon even after the loop knows about it. **Add `'auxiliary'` to both `MODES.ENVELOPE_GAINS` and `MODES.FULL` between `equipment` and `lighting`.** This was the same oversight pattern as Brief 72 P6 (palette registered in `balanceColours.js GAIN_ORDER` but `stateMode.js GAIN_ORDERS` not updated — the two arrays are intentionally separate per the state contract).

### §4.3 Systems "Energy Flows" Sankey (gate b)

The "Energy flows" tab on the Systems page (`SystemsModule.jsx:103`) renders `SystemSankey.jsx` which consumes `systems_flow` from the engine (`instantCalc.js` constructs `sf_nodes` + `sf_links` arrays starting at L5998 in the inline-legacy 'full' path; State 3 v25 has its own equivalent block).

Insertion sites in `instantCalc.js`:
- L6049–6051 (inline-legacy): adds `lighting` and `small_power` system nodes when those loads are present. **Add an `auxiliary` system node** with `id: 'auxiliary'`, `label: 'Auxiliary'`, `category: 'auxiliary'`, `metric` showing total W/m² (sum of auxiliary profiles' magnitudes).
- L6074–6075 (inline-legacy): adds `light_del` and `equip_del` end-use nodes. **Add an `aux_del` end-use node** when auxiliary electricity > 0.
- L6081+ (links): adds `electricity → lighting → light_del` chain (and same for small_power). **Add the parallel `electricity → auxiliary → aux_del` chain** with `value_kWh = auxiliary_electricity_kWh`.

State 3 v25 path: needs the same node/link triplet at its equivalent sf_nodes/sf_links construction site. Reading source confirms — `_calculateState3` doesn't currently construct sf_nodes for State 3 itself; SystemSankey.jsx falls back to the inline-legacy construction. **Inline-legacy only is sufficient for P5.** (If a future brief breaks this fallback, that's the place to fix.)

Colour: `LINK_COLORS.electricity = '#ECB01F'` already handles the upstream link. The auxiliary node's own colour is set by `NODE_COLORS.system` (cyan-on-blue) — to render in `#4B5563`, P5 should add a `NODE_COLORS.auxiliary` entry OR use a per-node `colour` field. The brief explicitly says "use `#4B5563` from balanceColours.js INTERNAL_COLOURS" so the cleanest play is to import INTERNAL_COLOURS in SystemSankey.jsx and override the auxiliary node's render colour. Alternative: read `INTERNAL_COLOURS.auxiliary` at engine emit time and stamp it onto the sf_node so SystemSankey doesn't have to know about colour palettes — that's the same pattern already used for `solar_*` nodes elsewhere.

### §4.4 Right-strip per-service breakdown (gate c)

`SystemsModule.jsx` L2208–2209:
```jsx
{ key: 'lighting',      label: 'Lighting',      node: { delivered_mwh: consumption.lighting?.electricity_mwh ?? 0, ... } },
{ key: 'small_power',   label: 'Small power',   node: { delivered_mwh: consumption.small_power?.electricity_mwh ?? 0, ... } },
```

**P5 insertion:** add an entry below `small_power`:
```jsx
{ key: 'auxiliary',     label: 'Auxiliary',     node: { delivered_mwh: <aux electricity>, demand_mwh: <aux gain>, electricity_mwh: <aux electricity>, gas_mwh: 0, enabled: true } },
```

Source values: `consumption.heat_balance.annual.gains.internal.auxiliary.electricity_kwh / 1000` for electricity, `…auxiliary.kwh / 1000` for the heat-gain side. (Note: the right-strip's `demand_mwh` field is more naturally "heat gain to zone" for auxiliary — the only consumer here is the visual; downstream `_systemPerf` accounting isn't routed through this strip.)

### §4.5 Summary of P5 edits

| File | Change |
| --- | --- |
| `frontend/src/utils/stateMode.js` GAIN_ORDERS | Add `'auxiliary'` between `equipment` and `lighting` in both `MODES.ENVELOPE_GAINS` and `MODES.FULL`. |
| `frontend/src/components/modules/balance/HeatBalance.jsx` L309 | Loop array: `['people', 'equipment', 'auxiliary', 'lighting']`. |
| `frontend/src/utils/instantCalc.js` sf_nodes + sf_links (~L6049, ~L6075, ~L6081) | Add `auxiliary` system node + `aux_del` end-use node + electricity → auxiliary → aux_del link chain. Stamp `colour: '#4B5563'` on the node. |
| `frontend/src/components/modules/SystemsModule.jsx` L2208–2209 | Add `{ key: 'auxiliary', label: 'Auxiliary', ... }` entry to the right-strip per-service list. |

No engine-physics changes — all surfaces are display-only readers of `consumption.heat_balance.annual.gains.internal.auxiliary` (already populated by Brief 72 P5).

### §4.6 EnergyFlowsTab on Results (out of scope but adjacent)

`frontend/src/components/modules/results/EnergyFlowsTab.jsx` is the Results module's own Energy Flows Sankey (different from the Systems Sankey). It currently reads `ae.lighting_kWh` and `ae.equipment_kWh` from a parallel `annualEnergy` aggregation (L41–47) — NOT from `consumption.heat_balance.annual.gains.internal`. Wiring auxiliary here would require adding `ae.auxiliary_kWh` to the upstream `annualEnergy` builder, which is a different code path. **The brief's "Energy Flows Sankey" mention is consistent with the Systems-page tab (SystemSankey.jsx), and the brief excludes "any Sankey redesign beyond adding the missing ribbon."** Leaving Results EnergyFlowsTab for a future brief — flagged in §future.

---

## §6 — Lighting + Small Power reconciliation (Part 6, pending)

Initial observation from §1.5: Lighting internal gain 56.28 MWh and Small Power 172.10 MWh match the brief's "post-re-creation" expected numbers within 0.1%. They diverge from pre-loss Lighting 128.6 / Small Power 116.7 by the same magnitude observed at Brief 72 PB close — which means the divergence is NOT new, and the question Part 6 has to answer is whether the re-creation was an acceptable rebaseline (a) or whether a specific input value is wrong (b). Engine regression (c) is unlikely because Brief 72 P5 falsifiability already proved `gain_fraction = 1.0` defaults hold structurally.

---

## §future — Tier-3 notes for next brief

- **EnergyFlowsTab on Results** (`frontend/src/components/modules/results/EnergyFlowsTab.jsx`) reads from a parallel `annualEnergy` aggregation (`ae.lighting_kWh` / `ae.equipment_kWh`) rather than `consumption.heat_balance.annual.gains.internal`. Wiring auxiliary here would need the upstream `annualEnergy` builder updated. Out of Brief 73 scope per "no Sankey redesign beyond adding the missing ribbon" — flag for a future brief if the Results tab's Energy Flows surface needs auxiliary parity.
- **Per-row collapse-state persistence** (carried forward from Brief 47 Part 5c).

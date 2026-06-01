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

### §2.6 Per-system rollup paths (deferred discovery from P1)

Anchor script `_brief73_p1_anchor.mjs` read `consumption.{service}.systems` and got empty arrays. The actual engine result structure (read from `instantCalc.js` L5318–5400 and L5542) splits per-system data across two locations:

- `consumption.ventilation` — **an array** of per-system v25-shape rollups: `{ id, name, enabled, fan_electricity_mwh, hre_recovery_mwh, ... }`. Anchor script's `c?.ventilation?.systems` was wrong — should iterate `c?.ventilation` directly. When `_validateShares` blocks, this array is also empty (cascading from the guard).
- `consumption.brief40` — top-level field carrying the full v40 brief40Computed output (heating / cooling / dhw / ventilation / lighting / small_power blocks each with per-system arrays). Used by `SystemEditorCard` + `SystemsDiagnosticPanel` for the right-strip per-system detail.
- `consumption.{space_heating,space_cooling,dhw}.{primary,secondary}` — per-system pair (primary + secondary) v25-shape blocks for heating/cooling/DHW. Brief 38 (2026-05-19).

P3 verification script will use `consumption.brief40.ventilation` for the fan electricity rollup (matches what the right-strip UI reads). The P1 anchor narrative remains valid — totals and internal gains were read correctly; only per-system breakdowns came back empty under the wrong path key.

---

## §4-diagnostic — Auxiliary visualisation (Part 4, pending)

To be filled in Part 4.

---

## §6 — Lighting + Small Power reconciliation (Part 6, pending)

Initial observation from §1.5: Lighting internal gain 56.28 MWh and Small Power 172.10 MWh match the brief's "post-re-creation" expected numbers within 0.1%. They diverge from pre-loss Lighting 128.6 / Small Power 116.7 by the same magnitude observed at Brief 72 PB close — which means the divergence is NOT new, and the question Part 6 has to answer is whether the re-creation was an acceptable rebaseline (a) or whether a specific input value is wrong (b). Engine regression (c) is unlikely because Brief 72 P5 falsifiability already proved `gain_fraction = 1.0` defaults hold structurally.

---

## §future — Tier-3 notes for next brief

(Empty at brief land.)

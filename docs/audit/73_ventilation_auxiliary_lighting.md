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

## §2-diagnostic — Ventilation share rule (Part 2, pending)

To be filled in Part 2.

---

## §4-diagnostic — Auxiliary visualisation (Part 4, pending)

To be filled in Part 4.

---

## §6 — Lighting + Small Power reconciliation (Part 6, pending)

Initial observation from §1.5: Lighting internal gain 56.28 MWh and Small Power 172.10 MWh match the brief's "post-re-creation" expected numbers within 0.1%. They diverge from pre-loss Lighting 128.6 / Small Power 116.7 by the same magnitude observed at Brief 72 PB close — which means the divergence is NOT new, and the question Part 6 has to answer is whether the re-creation was an acceptable rebaseline (a) or whether a specific input value is wrong (b). Engine regression (c) is unlikely because Brief 72 P5 falsifiability already proved `gain_fraction = 1.0` defaults hold structurally.

---

## §future — Tier-3 notes for next brief

(Empty at brief land.)

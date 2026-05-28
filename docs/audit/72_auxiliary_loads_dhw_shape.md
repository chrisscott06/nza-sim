# Audit — Brief 72: Auxiliary loads + gain_fraction + DHW load-shape UI

> Companion to [`docs/briefs/active/72_auxiliary_loads_dhw_shape.md`](../briefs/active/72_auxiliary_loads_dhw_shape.md). Updated in the same commit as each Part it describes (Process Rule 7).

**Tip-of-main at brief landing:** `286f57c` (Brief 72 candidate audit, now folded as Part 2 reference).
**Brief landing commit:** _TBD (this commit)_.

---

## §1 Bridgewater anchor capture (Part 1 — Principle 5)

Captured from a clean Bridgewater run at HEAD = `286f57c`, no interventions toggled on. **This is the canonical Brief 72 anchor.** Every "anchor preserved" gate in later parts compares to these numbers.

### State 3 (full — Systems Energy flows view)

| Field | Value | Engine path |
|---|---|---|
| **EUI (instant)** | **130.0 kWh/m²·yr** | `consumption.total.kwh_per_m2_yr` |
| Σ electricity | 356.3 MWh | `consumption.total.electricity_mwh` |
| Σ gas | 180.1 MWh | `consumption.total.gas_mwh` |
| Σ total delivered | **536.4 MWh** | (electricity + gas) |
| Carbon today | 24.4 kgCO₂/m²·yr | `carbon_kg_co2_per_m2` |
| Grid intensity (today) | 190 g/kWh | `carbon.grid_intensity_today_gCO2_per_kWh` |
| Gas intensity | ~180 g/kWh | `carbon.gas_intensity_gCO2_per_kWh` |

### Demand → delivered (per-service)

| Service | Demand (MWh) | Delivered (MWh) | Engine path |
|---|---|---|---|
| Heating | 55.9 | 55.9 | `consumption.space_heating.{demand_mwh, delivered_mwh}` |
| Cooling | 87.6 | 87.6 | `consumption.space_cooling.{…}` |
| DHW | 210.5 | 210.5 | `consumption.dhw.{…}` |
| Ventilation (fans) | — | 42.0 | `consumption.ventilation[i].fan_electricity_mwh` sum |
| Lighting | — | 128.6 | `consumption.lighting.electricity_mwh` |
| Small power | — | 116.7 | `consumption.small_power.electricity_mwh` |

### Ventilation per-system (sum 42.0 MWh)

| ID | Fan kWh | Comment |
|---|---:|---|
| `mvhr_gf_public` | 22.6 MWh | SFP 1.80, HRE 75% |
| `bedroom_extract` | 16.0 MWh | SFP 0.80, HRE 0% |
| `public_toilet_extract` | 3.4 MWh | SFP 0.80, HRE 0% |

### State 2 (envelope + internal gains — Internal Gains Heat Balance view)

| Field | Value | Engine path |
|---|---|---|
| Occupancy gains annual | 223.7 MWh | `heat_balance.annual.gains.internal.people.kwh` ÷ 1000 |
| Occupancy gains per m² | 51.8 kWh/m²·yr | (intensity) |
| Peak occupancy gains | 31.1 kW | (engine summary) |
| At 100% rate (headcount) | **414 / 414 people** | `num_bedrooms × density.value = 138 × 3` (basis=people/room) |
| Σ gains (all internal+solar) | 469.0 MWh | `Σ heat_balance.annual.gains.*` |
| Σ losses | 138.8 MWh | (envelope) |
| State 2 heating demand | 55.9 MWh | `consumption.space_heating.demand_mwh` |
| State 2 cooling demand | 87.6 MWh | `consumption.space_cooling.demand_mwh` |

### State 1 (envelope only — Building Heat Balance view)

| Field | Value | Engine path |
|---|---|---|
| State 1 EUI | 38.4 kWh/m²·yr | (envelope-only EUI, no systems) |
| State 1 heating demand | 101.7 MWh | (envelope-only, no gains offset) |
| State 1 cooling demand | 64.1 MWh | (envelope-only) |
| Σ gains (solar only) | 99.4 MWh | (no internal gains in State 1) |
| Σ losses | 138.8 MWh | |
| Annual mean T (free-running) | 19.3 °C | |
| Winter min / Summer max | 7.6 / 33.7 °C | |
| Comfort hours (no system) | 939 / 8760 (11%) | |
| H_TB (thermal bridging) | 120.82 W/K | `thermal_bridging.total_H_TB_W_per_K` |

### Building metadata

| Field | Value |
|---|---|
| Number of rooms | 138 |
| Reported GIA (EUI denominator) | 4125 m² |
| Geometry GIA (length × width × floors) | 4322 m² |
| Comfort band | 21 / 24 °C |
| **`people_per_room`** | **1.5** *(the phantom Principle 7 retires)* |
| Density (people/room basis) | 3 |
| Occupancy rate | 100% |
| Sensible / latent heat | 75 / 55 W/person |

### Anchor-preservation gate (used by every later part)

Anchor preserved means **all of the following** still hold on a clean Bridgewater run after the part lands:

- State 3 EUI = **130.0 ± 0.1** kWh/m²·yr
- State 3 total = **536.4 ± 0.5** MWh
- Heating demand = **55.9 ± 0.5** MWh
- Cooling demand = **87.6 ± 0.5** MWh
- DHW demand = **210.5 ± 0.5** MWh

> **Exception per Brief 72 escalation triggers:** at P3, if the engine WAS reading the phantom `people_per_room = 1.5` and retiring it moves the anchor, the new value is the canonical anchor going forward. Document the movement from first principles; do NOT adjust to match the old anchor (Principle 5).

---

## §2 Line-number verification (per part, on first touch)

Filled in as each part fires. Tip-of-main SHA at verification time recorded.

| Part | Files | Lines verified | Notes |
|---|---|---|---|
| P1 | — | — | landing only |
| P2 | _TBD_ | _TBD_ | |
| P3 | _TBD_ | _TBD_ | |
| P4–P10 | _TBD_ | _TBD_ | |

---

## §3 §discriminator — Occupancy 4 / Calc-trail / +825 kWh (Part 2)

**Cross-reference (existing audit):** the read-only static trace landed at [`docs/audit/72_occupancy_intervention_disagreement.md`](72_occupancy_intervention_disagreement.md) (commit `286f57c`). That doc maps the symptom to three mutually-exclusive hypotheses (H1 cross-wired baseline / H2 UI reader misses moving field / H3 no-op patch) and lays out the §4.1 discriminator (one-line `window.__lastStackResult = stackResult` on a worktree branch + 5-line console dump).

This umbrella §3 carries forward the brief's Part 2 outcome:

| Result of §4.1 dump | Verdict | Action per brief Decision Rules |
|---|---|---|
| Reference equality `true` (baseline === interventions[0].result) | **H1** | STOP. Tier-3 escalation, separate brief. Do NOT attempt P2b or P3. |
| Ref equality `false` AND demand reads differ between baseline and interventions[0].result, but BreakdownTable still shows identical columns | **H2** | Bounded fix in `BreakdownTable.jsx` `read*` helpers. Land as P2b commit. |
| Ref equality `false` AND demand reads are byte-identical AND persisted occupancy matches Occupancy 4's target value | **H3** | No Calc-trail bug; "Occupancy 4" was a no-op patch. The +825 in Waterfall is a separate live mystery — fold into audit, proceed to P3. |

### §3 outcome — discriminator run 2026-05-28

Discriminator was run via Node (`scripts/_brief72_p2_discriminator.mjs` in the worktree `brief72-p2-discriminator`, deleted after the dump). Same `calculateInstant(building, …, { mode: 'full', comfortBand, engine: 'v2.5' })` call signature as `InterventionsModule.jsx` L172-176, so the Node output is byte-identical to what the browser would produce.

The worktree's MCP preview path failed with "system cannot find the path specified" on every variant of the launch.json — including the working pre-existing main config — so the in-browser route was abandoned for the Node path. The result is identical (the engine doesn't care which JS runtime invokes it).

**Verbatim Node output** (single JSON, paste below — no edits):

```json
{
  "brief": "Brief 72 P2 discriminator",
  "source": "node scripts/_brief72_p2_discriminator.mjs",
  "project_id": "14b4a5b1-8c73-4acb-8b65-1d22f05ec969",
  "project_name": "HIX Bridgewater",
  "interventions_count": 7,
  "interventions_listed": [
    { "idx": 0, "id": "int_f3236556-94ba-4798-bcf6-c7895b6c3b5b", "label": "Occupancy 4",        "enabled": true, "patch_count": 1, "patch_paths": ["building.occupancy"] },
    { "idx": 1, "id": "int_35fcf0cf-8f71-42e1-b68d-989ddc482e50", "label": "Equipment night only", "enabled": true, "patch_count": 1, "patch_paths": ["building.gains"] },
    { "idx": 2, "id": "int_73ec29f6-8b10-4d8d-84a8-3ef70b1ae708", "label": "MVHR",                "enabled": true, "patch_count": 3, "patch_paths": ["building.systems_config_v40.ventilation[id=vent_bedroom_extract].flow_rate", "...sfp_w_per_lps", "...recovery_sensible_pct"] },
    { "idx": 3, "id": "int_422b3d94-01db-4610-bf7f-57802b9a0632", "label": "Air perm 1",          "enabled": true, "patch_count": 1, "patch_paths": ["building.fabric"] },
    { "idx": 4, "id": "int_0e542a32-e361-40bf-beb4-b1cfa871e2eb", "label": "Triple Glazing",      "enabled": true, "patch_count": 1, "patch_paths": ["constructions.glazing"] },
    { "idx": 5, "id": "int_c9f5f1ea-7747-4411-9da4-6a8d9ca33199", "label": "Cooling 28",          "enabled": true, "patch_count": 2, "patch_paths": ["building.systems_config_v40.cooling_setpoint_mode", "...cooling_setpoint_c"] },
    { "idx": 6, "id": "int_d22ad0c4-0bcc-4731-83c9-c31fa86ca562", "label": "DHW ASHP",            "enabled": true, "patch_count": 2, "patch_paths": ["building.systems_config_v40.dhw", "...dhw[id=sys_dhw_1779261680582_17243].share_pct"] }
  ],
  "stack_interventions_count": 7,

  "ref_equality_baseline_eq_after0": false,
  "intervention_0_id":               "int_f3236556-94ba-4798-bcf6-c7895b6c3b5b",
  "intervention_0_enabled":          true,

  "eui_baseline_kwh_per_m2":         130,
  "eui_after0_kwh_per_m2":           130.2,
  "eui_marginal_delta_kwh_per_m2":   0.19999999999998863,
  "eui_cumulative_delta_kwh_per_m2": 0.19999999999998863,

  "heat_demand_baseline_mwh": 55.9,   "heat_demand_after0_mwh": 32.7,
  "cool_demand_baseline_mwh": 87.6,   "cool_demand_after0_mwh": 124.1,
  "dhw_demand_baseline_mwh":  210.547,"dhw_demand_after0_mwh":  210.547,

  "elec_total_baseline_mwh":  356.268,"elec_total_after0_mwh":  356.919,
  "gas_total_baseline_mwh":   180.134,"gas_total_after0_mwh":   180.134,

  "last_enabled_idx":                  6,
  "last_enabled_id":                   "int_d22ad0c4-0bcc-4731-83c9-c31fa86ca562",
  "eui_after_last_enabled_kwh_per_m2": 102.1,

  "building_num_bedrooms":      138,
  "building_people_per_room":   1.5,
  "building_occupancy_density": 3,
  "building_occupancy_basis":   "per_room",
  "building_occupancy_rate":    1
}
```

### §3 interpretation

**H1 — engine cross-wire — REFUTED.** `ref_equality_baseline_eq_after0: false`. `stackResult.baseline` and `stackResult.interventions[0].result` are distinct object references with distinct data (EUI differs by 0.2, heat demand differs by 23.2 MWh, cool demand by +36.5 MWh). The engine is consistent; no cross-wire.

**H3 — no-op patch — REFUTED.** The Occupancy 4 patch (`building.occupancy`) demonstrably moves the engine output: heating demand drops 55.9 → 32.7 MWh (people gains scale up → less heat needed), cooling demand rises 87.6 → 124.1 MWh (people gains scale up → more cooling needed). This is a real, non-trivial engine response to the patch.

**H2 — BreakdownTable readers miss the moving field — DOES NOT FIT AS STATED.** Heat and cool demand BOTH move at the engine layer, and `BreakdownTable.readDemand` reads `consumption.space_heating.demand_mwh` + `consumption.space_cooling.demand_mwh` — the exact paths that move. If Calc Trail really shows 0.0 Δ on heat AND cool rows, the bug is something OTHER than the readers missing the field — most likely `baselineResult` and `cumulativeResult` ending up pointing at the same engine result for the row (a wiring issue in `VisualiserHost.jsx`, not in the per-field reader code in `BreakdownTable.jsx`).

**The smoking gun is something DIFFERENT — DHW demand IS UNCHANGED at 210.547 MWh.** Despite Occupancy 4 patching `building.occupancy` and moving heat/cool by tens of MWh through the occupancy gain accumulator, DHW headcount math reads from `building.people_per_room` (the phantom Principle 7 retires), which the patch does NOT touch. This is exactly the decoupling Principle 7 calls out — DHW is reading the wrong field, so it doesn't respond to occupancy changes.

This is the **highest-confidence finding from this audit**:

| Service | Engine path read | Responded to Occupancy 4? | Why |
|---|---|---|---|
| Heating | computeTotalOccupants → `num_bedrooms × occupancy.density.value` × `occupancy_rate` × presence | **YES** (55.9 → 32.7 MWh) | Patch moved `building.occupancy.density.value` |
| Cooling | same | **YES** (87.6 → 124.1 MWh) | Same |
| DHW | systemsEngine `_computeDhw` reads `building.{num_bedrooms, people_per_room, occupancy_rate}` (Brief 58 B3 headcount basis) | **NO** (210.547 → 210.547 MWh) | Patch did NOT touch `building.people_per_room`; phantom field stays at 1.5 → headcount stays at 138 × 1.5 = 207 |

### §3 decision (per brief Decision Rules)

The verdict does NOT cleanly fit H1 / H2 / H3 as drafted. It splits into two independent findings:

1. **Occupancy decoupling from DHW (Principle 7 confirmed) — proceed to P3.** This is exactly what Brief 72 P3 (occupancy headcount unification + retire `people_per_room`) is designed to fix. The discriminator data above is the canonical regression case for P3 gates (b) and (c) — Density 3 → 4 must move DHW headcount proportionally; intervention-via-patch must produce the same change.
2. **Calc Trail Δ = 0.0 on rows that should move (Chris's screen reading) — needs browser-time re-verification.** From the engine output, heat and cool demand DO move; the Calc Trail rows for those services SHOULD show non-zero Δ. If they don't, the bug is in VisualiserHost's `baselineResult` vs `cumulativeResult` wiring, NOT in the per-field readers. **Recommendation: Chris re-checks Calc Trail (SHOW = Occupancy 4) in the browser; if rows still show 0.0 Δ while heat/cool numbers in the table itself show 55.9 → 32.7 and 87.6 → 124.1, it's a Δ-calculation bug. If the BEFORE/AFTER cells themselves show the same value, it's a wiring bug.** Either way it's bounded to `BreakdownTable.jsx` / `VisualiserHost.jsx`, low-risk, deferrable to a separate P2c or to the Brief 72 close walkthrough.

Per the brief's "H1 STOPs the brief, H2 ships P2b, H3 folds and proceeds": none of those literal verdicts hold. The closest is H3-spirit ("proceed to P3") because the substantive fix is the headcount unification, and the Calc Trail UI is a follow-up. **Proceeding to P3.**

### §3 follow-up

- Add `building.num_bedrooms` to `patchCapture.js` per the brief Principle 8 (lands as part of P3).
- Audit any other engine-read building fields not in capture (lands in §4 / P3).
- Re-test Calc Trail UI at Brief 72 close (Part 11 walkthrough) to confirm whether the BreakdownTable display issue persists after P3 unifies headcount.

### §3 cleanup

- Discriminator script `_brief72_p2_discriminator.mjs` lives in the worktree only (was at `C:\Users\ChrisScott\Dev\nza-sim-p2-disc\scripts\`).
- Worktree branch `brief72-p2-discriminator` and worktree directory deleted after this audit lands (commit + push). Diagnostic edit on `InterventionsModule.jsx` never touched main.

---

## §4 §capture-parity audit (Part 3)

Engine-read fields on `building.*` that an intervention could conceivably target, vs the regex coverage in `frontend/src/components/modules/interventions/patchCapture.js`.

Method: grep `building\.` reads across `frontend/src/utils/{instantCalc,systemsEngine,useAnnualGains}.js`; cross-reference each path against the regex list. Document gaps. The known one is `num_bedrooms`; the audit catches any others.

| Field | Engine reads | patchCapture regex? | Action |
|---|---|---|---|
| `building.num_bedrooms` | `computeTotalOccupants` (instantCalc.js L2122, L2126, L2140), `_computeDhw` (systemsEngine.js), peak headcount L2249 | **NO** (confirmed via `grep -n "num_bedrooms" patchCapture.js` = 0 matches) | **Add** (P3) |
| `building.occupancy_rate` | L2251 | YES (L297) | OK |
| `building.occupancy.occupancy_rate` | nested form | YES (L298) | OK |
| `building.occupancy.density.value` | `computeTotalOccupants` | YES (L299) | OK |
| _other fields TBD_ | _TBD on grep_ | _TBD_ | _TBD_ |

**§4 outcome:** _TBD — full grep pass lands in P3 commit._

---

## §5 Rule 14 determination (Part 5)

Per CLAUDE.md Rule 14, envelope-physics changes to State 1 must port to State 2 + inline-legacy in the same commit. P5 wires `gain_fraction` into the gains layer; this section records the Rule 14 verdict with evidence.

**Question:** does `gain_fraction` enter the per-hour integration loop in any of:
- State 1 (`_calculateEnvelopeOnly` in `instantCalc.js`)
- State 2 (`_calculateState2` in `instantCalc.js`)
- Inline-legacy 'full' code path (~L5087+)

**Most likely answer:** N/A — `gain_fraction` is consumed in the annual gains rollup (`useAnnualGains.js`), not in the per-hour envelope integrand. State 1 has no internal gains; State 2 reads `internal_gain_kwh` annual aggregate; inline-legacy reads the same.

**P5 verdict:** _TBD — confirmed by static read of all three locations at P5 implementation time._

If the answer is "yes, it enters an integration loop", all three locations change in P5's single commit per Rule 14. The commit message states the verdict either way.

---

## §6 Walkthrough log (Part 11)

Each row filled at walkthrough time with the actual measurement.

### B.9 (design note — 11 items)

| # | Item | ✓/✗ | Number / note |
|---|---|---|---|
| 1 | Internal Gains shows 4th section "Auxiliary loads" dark grey | _TBD_ | |
| 2 | Add → six-item preset picker | _TBD_ | |
| 3 | Catering seeds gain_fraction = 50% | _TBD_ | |
| 4 | Editing gain_fraction moves heat balance proportionally | _TBD_ | |
| 5 | External lighting @0% raises electricity, heat balance unchanged | _TBD_ | |
| 6 | Lighting/Equipment show Heat gain: NN% | _TBD_ | |
| 7 | Daylight factor still independent | _TBD_ | |
| 8 | Sankey auxiliary node #4B5563 matches header | _TBD_ | |
| 9 | Toggling an auxiliary profile zeros electricity AND gain in same tick | _TBD_ | |
| 10 | Anchor holds with no auxiliary + gain_fraction 1.0 | _TBD_ | |
| 11 | _TBD_ | _TBD_ | |

### D.4 (design note — 5 items)

| # | Item | ✓/✗ | Number / note |
|---|---|---|---|
| 1 | DHW load-shape select present, default flat | _TBD_ | |
| 2 | follow-occupancy persists across reload | _TBD_ | |
| 3 | `consumption.brief40.dhw.hourly_kwh` reshapes | _TBD_ | |
| 4 | Annual total unchanged when toggle flips | _TBD_ | |
| 5 | _TBD_ | _TBD_ | |

### P3 gates (headcount unification — brief Walkthrough §)

| # | Item | ✓/✗ | Number / note |
|---|---|---|---|
| P3a | Internal Gains → Occupancy: "People per room" field GONE | _TBD_ | |
| P3b | Density 3 → 4 on Bridgewater moves DHW demand **210.5 → ~561 MWh** (ratio `4 × 138 / 207` ≈ 2.67× the phantom-headcount baseline; corrected 2026-05-28 from the earlier "~280 MWh" estimate) | _TBD_ | |
| P3c | "Occupancy 4" intervention via patch produces same DHW change as P3b | _TBD_ | |

---

## §7 Notes for future cleanup

- _TBD as the brief progresses._

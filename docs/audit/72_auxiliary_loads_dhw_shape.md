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

**§3 outcome:** _TBD — pending §4.1 dump on a worktree branch._

**§3 follow-up (regardless of H1/H2/H3 verdict):** add `building.num_bedrooms` to `patchCapture.js` (Code's side finding). Lands as part of P3 per the brief.

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
| P3b | Density 3 → 4 on Bridgewater moves DHW demand 210 → ~280 MWh | _TBD_ | |
| P3c | "Occupancy 4" intervention via patch produces same DHW change as P3b | _TBD_ | |

---

## §7 Notes for future cleanup

- _TBD as the brief progresses._

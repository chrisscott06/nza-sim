# Brief 75 audit — Full ventilation heat modelling + Bridgewater heating-demand-zero diagnostic

Companion to `docs/briefs/active/75_ventilation_heat_modelling.md`. Each section updated at the close of its corresponding brief Part.

Tip at brief land: `a209dc2` (Brief 74 P6 close).

Primary input: `docs/audit/74_bridgewater_over_gained_followup.md` — three candidate root causes for Bridgewater's `heating_demand = 0`:
- (a) Brief 73 P6 CIBSE-default-rebaseline outcome was wrong (defaults probably not actually CIBSE).
- (b) Zone heat balance over-saturating gains (utilisation factor or gains-warmed T_air trace).
- (c) Ventilation losses not feeding back into heating demand (gating bug on `dT_heat_out`).

P2 read-only diagnostic decides which.

---

## §1 — Bridgewater clean anchor (Part 1, 2026-06-01)

Captured via `node scripts/_brief75_p1_anchor.mjs`. Full JSON at `docs/audit/75_p1_anchor_output.json`.

### §1.1 Engine dispatch — settled

`result.state = 3`, `result.mode = 'full'` → **`_calculateState3` IS the live engine path on Bridgewater.** Brief 74 §6.3 / §6.5 dispatch analysis was wrong; the live UI does reach State 3. Probe quirk that surfaced this: calling `calculateInstant` WITHOUT `engine: 'v2.5'` opt-in crashes immediately at `_buildHeatBalance:6553` with "building is not defined" — a pre-existing bug in the inline-legacy 'full' path. The live SystemSankey caller doesn't trip it, which is the evidence. P3 will need to confirm the dispatch trigger (likely `hasV25Library` evaluating true via the live library API loader) and land the refactor on the State 3 path.

### §1.2 Building metadata

| Field | Value |
| --- | ---: |
| num_bedrooms | 138 |
| occupancy.density | 3 per_room |
| occupancy.occupancy_rate | 1.0 |
| geometry_gia_m2 | 4,125 |
| reported_gia_m2 (EUI denominator) | 4,125 |
| weather_file | `GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw` |
| comfort_band_c | 21 / 24 |

### §1.3 Headline anchor — captured

| Metric | Value | Brief 75 expected | Δ |
| --- | ---: | ---: | ---: |
| EUI (kWh/m²·yr) | **150.7** | ~133.6 | brief used pre-Brief-74-P3 figure; post-P3 the figure is 150.7 (P3 added +70.5 MWh aux to electricity_total_kwh) |
| Σ electricity (MWh) | **416.938** | ~416.9 | ✓ matches |
| Σ gas (MWh) | **204.698** | ~204.7 | ✓ matches |
| heating_demand (MWh) | **0.0** | 0 | ✓ matches — the subject of this brief |
| cooling_demand (MWh) | **302.1** | ~301 | ✓ matches |
| dhw_demand (MWh) | 263.183 | – | – |
| vent fan total (MWh) | 41.962 | ~42 | ✓ matches |

### §1.4 Heat balance — engine totals (raw, not browser-shown)

| Element | Value (MWh) | Notes |
| --- | ---: | --- |
| Σ losses (engine `totals.losses_kwh / 1000`) | **221.4** | fabric + infiltration + permanent_vents + (mech_ventilation=0). NOTE: the browser-shown "Σ losses 472.0 MWh" includes cooling (302.1) plus a different aggregation. |
| Σ gains (engine `totals.gains_kwh / 1000`) | **488.0** | matches browser. |
| Net raw (gains − losses) | **+266.6** | massive imbalance at the engine raw layer. Browser shows +16 MWh because it applies utilisation factor + deducts cooling. P3 needs to make this transparent (currently the +16 "balanced" reading is correct visually but the underlying physical flows aren't all accounted on the loss side). |

Loss elements (engine raw, kWh):

| Element | kWh | kWh/m² | Notes |
| --- | ---: | ---: | --- |
| external_wall | 37,892.6 | 8.77 | |
| roof | 17,406.9 | 4.03 | |
| ground_floor | 21,209.9 | 4.91 | |
| glazing | 73,680.1 | 17.05 | |
| thermal_bridging | 24,279.8 | 5.62 | |
| fabric_leakage (= infiltration) | 33,899.1 | 7.84 | ach 0.066 |
| permanent_vents | 13,029.7 | 3.01 | |
| **mech_ventilation** | **0** | 0 | Brief 74 P5 emit; reads as 0 because engine gates on dT_heat_out > 0 which never fires (heating_demand = 0). The subject of P3. |

### §1.5 Internal gains breakdown — the suspect

| Element | kWh | kWh/m² | Benchmark notes |
| --- | ---: | ---: | --- |
| people | 144,490.9 | 33.43 | Full hotel occupancy at 138 × 3 per_room × 1.0 rate. Sensitive to schedule shape; high but plausible for an aggressive hotel-occupancy assumption. |
| equipment | 130,297.9 | 30.15 | **HIGH.** CIBSE TM54 hotel guidance: equipment 5-15 kWh/m²·yr. |
| lighting | 56,281.8 | 13.02 | **HIGH.** CIBSE TM54 hotel guidance: lighting 8-12 kWh/m²·yr. |
| auxiliary | 53,251.3 gain (70,500 electricity) | 12.32 / 17.09 | Auxiliary loads — catering hoods, external lighting, lifts, etc. Wide range; 12 kWh/m² gain is mid-pack for a hotel. Electricity 17 kWh/m² is itself toward the upper end. |
| **Σ internal (excl. people)** | **239,830.9** | **58.13** | CIBSE TM54 combined non-people: ~20-30 kWh/m²·yr. **Bridgewater is roughly 2× over.** |
| **Σ internal (all)** | **384,321.9** | **93.2** | Including people. |

### §1.6 Ventilation per-system

| ID | Flow (L/s) | SFP | HRE | Fan elec (MWh) |
| --- | ---: | ---: | ---: | ---: |
| vent_mvhr_gf_public | 1,435 | 1.8 | 75% | 22.627 |
| vent_bedroom_extract | 2,280 | 0.8 | 0% | 15.978 |
| vent_public_toilet_extract | 479 | 0.8 | 0% | 3.357 |
| **Total** | **4,194** | – | – | **41.962** |

### §1.7 First-principles mech vent gross estimate — corrected

JSON inline estimate `first_principles_mech_vent_gross_estimate_mwh: 1269.7` is **wrong** (formula error in the probe; ignore). Corrected calculation here:

- Total flow: 4,194 L/s = 15,100 m³/h
- ΔT_annual_avg (Yeovilton mean ~10 °C, indoor 21 °C): ~11 K
- ρ·cp: 1.225 kg/m³ × 1.005 kJ/kg·K = 1.231 kJ/m³·K
- Hours: 8,760

Gross (no HRE):
- `15,100 × 1.231 × 11 × 8,760 / 3,600 = 497 MWh/yr`

With HRE applied (only mvhr_gf_public has 75%):
- mvhr_gf_public: `(1,435 / 4,194) × 497 × (1 − 0.75) = 42 MWh`
- bedroom_extract:  `(2,280 / 4,194) × 497 × 1.0 = 270 MWh`
- public_toilet_extract: `(479 / 4,194) × 497 × 1.0 = 57 MWh`
- **Net mech vent extract ≈ 369 MWh/yr**

This is the order-of-magnitude target P3's `mech_vent_thermal_kwh` should emit (the engine number need only agree within ~10%). Engine currently reports **0**. The gap is what P3 closes.

(MVHR recovery for P4: `(1,435 / 4,194) × 497 × 0.75 ≈ 128 MWh/yr` — same order as the brief's "40-70 MWh" estimate ÷ further weighted by hours-actually-on, year-fraction MVHR runs, etc. Refine in P4.)

### §1.8 Reading for P2

The internal-gains 93 kWh/m² total — 58 kWh/m² excluding people — is well above CIBSE TM54 hotel benchmarks. Outcome (a) ("inputs too generous") is the favoured hypothesis going into P2. But the corrected first-principles ventilation extract of ~369 MWh/yr that the engine reports as 0 is structurally separate — it's a Rule-9 violation (a real heat term not entering the displayed loss side) regardless of whether outcome (a) lands. **P3 closes both findings:** decompose the physical flow from the demand compensation, and the visualisation can then show the vent loss truthfully whether or not heating_demand happens to be zero this year.

---

## §2-diagnostic — Heating-demand-zero diagnostic (Part 2, pending)

Three named outcomes per the brief decision tree. To be filled at Part 2.

---

## §3 — Engine refactor: mech_vent_thermal_flow as standalone quantity (Part 3, pending)

To be filled at Part 3.

---

## §4 — MVHR heat recovery ribbon (Part 4, pending)

To be filled at Part 4.

---

## §5 — Final anchor + heating demand reconciliation (Part 5, pending)

To be filled at Part 5.

---

## §6-walkthrough — Code self-verification + handoff (Part 6, pending)

To be filled at Part 6.

---

## §future — Tier-3 notes for next brief

(Filled as work surfaces them.)

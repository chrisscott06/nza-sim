# Bridgewater measured-data findings (2026-05-15)

**Source:** Chris's data share — three years of half-hourly electricity (Apr 2024–Mar 2026), 50 months of monthly gas + electricity + water + occupancy (Jan 2022–Feb 2026), plus a 505 Design consumption analysis note.

**Purpose:** capture the measured-data context for the upcoming data-ingester brief and any future calibration work. **No engine fixes are warranted from this** — these are calibration targets, not engine bugs.

---

## Operational regime change (Dec 2022)

The building changed operational regime mid-2022. Two distinct consumption signatures result:

| Period | Regime | Occupancy |
|---|---|---|
| Jan 2022 – Nov 2022 | Normal Holiday Inn Express | ~69% (industry average) |
| Dec 2022 onwards | Home Office refugee accommodation | 100% continuous |

### Monthly averages by regime

| Metric | Pre-HO (2022) | Post-HO (2023–25) | Change | Interpretation |
|---|---:|---:|---:|---|
| Electricity | 50.3 MWh/month | 37.5 MWh/month | −25% | Lower variability (unsold rooms suppressed) — *not* lower total energy use |
| Gas | 9.7 MWh/month | 14.8 MWh/month | +52% | DHW load multiplied under continuous occupancy |
| Gas / HDD | 464 kWh/HDD | 1,549 kWh/HDD | ×3.3 | Confirms DHW dominance over space heating under continuous occupancy |

### Calibration implication

Two calibrated models are the ultimate target:
- **"Normal trading"** — calibrated against 2022 data
- **"Home Office continuous"** — calibrated against 2023–2025 data

Same building, two operational profiles. This is a strong test of the framework's flexibility — it should support multiple calibrations of the same physical building, switchable by scenario.

**Order of work:** calibrate the most recent stable period (2024–25, Home Office mode) first. Once that's working, add the second calibration.

---

## Headline modelled vs measured gaps (pre-calibration baseline)

State 3 modelled values reflect Bridgewater's v2.5 systems config at defaults (post Brief 28f Part 4 ship, post GIA correction). Measured values are 2024–25 annual averages from Chris's data share.

| Fuel | Modelled | Measured (2024–25 avg) | Gap | Likely cause |
|---|---:|---:|---:|---|
| Electricity | 260 MWh | ~560 MWh | **~300 MWh missing** | Back-of-house loads not in our current categories: lifts, refrigeration, exterior lighting + signage, BMS, kitchen equipment, server room |
| Gas | 139 MWh | ~205 MWh | **~70 MWh missing** | DHW `litres_per_person_per_day` at default 80 is too low under continuous occupancy; real value likely 150+ |
| Total delivered | 399 MWh | ~765 MWh | ~366 MWh | Combined effect |
| EUI (at corrected 4,322 m² GIA — `num_floors` 4→5) | ~92 kWh/m² | 178–199 kWh/m² | ~85–105 kWh/m² | Both gaps contribute |

### Electricity gap (~300 MWh) — likely sources to investigate during calibration

UK hotel reference benchmarks suggest the "missing" loads typically split as:

| Load category | Likely magnitude | Notes |
|---|---:|---|
| Lifts | 15–40 MWh/yr | 2× lifts in a 4-storey hotel |
| Kitchen + refrigeration | 80–150 MWh/yr | Walk-in cold rooms, prep area; Holiday Inn Express format has modest kitchen |
| Exterior lighting + signage | 20–40 MWh/yr | Car park, building sign, soffit lighting; 24/7 in many cases |
| BMS + controls + servers | 10–30 MWh/yr | Continuous low-power |
| Back-of-house power | 50–100 MWh/yr | Laundry, housekeeping equipment, plant-room ancillaries |
| Aggregate plausible | 175–360 MWh/yr | Consistent with ~300 MWh observed gap |

Calibration will benefit from sub-meter data if the FM has it. Half-hourly profile shape (overnight vs daytime base load, weekly periodicity) will help attribute load categories without sub-meters.

### Gas gap (~70 MWh) — DHW litres/person/day under continuous occupancy

DHW demand formula (Part 4):
```
DHW_kWh = annual_occupant_hours × (L_per_p_day × ΔT × 4.18 / 3600 / 24)
        = annual_occupant_hours × 0.1935 (at 80 L / 60°C / 10°C defaults)
```

At Bridgewater (post GIA correction won't change occupant hours — driven by num_bedrooms × occupancy_rate × ppr × schedule):
- Annual occupant-hours = 1,585,000 (from State 2)
- Default DHW demand = 306.8 MWh (kWh per person per hour × occ-hours / 1000)
- With 60% ASHP + 40% gas boiler, gas DHW = ~139 MWh (matches modelled total)
- Measured gas ~205 MWh; gap implies ~70 MWh extra DHW demand needed
- 70 MWh ÷ 306.8 MWh baseline = 23% under-estimation of DHW
- At constant occupancy, the most natural lever is `litres_per_person_per_day` going from 80 → ~98 (a small uplift)

But the regime context (gas / HDD jumped 3.3× post-HO) suggests the actual value may be higher than 98. Possible explanations:
- Bathroom redesign or higher hot-water use pattern under refugee accommodation
- More cooking / cleaning hot water (kitchens running differently)
- Towel laundry on-site (high DHW load)

Realistic V1 calibration value likely 150+ L/p/day (Chris's read).

---

## Project config corrections (for Brief 28f sub-piece 5.7)

Apply when 5.7 lands:

| Parameter | Before | After | Notes |
|---|---:|---:|---|
| `num_floors` | 4 | **5** | 4 storeys above + ground = 5 total in UK floor-counting. Fabric doc's "4-storey" framing referred to floors above ground. Result: 58.8 × 14.7 × 5 = 4,322 m², within 2.5% of consumption-analysis figure 4,215 (difference attributable to footprint-not-rectangular and/or plant/circulation excluded from 4,215). No dimension stretch needed. |
| `num_bedrooms` | 134 | 134 (unchanged) | The "138" was scope-doc prose only; project config already correct. |
| MVHR `flow_l_s` | 5000 | **1,450** | 5 × Toshiba VN-M1000HE @ ~290 L/s each. Per Fabric & Systems Modelling Notes. (Already applied to test fixture; needs to land in v2.5 project config.) |
| DHW `litres_per_person_per_day` | (default 80) | (stay at 80) | Calibration will tune. |
| Occupancy banner | (none) | "Configured at design peak; calibration will ground-truth" | UI surfacing per Finding 2 deferral decision. |

After applying `num_floors` correction (4 → 5, no dimension stretch needed), modelled EUI drops from 115.6 → ~92 kWh/m² (delivered 399 MWh / GIA 4,322 m²): still substantially under measured (178–199 kWh/m²), but the gap becomes a meaningful calibration question rather than a units mismatch. **Note:** the GIA increase grows envelope (wall + roof + floor area scales with number of floors) so heating + cooling demand will grow too — State 2 + State 3 outputs need to be re-computed once 5.7 lands; the ~92 kWh/m² figure is approximate pre-re-run.

---

## What this enables for the framework

Once measured-data ingest lands, the tool can answer:

1. **Where exactly are we losing fidelity?** Sub-meter circuit by circuit (if available), or load-profile shape if not.
2. **Which calibration adjustments are within physically defensible bounds?** Provenance + confidence on each input lets State 4 reconciliation propose adjustments without going off-physical.
3. **How do two regimes compare against one model?** The two-mode calibration is the demonstration.

These are the State 4 (reconciliation) capabilities the contract has anticipated. Measured-data ingest unlocks that work.

---

## File pointers

- Brief: `docs/briefs/active/28f_state_3_systems.md` (Part 5.7 + measured-data context section)
- State 3 validation: `docs/validation/state3_part4_findings_2026_05_15.md`
- Contract: `docs/state_contracts.md` (v2.5) — State 4 reconciliation section
- Engine: `frontend/src/utils/instantCalc.js::_calculateState3` (post Part 5.1 + 5.2)

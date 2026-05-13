# State 2 — BREDEM-derived expected ranges (Bridgewater reference)

Per the discipline rule in `docs/state_contracts.md` (introduced in v2.2,
extended in v2.3): every expected range in this contract is backed by an
independent first-principles calculation with stated assumptions. This
document is the worked derivation for State 2 against the Bridgewater
reference scenario. Brief 27 Part 0.

---

## Reference scenario

**Project:** HIX Bridgewater (`14b4a5b1-8c73-4acb-8b65-1d22f05ec969`)

| Property | Value | Source |
|---|---|---|
| Geometry | 58.8 × 14.7 × 4 floors × 3.2 m | persisted config |
| GIA | 3,457 m² | computed |
| Rooms | 134 | persisted config |
| Building type | Hotel (UK standard) | project metadata |
| Fabric | Brief 26 Part 3 reference (cavity_wall_enhanced, pitched_roof_standard, ground_floor_slab, double_low_e) | persisted constructions |
| Comfort band | 21 / 25 °C | persisted project |
| Weather | Yeovilton TMYx | persisted weather file |

**State 1 baseline (post-Brief 26.2 shading fix, persisted Bridgewater config):**

| Metric | live | sim | flag |
|---|---:|---:|---|
| heating_demand_mwh | 155.1 | 164.2 | soft (+5.9%) |
| cooling_demand_mwh | 67.9 | 45.0 | HARD (live over) |
| overheating_hours | 2,064 | 2,043 | silent |
| underheating_hours | 5,031 | 5,038 | silent |
| comfort_hours | 1,665 | 1,679 | silent |
| annual_mean_c | 18.8 | 18.9 | silent |
| summer_max_c | 41.7 | 34.5 | warn (isotropic-sky residual) |

State 2 expectations below build on this baseline.

---

## State 2 gain contributions

### People (sensible)

| Quantity | Value | Source |
|---|---|---|
| Rooms | 134 | project |
| Average density | 1.5 ppl/room | hotel benchmark |
| Total occupants when 100% occupied | 201 | computed |
| Occupancy rate (fraction of rooms typically occupied) | 0.75 | hotel benchmark |
| Effective average occupants | 151 | 201 × 0.75 |
| Sensible heat per occupant | 75 W | typical hotel-bedroom rest |
| Latent heat per occupant | 55 W | (informational; not used in State 2 dry-bulb balance) |
| Presence per day | ~14 hrs | overnight + evening + early morning, hotel typical |
| Annual presence | 151 × 14 × 365 | = 771,610 occupant-hours |
| **Annual sensible gain** | **151 × 75 × 14 × 365 / 1000** | **= 57.9 MWh/yr** |

### Lighting

| Quantity | Value | Source |
|---|---|---|
| LPD | 8 W/m² | LED-typical hotel bedroom with corridor averaged |
| Total installed lighting power | 3,457 × 8 / 1000 | = 27.66 kW peak |
| Effective full-load hours | 1,800–2,500 hrs/yr | 5 hrs/day with spill + 24/7 corridor at 25% LPD-equivalent |
| **Annual lighting energy** | **27.66 × (1,800 to 2,500)** | **= 49.8 to 69.2 MWh/yr** |

### Equipment

| Quantity | Value | Source |
|---|---|---|
| Baseload | 3 W/m² | TVs standby, mini-bars, network, smoke detectors |
| Active load | 7 W/m² | TVs on, kettles, chargers when occupied |
| Baseload power | 3,457 × 3 / 1000 = 10.4 kW | continuous |
| Active power peak | 3,457 × 7 / 1000 = 24.2 kW | when occupied |
| Baseload annual | 10.4 × 8,760 / 1000 | = 91 MWh/yr |
| Active annual | 24.2 × ~1,500 hrs / 1000 | = 36.3 MWh/yr |
| **Total equipment annual** | **91 + 36** | **= ~127 MWh/yr (range 110–150)** |

### Total internal gains injected to zone

| Source | Annual gain | Notes |
|---|---:|---|
| People sensible | 57.9 MWh | distributed across overnight + evening |
| Lighting | 60 MWh ± 10 | concentrated in evening + corridor 24/7 |
| Equipment | 127 MWh ± 20 | mostly baseload, partially occupancy-following |
| **Total** | **~245 MWh ± 30** | injected to indoor air over the year |

---

## State 1 → State 2 delta derivation

Internal gains are injected to the zone air as additional heat. The
effect on heating/cooling demand depends on the seasonal phasing —
gains during heating hours offset heating, gains during cooling/comfort
hours raise indoor temperatures and increase cooling demand.

### Heating demand reduction

Gains during heating-season hours (winter + shoulder, when free-running
T < 21°C) directly offset what a heating system would need to supply.

For Bridgewater, the State 1 baseline has 5,031 underheating hours
(roughly 57% of the year). Of the ~245 MWh of annual gains, the
fraction injected during underheating hours is approximately:

  fraction_in_heating_season ≈ (underheating_hours / 8,760) × occupancy_phasing_factor

Hotel occupancy is concentrated in evening + overnight (cooler hours
that are more likely to be in heating season). Phasing factor ≈ 1.2
for occupancy-weighted gains, ≈ 1.0 for baseload equipment.

  effective heating-offset gain ≈ 245 × 0.57 × 1.1 ≈ 154 MWh of gains
                                                           in heating hours

Of these, only a fraction reduces heating demand 1:1 — the rest raises
indoor temperature above the lower comfort bound and stops offsetting.

Empirically (from PHPP/SAP10 monthly benchmarks for similar UK hotels):
**gains offset roughly 25–40% of total gain energy as heating reduction**.

  Expected heating reduction = 154 × 0.30 = 46 MWh ± 15
                             ≈ **30 to 60 MWh**

### Cooling demand increase

State 1 has 2,064 overheating hours (~24% of year). Gains during these
hours add directly to cooling demand. Phasing factor for daytime gains
(lighting, equipment-active) is higher in cooling hours.

  effective cooling-add gain ≈ 245 × 0.24 × 0.9 ≈ 53 MWh of gains
                                                           in cooling hours

Of these, most translate to cooling demand because the zone is already
above the upper comfort bound and the gains push it further.

  Expected cooling increase = 53 × 0.5 = 27 MWh ± 12
                            ≈ **15 to 35 MWh**

### Overheating hour increase

Gains heating the zone during comfort hours push some of those hours
above the upper bound. State 1 comfort hours: 1,665. Expected fraction
shifted to overheating: ~25%.

  Expected overheating increase = 1,665 × 0.25 ≈ 416 hours
                                ≈ **400 to 800 hours**

  Expected State 2 overheating: 2,064 + ~600 = **2,400 to 2,900 hours**

---

## Bridgewater State 2 expected ranges

Anchored on the post-Brief 26.2 State 1 baseline (live engine 155.1 MWh
heating; sim 164.2 MWh).

| Metric | Expected State 2 range | Derivation |
|---|---|---|
| heating_demand_mwh (live) | **95 to 125** | State 1 155.1 minus 30–60 |
| heating_demand_mwh (sim) | **105 to 135** | State 1 164.2 minus 30–60 |
| cooling_demand_mwh (live) | **80 to 105** | State 1 67.9 plus 15–35 |
| cooling_demand_mwh (sim) | **55 to 85** | State 1 45.0 plus 15–35 |
| overheating_hours | **2,400 to 2,900** | State 1 ~2,050 plus 400–800 |
| underheating_hours | **3,500 to 4,500** | State 1 ~5,030 minus 500–1,500 (some hours move into comfort) |
| comfort_hours | **1,500 to 2,200** | residual; underheating drop > overheating rise |
| annual_mean_c (free-running) | **19.5 to 22.0** | State 1 18.8 plus ~1.5–3 K from total gain energy / building heat capacity |
| people_kwh (annual) | **50,000 to 65,000** | 57.9 MWh ± 10% schedule and density uncertainty |
| lighting_kwh (annual) | **50,000 to 70,000** | 60 MWh ± 17% LPD + control uncertainty |
| equipment_kwh (annual) | **110,000 to 150,000** | 127 MWh ± 18% mix of base + active |

### Engine agreement expectations (State 2)

The Brief 26.2 sky model and shading divergences carry forward:

- **Headline integrated metrics** (heating demand, comfort distribution)
  should remain silent between engines — gains don't introduce new
  systematic divergence
- **Cooling demand** likely stays HARD-divergent (live over-predicts due
  to isotropic sky over-counting solar; gains add to the existing
  difference)
- **Peak summer temperature** unchanged divergence (~5–10°C higher in
  live than sim)
- **State 1 → State 2 delta** should be within ~10% between engines if
  the gain magnitudes and schedules are identical (they will be — both
  engines derive from the same `building.occupancy` and `building.gains`)

---

## Verification gate for Brief 27

A State 2 implementation is **expected** to produce numbers within these
ranges on Bridgewater. If it doesn't:

- Numbers HIGH: investigate over-counting (double-application of
  schedule, density unit confusion, monthly multiplier stacking)
- Numbers LOW: investigate missing gains (a relationship-to-occupancy
  branch returning zero, schedule never applied, density basis wrong)
- Numbers WITHIN range but State 1 → State 2 delta wrong: investigate
  state isolation (gains leaking into State 1, or State 1 carrying
  gains from old persisted state)

The expected ranges are wide intentionally — the model has multiple
approximations (single-zone, occupancy-following equipment, isotropic
solar). Don't tighten them on first pass. If the model lands
consistently in one half of the range across multiple variants, then
narrow the range for that case specifically.

If results sit consistently outside the range, treat it as a model bug
unless the user can point to a stated assumption being violated.

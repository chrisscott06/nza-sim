# Brief 98-A2 — EnergyPlus inherits NZA-Sim's inputs: the matched-input comparison

**Same building = same inputs.** EnergyPlus now inherits NZA-Sim's airtightness (98-A P0),
small-power schedule (P0), lighting schedule (P1) and DHW demand (P2). NZA-Sim `instantCalc.js`
untouched; anchors 132.6/126.0 byte-identical. report_baseline_v1, both engines engine-direct,
EP 25-2-0, 0 fatal.

## Input parity — now complete
| Input | NZA-Sim | EnergyPlus (before → after) | Matched? |
|---|---|---|---|
| Airtightness (operational ACH) | 0.0692 | 0.5 → **0.0692** (98-A P0) | ✅ |
| Small power / equipment | 5.04 W/m² flat 8760h (186.1 MWh) | 4.5 W/m² × 24%-sched (39.6) → **5.04 flat (186.1)** | ✅ |
| Lighting | LPD 2 × NZA profile (39.0 MWh) | LPD 2 × hotel-sched (19.7) → **NZA profile (39.0)** | ✅ |
| DHW demand | 12,144 L/day → 257.3 MWh | ~940 L/day (~24) → **12,144 L/day → 257.3** | ✅ |

## Claim 2 — Demand → Delivered: **now tight** ✅
The three 98-A candidate bugs were input-disconnections (EP inventing its own schedules/sizing,
like the 0.5 ACH). With the inputs inherited, they collapse:

| Service (MWh) | NZA-Sim | EnergyPlus | Δ |
|---|---|---|---|
| Equipment / small power | 186.1 | 186.1 | **−0.0 %** |
| Lighting | 39.0 | 39.0 | **−0.0 %** |
| DHW demand (thermal) | 257.3 | 257.3 | **~0 %** |
| DHW delivered — gas | 157.4 | 45.4 | named residual (below) |

**Named residual — DHW delivered split (not a demand mismatch).** DHW *demand* matches exactly; the
delivered gas/electricity differ because the engines model the ASHP differently: EP as a **series
preheat** (cold→45 °C ≈ 70 % of the heat, electric; gas boosts 45→60 °C) vs NZA's **parallel 52/48
gas/ASHP split**. That's the 98-pre-b DHW-generator topology limitation, a systems-modelling
difference, not an input gap. (Fans/ventilation electricity — EP 55.9 MWh explicit MVHR fan; NZA
folds it elsewhere — remains a scope/accounting item to reconcile.)

## Claim 1 — Fabric → Demand: the residual got **LARGER**, and here's the honest reason
| Metric (MWh) | NZA-Sim | EnergyPlus | 98-A (unmatched gains) | now (matched gains) |
|---|---|---|---|---|
| Heating demand | 87.7 | **10.3** | EP 52.9 | **EP 10.3** |
| Cooling demand | 101.1 | **163.8** | EP 66.6 | **EP 163.8** |

**Matching the internal gains did not leave Claim 1 unchanged — it moved EP a lot, revealing a large
engine-solver difference the mismatch had been hiding.** In 98-A, EP ran only 39.6 MWh equipment
gain (vs NZA's 186); that *understated* EP's gains, coincidentally keeping EP's heating/cooling closer
to NZA's. With both engines now carrying the same **~225 MWh of internal gains** (equipment 186 +
lighting 39, + people + solar), the two engines diverge sharply on how those gains couple to demand:

- **EnergyPlus** (full CTF hourly heat balance + thermal mass): the gains offset heating hour-by-hour
  and drive overheating → heating collapses to **10.3 MWh**, cooling rises to **163.8 MWh**.
- **NZA-Sim** (blended-zone, monthly loss integration): retains **87.7 MWh** heating despite the same
  gains, and **101.1 MWh** cooling.

This is the **blended-zone-vs-full-heat-balance solver difference** named in 98-A — but now
*unmasked* and large, because the gains are large. It is a genuine engine-physics difference, not a
config/input gap (the inputs are matched). It is amplified by the gains being **very large** — which
points straight at the realism question below.

## The realism question this surfaces (flagged, not chased — Chris's call, and now it matters)
The residual is dominated by an unusually large internal-gain load: **small power 186 MWh = 5.04 W/m²
running FLAT 8760 h** (100 % load factor). That is almost certainly unrealistic for a 138-bed hotel
(CIBSE TM54 hotel small-power runs a diversified profile, ~20–30 % annual load factor, not flat 24/7).
The DHW basis likewise implies **345 occupants** (138 rooms × 2.5 density × 55 L/person/day). Both are
NZA-Sim inputs, unchanged here (98-A2 only made EP consume them).

**With realistic (scheduled, lower) small power, the gains would be far smaller, and the two engines'
heating/cooling would very likely converge** — the current heating 10-vs-88 gap is largely an
artefact of the flat 186 MWh gain, not a fundamental fabric disagreement. Fixing that touches NZA-Sim
and moves the anchor (126.0 would drop), so it is **Chris's call**, logged as a discrete follow-up:

> **Baseline-realism review (future brief):** replace NZA-Sim's flat 8760 h small-power with a
> diversified hotel profile (both engines), and sanity-check the DHW occupancy basis (345 people for
> 138 rooms). This lowers the baseline EUI (currently 126.0) and should collapse the Claim-1 residual.
> Anchor impact — Chris's approval required.

## Verdict — is the comparison valid / is 98-B clear?
- **98-A2's stated goal is achieved:** EnergyPlus now inherits NZA-Sim's inputs; Claim 2 (systems
  demand) is tight to <0.1 %; the DHW delivered split is a named topology residual.
- **But the comparison is NOT yet presentable as "the engines agree":** matched inputs unmasked a
  large Claim-1 fabric/solver residual (heating 10 vs 88) that is real engine physics, heavily
  amplified by the unrealistic flat small-power gain.
- **Recommendation: 98-B (Results UI) is NOT clear to proceed.** Do the baseline-realism review first
  (diversified small-power profile + DHW occupancy sanity-check, Chris to approve the anchor move).
  Once the gains are realistic, re-run this matched-input comparison: the expectation is the Claim-1
  residual collapses toward the named fabric terms (thermal bridging + permanent vents), and the
  engines finally agree. Only then does 98-B build on a comparison that's genuinely valid.

NZA-Sim untouched; anchors 132.6/126.0 byte-identical; EP 25-2-0.

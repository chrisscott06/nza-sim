# Brief 98-A — the first VALID NZA-Sim vs EnergyPlus comparison

**Same building, both engines, airtightness basis matched (P0), nothing tuned.** All prior
NZA-vs-EP divergence numbers were measured across mismatched inputs (stale config: gas-not-VRF,
MEV-not-MVHR, lighting 0.8-not-1.0, DHW gas-not-hybrid — fixed via 98-pre-b/c/d) and are void.
This is the first comparison where the two engines demonstrably read the same building.
NZA-Sim `instantCalc.js` untouched; anchors 132.6 / 126.0 byte-identical.

Engine-direct runs on `report_baseline_v1`: NZA-Sim `calculateInstant` (v2.5) vs main `/api/simulate`
EnergyPlus 25-2-0 (0 fatal). Data: `98A_nza_results.json`, `98A_ep_results.json`.

## Same building confirmed (input parity)
| Input | NZA-Sim | EnergyPlus | Equal? |
|---|---|---|---|
| Constructions (U-values) | project library (`bridgwater_*`) | same library items | ✅ |
| Geometry (L×W×floors×h) | 58.8 × 14.34 × 5 × 3.2 | same | ✅ |
| GIA / volume | 4216 m² / 13,491 m³ | same | ✅ |
| Systems | VRF heat + VRF cool + MVHR 80% + gas/ASHP DHW | same (via `derive_systems_for_sim`) | ✅ |
| **Airtightness (operational ACH)** | **0.06925** (q50 4.64 → n50 1.385 / 20) | **0.06925** (P0 fix; was flat 0.5) | ✅ (P0) |

So the residuals below are **engine differences, not config drift**.

---

## Claim 1 — Fabric → Demand (the physics)
| Metric | NZA-Sim | EnergyPlus | Δ (EP vs NZA) |
|---|---|---|---|
| Heating demand | 87.7 MWh | 52.9 MWh | **−39.7 %** |
| Cooling demand | 101.1 MWh | 66.6 MWh | **−34.1 %** |
| Monthly heating-shape correlation r | — | — | **0.896** |

**The residual is dominated by two named, quantified NZA-only mechanisms EnergyPlus structurally
lacks — not "engine accuracy":**

| Residual | Magnitude (NZA gross loss) | Mechanism | In EP? |
|---|---|---|---|
| **Thermal bridging** | **24.0 MWh** | Linear/point Ψ·L bridging at junctions. The EP assembler emits no bridging surfaces or construction Ψ-adjustment. | **0 (absent)** |
| **Permanent vents** | **18.9 MWh** | Always-open passive envelope openings (trickle vents/louvres), wind+stack driven. The EP assembler emits `ZoneInfiltration` + MVHR only — no permanent-vent airflow. | **absent** |
| Solver convention / thermal mass | remainder | EP full CTF hourly heat balance vs NZA blended-zone monthly loss integration. | different |

**These two NZA-only terms sum to 42.9 MWh gross — larger than the 34.8 MWh net heating gap.** So the
Fabric→Demand divergence is fully accounted for by structural EP absences (bridging + perm vents),
with EP's conduction/glazing terms slightly *higher* than NZA's (partly offsetting). The monthly
shape gap (r 0.90, not ~0.98) is the *same* mechanism: NZA's year-round bridging + perm-vent losses
keep shoulder-season heating up (rel. 0.5–0.8 in spring/autumn), while EP heating falls to ~0
May–Sept. **Verdict: Claim 1 is defensible physics — every term named with magnitude and mechanism.**

---

## Claim 2 — Demand → Delivered (the arithmetic — expected tight; it is NOT)
Given each engine's own demand, delivered energy per service should be near-arithmetic (demand ÷
efficiency). It isn't — **multiple >5 % gaps, flagged as candidate bugs (documented, not tuned, per
the brief's escalate rule):**

| Service (delivered/end-use, MWh) | NZA-Sim | EnergyPlus | Gap | Assessment |
|---|---|---|---|---|
| Heating (delivered heat) | 87.7 | 52.9 | — | = Claim 1 demand (physics, expected) |
| Cooling (delivered) | 101.1 | 66.6 | — | = Claim 1 demand (physics, expected) |
| **Small power / equipment** | **186.1** | **39.6** | **4.7×** | 🔴 **CANDIDATE BUG** — implied NZA ~5 W/m² at ~100 % load-factor (flat 8760 h) vs EP ~4.5 W/m² scheduled (~2100 h). NZA small_power appears to run unscheduled/flat. |
| **DHW** | **257.3 demand → 199.6 delivered** (42.2 elec + 157.4 gas) | **~23.7 gas** | **~8–10×** | 🔴 **CANDIDATE BUG** — NZA DHW demand (tap-mix 55 L/person/day → 61 kWh/m²·yr) vs EP DHW generator sizing. A ~10× demand-basis mismatch. |
| **Lighting** | **39.0** | **19.7** | **2.0×** | 🔴 **CANDIDATE BUG** — same LPD 2 W/m² × factor 1.0, so the 2× gap is a schedule/hours mismatch (NZA runs lighting more hours than EP's `hotel_bedroom_lighting` schedule). |
| **Fans / ventilation** | (not surfaced as a service) | 48.7 | — | 🟠 scope/accounting difference — EP has explicit MVHR fan energy; NZA folds ventilation elsewhere. Reconcile before trusting fan electricity. |
| **Total delivered** | 531.3 (elec 373.8 / gas 157.4) | 199.4 (elec 175.8 / gas 23.7) | 2.7× | driven by the small_power + DHW candidates above |

**Verdict: Claim 2 is NOT tight.** The systems/delivered layer carries several large discrepancies —
dominated by **small_power (4.7×)** and **DHW (~10×)** — that are candidate bugs, not physics. Until
they're diagnosed, the headline delivered-energy / EUI comparison (NZA 126 vs EP 47.3) is
uninterpretable: most of that gap is the small_power + DHW candidates, not fabric physics.

---

## Plain-English verdict
Once the two engines read the **same building** (airtightness matched in P0), the **fabric physics
agree well and defensibly**: heating demand differs 40 %, but that gap is fully explained by two
things NZA-Sim models and EnergyPlus doesn't — **thermal bridging (24 MWh) and permanent vents
(19 MWh)** — both structural, both named with magnitude, monthly shapes correlate r 0.90.

The **systems layer does NOT agree**: NZA-Sim's small power (4.7×), DHW (~10×) and lighting (2×) are
far larger than EnergyPlus's, and these — not the fabric — dominate the headline EUI gap. These are
candidate bugs in the demand→delivered accounting, flagged here, not chased or tuned.

---

## Recommendation for Brief 98-B (Results UI + perturbation tester)
**Do a Claim-2 bug-fix pass BEFORE 98-B.** The fabric physics (Claim 1) is trustworthy and ready to
present — but 98-B builds a headline NZA-vs-EP comparison UI, and right now that headline is
dominated by the Claim-2 systems candidates (small_power 4.7×, DHW ~10×, lighting 2×), not by the
defensible fabric residual. Shipping the interrogation UI on top of an EUI gap that's mostly
uncharacterised systems discrepancies would present drift as physics — the exact failure this brief
was reframed to avoid.

Suggested order of the follow-up fixes (each its own short brief, EP-side or scope-alignment only —
NZA-Sim engine stays untouched):
1. **DHW demand basis** (biggest, ~10×) — reconcile the EP DHW generator's litres/sizing with NZA's
   tap-mix (55 L/person/day). Likely the EP DHW is under-demanded.
2. **small_power schedule** (4.7×) — determine whether NZA runs small power flat 8760 h vs EP's
   scheduled ~2100 h; align the basis.
3. **lighting hours** (2×) — same LPD, so a schedule/hours mismatch.
4. **fan/ventilation accounting** — surface NZA's MVHR fan electricity to compare like-for-like.

Once Claim 2 is tight (<5 % per service), 98-B's comparison headline will reflect the defensible
fabric residual (bridging + perm vents), and the perturbation tester will vary real physics.
EP version 25-2-0 confirmed; airtightness matched; anchors 132.6/126.0 intact.

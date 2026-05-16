# SBEM thermal bridging convention + Bridgewater geometry reality check

**Status:** Read-only diagnostic produced before Brief 28-ThermalBridgingPhysical drafting. No engine changes. Feeds the new brief.
**Date:** 2026-05-16
**Source of request:** Chris (Brief 28-ThermalBridgingPhysical pre-work) — two read-only diagnostics flagged ahead of pausing Gate E5b and Brief 28-DisplayLayer.

---

## TL;DR

Two findings, both confirmed:

1. **Bridgewater NE glazing is overstated by ~178.6 m²** in the engine's `computeGeometry(building)`. The persisted state has WWR.north = 0.55 (driving glazing = WWR × area = 517.4 m²) against the real NE facade of 339 m² of itemised openings (curtain wall 178 + bedroom 114 + big windows 47). Net effect on heat loss: **+19.5 MWh/yr phantom** at BRUKL U-values (matches Chris's "~+20 MWh" expectation). Engine also under-reports total wall area by 58.8 m² (height 16.0 vs real 16.4 m — likely parapet not modelled).

2. **The engine's thermal-bridging formula is mis-interpreting BRUKL's α.** BRUKL's `α` is officially defined as *"Percentage of the building's average heat transfer coefficient which is due to thermal bridging"* — i.e. `α = H_TB / HTC_total × 100%`. The engine treats α as a multiplier on area-UA (`effective_fabric_UA = area_UA × (1 + α/100)`), which for α=200 produces a 3× uplift. Under the official BRUKL definition α cannot exceed 100% (since `H_TB ≤ HTC_total`), so the Bridgewater BRUKL value of 200.31% cannot be the standard α — it must be either misread from a different field or generated under a non-standard convention.

This document does NOT propose a fix — Brief 28-ThermalBridgingPhysical (being drafted by Chris/Claude Chat) will do that. It captures the facts so the new brief can be precise.

---

## Diagnostic 1 — Geometry reality check

### Source

`26002-NZA-XX-XX-CA-X-0001 - Geometry Measurements.xlsx`, OneDrive path:
`01a - Live Projects / 26002 - Zeal HIX CRREM Study / 01 - WIP / CA_Calcs / `

Single-zone block massing model in the engine vs the per-window-itemised CAD-measured geometry. Building rotated 41° clockwise from compass, so the engine's `north` face is the building's NE elevation.

### Engine vs real, per facade

Engine geometry per `frontend/src/utils/instantCalc.js::computeGeometry`:
- Dimensions: 58.8 × 14.7 m footprint, 5 floors × 3.2 m = **16.0 m** total height
- Total wall = 2 × (58.8 + 14.7) × 16.0 = **2,352.0 m²**
- Persisted WWR: north 0.55 / south 0.12 / east 0.02 / west 0.02

Real geometry from the sheet:
- Footprint 58.8 × 14.7 m, height **16.4 m** (engine under by 0.4 m — likely a parapet not modelled)
- Total wall = 2 × (58.8 + 14.7) × 16.4 = **2,410.8 m²**
- Glazing itemised per opening type per facade

| Engine face | Real label | Eng gross | Real gross | Δ gross | Eng opaque | Real opaque | Δ opaque | Eng glaz | Real glaz | **Δ glaz** | Eng WWR | Real WWR |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `north` | NE | 940.8 | 964.3 | −23.5 | 423.4 | 625.4 | −202.1 | **517.4** | **338.9** | **+178.6** | 0.550 | **0.351** |
| `south` | SW | 940.8 | 964.3 | −23.5 | 827.9 | 852.7 | −24.8 | 112.9 | 111.6 | +1.3 | 0.120 | 0.116 |
| `east` | SE | 235.2 | 241.1 | −5.9 | 230.5 | 235.8 | −5.3 | 4.7 | 5.3 | −0.6 | 0.020 | 0.022 |
| `west` | NW | 235.2 | 241.1 | −5.9 | 230.5 | 235.8 | −5.3 | 4.7 | 5.3 | −0.6 | 0.020 | 0.022 |
| **TOTAL** | | **2,352.0** | **2,410.8** | **−58.8** | **1,712.3** | **1,949.8** | **−237.5** | **639.7** | **461.0** | **+178.7** | 0.272 | 0.191 |

### Real NE facade — opening breakdown

The real NE elevation is not a uniform-WWR sheet. It's three distinct opening types totalling 338.9 m² across a 964.3 m² gross wall:

| Opening type | Width (m) | Height (m) | Qty | Area (m²) |
|---|---:|---:|---:|---:|
| NE Bedroom | 1.07 | 1.57 | 68 | 114.23 |
| NE Big | 2.36 | 2.48 | 8 | 46.82 |
| NE Curtain wall | 45.60 | 3.90 | 1 | 177.84 |
| **Total** | | | | **338.89** |

The 45.6 × 3.9 m curtain wall is a single-floor feature (probably ground/first floor). The 68 small bedroom windows are distributed across upper floors. The 8 "big" windows are likely day-room / circulation features.

This kind of opening structure is fundamentally incompatible with a single WWR per facade — but for V1 the right input would be **WWR.north = 339 / 964 ≈ 0.351**, not 0.55.

### Phantom heat-loss impact

At BRUKL U-values (U_wall 0.14, U_glaz 1.40 W/m²K) and Brief 28L-implied effective Yeovilton degree-hours per element (walls ~74.9 K·h/yr per W; glazing ~86.3 K·h/yr per W — derived by back-solving from the Brief 28L Gate L2 per-row figures):

```
Phantom glazing heat loss : +21.6 MWh/yr  (extra 178.55 m² × U=1.40)
Missing wall heat loss    :  −2.1 MWh/yr  (forgone 202.06 m² × U=0.14)
NET phantom heat loss     : +19.5 MWh/yr
```

Plus the 58.8 m² total-wall shortfall (engine height 16.0 vs real 16.4) is a minor under-count of opaque-fabric losses, but it partially offsets the over-glazing — small effect compared to the WWR error.

**Total: engine's modelled fabric loss is ~+19.5 MWh/yr higher than reality on the NE alone, before any TB issue.**

### Documented, not fixed

Per Chris's brief direction:
- ✗ No engine change here.
- ✗ No persisted-state change to WWR.north (would risk masking the issue before Brief 28-ThermalBridgingPhysical lands).
- ✓ Recorded for the new brief's scoping.

### Implication for the engine's geometry handling

The single-WWR-per-facade abstraction is a known V1 simplification (see Brief 28e §Background). It hides exactly this kind of error: a facade with itemised openings of very different sizes cannot be represented by a scalar WWR without losing the geometric truth.

For Bridgewater specifically the engine could be made faithful by:
- (a) reducing WWR.north to 0.351 to match the area-weighted average, accepting that the per-opening detail (curtain wall vs bedroom windows) is lost in the live engine but the total glazing area becomes correct — minimal engine work, just a persisted-state correction
- (b) extending `building_config.fabric.windows[]` (or similar) into a per-opening itemised schema like Brief 28e's `operable_openings` — much bigger schema lift

The new brief will decide. **(a) is the minimum-viable correction; (b) is the principled fix.**

---

## Diagnostic 2 — SBEM thermal-bridging convention

### Key formulae (verbatim from primary sources)

**SAP 2009 Appendix K**, equations (K1) and (K2):

> *"The transmission heat transfer coefficient associated with non-repeating thermal bridges is calculated as:*
> *H_TB = Σ(Ψ × L)   (K1)*
> *where L is the length of the thermal bridge, in metres, over which Ψ applies.*
>
> *If details of the thermal bridges are not known, use*
> *H_TB = y × A_exp   (K2)*
> *where A_exp is the total area of external elements ... and y = 0.15."*

So the **default y-value when no junction-by-junction calculation is available is 0.15 W/m²K** (SAP / domestic). For non-domestic / SBEM, the standard practice is the "10% uplift on area-weighted U-values" simplified method — see below.

The total **transmission heat transfer coefficient** is:

```
HTC = Σ(U_i × A_i) + H_TB                                  [W/K]
       └──────┬──────┘   └─┬─┘
          fabric (no TB)    TB component
```

Equivalently, expressing TB as an effective Y added uniformly to U-values:

```
Y_eff   = H_TB / A_envelope                                [W/m²K]
U_eff_i = U_i + Y_eff                                      [W/m²K]
HTC     = Σ(U_eff_i × A_i) = Σ(U_i × A_i) + Y_eff × A_envelope
                           = Σ(U_i × A_i) + H_TB
```

The two formulations are mathematically identical when Y_eff is applied uniformly to every external element. (Heatflux PSI-Values reference: *"The Y-Value is then added on to the U-Value of every heat loss surface in the building."*)

### Default SBEM "10% uplift" method

SBEM and DSM software allow a simplified default: **add 10% to the standard area-weighted average U-values**, applied consistently to both Actual and Notional buildings (IES VE Knowledgebase, Approved Document L2A 2013 era).

> *"the non-repeating thermal bridge heat losses for each element (including windows etc) must be allowed for by adding 10% to the standard area weighted average U-values, or by an equivalent method that satisfies BS EN ISO 14683, and be consistently applied to both Actual and Notional buildings."*

Under the 10% uplift:
- HTC_total = 1.10 × H_fabric (where H_fabric = Σ U_i × A_i)
- ⟹ H_TB / H_fabric = 0.10
- ⟹ H_TB / HTC_total = 0.10 / 1.10 = **9.09%**

This is why the IES VE FAQ says "you should observe an Alpha value of 10%" — the ~10% figure is the engine-side input to the calculation, not the BRUKL-reported α.

### What α actually means in the BRUKL output

**Verbatim from an official sample BRUKL document** (assets.publishing.service.gov.uk, BRUKL Report Additional Measures, April 2025, page 6 — Technical Data Sheet):

> **Alpha value\* [%]**
> **\* Percentage of the building's average heat transfer coefficient which is due to thermal bridging**

Sample numbers from that BRUKL (Actual vs Notional):
- Actual: external area 694.4 m², average conductance 208.51 W/K, average U-value 0.30 W/m²K, **α = 59.07%**
- Notional: same external area 694.4 m², average conductance 297.97 W/K, average U-value 0.43 W/m²K, **α = 40.84%**

Note that `Average conductance / External area = Average U-value` exactly in both columns (208.51 / 694.4 = 0.300; 297.97 / 694.4 = 0.429) — confirming that BRUKL's "Average conductance" = HTC_total (including TB) and "Average U-value" = HTC_total / A_envelope (an effective U including TB).

**Critical algebraic consequence:**

```
α (BRUKL) = H_TB / HTC_total × 100%      where HTC_total = H_fabric + H_TB

⟹ 0 ≤ α < 100% by construction       (H_TB cannot exceed HTC_total)

⟹ Solving for H_TB given α and H_fabric:
    H_TB = (α/100) / (1 − α/100) × H_fabric
         = α / (100 − α) × H_fabric
```

For the default 10% U-value uplift method:
- H_TB = 0.10 × H_fabric ⟹ HTC_total = 1.10 × H_fabric ⟹ α = 0.10/1.10 = 9.09%

For the sample BRUKL Actual α = 59.07%:
- H_TB = 0.5907 × 208.51 = 123.16 W/K
- H_fabric = 208.51 − 123.16 = 85.35 W/K (i.e. fabric is only ~41% of HTC; TB dominates)
- An exceptionally bad TB case (probably an old conversion with poor junctions)

### Bridgewater "α = 200.31%" — what to make of it

Per Chris's seed (`scripts/seed_bridgewater_v25_systems.mjs`) and Brief 28L documentation, the persisted value is `fabric.thermal_bridging_alpha_pct = 200`, sourced from "BRUKL Tech Data Sheet α = 200.31%".

**α = 200.31% is mathematically impossible under the official BRUKL definition** (since α ≤ 100% by construction). One of three things has happened:

1. The 200.31% was read from a non-`α` field in the BRUKL Tech Data Sheet (e.g., it might be `(U_actual − U_notional) / U_notional × 100`, a relative comparison number that could exceed 100%, or some non-standard psi×L / fabric ratio).
2. The Bridgewater BRUKL was generated by a software version that reports α under a non-standard convention — e.g. `α = H_TB / H_fabric × 100%` instead of `H_TB / HTC_total × 100%`. Under that convention 200.31% would mean `H_TB = 2.0 × H_fabric` — a TB-dominated building.
3. The BRUKL output is corrupted on that specific field.

The right next step (in the new brief) is to **pull the original Bridgewater BRUKL document and verify which field 200.31% was read from**, before deciding what the engine should do with it.

### Where the engine sits today

`frontend/src/utils/instantCalc.js` (Brief 28k Gate 1):

```javascript
const fabric_area_UA = wholeWallU_ext * total_wall_opaque
                     + u_roof  * roof_area
                     + u_floor * ground_area
                     + u_glaz  * total_glazing
// (Brief 28k Gate 1; line 843 in instantCalc.js)

const effective_fabric_UA = fabric_area_UA * (1 + thermal_bridging_alpha_pct / 100)
```

This treats α as the **fractional uplift on area-UA** — i.e., the "10% on U-values" convention. Under that interpretation `α = 200` produces a 3× uplift, which is the engine behaviour Chris observed (TB ≈ 237 MWh, dominating heating demand).

**Under the BRUKL-definition reading**, `α = 200` is impossible. Under the "fractional uplift on U-values" reading, `α = 200` means H_TB = 2 × H_fabric — possible but unusual. Either way, the source of the 200.31% input value needs to be re-verified before the engine's interpretation is changed, because the right fix depends on which BRUKL field that number actually came from.

### Approved Document L / Table K1 default psi-values

Default ψ values (W/m·K) per junction type, from SAP 2009 Appendix K Table K1 (representative selection — the table is more complete in the source):

| Junction type | Accredited Ψ (W/m·K) | Default Ψ (W/m·K) |
|---|---:|---:|
| Steel lintel with perforated steel base plate | — | 0.50 |
| Other lintels (including other steel lintels) | 0.30 | 1.00 |
| Sill | 0.04 | 0.08 |
| Jamb | 0.05 | 0.10 |
| Ground floor (also exposed upper floor / floor above garage) | 0.16 | 0.32 |
| Intermediate floor within a dwelling | 0.07 | 0.14 |
| Eaves (insulation at ceiling level) | 0.06 | 0.12 |
| Eaves (insulation at rafter level) | 0.04 | 0.08 |
| Gable (insulation at ceiling level) | 0.24 | 0.48 |
| Gable (insulation at rafter level) | 0.04 | 0.08 |
| Flat roof | 0.04 | 0.08 |
| Flat roof with parapet | 0.28 | 0.56 |
| Corner (normal) | 0.09 | 0.18 |
| Corner (inverted) | −0.09 | 0.00 |
| Party wall between dwellings | 0.06 | 0.12 |
| Roof — insulation at ceiling level (party wall) | 0.12 | 0.24 |

(Domestic SAP; SBEM non-domestic uses the same junction conventions per BS EN ISO 14683.)

If the engine ever moves to detailed `H_TB = Σ(ψ × L)` calculation, these are the look-up tables to mirror.

### Three options the SBEM methodology allows

Per SAP Appendix K — same three options apply in SBEM non-domestic via the BS EN ISO 14683 reference:

1. **Accredited Construction Details** — use ψ values from the 'accredited' column of Table K1 along with each junction length in equation (K1).
2. **Calculated ψ values** by qualified person per BRE IP 1/06 + BR 497, increased by 0.02 or 25% (whichever larger) and used in (K1). In Scotland the increase doesn't apply.
3. **Default y-value** — if neither (1) nor (2) applies, use `y = 0.15` in (K2). For Bridgewater non-domestic the SBEM-equivalent default is the 10% U-value uplift (α ≈ 9.09% in BRUKL terms).

---

## Sources

- **SAP 2009 Appendix K** — verbatim source for equations (K1), (K2), default y = 0.15, three-options procedure, and the full Table K1 ψ-value list.
  [BRE: SAP-2009-Appendix-K.pdf](https://files.bregroup.com/bre-co-uk-file-library-copy/filelibrary/SAP/2009/SAP-2009-Appendix-K.pdf)
- **Official BRUKL Report sample (Part L 2021)** — verbatim source for the Technical Data Sheet `Alpha value [%]` definition and the Actual/Notional sample numbers (208.51 / 297.97 W/K conductance, 59.07% / 40.84% α).
  [gov.uk: BRUKL_Report_Additional_Measures_29_April_2025.pdf](https://assets.publishing.service.gov.uk/media/6819e273df188ba858873a74/BRUKL_Report_Additional_Measures_29_April_2025.pdf)
- **IES VE Knowledgebase — Part L2 2010 thermal bridging FAQ** — source for the "10% on area-weighted U-values" simplified default and the Actual vs Notional consistency requirement.
  [IES VE FAQ 1609](https://www.iesve.com/support/ve/knowledgebase_faq/faq/1609)
- **Heatflux — PSI-Values, SAP & SBEM** — source for the Y-value methodology summary and "added on to the U-value of every heat loss surface" application rule.
  [heatflux.co.uk/thermal-bridging-psi-sap-sbem](https://www.heatflux.co.uk/thermal-bridging-psi-sap-sbem/)
- **BS EN ISO 14683:2017** — the underlying European standard for linear thermal transmittance methods and default values (referenced by both SAP Appendix K and SBEM). Not fetched here — pointer only.
  [NBS Publication Index](https://www.thenbs.com/PublicationIndex/documents/details?Pub=BSI&DocID=319619)

---

## What the new brief (Brief 28-ThermalBridgingPhysical) needs to settle

These are open questions for the new brief — recorded here as a handoff checklist, not answered:

1. **Verify the source field for Bridgewater's 200.31%.** Pull the original BRUKL document and identify which field that number was read from. Without that, the engine's TB input is uncalibrated.
2. **Decide the engine's α-interpretation contract.** Three candidates:
   - **(α-A)** BRUKL-strict: `H_TB = α/(100−α) × H_fabric`. Bounded by α < 100%. Matches BRUKL Tech Data Sheet exactly.
   - **(α-B)** Fractional uplift on H_fabric: `H_TB = α/100 × H_fabric`. Maps to "10% on U-values" when α=10. Allows α > 100% (TB-dominated buildings). This is what the engine currently does.
   - **(α-C)** Detailed: bypass α entirely, take a `building_config.fabric.thermal_bridging_psi_L_W_per_K` (the `H_TB` directly in W/K), let the engine read junction-by-junction or accept a single user-provided number.
3. **Decide the geometry V1 correction for Bridgewater.** Either (a) reduce WWR.north to 0.351 to match itemised total area (minimal change, loses per-opening detail), or (b) extend the schema to per-opening itemised glazing (much bigger lift, principled fix). The Brief 28e operable_openings schema is the obvious template.
4. **Both fixes are calibration concerns, not engine bugs.** Brief 28k convention math is correct given the inputs. The issues are: (a) WWR input is wrong on NE, and (b) α input interpretation is uncertain. The new brief should keep this framing.

Halt here. Awaiting Brief 28-ThermalBridgingPhysical from Chris / Claude Chat.

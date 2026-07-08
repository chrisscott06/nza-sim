# HIEX Bridgwater — Intervention Specification & Cost Benchmarks
## For the modelling chat: WHAT each intervention is and WHAT it costs. No modelling instructions.

**The four report metrics (confirmed):**
1. **EUI reduction** — kWh/m²/yr
2. **GHG reduction** — lifetime tCO₂e saved to 2050, CRREM grid pathway, capped at asset life
3. **Cost-effectiveness — £/tCO₂e** (capex ÷ lifetime tonnes saved) ← the fourth metric
4. **Simple payback** — years (capex ÷ annual £ saving)

**Site quantities (for cost build-ups):** 138 rooms (134 occupied) · GIA 4,215 m² · DHW gas 134.8 MWh/yr · existing DHW ASHP 21.1 kW · VRF ~320 kW cooling (10 condensers, SHRM 3-pipe heat recovery confirmed) · total fan energy ~152 MWh/yr · EF R.01 bathroom extract 2,292 l/s · elec £0.28/kWh · gas £0.07/kWh.

**On-cost percentages for NRM-tier build-ups:** prelims 10–15% · OH&P 5–10% · design & engineering 8–12% · contingency 10–15%. Apply to NRM-tier items only.

**Confidence key:** H = published/sourced current rate · M = industry-standard rate, dated or generalised · L = allowance only; no credible benchmark — flagged.

---

## THEME 1 — HOT WATER

### 1.1 Reduce DHW demand (low-flow fittings)
- **Category:** Systems (water) · **Description:** Low-flow shower heads and flow regulators across all rooms; verify demand assumptions against metered data.
- **Physical change:** DHW demand −10–25%. **Modelling input required: assume a shower fraction of total DHW (suggest 60–70% of room hot water is shower draw — state the assumption); low-flow saving applies to that fraction only.** Open: actual litres/person unverified pending water metering.
- **Phasing:** Independent; do early. Water metering (5.3) confirms the saving.
- **Cost plan — Tier (a) Simple:** 138 rooms × £60/room (fittings + fit) = **£8,280** (range £5.5k–£13.8k @ £40–£100/room). Source: retail/trade pricing for hotel low-flow retrofit, 2025. **Confidence M.**

### 1.2 Waste-water heat recovery (WWHR)
- **Category:** Systems · **Description:** Drain-water heat exchangers pre-heat incoming cold feed, cutting the temperature lift.
- **Physical change:** DHW energy −15–25% on recovered flows; recovery efficiency 40–50% assumed. Open: drain layout/riser access.
- **Phasing:** Best at plant/riser works; pairs with 1.4.
- **Evidence (riser-mounted vertical WWHR works in practice):** Recoup Pipe HEX vertical units sited within service risers, gravity-fed from the floor above, with two showers sharing one unit (2:1) to halve cost — documented in a completed Passivhaus student-accommodation scheme: https://knowledge.recoup.co.uk/award-winning-passivehaus-student-accommodation · Hotel-specific case study (Kings Cross Hotel): https://recoup.co.uk/wp-content/uploads/2017/06/Case-Study-Waste-Water-Heat-Recovery-Savings-at-Kings-Cross-Hotel.pdf · Manufacturer confirms vertical systems as standard for hotels/student accommodation: https://recoup.co.uk/case-studies/
- **Cost plan — Tier (c) NRM-style (riser application):**
  - Vertical WWHR units: 9 risers × 1 unit @ £900 = £8,100 (unit rate £700–£1,200, Recoup/Showersave published domestic pricing, 2024–25)
  - Plumbing labour: 9 risers × 1.5 days @ £350/day = £4,725
  - Builder's work/access allowance: £3,000
  - Subtotal £15,825 + on-costs (~40%) ≈ **£22,000** (range £15k–£35k). **Confidence M on units, L on hotel riser install — flagged: hotel-scale WWHR case-study pricing is scarce.**

### 1.3 Exhaust air over ASHP (COP uplift)
- **Category:** Systems · **Description:** Route continuous warm extract air (~20°C) across the DHW heat pump's source coil.
- **Physical change:** ASHP COP +0.3–0.5. Open: duct routing feasibility roof-side.
- **Phasing:** Do with 1.4 (plant works) or standalone.
- **Cost plan — Tier (b) Elemental:** Ductwork modification allowance £4,000 (£2.5k–£8k) + commissioning 1 day @ £550 = **£4,550**. Source: M&E day rates + ductwork allowances, industry standard 2025. **Confidence L–M — flagged: no published benchmark for this configuration; allowance only.**

### 1.4 Larger ASHP — full DHW off gas
- **Category:** Systems · **Description:** Upsized high-temperature ASHP meets the full hot-water load; gas water heaters retired. The principal carbon measure.
- **Physical change:** DHW fuel gas→electric; plant ~60–80 kW high-temp ASHP + cylinder/coil works; SCOP 2.8–3.0 assumed.
- **Phasing:** After 1.1 (size to reduced demand); pairs with 1.2/1.3/1.5.
- **Cost plan — Tier (c) NRM-style (70 kW basis):**
  - ASHP plant: 70 kW @ £550/kW supply = £38,500 (commercial high-temp monobloc supply rates, 2024–25 trade pricing)
  - Mechanical install, cylinders/coils, pipework: £25,000 allowance
  - Electrical supply upgrade + controls: £8,000
  - Gas plant strip-out: £4,000
  - Subtotal £75,500 + on-costs (~40%) ≈ **£105,000** (range £80k–£140k; ≈ £1,150–£2,000/kW all-in, consistent with PSDS-era commercial heat-pump project benchmarks). **Confidence M — commercial installed £/kW varies widely with integration scope.**

### 1.5 Interlinked heat recovery — cooling/VRF to DHW
- **Category:** Systems · **Description:** Recover rejected heat from the (confirmed heat-recovery) VRF into DHW pre-heat via a water-side module.
- **Physical change:** DHW pre-heat from recovered heat when cooling and DHW coincide; 50–60% useful capture assumed. Open: whether the installed SHRM generation accepts a hot-water module; pipe run roof-to-calorifier.
- **Phasing:** Decision point after VRF commissioning (3.1); strongest if done at DHW plant works (1.4).
- **Cost plan — Tier (b) Elemental (allowance):** Water-side HX module + integration £15,000–£35,000, central **£25,000**. **Confidence L — flagged: bespoke; no credible published benchmark. Manufacturer budget quote required.**

---

## THEME 2 — VENTILATION

### 2.1 MVHR replacing central electric heating + bathroom extract
- **Category:** Systems · **Description:** MVHR replaces the separate bathroom extract and central electric heating, using the ceiling void as extract plenum and the extract path as supply ductwork.
- **Physical change:** Extract-only → balanced supply/extract with 80% HR; SFP to confirm (1.5 vs 2.0); electric panel heating largely removed. Note: net energy effect may be adverse here — modelling decides.
- **Phasing:** Mutually exclusive with keeping EF R.01 as-is; supersedes 2.2 on the same system.
- **Cost plan — Tier (c) NRM-style (~2,300 l/s):**
  - MVHR/AHU plant: 2,300 l/s @ £12/(l/s) supply = £27,600 (basis: mid-band of commercial packaged AHU supply-only trade rates, £8–£18/(l/s), 2024–25 — generalised industry rate, not a published index; treat as budget-grade)
  - Ductwork/plenum adaptation: £30,000 allowance
  - Electrical + controls: £8,000
  - Panel heater strip-out: £5,000
  - Subtotal £70,600 + on-costs (~40%) ≈ **£99,000** (range £70k–£140k). **Confidence L–M — flagged: plenum conversion is bespoke; builder's-work allowance dominates and needs a design study.**

### 2.2 Reduce fan duty
- **Category:** Systems/controls · **Description:** Slow the extract toward the minimum air-quality-compliant flow (505's case: 2,292→1,656 l/s).
- **Physical change:** Extract flow −25–30%; fan power falls with cube law.
- **Phasing:** Do now; superseded if 2.1 proceeds. Zeal already seeking a quote.
- **Cost plan — Tier (a) Simple:** Commissioning engineer 2 days @ £550 + inverter/controls adjustment allowance £1,500 = **£2,600** (range £1.5k–£5k). **Confidence M** (day rates H; scope depends on existing inverters — EF G.02 confirmed has one).

### 2.3 Heat-recovery bypass setpoint
- **Category:** Controls · **Description:** Lower the temperature at which HRV heat recovery is bypassed, avoiding recovered heat when the building wants cooling.
- **Physical change:** Bypass setpoint change on 5 HRV units.
- **Phasing:** Bundle with BMS visit (6.1).
- **Cost plan — Tier (a) Simple:** Within controls visit; incremental **£0–£500. Confidence H** (it's a setting).

### 2.4 Openable windows / purge ventilation
- **Category:** Fabric · **Description:** Retrofit openable lights for night purge. Assessed separately: real but marginal (~0.8 kWh/m²/yr), night-only.
- **Physical change:** ~100 bedroom windows openable 50%.
- **Phasing:** Independent; low priority on energy grounds (comfort measure).
- **Cost plan — Tier (a) Simple:** 100 windows × £650/window (replace fixed light with openable, supply+fit) = **£65,000** (range £40k–£90k @ £400–£900/window). Source: fenestration trade rates 2024–25. **Confidence M.** Note: poor £/tCO₂e by construction — include for completeness.

---

## THEME 3 — HEATING & COOLING

### 3.1 VRF metering, commissioning & diagnostic health check
- **Category:** Systems/controls · **Description:** Recommendation 1. Sub-meter the VRF; manufacturer diagnostic visit; verify refrigerant charge vs F-gas register; clean coils; align controls. Evidence: managed systems achieve ~3.9 vs ~2.8 typical.
- **Physical change:** In-service COP recovered toward rated; quantum unknown until metered (open question by design).
- **Phasing:** BEFORE any replacement decision (3.2) or DHW interlink (1.5). Pairs with 5.3.
- **Cost plan — Tier (b) Elemental:** Manufacturer/specialist diagnostic visit £3,000 (£1.5k–£4.5k) + F-gas/charge verification £1,500 + coil cleaning £1,200 + sub-metering of VRF circuits 4 points @ £600 = £2,400. Total ≈ **£8,100** (range £5k–£12k). **Confidence M** (service day rates well established; scope varies).

### 3.2 VRF replacement (current-generation R-32 heat recovery)
- **Category:** Systems · **Description:** Replace the 2019 SHRM fleet with the current R-32 heat-recovery generation at end of life. Realistic saving 15–25% on heating/cooling energy plus ~80% refrigerant-carbon cut.
- **Physical change:** 10 condensers + indoor units/controls; refrigerant R-410A→R-32; rated SCOP ~4.7 replacing in-service ~2.5–3.0. **Capacity basis (320 kW):** R01 = 14HP twin + 10HP follower ≈ 40 + 28 = 68 kW; R02–R10 = 9 × 10HP ≈ 9 × 28 = 252 kW; total ≈ 320 kW nominal cooling (Toshiba 10HP ≈ 28 kW). Like-for-like sizing pending 3.1 evidence — right-sizing after metering could reduce it.
- **Phasing:** Decision AFTER 3.1 evidence; natural trigger is plant life (~2034). Absorbs 7.2 (refrigerant transition).
- **Cost plan — Tier (c) NRM-style (320 kW basis):**
  - VRF plant (outdoor+indoor+FS boxes): 320 kW @ £450/kW supply = £144,000 (trade supply rates 2024–25)
  - Install/refrigerant pipework (reuse where compliant), labour: £90,000 allowance
  - Controls + commissioning: £20,000
  - Strip-out & disposal (incl. R-410A recovery): £15,000
  - Subtotal £269,000 + on-costs (~40%) ≈ **£375,000** (range £280k–£480k; ≈ £900–£1,500/kW all-in). **Confidence M — flagged: phased-replacement options would change profile; budget quote needed at decision point.**

### 3.3 Setpoint optimisation (heating/cooling dead-band)
- **Category:** Controls · **Description:** Widen dead-band within comfort agreement (e.g. heating 21→20, cooling 24→25 — final values are the model's to test).
- **Physical change:** Zone setpoints across VRF.
- **Phasing:** Do now; bundle with 6.1.
- **Cost plan — Tier (a) Simple:** Within BMS/controls visit — **£0–£500. Confidence H.**

### 3.4 Fabric — U-values / G-values
- **Category:** Fabric · **Description:** Improve glazing (G 0.55→0.4) and/or wall insulation. Included for completeness; expected marginal or counterproductive here (cuts useful heat loss, raises cooling).
- **Physical change:** Glazing G-value and/or wall U-value.
- **Phasing:** Independent; low priority.
- **Cost plan — Tier (b) Elemental (area corrected):** Bedroom glazing ≈ 1.4 m²/window × 138 windows ≈ **193 m²** total (SW/S/W-facing subset ≈ 100–120 m²). Film to all bedroom glazing: 193 m² @ £45/m² = **£8,700** (range £5k–£14k; film rates £25–£70/m², 2024–25). SW/S/W subset only: ≈ £5,000. Full glazing replacement alternative ~£400–£600/m² (not recommended). **Confidence M.** *(Prior 1,000 m² figure was an error — corrected.)*

### 3.5 Brise soleil (external solar shading)
- **Category:** Fabric · **Description:** Fixed horizontal brise soleil, 0.5 m projection, above bedroom windows on the SW, S and W orientations (optional extension to E/NE). Unlike film, shading is seasonally selective: it cuts high-angle summer sun (reducing cooling) while admitting low-angle winter sun (preserving useful gains) — better suited to this gains-driven building than year-round G-value reduction.
- **Physical change:** 0.5 m external horizontal overhang per listed window. **Quantity = number of windows on those orientations × window width × 0.5 m projection.** Placeholder: ~70 windows × 1.2 m ≈ 42 m² blade area / 84 lm (window counts per façade to be confirmed from drawings — open item).
- **Phasing:** Independent; pairs naturally with any façade access works (e.g. 2.4).
- **Cost plan — Tier (b) Elemental:** 42 m² blade area @ £550/m² supplied + installed = **£23,100** (range £17k–£34k; aluminium brise soleil trade rates £400–£800/m² of blade, 2024–25 — generalised industry rate). Access/scaffold allowance +£5,000 if not shared with other façade works. **Confidence M–L — manufacturer budget quote recommended; no published index for small retrofit brise soleil.**

---

## THEME 4 — ROOM / EQUIPMENT LOADS

### 4.1 Room load monitoring (sample sub-metering)
- **Category:** Occupancy/other (enabling) · **Description:** Meter a representative sample of rooms to establish the real plug-load profile — converts the assumed room load into data.
- **Physical change:** None to demand; replaces assumption with measurement.
- **Phasing:** FIRST in this theme; sizes 4.2 honestly.
- **Cost plan — Tier (a) Simple:** 10 rooms × £450/point (CT meter + comms, installed) = **£4,500** (range £3k–£8k @ £300–£800/point; BSRIA-type metering rates). **Confidence M.**

### 4.2 Automatic room shut-off (keycard/occupancy master switch)
- **Category:** Occupancy · **Description:** Master switch cuts non-essential room power when unoccupied; offered as a resident incentive.
- **Physical change:** Room plug load −20–30% when unoccupied (assumed pending 4.1).
- **Phasing:** After 4.1 sizes the prize; pilot 10 rooms first.
- **Cost plan — Tier (a) Simple:** 138 rooms × £140/room (keycard switch + wiring, installed) = **£19,320** (range £11k–£28k @ £80–£200/room; hotel keycard-switch trade rates). **Confidence M.**

### 4.3 Equipment efficiency at replacement
- **Category:** Other · **Description:** Specify low-standby, efficient appliances at natural replacement.
- **Physical change:** Appliance W ratings at churn. **Cost: marginal at replacement — £0 capex modelled. Confidence H (by definition). Flag: no benchmark needed.**

---

## THEME 5 — COMMUNAL LOADS

### 5.1 Kitchen/catering review + circuit metering
- **Category:** Other (enabling + operational) · **Description:** Meter kitchen circuits; identify equipment left running outside service. Kitchen is a documented blind spot — potentially material.
- **Physical change:** Left-on load eliminated (quantum unknown; open by design).
- **Phasing:** With 5.3 metering package.
- **Cost plan — Tier (a) Simple:** 4 circuits @ £500 + half-day survey £300 = **£2,300** (range £1.5k–£4k). **Confidence M.**

### 5.2 Communal lighting + controls
- **Category:** Lighting · **Description:** Confirm LED throughout communal/external; add occupancy sensing. (No auto-M&T exists — BRUKL confirmed.)
- **Physical change:** Communal lighting hours/load down; PIR control.
- **Phasing:** Independent; do now.
- **Cost plan — Tier (b) Elemental:** LED verification/replacement allowance: 150 fittings @ £110 = £16,500 (£80–£150/fitting supply+fit, trade rates 2024–25) + PIR sensors 40 points @ £90 = £3,600. Total ≈ **£20,100** (range £12k–£30k). **Confidence M–H** (LED retrofit rates well published).

### 5.3 Building sub-metering package (plant + water)
- **Category:** Other (THE enabling measure) · **Description:** Sub-meter major plant (ventilation, DHW, kitchen, lifts, VRF) + water metering (hot:cold split, leak check). Converts the inferred base load into addressable demand.
- **Physical change:** None to demand; resolves the report's largest unknown.
- **Phasing:** FIRST ACTION overall. Gates: base-load work, 4.2 sizing, 3.2 decision, DHW verification.
- **Cost plan — Tier (b) Elemental:** 14 electrical points @ £600 = £8,400 + water meters 3 @ £800 = £2,400 + data logging/comms £2,500. Total ≈ **£13,300** (range £9k–£20k; £300–£800/point BSRIA-type rates). **Confidence M.**

### 5.4 Communal ventilation run-hours
- **Category:** Controls · **Description:** Align HRV schedules to actual space use.
- **Cost plan — Tier (a) Simple:** Within BMS visit (6.1) — **£0–£500. Confidence H.**

---

## THEME 6 — CONTROLS & BMS

### 6.1 BMS setpoint realignment + schedules (consolidated controls visit)
- **Category:** Controls · **Description:** One controls package: setpoints (3.3), schedules (5.4), bypass (2.3), dead-bands — subject to a BMS capability survey.
- **Physical change:** Coordinated setpoints/schedules across plant.
- **Phasing:** Do now; the survey may reveal capability limits (open question).
- **Cost plan — Tier (a) Simple:** Controls specialist 4 days @ £600 + BMS survey 1 day @ £600 = **£3,000** (range £2k–£6k). **Confidence M–H** (day rates well established; scope uncertain until survey).

---

## THEME 7 — CARBON MEASURES

### 7.1 Solar PV
- **Category:** Other · **Description:** Rooftop array. Cuts carbon, not EUI (CRREM measures gross demand).
- **Physical change:** ~40–60 kWp (open: roof area after plant; structural check).
- **Phasing:** Independent; roof survey first.
- **Cost plan — Tier (b) Elemental (50 kWp basis):** 50 kWp @ **£1,100/kWp** installed = **£55,000** (rate locked by CS; sourced band £700–£1,100/kWp, 2026 UK commercial rooftop — strong, current benchmark; £1,100 is the prudent top of band for a smaller, plant-congested roof). **Confidence H.**

### 7.2 Low-GWP refrigerant transition
- **Category:** Systems · **Description:** R-410A→R-32 at plant replacement. Absorbed into 3.2 (no separate retrofit path exists — R-32 cannot be dropped into R-410A kit).
- **Cost:** Within 3.2. **Confidence H (by definition).** Interim: nothing to buy; maintain F-gas compliance via 3.1.

---

## FLAGGED — NO CREDIBLE BENCHMARK (allowances only, marked L above)
- 1.3 Exhaust-over-ASHP ducting (configuration-specific)
- 1.5 Cooling→DHW interlink module (manufacturer quote required)
- 2.1 MVHR plenum conversion builder's work (design study required)
- Hotel-scale WWHR install (unit rates published; hotel application scarce)

## PHASING SUMMARY (dependency spine)
1. **Now, low-cost:** 5.3 sub-metering + 4.1 room sample + 5.1 kitchen metering → 6.1 controls visit (carrying 3.3, 5.4, 2.3) → 2.2 fan duty → 3.1 VRF commissioning → 1.1 low-flow → 5.2 lighting/controls
2. **Evidence-gated:** 4.2 room shut-off (after 4.1) · base-load measures (after 5.3) · 3.2 VRF replacement and 1.5 interlink (after 3.1)
3. **Plant-works cluster:** 1.4 DHW ASHP + 1.2 WWHR + 1.3 exhaust duct (+1.5 if viable) as one project
4. **Independent/optional:** 7.1 PV · 2.4 openable windows · 3.4 fabric/film · 2.1 MVHR (only if model supports it)

*Rates at 2024–26 price levels as stated per line; older sources indexed judgement-flagged. All NRM-tier totals include on-costs at the stated percentages. Every costed line is quantity × unit × rate = total for direct import.*

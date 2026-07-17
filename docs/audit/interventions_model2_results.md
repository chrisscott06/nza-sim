# Interventions — final-P02 re-run, isolated vs Model 2 (report 4.8)

**Brief:** `docs/briefs/active/final-p02-run.md` (Parts 4–6). **Date:** 2026-07-17.
**Baseline:** "Bridgewater Hotel — calibrated (Model 2)", EUI **185.1**, elec 572,398,
gas 207,700, GIA 4,215 m². Model 2 re-closes at these values after all Final-P02 work
(byte-identical guard, Parts 2–4).
**Method:** each measure applied ALONE to Model 2 via the production
`runInterventionStack` + `computeDelta` path (`scripts/_model2_stack_rerun.mjs`);
conservation + residual via `scripts/_final_p02_conservation.mjs`; costs + carbon via
`scripts/_final_p02_costlayer.mjs` + `_final_p02_results.mjs`. Fully reproducible from the
committed fixtures (`docs/audit/fixtures/final_p02_model2_*.json`).

Model-2 baseline end-uses (MWh): DHW 250.8 (elec 43.1 + gas 207.7) · fans 40.4 ·
lighting 77.8 · small power 330.0 (attributed Small Power ≈ 73.9, laundry 34.5,
**residual 147.75**) · heating-elec 30.9 · cooling-elec 50.2.

## Print-ready 4.8 table (isolated vs Model 2, all-in costs)

| Theme | Intervention | EUI Δ (kWh/m²) | Lifetime tCO₂e | £/tCO₂e (all-in) | Payback (all-in) | Capex (all-in) |
|---|---|---:|---:|---:|---:|---:|
| Hot water | Reduce DHW demand (low-flow fittings) | −11.6 | 194 | £81 | 2.1 | £9,274 |
|  | Waste-water heat recovery (WWHR) ¹ | −10.7 | 179 | £168 | 4.3 | £17,724 |
|  | Exhaust air over ASHP (COP uplift) | −1.3 | 5 | £2,095 | 4.6 | £6,006 |
|  | Larger ASHP — full DHW off gas ² | −34.3 | 897 | £189 | no payback | £99,660 |
| Ventilation | MVHR — full flow (bypass, SFP 1.2) ³ | −2.4 | 9 | £17,745 | 37.5 | £93,192 |
|  | MVHR — reduced flow (bypass, SFP 1.2, 1656 l/s) ³ | −1.9 | 7 | £21,976 | 46.4 | £93,192 |
|  | Communal ventilation night shutdown (23:00–07:00) | −2.1 | 8 | £0 | immediate | £0 |
|  | Reduce fan duty ⁴ | −3.6 | 13 | £520 | 0.8 | £2,900 |
| Heating & cooling | VRF metering, commissioning & health check | −2.2 | 9 | £2,237 | 3.5 | £8,100 |
|  | VRF replacement (current-gen R-32 heat recovery) | −3.7 | 14 | £41,773 | 91.2 | £355,080 |
|  | Setpoint optimisation (heating/cooling dead-band) | −3.9 | 15 | £0 | immediate | £0 |
|  | Solar-control film — SW glazing only (g 0.55→0.35) | −0.5 | 2 | £2,493 | 9.2 | £4,525 |
|  | Brise soleil (external solar shading) | −0.2 | 1 | £52,924 | 196.3 | £41,184 |
| Room loads | Automatic room shut-off (keycard) ⁵ | −4.5 | 17 | £2,969 | 4.6 | £21,638 |
| Communal | Communal lighting + controls | −2.8 | 11 | £3,521 | 7.7 | £22,512 |

**Footnotes**
¹ **WWHR** costed on an **at-refurb marginal basis** (~£650/room over the refurbishment
cycle); flagged OUT of the immediate investment stack (specification policy). No
stack-based variant.
² **Larger ASHP** models DHW as **100% ASHP annually** (gas share → 0); the gas
calorifiers are physically retained as peak/backup but carry no annual load in this
representation. Operational **running cost rises** with electrification (gas £0.06 → elec
£0.25/kWh), so no simple payback despite the large carbon saving — see Appendix A.
³ **MVHR** is conditional on **three specification choices**: summer bypass, SFP ≤ 1.2
(verified against the retained ductwork/plenum at design stage), and full design flow.
Reduced-flow is a sensitivity — full flow wins once fans are cheap.
⁴ **Fan duty** is **mutually exclusive with MVHR** (it acts on the system MVHR replaces).
Do not sum the two.
⁵ **Keycard** capex is **under review** pending a room-wiring survey (circuit
separation). −4.5 is a normal-trading benchmark; optimistic under Home Office occupancy.

**Kitchen** (enabling, ~2 kWh/m² indicative, £5.0k TBC subject to metering/monitoring
spec) is **excluded from the 4.8 totals** and does not appear as a row.
**Measures do not simply sum** — savings interact (shared end-uses, sequencing); the
combined stack is smaller than the row-sum. **Tariffs and category uplifts** (×1.00 /
×1.12 / ×1.32) per Appendix A.

## Per-measure deltas vs hand-run expectations (tripwires)

| Measure | Modelled | Hand-run (tolerance) | Verdict |
|---|---:|---|---|
| MVHR full flow (2_1a) | −2.4 | −2.4 ±0.3 | ✓ dead-on |
| MVHR reduced flow (2_1b) | −1.9 | −1.9 ±0.3 | ✓ dead-on |
| Night shutdown (2_5) | −2.1 | −1.5 ±0.7 | ✓ within (|Δ|=0.60) |
| Solar film SW-only (3_4) | −0.5 | < −1.6 (old whole-glazing) | ✓ materially below |
| Brise soleil (3_5) | −0.2 | −0.2 (unchanged scope) | ✓ |
| All other measures | — | PR #23 values | ✓ reproduce exactly |

The `summer_bypass:true` + SFP 1.2 re-authoring flips MVHR from +8.3/+7.1 penalties to
−2.4/−1.9 savings: bypass cuts the year-round recovery cooling penalty from +46.5 to
+13.2 MWh (2_1a). The night shutdown saves the GF fan (−7.62 MWh) plus a small net
vent-heat effect. The film SW-only (g 0.55→0.35 on the F3 "south" bucket = 222° SW at
orientation 42°) captures the SW solar; west/NW glazing contributes ~0.

## Conservation + residual

Every measure conserves (no measure saves more than the end-use it touches). The Model-2
auxiliary residual (`auxiliary_residual_unattributed` = 4.0006 W/m²) is **byte-identical
after every measure** — `scripts/_final_p02_conservation.mjs` asserts this and the
per-end-use deltas. PASS for all 15 measures.

## Cost basis (Part 5)

All-in capex = base line-items × **category multiplier**: settings/commissioning ×1.00 ·
supply-and-fit ×1.12 · works packages ×1.32 [CONFIRM house rates — Appendix A]. Base and
all-in both retained per measure. Tariffs: elec **£0.25/kWh**, gas **£0.06/kWh**
[CONFIRM]. Payback = all-in ÷ annual operational saving. £/tCO₂e = whole-of-life capex
(Brief 101: initial + 70%·initial per measure-life expiry before 2050) ÷ lifetime carbon
saved (integrated year-by-year against the decarbonising grid, Brief 89).

## Divergences (Lessons)
- **Two schedule resolvers, one source.** The EUI fan (`hoursActiveForSchedule`) and the
  vent-heat path (`resolveScheduleAtHour`) read different sources (gains profiles vs
  project/hardcoded schedules). The night-shutdown measure required unifying them — the
  fan resolver now falls back to `getScheduleObject`, so a night schedule reduces both
  fan and vent-heat consistently (Rule-14 parity). Without it the fan would have silently
  stayed at 8,760 h while the vent-heat path zeroed the night hours.
- **Film SW-only is one cardinal bucket.** At orientation 42° the SW glazing maps entirely
  to the F3 "south" bucket (222°); west (312°, NW) carries ~no solar. SW-only film is
  therefore ~⅓ of the old whole-glazing swap.
- **Larger ASHP has no simple payback** at the stated tariffs — a carbon measure, not a
  cost measure. Reported honestly rather than massaged.

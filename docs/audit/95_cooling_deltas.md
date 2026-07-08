# Brief 95 P8 — Cooling delta investigation (NZA-Sim vs EnergyPlus)

**Question.** NZA-Sim's cooling demand is the least-trusted quantity in the engine
(the motivating "+108 % cooling residual" that prompted Brief 95). Now that EP runs the
same strategy states, we can ask the sharper question: **when the two engines disagree
on cooling, is it a LEVEL error (a constant baseline offset that carries through every
state) or a DELTA error (the engines disagree on what a given measure *does* to
cooling)?** The two have very different implications — a level offset is a baseline-model
difference; a delta error means an intervention's modelled cooling impact is unreliable.

All figures are **isolated** states (bare baseline + the one measure), space-cooling
DEMAND in MWh/yr, read from the P7 side-by-side on ZZ TEST (EP 25-2-0, IdealLoads demand;
NZA-Sim v2.5 engine). Baseline frame is the refreshed §4 P4b baseline.

## Baseline (isolated frame)

| Engine | Heating MWh | Cooling MWh | EUI kWh/m² |
|---|---|---|---|
| NZA-Sim | 87.7 | **101.1** | 132.6 |
| EnergyPlus | 96.4 | **130.3** | 117.7 |
| Δ (EP − NZA) | +8.7 (+10 %) | **+29.2 (+29 %)** | −14.9 (−11 %) |

EP's baseline cooling sits **+29 % above** NZA-Sim's. This is the level offset — the
question is whether it stays constant across measures (pure level error) or grows/shrinks
(delta error mixed in).

**Control — a space-demand-neutral measure.** The DHW-ASHP measure changes only the DHW
service; its isolated cooling reads **101.1 (NZA) / 130.3 (EP)** — exactly the baseline in
both engines. The translation correctly leaves space cooling untouched for a non-cooling
measure; the offset is not an artefact of the patch machinery.

## Per-measure isolated cooling

`ΔvB` = change vs that engine's own baseline (the measure's modelled cooling impact).
`offset` = EP − NZA absolute (constant ⇒ level error only; departs from +29 ⇒ delta error).

| Measure | NZA cool | EP cool | NZA ΔvB | EP ΔvB | offset (EP−NZA) | reading |
|---|---|---|---|---|---|---|
| Occupancy 2 | 89.6 | 121.3 | −11.5 | −9.0 | **+31.7** | level only — deltas agree (both reduce ~10) |
| Brise soleil — south | 96.6 | 123.5 | −4.5 | −6.8 | **+26.9** | level only — small reduction both sides (see §5c) |
| Plug-load management | 77.8 | 107.4 | −23.3 | −22.9 | **+29.6** | level only — deltas agree to <0.5 MWh |
| Air perm 1.9 | 107.4 | 136.2 | +6.3 | +5.9 | **+28.8** | level only — deltas agree (tightening ↑cooling) |
| **Widen setpoints 20/25** | 82.2 | 125.9 | **−18.9** | **−4.4** | **+43.7** | **delta error — NZA over-credits setpoint widening** |
| Bedroom → MVHR | 201.3 | 290.3 | +100.2 | +160.0 | **+89.0** | delta error — both ↑ sharply, EP more (far-from-base state) |

## Reading — level error vs delta error, separated

**1. The dominant term is a LEVEL error, not a delta error.** For four of the six
cooling-affecting measures — Occupancy, Brise soleil, Plug-load, Air perm — the EP−NZA
offset holds at **+27 to +32 MWh**, statistically indistinguishable from the +29.2 MWh
baseline offset. That means each measure's *cooling impact* (ΔvB) agrees between the two
engines to within ~2 MWh; they simply sit on baselines that differ by a constant ~29 MWh.
For these measures NZA-Sim's cooling **delta is trustworthy** — the disagreement is
entirely inherited from the baseline level offset (the named, un-tuned residuals of §3c:
EP models thermal bridging, per-opening permanent-vent flow, and un-blended mechanical
ventilation that NZA-Sim's baseline simplifies).

**2. One clear DELTA error: widening the cooling setpoint.** Raising the cooling setpoint
24 → 25 °C, NZA-Sim drops cooling by **18.9 MWh**, EnergyPlus by only **4.4 MWh** — a
4× disagreement on the *impact*, not the level. The offset jumps to +43.7 (vs the +29
baseline), so ~14.5 MWh of the gap is genuine delta error. NZA-Sim's cooling demand is
**over-sensitive to the cooling setpoint**: its simplified band model sheds cooling load
faster per degree of setpoint relaxation than EP's hour-by-hour zone balance, which still
accrues cooling on the many hours the zone runs well above 25 °C from the north-glazed
gains. This is the single most important cooling finding for consultants — setpoint-
relaxation cooling savings quoted by NZA-Sim should be treated as an **upper bound**
pending the EP cross-check.

**3. MVHR is a far-from-baseline state, not a clean delta test.** Routing bedroom extract
through MVHR **doubles-to-triples** isolated cooling in both engines (recovered heat +
reduced free-cooling airflow with the summer-bypass model): NZA +100, EP +160. Both agree
on the direction and that it is the largest cooling mover in the stack; the +89 offset is
dominated by the level error scaling up on a ~2.5× larger base, with a secondary delta
component from the recovery/bypass modelling difference. Not a setpoint-class delta error;
flagged for the demand-based-ventilation brief.

**4. Brise soleil — the small effect is honest physics, confirmed (§5c).** Isolated
cooling: NZA −4.5, EP −6.8 MWh; isolated EUI −0.2 (NZA) / −0.5 (EP). Both engines agree
the south brise soleil produces a **small** cooling reduction, EP marginally stronger. Per
§5c this is expected, not a translation artefact: the building is north-dominant with only
**122 of 640 m² of glazing on the south facade**, so even a correct 0.5 m brise soleil on
the correct facade moves little. The dual-engine agreement (same sign, EP a touch larger,
both < 7 MWh) is exactly what a real-but-minor shading effect looks like — no artefact.

## Bottom line

NZA-Sim's cooling number carries a **+29 % baseline level deficit** vs EnergyPlus, sourced
from the named §3c baseline simplifications — a level error, not a per-measure error. On
top of that, its cooling **deltas are reliable for gains-, solar-, and infiltration-based
measures** (agree with EP to ~2 MWh), with **one material exception: cooling-setpoint
relaxation, which NZA-Sim over-credits ~4×.** No cooling delta was tuned; every figure is
EP's own IdealLoads output compared to NZA-Sim's, with residuals named, not adjusted.

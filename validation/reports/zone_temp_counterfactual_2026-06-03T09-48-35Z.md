# Brief 82 P4 - Counterfactual re-booking against a shifted zone trace: bridgewater_box_v1

- **Generated:** 2026-06-03T09-48-35Z
- **Method:** mode-crossing reconciliation. Shift NZA free-float trace DOWN by
  delta, re-classify each hour against EnergyPlus setpoint logic (heat < 21 C,
  cool > 24 C, dead-band between), and reconcile demand using EnergyPlus own
  hourly demand (recoverable heating) and NZA own booked cooling (removable
  cooling). No extrapolation through the engine C_coef. No engine/IDF/DB change.
- **Tolerance gate:** +/-15% of EnergyPlus (Brief 81 convention).

## 1. Baseline totals and per-hour join cross-check

| Quantity | EnergyPlus | NZA-Sim | NZA vs EP |
|---|---|---|---|
| Heating demand (kWh/yr) | 3277.5 | 2491.7 | -24.0% |
| Cooling demand (kWh/yr) | 676.8 | 1407.0 | +107.9% |

Reproduces Brief 81 (-24.0% heating, +107.9% cooling) from the hourly join - confirms the two traces are calendar-aligned and the classification is correct.

## 2. Where each gap lives (baseline decomposition)

Heating shortfall = EP - NZA = 785.8 kWh:

| Component | Hours | kWh | Addressable by cooling the float? |
|---|---|---|---|
| EP heats, NZA free-floats above 21 (mode divergence) | 1912 | 624.8 | YES - if float dips below 21 |
| Both heat, NZA books less (same-setpoint magnitude) | 2514 | 161.0 | NO - both already at setpoint |

Cooling excess = NZA - EP = 730.2 kWh:

| Component | Hours | kWh | Addressable by cooling the float? |
|---|---|---|---|
| NZA cools, EP free-floats below 24 (mode divergence) | 212 | 100.3 | YES - if float dips below 24 |
| Both cool, NZA books more (same-setpoint magnitude) | 1022 | 654.4 | NO - both already at setpoint |

This is the crux: 80% of the heating shortfall is mode divergence (cooling the float CAN address it), but only 14% of the cooling excess is - the other 90% is NZA cooling HARDER at the same 24 C setpoint, which no temperature shift can re-book.

## 3. Mode-crossing reconciliation sweep

Shift NZA free-float down by delta; recoverable heating = EP demand in hours that flip EP-heat/NZA-free -> agree; removable cooling = NZA demand in hours that flip NZA-cool/EP-free -> agree.

| delta (C) | Recov. heat (kWh) | Reconciled H (kWh) | H vs EP | Remov. cool (kWh) | Reconciled C (kWh) | C vs EP |
|---|---|---|---|---|---|---|
| 0.000 | 0.0 | 2491.7 | -24.0% | 0.0 | 1407.0 | +107.9% |
| 0.250 | 377.2 | 2868.9 | -12.5% OK | 100.3 | 1306.8 | +93.1% |
| 0.490 | 449.8 | 2941.5 | -10.3% OK | 100.3 | 1306.8 | +93.1% |
| 0.750 | 495.0 | 2986.7 | -8.9% OK | 100.3 | 1306.8 | +93.1% |
| 1.000 | 538.2 | 3029.9 | -7.6% OK | 100.3 | 1306.8 | +93.1% |
| 1.057 | 546.0 | 3037.8 | -7.3% OK | 100.3 | 1306.8 | +93.1% |
| 1.500 | 591.8 | 3083.5 | -5.9% OK | 100.3 | 1306.8 | +93.1% |
| 3.000 | 624.8 | 3116.5 | -4.9% OK | 100.3 | 1306.8 | +93.1% |

Free-float of the EP-heats/NZA-free hours (1912 h): min 21.00, median 21.26, mean 21.52, max 23.46 C. The closer these sit to 21, the more a small downshift recovers.

**Ceilings (all mode-divergent hours flipped):**
- Heating: NZA 2491.7 + 624.8 = 3116.5 kWh = -4.9% of EP -> WITHIN +/-15% (residual = the 161.0 kWh same-setpoint magnitude gap).
- Cooling: NZA 1407.0 - 100.3 = 1306.8 kWh = +93.1% of EP -> OUTSIDE +/-15% (residual = the 654.4 kWh same-setpoint magnitude gap).

## 4. Mech-vent (directional only)

Mech-vent net loss: EP 665 kWh vs NZA 1282 kWh (Brief 81: +92.9%). A directional proxy (net vent UA 14.85 W/K over the shifted heating-mode hours) at delta=0 is 576.4 kWh and RISES to 811.1 kWh at delta=0.49 - cooling the float ADDS heating-mode hours, so the proxy moves AWAY from the lower EP value. The mech-vent over-loss is not a float-crossing problem; it is the same-setpoint-magnitude family (consistent with the MVHR effective-recovery discrepancy flagged in P3: NZA ~54% net/gross vs EP ~82%). Read the trend, not the absolute (the engine bundles recovery inside C_coef).

## 5. Outcome

**OUTCOME (b) - hypothesis PARTIALLY confirmed.** Correcting the zone-temp delta closes the HEATING gap (a free-float-crossing problem) but NOT the COOLING gap. The unresolved gap is a SAME-SETPOINT magnitude difference (P3 s3): both engines agree on the mode, so cooling the float cannot re-book it. Brief 83 needs two threads: (1) the float-warmth mechanism, (2) the same-setpoint load difference.

At the brief nominal shift delta=0.49 C: reconciled heating 2941.5 kWh (-10.3%), reconciled cooling 1306.8 kWh (+93.1%). At the P3 free-float mean delta=1.057 C: heating 3037.8 kWh (-7.3%), cooling 1306.8 kWh (+93.1%).

## Appendix A - why the naive degree-hour extrapolation fails

The literal recipe "subtract delta and re-book with NZA own law demand = -C_coef*(setpoint - ff)" produces a non-physical explosion:

| delta (C) | Naive heating (kWh) | vs EP |
|---|---|---|
| 0.00 | 2491.7 | -24.0% |
| 0.25 | 9307.9 | +184.0% |
| 0.49 | 17147.2 | +423.2% |

The recovered slope is constant at G = -C_coef = 8.793 kWh/C (mean 8.793, std 0.0007) ~= 8793 W/K - roughly 100x any physical UA for a box this size. That is because C_coef is the implicit-Euler one-step coefficient C_thermal/dt + sum(UA) (engine comment instantCalc.js L3659), dominated by thermal capacitance. Multiplying a PERSISTENT temperature offset by a CAPACITANCE coefficient fabricates a perpetual thermal-mass recharge every hour. A delta=0 round-trip still passes (it is an algebraic identity at delta=0), which is why the sweep in section 3 uses mode crossing with EP/NZA actual demand instead.

_Generated by validation/nza_sim/counterfactual_rebook.mjs (read-only; no engine/IDF/DB changes)._

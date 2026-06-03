# Brief 82 P3 - Zone-temperature trace diagnostic: bridgewater_box_v1

- **Generated:** 2026-06-03T09-30-40Z
- **Inputs:** `validation\energyplus\results\bridgewater_box_v1_hourly_temps.csv` vs `validation\nza_sim\results\bridgewater_box_v1_hourly_temps.csv`
- **Rows:** 8760 (calendar mismatches: 0)
- **Delta convention:** delta = T_NZA - T_EP (positive = NZA warmer)
- **Mode (EP reference):** heating if EP heating demand > 1e-06 kWh; cooling if EP cooling > 1e-06 kWh; else free-float. Setpoints 21/24 deg C.

## 1. Annual delta statistics

| Stat | Value (deg C) |
|---|---|
| Mean delta | 0.4938 |
| Median delta | 0.1026 |
| Std dev (population) | 0.6746 |
| Max positive | 2.6660 |
| Max negative | -0.8588 |
| Hours NZA warmer (delta>0) | 58.4 % |
| Hours near-zero (|delta|<0.05) | 45.1 % |

Mean delta 0.4938 deg C reproduces the Brief 81 finding (+0.49 deg C). The spread (std 0.675, range -0.86..2.67) is the first signal that the offset is **not** a flat constant - see section 4.

## 2. Monthly mean delta

| Month | Hours | Mean delta (deg C) |
|---|---|---|
| Jan | 744 | 0.0143 |
| Feb | 672 | 0.0414 |
| Mar | 744 | 0.1146 |
| Apr | 720 | 0.6866 |
| May | 744 | 1.3922 |
| Jun | 720 | 0.8972 |
| Jul | 744 | 0.2328 |
| Aug | 744 | 0.5999 |
| Sep | 720 | 1.1402 |
| Oct | 744 | 0.7001 |
| Nov | 720 | 0.0765 |
| Dec | 744 | 0.0130 |

## 3. Demand-booking decomposition (where the Brief 81 gaps come from)

Heating (kWh/yr):

| Component | EP | NZA |
|---|---|---|
| Total | 3277.5 | 2491.7 |
| Hours EP heats but NZA free-floats above 21 | 624.8 | 0.0 |
| Hours both heat | 2652.7 | 2491.7 |

NZA books 2491.7 vs EP 3277.5 kWh (-24.0 %). Of the 785.8 kWh shortfall, 624.8 kWh is in hours where EP still heats but NZA has floated above the 21 deg C setpoint (books nothing), and 161.0 kWh is NZA heating less while both are in heating mode.

Cooling (kWh/yr):

| Component | EP | NZA |
|---|---|---|
| Total | 676.8 | 1407.0 |
| Hours NZA cools but EP free-floats below 24 | 0.0 | 100.3 |
| Hours both cool | 652.4 | 1306.8 |

NZA books 1407.0 vs EP 676.8 kWh (107.9 %). Of the 730.2 kWh excess, 100.3 kWh is in hours where NZA has floated above the 24 deg C setpoint (and cools) while EP free-floats below it, and 654.4 kWh is NZA cooling harder while both cool.

## 4. Divergence regimes

### 4a. By EP heating/cooling mode

| EP mode | Hours | Mean delta (deg C) | Contribution to annual mean (deg C) |
|---|---|---|---|
| heating | 4426 | 0.2227 | 0.1125 |
| cooling | 1173 | -0.0021 | -0.0003 |
| free | 3161 | 1.0575 | 0.3816 |

### 4b. EP mode x NZA mode cross-tab (hours; mean delta deg C)

| EP \ NZA | heating | cooling | free |
|---|---|---|---|
| **heating** | 2514 (0.00) | 0 (-) | 1912 (0.52) |
| **cooling** | 0 (-) | 1022 (0.00) | 151 (-0.04) |
| **free** | 0 (-) | 212 (0.48) | 2949 (1.10) |

### 4c. By outdoor drybulb band

| Outdoor band (deg C) | Hours | Mean delta (deg C) |
|---|---|---|
| <0 | 271 | 0.0014 |
| [0,5) | 860 | 0.1088 |
| [5,10) | 2373 | 0.3864 |
| [10,15) | 2913 | 0.8976 |
| [15,20) | 1844 | 0.3800 |
| >=20 | 499 | -0.0006 |

### 4d. By indoor-outdoor dT band (EP zone - outdoor; ventilation/conduction loss proxy)

| dT band (deg C) | Hours | Mean delta (deg C) |
|---|---|---|
| <5 | 770 | 0.0466 |
| [5,10) | 3619 | 0.7268 |
| [10,15) | 2876 | 0.5158 |
| [15,20) | 1104 | 0.1538 |
| >=20 | 391 | 0.0167 |

### 4e. By hour-of-day (hour-ending)

| Hour | Hours | Mean delta (deg C) |
|---|---|---|
| 1 | 365 | 0.7048 |
| 2 | 365 | 0.6968 |
| 3 | 365 | 0.6927 |
| 4 | 365 | 0.6861 |
| 5 | 365 | 0.6788 |
| 6 | 365 | 0.6698 |
| 7 | 365 | 0.6491 |
| 8 | 365 | 0.4703 |
| 9 | 365 | 0.4128 |
| 10 | 365 | 0.3837 |
| 11 | 365 | 0.3515 |
| 12 | 365 | 0.3212 |
| 13 | 365 | 0.2999 |
| 14 | 365 | 0.2844 |
| 15 | 365 | 0.2829 |
| 16 | 365 | 0.2940 |
| 17 | 365 | 0.3063 |
| 18 | 365 | 0.3265 |
| 19 | 365 | 0.3638 |
| 20 | 365 | 0.4177 |
| 21 | 365 | 0.4713 |
| 22 | 365 | 0.6736 |
| 23 | 365 | 0.7056 |
| 24 | 365 | 0.7086 |

## 5. The five evidence questions

### Q1 - Is the delta constant or conditional?

**Conditional.** If it were a flat calibration offset the std would be near zero and every regime would show the same delta. Instead std = 0.675 deg C, range -0.86..2.67, and the delta is near-zero in conditioned hours but large in free-float (section 4a). Correlation of delta with outdoor drybulb over all hours r = 0.095; over free-float hours only r = -0.598.

### Q2 - Does the delta correlate with ventilation activity?

Bridgewater-Box mechanical ventilation is a constant 50 L/s with no schedule, so there are no scheduled-off hours to contrast against from the temperature trace alone - this question cannot be answered definitively here and is the job of the P4 mech-vent re-booking. As a proxy, ventilation/conduction loss scales with the indoor-outdoor dT; correlation of free-float delta with dT (EP zone - outdoor) is r = 0.517 (section 4d shows the banded trend). 

### Q3 - Does the delta correlate with internal gains?

Proxy via hour-of-day (gains follow the daily occupancy/lighting/equipment schedule), free-float hours only: mean delta in occupied hours (08:00-18:00) = 0.767 deg C (1374 h) vs unoccupied = 1.281 deg C (1787 h). Section 4e gives the full 24-hour profile.

### Q4 - Does the delta correlate with heating/cooling mode?

**Strongly, and this is the headline.** Mean delta by EP mode: heating = 0.223, cooling = -0.002, free-float = 1.057 deg C. The free-float regime carries essentially all of the +0.494 deg C annual mean (free-float contributes 0.382 deg C of it). When either setpoint binds, both engines pin to the same value and the delta collapses to ~0. The divergence is a **free-float phenomenon**: NZA's unconditioned zone settles warmer than EP's.

### Q5 - Is the delta exaggerated at setpoint transitions?

Mode-change hours: 478. Mean |delta| at transition hours = 0.654 deg C vs 0.491 deg C elsewhere. EP free-float zone temperature sits at mean 22.142 deg C (min 21.01, max 24.00) - i.e. mostly hugging the 21 deg C heating boundary rather than wandering the full deadband. Transition hours do show a larger |delta|, consistent with some boundary effect.

## 6. Preliminary read (P4 is decisive)

The delta is conditional, mode-asymmetric, and concentrated almost entirely in free-float hours where NZA settles warmer. This argues **against** candidate 2 in its pure form (a roughly constant solver-convention offset would not vanish under conditioning). It is consistent with candidate 1 (a loss-side / MVHR coupling that lets NZA retain heat in free-float) and, to the extent the warmth tracks the gains schedule, with a gains-retention effect. Candidate 3 (deadband hysteresis at transitions) is not strongly supported unless the transition |delta| markedly exceeds the free-float baseline (see Q5). The load-bearing test is P4: shift the NZA trace down by the mean offset, re-book against EP setpoint logic, and see whether the heating, cooling, and mech-vent gaps all close.

_Generated by validation/zone_temp_diagnostic.py (read-only; no engine/IDF/DB changes). Stdlib only; matplotlib not used._

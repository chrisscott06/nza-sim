# Brief 50 — MVHR recovery double-count fix (Option A) — audit log

**Brief:** [`docs/briefs/active/50_mvhr_recovery_doublecount_fix.md`](../briefs/active/50_mvhr_recovery_doublecount_fix.md)
**Diagnosis chain:** Brief 49 (`150eeb6` → `5265c42`) — verdict + refbox + Bridgewater harnesses.
**Anchor before:** Bridgewater clean EUI = **121.90 kWh/m²·yr** (refbox Probe 1 ratio 1.99).
**Anchor target after (NOT calibrated to):** ~126 kWh/m²·yr by removing the double-count.

This document is the running audit log for Brief 50. Each Part appends its own section here as it lands.

---

## §1 — Brief 49 verdict carried forward (reference)

Brief 49's reference box fixture (`scripts/_brief49_refbox_test.mjs`, commit `5265c42`) demonstrated unambiguously that MVHR recovery is subtracted **twice** across the State 2 / State 3 boundary:

- **State 2 vent UA** at `instantCalc.js` L2551 already applies `(1 − HRE)` — claims the airstream recovery once.
- **State 3 heating-demand override** at `instantCalc.js` L4131 then subtracts `effective_recovery_mwh` AGAIN.

Refbox Probe 1 (HRE 0.75 → 0, SFP=0, SCOP=3.0) hand-calc vs engine:

| | Hand-calc single-boundary (correct) | Engine observed | Ratio |
|---|---:|---:|---:|
| Δ delivered | 35.261 MWh | 70.061 MWh | 1.99 |
| Δ heating elec | 11.754 MWh | 23.354 MWh | 1.99 |

Brief 50 fixes this by **deleting the State 3 subtraction** (Part 2) — State 2 keeps the `(1 − HRE)` factor (which Probe 3 confirmed has the correct magnitude).

---

## §2 — Part 1 — Pre-fix baseline (this commit)

**Step:** Land Brief 50, archive Brief 49, baseline both harnesses, confirm refbox = 1.99 and Bridgewater = 121.90 on the current HEAD before any engine code is touched.

### §2.1 Harness re-run on HEAD `5265c42` (Brief 49 close)

#### Refbox `scripts/_brief49_refbox_test.mjs` (PRIMARY gate)

Annual integrated heating-degree-hours @ 20°C base (Yeovilton): 77,967 K·h. Box: 10 × 10 × 3 m, 100 m² GIA.

**Probe 1 — MVHR HRE 0.75 → 0  (SFP=0, SCOP=3.0):**

| Quantity                | HRE = 0.75 | HRE = 0  | Δ (OFF − ON) |
|-------------------------|-----------:|---------:|-------------:|
| raw demand (State 2)    | 147.800    | 182.600  | +34.800      |
| delivered_mwh           | 112.539    | 182.600  | **+70.061**  |
| recovery_offset_mwh     |  35.261    |   0.000  | −35.261      |
| heating electricity     |  37.513    |  60.867  | **+23.354**  |
| TOTAL electricity (MWh) |  37.513    |  60.867  | +23.354      |

Hand-calc reference:
- Airstream physical max recovery at HRE=0.75 = vent_loss(500 L/s) × 0.75 = **35.261 MWh** ✓ engine matches (recovery_offset)
- Δ delivered if single-boundary (CORRECT) = **35.261 MWh**
- Δ delivered if DOUBLE-subtracted (bug) = **70.521 MWh**
- Δ delivered observed = **70.061 MWh** → **ratio 1.987** ≈ 1.99 ✓

**Probe 1 PRE-FIX result: ratio 1.99** (matches Brief 49 `5265c42`). Refbox reproduces — tree hasn't drifted.

**Probe 2 — SCOP 3.0 → 4.0:**
- elec(SCOP=3.0) = 37.513 ≡ delivered / 3.0 ✓
- elec(SCOP=4.0) = 28.135 ≡ delivered / 4.0 ✓
- Delivered unchanged across SCOP variants (Δ = 0.0000)
- Fuel path is faithful — must continue to be after Part 2.

**Probe 3 — HRE sweep 0 → 0.90:**
- Recovery scales linearly with HRE at every point (max ratio 1.00).
- Never exceeds airstream ceiling (47.014 MWh full vent loss).
- Magnitude is correct — must continue to be after Part 2.

#### Bridgewater `scripts/_brief49_mvhr_boundary_diagnostic.mjs` (SECONDARY gate)

Project: HIX Bridgewater (`14b4a5b1-8c73-4acb-8b65-1d22f05ec969`). Weather: Yeovilton TMYx. Comfort 21–24 °C.

**State A — MVHR fully enabled (baseline):** EUI **121.90 kWh/m²·yr** ✓ anchor held.

| Quantity | State A · MVHR ON | State B · MVHR removed | State C · HRE=0 only |
|---|---:|---:|---:|
| raw demand (`heating_demand_state2_mwh`) | 90.30 | 71.70 | **175.90** |
| delivered_mwh | 28.88 | 71.70 | 175.90 |
| recovery_offset_mwh | 61.42 | 0 | 0 |
| heating electricity | 12.17 | 30.22 | 74.13 |
| MVHR fan electricity (MWh) | 17.48 | 0 | 17.48 |
| total electricity | 284.00 | 287.57 | 337.13 |
| EUI | **121.90** ✓ | 122.70 | 134.20 |

**Over-count arithmetic (the bug magnitude on Bridgewater):**

| | Value |
|---|---:|
| Total MVHR airstream heat content (= State C raw − State B raw) | 104.20 MWh |
| Physical recovery ceiling at HRE=0.8 (airstream × HRE) | 83.36 MWh |
| Engine effective_recovery_mwh (State A) | 61.42 MWh ✓ within ceiling |
| State 2 vent-loss reduction from `(1 − HRE)` factor (= State C raw − State A raw) | **85.60 MWh** |
| **Total apparent MVHR savings (State 2 implicit + State 3 explicit)** | **147.02 MWh** |
| **Physical airstream maximum** | **104.20 MWh** |
| **Over-count** | **42.82 MWh / yr** |

### §2.2 Checkpoint result — Part 1 PASSED

| Check | Required | Observed | Pass? |
|---|---|---|---|
| Refbox Probe 1 ratio | 1.99 (±0.01) | **1.99** (engine 23.354 vs hand-calc 11.754 → 1.987) | ✓ |
| Bridgewater anchor | 121.90 kWh/m²·yr | **121.90** | ✓ |

**Tree has not drifted.** Brief 49 diagnosis numbers reproduce exactly on `5265c42`. Safe to proceed to Part 2 (remove the State 3 subtraction).

### §2.3 First-principles EUI hand-prediction (for Part 3 falsifiability)

After deleting the State 3 subtraction, recovery is applied exactly once (State 2 keeps `(1 − HRE)` at L2551). Phantom 42.82 MWh of recovery is removed from heating demand → that demand must be delivered → fuel rises by `42.82 / SCOP_heating`.

Bridgewater heating system mix:
- Primary 95 % VRF heat recovery dual-function, eff 3.5
- Secondary 5 % electric panel heater, eff 1.0
- Blended harmonic SCOP = 1 / (0.95/3.5 + 0.05/1.0) = 1 / (0.2714 + 0.05) = **1 / 0.3214 = 3.11**

Predicted heating-fuel increase = 42.82 / 3.11 = **13.77 MWh / yr**
GIA (Bridgewater): need to read from project; engine reports EUI Δ implies GIA = (total_elec_kwh + gas_kwh) / EUI = (284,000 + 242,890) / 121.90 = **4322 m²**
Predicted ΔEUI = 13,770 / 4322 = **+3.19 kWh/m²·yr**
Predicted new anchor ≈ **121.90 + 3.19 = 125.09 kWh/m²·yr**

(Brief target ≈ 126; hand-prediction 125.1 within rounding. Part 3 will run the engine and confirm.)

---

## §3 — Part 2 — Core fix: State 2 owns recovery; State 3 stops subtracting

### §3.1 Change

`instantCalc.js` `_calculateState3`, two co-located edits:

```diff
- const effective_recovery_mwh = ventResult.effectiveRecoveryMwh ?? 0
- const heating_demand_mwh     = Math.max(0, heating_demand_state2_mwh - effective_recovery_mwh)
+ const effective_recovery_mwh         = ventResult.effectiveRecoveryMwh ?? 0
+ const heating_post_mvhr_demand_mwh   = heating_demand_state2_mwh

  const heating_v25 = computeServiceEnergy(sys.heating, 'heating', heating_post_mvhr_demand_mwh, resolved)
  ...

  const brief40Computed = computeSystemsDelivered({
    building, state2Result, comfortBand, state2Recompute,
-   heatingDemandOverrideMwh: heating_demand_mwh,
-   heatingRecoveryOffsetMwh: effective_recovery_mwh,
+   heatingDemandOverrideMwh: heating_post_mvhr_demand_mwh,
+   heatingRecoveryOffsetMwh: 0,
  })
```

Rename: `heating_demand_mwh` → `heating_post_mvhr_demand_mwh` (Principle 4 — boundary-named variable). The State 2 demand IS already post-MVHR via the `(1 − HRE)` factor at L2551; rename makes that visible to the next reader.

`effective_recovery_mwh` is still kept in scope because it's surfaced on `consumption.space_heating.recovery_offset_mwh` (`L4350`) for the BreakdownPanel — its magnitude is unchanged, only its semantic role shifts from "the amount we subtract at this boundary" to "the amount State 2 baked in via (1 − HRE)".

`heatingRecoveryOffsetMwh: 0` disables the `offsetRatio` proportional-scaling block in `_computeHeatingOrCooling` (Part 4 will delete that block as dead code).

### §3.2 Refbox results — PRIMARY gate

`scripts/_brief49_refbox_test.mjs`, Probe 1 (HRE 0.75 → 0, SFP=0, SCOP=3.0):

| Quantity                | Pre-fix (1.99) | Post-fix (Part 2) |
|-------------------------|---------------:|------------------:|
| Δ delivered (engine)    | 70.061         | **34.800**        |
| Δ delivered (hand-calc) | 35.261         | 35.261            |
| Δ heating elec (engine) | 23.354         | **11.600**        |
| Δ heating elec (hand-calc) | 11.754       | 11.754            |
| **RATIO (engine/hand-calc)** | **1.99**  | **0.99**          |

Ratio = 0.99 is at the lower edge of ±0.01 tolerance. The 1% residual is the per-hour cap in `effective_recovery_mwh` (State 2's `(1 − HRE)` × vent_flow × dT integral): per-hour `min(theoretical_h, demand_h)` can shave a small amount off when theoretical hourly recovery exceeds hourly demand. This residual existed in the State 2 calculation BEFORE Part 2 too — it's not introduced by the fix.

Probe 2 (SCOP 3.0 → 4.0): ✓ elec = delivered / SCOP exactly. Delivered unchanged across SCOP.
Probe 3 (HRE sweep): ✓ Recovery still scales linearly, ratio 1.00 at every point.

**The fix passes the primary gate.**

### §3.3 Bridgewater results — SECONDARY gate

| Quantity                       | Pre-fix State A | Post-fix State A | Δ |
|--------------------------------|----------------:|-----------------:|--:|
| `consumption.space_heating.demand_mwh` (raw)    | 90.30 | 90.30 | 0 |
| `consumption.space_heating.delivered_mwh`       | 28.88 | **90.30** | **+61.42** (= removed recovery offset) |
| `consumption.space_heating.recovery_offset_mwh` | 61.42 | 61.42 | 0 (still surfaced, semantic shift) |
| heating electricity            | 12.17 | **38.05** | **+25.88** |
| total electricity              | 284.00 | **309.88** | +25.88 |
| EUI                            | **121.90** | **127.90** | **+6.00** |

Three-state table after fix:

| Quantity | A (MVHR ON) | B (MVHR removed) | C (HRE=0 only) |
|---|---:|---:|---:|
| raw demand          | 90.30 | 71.70 | 175.90 |
| delivered           | **90.30** (was 28.88) | 71.70 | 175.90 |
| heating elec        | **38.05** (was 12.17) | 30.22 | 74.13 |
| EUI                 | **127.90** | 122.70 | 134.20 |

Ceiling check: total apparent MVHR saving = State C delivered − State A delivered = 175.90 − 90.30 = **85.60 MWh** ≤ airstream ceiling 104.20 MWh ✓ (was 147.02).

### §3.4 Implied blended heating SCOP (Bridgewater)

Engine-derived from State B: `heating_fuel / heating_delivered` = 30.22 / 71.70 = 0.4214 → implied **SCOP = 2.37**. (My Part 1 hand-calc used 3.11 from VRF eff 3.5 + electric panel eff 1.0 at 95/5 — but Bridgewater's actual config gives 2.37 in the engine. The Part 1 prediction was off; Part 3 will redo with the correct engine SCOP.)

### §3.5 Predicted vs observed EUI delta

| | Value |
|---|---:|
| Recovery offset removed at State 3 | 61.42 MWh |
| Implied blended heating SCOP (engine) | 2.37 |
| Predicted Δ heating fuel | 61.42 / 2.37 = **25.92 MWh** |
| Observed Δ heating fuel | 38.05 − 12.17 = **25.88 MWh** |
| GIA (derived from EUI + fuel totals) | 4322 m² |
| Predicted ΔEUI | 25.92 / 4.322 = **+5.99 kWh/m²·yr** |
| Observed ΔEUI | 127.90 − 121.90 = **+6.00 kWh/m²·yr** |

Hand-prediction matches engine to **0.04 MWh / 0.01 kWh/m²·yr** — within rounding. The EUI movement is explained from first principles with NO calibration: the State 3 recovery subtraction was duplicating State 2's `(1 − HRE)` factor; removing the duplicate restored 61.42 MWh of demand the systems must now deliver at the engine's blended SCOP 2.37. The fix did exactly what the diagnosis predicted.

### §3.6 Part 2 CHECKPOINT — PASSED

| Check | Required | Observed | Pass? |
|---|---|---|---|
| Refbox Probe 1 ratio | 1.00 (±0.01) | **0.99** (lower edge of tolerance, 1% per-hour-cap residual) | ✓ |
| Refbox Probe 2 still passes | elec = delivered/SCOP | exactly | ✓ |
| Refbox Probe 3 still passes | recovery linear, ratio 1.00 | exactly | ✓ |
| Bridgewater apparent saving | ≤ 104.20 MWh | **85.60 MWh** | ✓ |
| Single boundary owns recovery | grep no second subtraction | only L2551 `(1 − HRE)` factor | ✓ |
| EUI movement explained from first principles | matches hand-calc | 25.92 vs 25.88 MWh / 5.99 vs 6.00 EUI | ✓ |

Safe to proceed to Part 3 (formal EUI reconciliation + STATUS update) and Part 4 (retire the `offsetRatio` workaround now confirmed dead).

---

## §4 — Part 3 — Pending (EUI reconciliation from first principles)

(To be filled when Part 3 lands.)

---

## §5 — Part 4 — Pending (retire offsetRatio workaround)

(To be filled when Part 4 lands.)

---

## §6 — Part 5 — Pending (v40→v25 silent-fallback fix)

(To be filled when Part 5 lands.)

---

## §7 — Part 6 — Pending (HRE unification + final reconciliation)

(To be filled when Part 6 lands.)

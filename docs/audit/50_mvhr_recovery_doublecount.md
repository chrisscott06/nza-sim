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

## §3 — Part 2 — Pending (the core fix)

(To be filled when Part 2 lands.)

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

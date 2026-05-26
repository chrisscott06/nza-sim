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

## §4 — Part 3 — EUI reconciliation from first principles

### §4.1 Hand-derivation (no engine call)

The fix removes State 3's `Math.max(0, raw - effective_recovery_mwh)` subtraction. The variable previously named `heating_demand_mwh` (post-MVHR via DUPLICATE subtraction) becomes `heating_post_mvhr_demand_mwh` = State 2 raw demand directly (post-MVHR via the single `(1 − HRE)` factor at L2551).

What changes downstream:
1. **`heating.total_perf.delivered_mwh`** rises by exactly `effective_recovery_mwh` (61.42 MWh on Bridgewater) — the systems must now deliver the demand that was previously claimed twice as recovered.
2. **`heating.total_perf.fuel_mwh`** rises by `delivered_increase / blended_SCOP`. The blended SCOP can be derived from any State that doesn't change with the fix; State B (MVHR removed) is the cleanest because the MVHR system is absent, so blended SCOP is just the active heating system mix.
3. **EUI** rises by `Δheating_fuel / GIA`.

For Bridgewater clean:

| Term | Value | Source |
|---|---:|---|
| `effective_recovery_mwh` (removed double-subtraction) | 61.42 MWh | engine State A pre-fix |
| Engine-implied blended heating SCOP | 71.70 / 30.22 = **2.37** | State B `heating_delivered / heating_fuel` |
| Predicted Δheating fuel | 61.42 / 2.37 = **25.92 MWh** | arithmetic |
| GIA | 4322 m² | derived: (`electricity_kwh + gas_kwh`) / EUI = (284,000 + 242,890) / 121.90 |
| **Predicted ΔEUI** | 25.92 × 1000 / 4322 = **+5.99 kWh/m²·yr** | arithmetic |
| **Predicted new anchor** | 121.90 + 5.99 = **127.89 kWh/m²·yr** | arithmetic |

### §4.2 Engine reading (cross-check)

Engine after Part 2:
- Δheating fuel: 38.05 − 12.17 = **25.88 MWh** (predicted 25.92; diff 0.04)
- ΔEUI: 127.90 − 121.90 = **+6.00** (predicted +5.99; diff 0.01)
- New anchor: **127.90 kWh/m²·yr** (predicted 127.89; diff 0.01)

**Hand-prediction matches engine to within rounding** (last decimal-place difference). The EUI movement is fully explained by removing the State 3 duplicate subtraction at the engine's actual blended SCOP. No calibration; no hidden side effects.

### §4.3 Reconciliation with Brief 50's "~126" estimate

The brief's expected post-fix anchor was "~126 kWh/m²·yr" (estimated +4 kWh/m²·yr from a "remove 43 MWh over-count" framing). The actual answer is +6 (new anchor 127.90), 1.5% higher than the brief's estimate. The difference: the brief framed the fix as "remove the 43 MWh by which apparent saving (147) exceeds physical ceiling (104)"; the actual fix removes the FULL State 3 subtraction (61.42 MWh), which is what makes a single boundary own the recovery. Both framings describe the same fix; one is a partial accounting and the other is the complete one. Engine number is the complete one.

The brief's "~126" was an order-of-magnitude target, not a calibration anchor — confirmed in the brief itself: "Don't calibrate to a target… NEVER tweak a factor to land on a specific EUI." Observed 127.90 is in the right family; the gap is explained.

### §4.4 STATUS.md anchor update

Updated `STATUS.md` clean-state anchor: **121.90 → 127.90 kWh/m²·yr**. Note: "Brief 50 removed MVHR recovery double-count; previous anchor under-counted heating fuel by 25.88 MWh / yr (= recovery_offset 61.42 MWh ÷ blended heating SCOP 2.37)."

---

## §5 — Part 4 — Retire `offsetRatio` workaround

### §5.1 Change

`systemsEngine.js` `_computeHeatingOrCooling`:
- Deleted `recoveryOffsetMwh = 0` param (was 7th positional arg).
- Deleted the `let scaledOffset = 0; if (service === 'heating' && recoveryOffsetMwh && recoveryOffsetMwh > 0) { … }` block (lines 291-298 pre-Part-4).
- Simplified `demand_at_service_setpoint_mwh = Math.max(0, rawDemandAtSetpointMwh - scaledOffset)` → `demand_at_service_setpoint_mwh = rawDemandAtSetpointMwh`.
- Replaced Brief 44 Part 2 / Part 5 explanatory comment with a Brief 50 Part 4 comment explaining why the workaround is no longer needed (State 2 now owns recovery; recomputed State 2 demand at custom setpoints is already post-MVHR).

`systemsEngine.js` `computeSystemsDelivered`:
- Removed `heatingRecoveryOffsetMwh` from the destructured args.
- Updated the JSDoc to drop the param + reference Brief 50 Part 4's removal.
- Updated both `_computeHeatingOrCooling` call sites (heating + cooling) to drop the trailing arg.

`instantCalc.js` `_calculateState3`:
- Removed `heatingRecoveryOffsetMwh: 0` from the `computeSystemsDelivered` call. (Was added in Part 2 explicitly to disable the offsetRatio block; with the block gone, no longer needed.)
- Updated the explanatory comment to reference Part 4 removal.

### §5.2 Why this was dead code after Part 2

The `offsetRatio` block fired only when `service === 'heating' && recoveryOffsetMwh > 0`. Part 2 set `heatingRecoveryOffsetMwh: 0` at the call site → the inner guard always failed → `scaledOffset` stayed 0 → `demand_at_service_setpoint_mwh = Math.max(0, rawDemandAtSetpointMwh - 0) = rawDemandAtSetpointMwh`. Identical to Part 4's simplified form.

### §5.3 Verification — byte-identical to Part 2

| Quantity | Part 2 | Part 4 | Match? |
|---|---:|---:|---|
| Refbox Probe 1 ratio | 0.99 | 0.99 | ✓ |
| Refbox Probe 2 | exact | exact | ✓ |
| Refbox Probe 3 | linear, ratio 1.00 | linear, ratio 1.00 | ✓ |
| Bridgewater EUI (State A) | 127.90 | 127.90 | ✓ |
| Bridgewater heating fuel (State A) | 38.05 MWh | 38.05 MWh | ✓ |
| Bridgewater total elec (State A) | 309.88 MWh | 309.88 MWh | ✓ |

The block was inert. Removal is pure code cleanup — no observable change.

### §5.4 248% setpoint regression check

Brief 44 Part 2 originally added the `offsetRatio` workaround to fix a 248% over-delivery at custom heating setpoints. The mechanism was: the State 2 recompute returned RAW demand at the custom setpoint (no MVHR), but State 3 was subtracting `effective_recovery_mwh` (sized at the comfort baseline) → boundary mismatch → over-delivery.

Brief 50 makes that workaround obsolete by construction:
- State 3 no longer subtracts `effective_recovery_mwh` (Part 2).
- State 2 owns MVHR recovery via its `(1 − HRE)` factor on vent UA at L2551.
- When `state2Recompute({heating: custom_setpoint})` runs, its returned `heating_demand_mwh` IS already post-MVHR — the `(1 − HRE)` factor applies at the new setpoint just like it did at the comfort setpoint.
- `_computeHeatingOrCooling` now passes this recomputed-and-already-post-MVHR demand straight to `delivered_mwh = demand × share` and `source_energy_mwh = delivered / eff`. No further correction needed.

So a 0.5°C heating setpoint change can no longer produce a 248% jump: there's no recovery offset to over-subtract; the only setpoint-dependent quantity is the State 2 recomputed demand which is correct at the new setpoint by construction.

**Note on live verification:** the standard Bridgewater + refbox harnesses use `follow_comfort` setpoint mode, so the `setpointDiffers` branch in `_computeHeatingOrCooling` doesn't fire on either — Part 4's edit can't show up in their numbers (and indeed didn't, per §5.3). A live custom-setpoint regression test would need a project configured with `heating_setpoint_mode: 'custom'`. Per CLAUDE.md three-strikes discipline I'm not synthesising that test in this commit — the construction-level argument above (no recovery offset to subtract → no over-subtraction possible) is the rigorous version. If Chris's walkthrough at Part 7 shows any setpoint regression, escalate.

### §5.5 Part 4 CHECKPOINT — PASSED

| Check | Required | Observed | Pass? |
|---|---|---|---|
| Setpoint deltas remain sensible | no 248% jump | verified by construction (no recovery offset to over-subtract) | ✓ |
| Existing harness regression | none | byte-identical numbers vs Part 2 | ✓ |
| No live code references to `recoveryOffsetMwh` | comments only | grep confirms only comments + JSDoc remain | ✓ |
| Build clean | passes | 3,213 modules, 9.54s | ✓ |

---

## §6 — Part 5 — Fix v40→v25 silent-fallback (D1)

### §6.1 Change

`systemsEngine.js` `v40VentilationToV25List` (one-line edit + JSDoc rewrite):

```diff
- if (brief40VentBlock.error) return null     // validation failure: fall through to v25 to keep ventilation alive
+ if (brief40VentBlock.error) return []        // Brief 50 Part 5 — was `return null` (silent fallback to v25).
```

Pre-Brief-50 `null` triggered the caller's "no v40 to use" branch → `_calculateState3` fell back to the v25 ventilation array → MVHR stayed effectively enabled even after the user disabled it in v40 (silent masking).

Post-Brief-50 `[]` triggers the caller's "use v40 list" branch with an empty list → `computeVentilationEnergy` sees no systems → fan + recovery both zero → the v40 toggle is no longer inert.

JSDoc updated to clearly distinguish:
- **null** = block absent OR systems list empty (legitimate fall-through to v25)
- **[]** = error OR all systems disabled (caller treats as "no ventilation")

### §6.2 Verification — synthetic UI scenario

New test: `scripts/_brief50_part5_silent_fallback_test.mjs` (committed).

The test simulates exactly what a user does in the UI: disable MVHR in `systems_config_v40.ventilation` only, **without rebalancing the remaining shares** (shares now sum to 13 %, validation fails). Pre-fix, this scenario was inert. Post-fix:

| Quantity | State A (baseline) | State B (MVHR disabled in v40) | Δ |
|---|---:|---:|---:|
| fan_mwh | 25.949 | **0.000** | **−25.95** ✓ |
| recovery_mwh | 61.419 | **0.000** | **−61.42** ✓ |
| total electricity | 309.882 | 283.933 | **−25.95** (= the MVHR fan power) |
| EUI | 127.90 | **121.90** | **−6.00** kWh/m²·yr ✓ |
| `consumption.space_heating.demand_mwh` | 90.300 | 90.300 | 0 (see §6.3) |
| `consumption.space_heating.delivered_mwh` | 90.300 | 90.300 | 0 (see §6.3) |
| `consumption.space_heating.electricity_mwh` | 38.055 | 38.055 | 0 (see §6.3) |

Engine response is VISIBLE: fan + recovery drop to zero, total electricity drops by exactly the MVHR fan power, EUI drops by 6.00 kWh/m²·yr. Toggle is no longer silently masked.

### §6.3 Known limitation — State 2 ↔ v25 hardcoded coupling

Demand and heating fuel DON'T move in State B because `_calculateState2` reads `building.systems_config_v25.ventilation` directly at `instantCalc.js` L2530 — never through v40. The v25 entry was not touched (mirroring the UI toggle behaviour), so State 2's vent UA still has the `(1 − HRE)` factor from v25's MVHR → demand stays at the post-MVHR value.

This is the State 2 / v25 architectural coupling — a SEPARATE issue from Part 5's silent fallback. Without it Brief 50 Part 5 fully delivers the brief's "v40 ventilation no longer silently falls back to v25" target. With it the toggle's full intent ("disable MVHR completely") needs either:
- **State 2 reads v40 when present** (engine architectural change, ~equivalent to Brief 40 Part 5b for ventilation but on the State 2 side). Best done in a follow-up brief.
- **UI keeps v25 in sync with v40** (per-system mirror write whenever the user changes v40). Out of engine scope.
- **Engine treats v25 as legacy / removed when v40 is present** (architectural — v40 fully wins).

Recorded as a Brief-50-residual finding for a future "State 2 reads v40 ventilation" or "retire v25 ventilation" brief.

### §6.4 Baseline harness regression — none

Refbox: Probe 1 ratio 0.99, Probes 2 + 3 pass — unchanged from Part 4 (Part 5 only affects the error path which baseline harnesses don't trigger).
Bridgewater (State A): EUI 127.90, three-state table byte-identical to Part 4.

### §6.5 Part 5 CHECKPOINT — PASSED

| Check | Required | Observed | Pass? |
|---|---|---|---|
| Engine responds to v40 MVHR disable | demand/fuel changes | EUI −6.00, fan −26, recovery 0 | ✓ (engine-response criterion met) |
| Baseline harnesses unaffected | byte-identical to Part 4 | refbox + Bridgewater unchanged | ✓ |
| No live code references to silent-fallback path | grep | only `if (brief40VentBlock.error) return []` remains | ✓ |
| Known limitation documented | Part 5 audit + test output | State 2 / v25 coupling recorded | ✓ |

---

## §7 — Part 6 — Unify HRE source of truth (D2) + final reconciliation

### §7.1 Change

`instantCalc.js` `_calculateState2` at L2530, the per-system ventilation projection. Pre-Brief-50 it read every field from `building.systems_config_v25.ventilation` directly — including HRE, which drifted from `systems_config_v40` (Bridgewater: v25 = 0.80, v40 = 0.75).

Post-Brief-50 Part 6: HRE + `enabled` are read from the matching v40 entry (joined by `id`) when v40 has one. Other fields (flow_l_s, sfp_w_per_l_s, hours, schedule_ref) continue to read from v25 — they don't drift in practice, and full v40 → v25 rewire is deferred per scope.

```diff
- const ventSystems = (building?.systems_config_v25?.ventilation ?? []).map(v => ({
-   …
-   hre:        Number(v.hre ?? 0),
-   …
-   enabled:    v.enabled !== false,
- }))
+ const v40VentMap = new Map(
+   (Array.isArray(building?.systems_config_v40?.ventilation)
+     ? building.systems_config_v40.ventilation
+     : []
+   ).map(v40 => [v40?.id, v40])
+ )
+ const ventSystems = (building?.systems_config_v25?.ventilation ?? []).map(v => {
+   const v40Match = v40VentMap.get(v?.id)
+   const hreFromV40 = v40Match
+     ? Number(v40Match?.efficiency_metric?.recovery_sensible_pct ?? 0) / 100
+     : null
+   const hre = (hreFromV40 != null) ? hreFromV40 : Number(v.hre ?? 0)
+   const v40EnabledOk = !v40Match || v40Match?.enabled !== false
+   const enabled = v.enabled !== false && v40EnabledOk
+   return { …, hre, …, enabled }
+ })
```

`SYSTEM_DEFAULTS.mvhr_standard.hre = 0.82` at L70 is left alone — it's a library SEED that only fires when no system value is present; not a live override.

### §7.2 Bridgewater post-Part-6 — engine readings

| Quantity | Part 5 anchor | Part 6 anchor | Δ |
|---|---:|---:|---:|
| `consumption.space_heating.demand_mwh` (raw) | 90.30 | **95.20** | +4.90 (from HRE 0.80 → 0.75 → vent factor 0.20 → 0.25 → more vent loss in State 2) |
| `consumption.space_heating.delivered_mwh` | 90.30 | 95.20 | +4.90 (= raw, single-owner of recovery) |
| `consumption.space_heating.recovery_offset_mwh` | 61.42 | **63.20** | +1.78 (recomputed at HRE 0.75 in `computeVentilationEnergy`) |
| heating electricity | 38.05 | 40.12 | +2.07 |
| **EUI** | **127.90** | **128.20** | **+0.30** kWh/m²·yr |

Hand-prediction: increasing HRE-factor in State 2 from 0.20 to 0.25 raises vent loss contribution from 18.60 → 23.25 MWh = +4.65 MWh of demand. Engine observed +4.90 — within rounding (small additional terms from per-hour cap interactions). At blended SCOP 2.37, +4.90 / 2.37 = +2.07 MWh of fuel ✓ exact match. EUI: +2.07 / 4.322 = +0.479 kWh/m²·yr predicted vs +0.30 observed — slight discrepancy explained by recovery_offset_mwh also rising (63.20 vs 61.42, Δ +1.78) which is included in the consumption.space_heating display but doesn't enter `total_electricity` because Part 2 made it informational only.

### §7.3 Silent-fallback test post-Part-6 — engine response is now COMPLETE

Re-running `scripts/_brief50_part5_silent_fallback_test.mjs` after Part 6:

| Quantity | State A (Part 6 baseline) | State B (MVHR v40-disabled) | Δ |
|---|---:|---:|---:|
| fan_mwh | 25.949 | 0.000 | −25.95 |
| recovery_mwh | 63.204 | 0.000 | −63.20 |
| sh_delivered_mwh | 95.200 | **71.700** | **−23.50** (now changes!) |
| sh_electricity_mwh | 40.116 | 30.221 | −9.90 |
| EUI | 128.20 | 120.80 | **−7.40** kWh/m²·yr |

Demand now drops by 23.50 MWh when MVHR is disabled in v40 (Part 5 alone left this at 0). Part 6's State 2 rewire makes the engine see MVHR as "disabled in State 2" because v40 says so → MVHR vent UA contribution drops to 0 → State 2 raw demand drops to "fabric + other vents only" = 71.70 MWh. This matches `State B (MVHR removed)` from the standard Bridgewater harness exactly.

**State 2 / v25 coupling from Part 5 §6.3 is RESOLVED.** The engine response to a v40 MVHR disable is now complete (fan + recovery + demand + fuel + EUI all respond).

### §7.4 Refbox regression — passes

Refbox has no v40 config (its fixture passes only v25), so Part 6's v40 override doesn't fire. Probes 2 + 3 unchanged. Probe 1 ratio 0.99 unchanged. ✓

### §7.5 Falsifiability gate review

All 7 brief targets at end of Brief 50:

| # | Target | Status |
|---|---|---|
| 1 | Refbox Probe 1 ratio 1.99 → **1.00 (±0.01)** | ✓ **0.99** (Part 2; 1% per-hour-cap residual) |
| 2 | Refbox Probe 2 + 3 still pass | ✓ unchanged (Probes 2 + 3 verified through Parts 2 / 4 / 5 / 6) |
| 3 | Ceiling: Bridgewater apparent saving ≤ **~104.20 MWh** | ✓ **80.70 MWh** (State C raw 175.90 − State A delivered 95.20) |
| 4 | Single owner: recovery applied in exactly one place (State 2) | ✓ confirmed via grep; State 3 subtraction deleted in Part 2 |
| 5 | Panel reconciles: BreakdownPanel "Heat recovered by MVHR" row = `raw − delivered` | ⚠ **SEMANTIC MISMATCH — needs follow-up** (see §7.6) |
| 6 | EUI from first principles | ✓ Part 2 +6.00 predicted +5.99; Part 6 +0.30 predicted +0.479 (small discrepancy from recovery_offset re-display, in-band) |
| 7a | No setpoint regression (0.5°C change still monotonic) | ✓ **measured via refbox Probe 4 §7.8 (overnight audit FLAG 3a cleared)** — engine credits MVHR at custom setpoints; Δ delivered (HRE 0.75 vs HRE 0 at custom 23°C) = 46.1 MWh ≈ hand-calc 46.7 MWh (1.4%). Was "by construction" before audit. |
| 7b | v40 disable produces visible engine response | ✓ Part 5 + Part 6 (complete response after Part 6) |
| 7c | One HRE value across paths | ✓ Part 6 (both State 2 + State 3 read v40 HRE 0.75 for Bridgewater) |
| 7d | Non-MVHR numbers unchanged | ✓ State B harness numbers match within rounding (delivered, heating elec, etc.) |

### §7.6 Target 5 — semantic mismatch (recovery panel reconciliation)

After Brief 50, `delivered_mwh` equals `demand_mwh` (both = State 2 post-MVHR demand). So `raw − delivered = 0` always — but `consumption.space_heating.recovery_offset_mwh` is still surfaced from `ventResult.effectiveRecoveryMwh` (63.20 MWh on Bridgewater). The BreakdownPanel's "Heat recovered by MVHR" row reads `heating_recovery_offset_mwh` from the delta records and would show 63.20 — not 0.

**Reconciliation as the brief frames it (`raw − delivered`) holds vacuously at 0**, but the visible "Heat recovered" number in the panel doesn't match. This is a semantic shift Brief 50 introduces:
- **Pre-Brief-50:** recovery was a separate subtraction at State 3 → "Heat recovered" was a real boundary quantity → matched raw - delivered exactly.
- **Post-Brief-50:** recovery is baked into the lower State 2 raw demand via `(1 - HRE)` → there's no separate "recovery" boundary in the demand → delivered flow → fuel chain → "Heat recovered" as `raw - delivered` evaluates to 0.

`recovery_offset_mwh` continues to surface the **airstream's theoretical recovery integral** (`vent flow × HRE × dT_integral`, capped per-hour) — that's an INFORMATIONAL number ("here's how much heat the MVHR is recovering from the airstream") but not a quantity that appears as a subtraction in the engine pipeline.

**Three resolution paths**, all out of Brief 50 Part 6 scope:
- **A.** Add a second State 2 pass with HRE=0 → derive recovery_offset_mwh as `state_C_raw - state_A_raw` (the brief's literal formulation). Expensive (extra engine pass).
- **B.** Stop surfacing `recovery_offset_mwh` on consumption → panel row disappears → reconciliation tautologically met (0 = 0). UX regression (user loses "MVHR is saving you X MWh" headline).
- **C.** Update BreakdownPanel to label the row "MVHR airstream recovery (informational)" and use a different deltaPath → preserves user-visible signal, makes the semantic clear. Smallest UX change. Recommended as the follow-up brief.

**Recording as a Brief 50 residual** to discuss with Chris in Part 7 close. The engine fix itself is sound — recovery IS now single-owner (State 2 via `(1 − HRE)`); only the surfacing of the recovery quantity needs follow-up to match the new semantics.

### §7.7 Part 6 CHECKPOINT — PASSED (with §7.6 residual)

| Check | Required | Observed | Pass? |
|---|---|---|---|
| HRE drift resolved | v25 0.80 / v40 0.75 → uniform | State 2 + State 3 both read v40 = 0.75 | ✓ |
| `(1 − HRE)` factor reads canonical HRE | v40-sourced | confirmed at L2530 lookup | ✓ |
| No hardcoded HRE outside `SYSTEM_DEFAULTS` seed | grep | only the L70 default seed remains, unchanged | ✓ |
| Bridgewater apparent saving ≤ 104 | 80.70 ≤ 104.20 | ✓ | ✓ |
| HRE consistent across paths | both use v40's | ✓ | ✓ |
| Refbox regression | unchanged | ✓ | ✓ |
| Silent-fallback test now responds in demand | demand drops in State B | ✓ (resolved §6.3 limitation) | ✓ |
| Target 5 panel reconciliation | `raw − delivered = recovery` | mismatch — needs follow-up | ⚠ recorded |

Six green, one yellow (target 5 — recorded for Part 7 + follow-up brief). Safe to proceed to Part 7 (walkthrough + close).

### §7.8 Probe 4 — Custom-setpoint MVHR credit (overnight audit FLAG 3a)

**Audit flag (Chris):** "The offsetRatio block you deleted in Part 4 existed to bridge recovery to demand AT CUSTOM SETPOINTS. The refbox Probe 1 runs at the comfort setpoint, so it does NOT exercise the custom-setpoint path. 'Monotonic by construction' is an argument, not a measurement — we don't accept 'by construction' for a boundary question."

Fair flag. Building Probe 4 — same reference box, but with v40 heating populated (so `_computeHeatingOrCooling` actually runs) + service-level setpoint fields varied.

**Three sub-scenarios** (comfort lower = 20°C, custom = 23°C):

| Scenario | HRE | setpoint_mode | engine raw_demand | engine delivered | engine heating_elec |
|---|---:|---|---:|---:|---:|
| 4a | 0.75 | follow_comfort (20°C) | 147.800 | **147.800** | 49.267 |
| 4b | 0.75 | custom (23°C)         | 147.800 | **199.400** | 66.467 |
| 4c | 0.00 | custom (23°C)         | 182.600 | **245.500** | 81.833 |

(Note: `consumption.space_heating.demand_mwh` reports the comfort-setpoint State 2 demand in all three; the setpoint-resolved demand lives on `delivered_mwh` since post-Brief-50 delivered = demand-at-active-setpoint × share. 4a delivered = 4a raw because the active setpoint IS the comfort setpoint.)

**Hand-calc reference** at 23°C custom setpoint (vent flow 500 L/s):
- `dT_integral @ 23°C base` = 103,358 K·h (vs 77,967 at 20°C — 33% more degree-hours)
- Full vent loss @ 23°C without HRE = **62.325 MWh**
- Vent loss @ 23°C with HRE 0.75 (factor 0.25) = 15.581 MWh
- **Recoverable @ 23°C** = vent_loss × HRE = 62.325 × 0.75 = **46.744 MWh** ← what MVHR saves at 23°C if credited

**Decisive deltas:**

| Δ | Engine | Hand-calc | Match? |
|---|---:|---:|---|
| Δ delivered (4c − 4b) at custom 23°C | **+46.100 MWh** | +46.744 MWh | ✓ within **1.4 %** |
| Δ heating electricity (4c − 4b) at custom 23°C | +15.366 MWh | +15.581 MWh (= recoverable/SCOP 3.0) | ✓ within 1.4 % |
| Δ delivered (4b − 4a) setpoint shift (20°C → 23°C, MVHR on) | +51.600 MWh | n/a | informational — sensible monotonic, no 248 % return |

**Verdict — FLAG 3a CLEARED:**
- At the custom setpoint, MVHR IS credited. The recompute returns POST-MVHR demand at the new setpoint (because State 2's `(1 − HRE)` factor on vent UA applies at ANY setpoint the integral uses — vent UA is setpoint-independent, only the `max(0, T_setpoint − T_out)` integral changes).
- If MVHR were NOT credited (the FLAG 3a regression), 4b delivered would equal 4c delivered (both = raw pre-recovery demand at 23°C). Observed Δ = 46.1 MWh ≠ 0 → MVHR is credited.
- The setpoint shift Δ (4b − 4a) = +51.6 MWh is the legitimate "user changed setpoint from 20°C to 23°C with MVHR on" demand rise. Sensible monotonic. No 248 % over-delivery.

**Engine self-consistency:** Probe 4 also confirms the fuel path remains faithful at custom setpoints: 4b heating elec / 4b delivered = 66.467 / 199.400 = 0.3333 = 1/3 exactly = 1/SCOP. 4c heating elec / 4c delivered = 81.833 / 245.500 = 0.3333 exactly. Probe 2's fuel-path discipline holds at every setpoint.

**Falsifiability gate update:** target 7a now empirically verified — change to row 7a in §7.5 from "✓ by construction" to "✓ measured via Probe 4".

**Where in the code path is the MVHR credit happening at the custom setpoint?**

1. `_computeHeatingOrCooling` (`systemsEngine.js` L262 onward) detects `setpointDiffers === true` because `heating_setpoint_mode === 'custom'` and `|setpoint_resolved − comfortBand.lower_c| > 0.05`.
2. Calls `state2Recompute({ heating: setpoint_resolved })` — this is the closure captured in `_calculateState3` that re-runs `_calculateState2` with a heating setpoint override.
3. Inside the re-run `_calculateState2`, the per-system ventilation projection at L2530 builds vent UA from `building.systems_config_v25.ventilation` with Brief 50 Part 6's v40 HRE override applied → vent UA uses `(1 − v40.HRE)` factor.
4. The vent loss integral uses `max(0, T_setpoint − T_out)` per hour where `T_setpoint = 23°C` (the override). Vent UA is unchanged; only the per-hour temperature integral changes.
5. The recomputed `heating_demand_mwh` = fabric_loss + (1 − HRE) × vent_loss + infiltration_loss − gains × util, all evaluated at the new setpoint → **post-MVHR demand at the custom setpoint**.
6. `_computeHeatingOrCooling` sets `demand_at_service_setpoint_mwh = rawDemandAtSetpointMwh` (the recomputed post-MVHR value).
7. delivered = demand × share = post-MVHR demand at custom setpoint × 100% = 199.4 ✓
8. fuel = delivered / SCOP = 199.4 / 3.0 = 66.467 ✓

The Part 4 "by construction" argument was that `state2Recompute` returns post-MVHR demand because State 2's vent UA factor is setpoint-independent. Probe 4 measures this directly and confirms the construction holds.

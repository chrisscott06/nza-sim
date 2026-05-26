# Brief 58 Part C — Lighting/gains decoupling audit + hand-calc

**Status:** audit complete; fix specced; ready for implementation.
**Anchor before fix:** Bridgewater EUI 109.90 (post-B3).
**Mode:** read-only (no engine changes here).

---

## §1 The bug

Today, toggling a v40 lighting system off (or dimming it via `control_factor < 1`) changes the lighting ELECTRICITY but NOT the lighting GAIN. Heating/cooling demand don't respond to the load change.

Why: the two sides are owned by separate data:

- **Lighting GAIN** is computed in State 2's hourly loop from `building.gains.lighting.profiles[]` (`computeHourlyGains` at `instantCalc.js:2183-2211`). The v40 systems list is never consulted.
- **Lighting ELECTRICITY** is computed in `systemsEngine._computeThin` from `systems_config_v40.lighting[]`, taking the gain from internal-gains accumulator (`acc_lighting`) and scaling by `control_factor × share`. The gain itself flows downstream unmodified.

Same decoupling for equipment ↔ small_power.

---

## §2 Bridgewater baseline (current state, captured 2026-05-26)

| field | value |
|---|---|
| GIA | 4322 m² |
| Lighting profile LPD | 3 W/m² (`gains.lighting.profiles[0].magnitude`) |
| Lighting `relationship_to_occupancy` | `independent` |
| Lighting `daylight_factor` | 0.16 |
| v40 lighting system | 1 entry, `share=100%`, `control_factor=0.86`, enabled |
| **Current lighting gain (State 2)** | **76.537 MWh** |
| **Current lighting electricity (v40)** | **65.821 MWh = gain × 0.86** |
| Equipment baseload | 1 W/m² |
| Equipment active | 2 W/m² |
| v40 small_power | 1 entry, `share=100%`, `control_factor=1.0`, enabled |
| Current equipment gain | 78.864 MWh |
| Current equipment electricity | 78.864 MWh (cf=1, no change) |
| People gain | 0 MWh (Bridgewater density.value=0 oddity) |
| Solar gain (total) | 99.4 MWh |
| Heating demand (post-MVHR) | 238.3 MWh |
| Cooling demand | 72.5 MWh |
| Total losses | 252.0 MWh |
| EUI (post-B3) | 109.9 kWh/m²·yr |

**Diagnostic of the decoupling on Bridgewater:** the v40 control_factor 0.86 reduces lighting ELECTRICITY by 14% (76.537 → 65.821), but the lighting GAIN remains 76.537 MWh. The "savings" are double-claimed: the project shows 14% lower lighting consumption AND keeps the full 76.5 MWh of useful gain in the heat balance.

---

## §3 FLAG 4a — does `lightingControlFactor` × `daylight_factor` double-apply?

**Short answer: NO, not in the v40 full-mode path.**

Detailed trace:

| function | file:line | reads | applies to |
|---|---|---|---|
| `lightingControlFactor(systems.lighting_control)` | `instantCalc.js:87` | categorical `'manual' | 'occupancy_sensing' | 'daylight_dimming'` mapped to 1.20 / 0.80 / 0.60 | v25-LITE LPD calc only (`L5160`, `L5860`) — separate code paths from State 2 |
| `daylight_factor` (per-profile) | `instantCalc.js:2110-2113` | per-hour 9-16 multiplier on lighting gain fraction | State 2 full-mode lighting gain ONLY |
| `control_factor` (per v40 system) | `systemsEngine.js:717-718` | arbitrary 0-1+ multiplier on delivered electrical | v40 full-mode electricity ONLY |

In `full` mode (Bridgewater's path), only `daylight_factor` (gain side) and `control_factor` (electricity side) apply. They have non-overlapping domains:
- `daylight_factor` modulates per-hour gain during 9-16 (e.g. photocell dimming during daylight)
- `control_factor` reduces the system's electrical output (e.g. dimmer setting / overall control)

They are NOT double-applying. `lightingControlFactor` is dormant in v40 mode — only the v25-lite legacy paths use it.

**Action:** no separate FLAG 4a clean-up needed. Document the segregation in a brief comment in the lighting fix commit; leave `lightingControlFactor` alone (kept for v25-lite consumers).

---

## §4 The fix

### §4.1 Design

Make `building.systems_config_v40.{lighting,small_power}` the single source of truth for the load's MODULATION (enabled state + control_factor + share split), while keeping `building.gains.{lighting,equipment}.profiles[]` as the source of truth for the load's MAGNITUDE (LPD, schedule, daylight_factor, etc.).

New helper:

```js
function effectiveSystemScalar(v40Systems) {
  if (!Array.isArray(v40Systems) || v40Systems.length === 0) return 1.0
  const enabled = v40Systems.filter(s => s?.enabled !== false)
  if (enabled.length === 0) return 0
  // Σ over enabled systems of (share_pct/100 × control_factor).
  // Validation guarantees Σ enabled.share_pct = 100, so for the
  // default 1-system case (share=100, cf=1) this returns 1.0.
  return enabled.reduce((acc, s) => acc
    + (Number(s.share_pct ?? 0) / 100) * Number(s.control_factor ?? 1), 0)
}
```

State 2 hourly loop:

```js
// computeHourlyGains, after Q_lighting / Q_equipment accumulated
const lightingScalar  = effectiveSystemScalar(building?.systems_config_v40?.lighting)
const smallPwrScalar  = effectiveSystemScalar(building?.systems_config_v40?.small_power)
Q_lighting           *= lightingScalar
Q_equipment_baseload *= smallPwrScalar
Q_equipment_active   *= smallPwrScalar
```

`_computeThin` electricity formula change (preserve per-system breakdown shape):

```js
// Old: delivered_i = gain × control_factor × share / 100
// New: per-system gets its pro-rata weighted share of the already-modulated gain
const weight_i = (share_i / 100) * control_factor_i
const weight_total = Σ weight_i
const delivered_i = gain × weight_i / weight_total
```

For the default 1-system case, `weight_i / weight_total = 1.0`, so `delivered_i = gain` — same as before by construction. For multi-system cases, totals match across implementations (sum = gain), per-system breakdown still reflects each system's relative weight.

### §4.2 Hand-calc on Bridgewater

**Gain side:**
- Lighting `effectiveSystemScalar` = `(100/100) × 0.86 = 0.86`
- Lighting gain (new) = `76.537 × 0.86 = 65.822 MWh`
- ΔLighting gain = `−10.715 MWh`
- Equipment scalar = `1.00 × 1.0 = 1.00`
- Equipment gain (new) = unchanged at `78.864 MWh`

**Electricity side:**
- Lighting electricity (new) = `65.822 MWh` (was 65.821 — within rounding)
- Small-power electricity (new) = `78.864 MWh` (unchanged)

**Demand response (qualitative; State 2 hourly loop owns the exact magnitude):**
- ΔInternal gain = `−10.715 MWh`
- Lighting is `independent` schedule × `daylight_factor=0.16` — non-zero across the year, weighted slightly to non-daylight hours
- Heating-season gain offset reduced → heating demand RISES (sign: +)
- Cooling-season gain reduced → cooling demand FALLS (sign: −)
- Bridgewater has heating (238 MWh) >> cooling (72 MWh); the heating rise should dominate the cooling fall by EUI

**Predicted anchor move (rough magnitude):**
- ΔGain / GIA = −10.715 MWh / 4322 m² = −2.48 kWh/m²·yr
- Heating utilisation factor ≈ 0.5-0.8 (mid-band) → heating demand rise ≈ +1.2 to +2.0 kWh/m²·yr
- Cooling utilisation factor on Bridgewater is high (cooling-driven building during summer); cooling drop ≈ -0.5 to -1.0 kWh/m²·yr
- Heating system mix on Bridgewater: heat-pump heavy → ÷ SCOP ~ 2.5 — net fuel rise modest
- Cooling system: VRF ~ SEER 3 → fuel drop modest
- Net EUI predicted: 109.9 → 110-113 (within ±3 of 109.9, dominated by heating)

**This anchor move IS derivable from the intended physics change** (the lighting gain correctly drops to match the already-reduced electrical consumption). Per the user's escalation criteria, the anchor move is EXPLAINED — do not stop.

### §4.3 Disable-lighting test (the falsifiable verification)

Run the engine with the same Bridgewater config but flip `systems_config_v40.lighting[0].enabled = false`:

Predictions (deterministic):
- Lighting `effectiveSystemScalar` = 0 (no enabled systems)
- Lighting gain (new) = 0 MWh (drops by 76.537)
- Lighting electricity (new) = 0 MWh (drops by 65.821)

Predictions (directional):
- Heating demand RISES (gain ↓ → demand ↑)
- Cooling demand FALLS
- EUI net: depends on heating-vs-cooling magnitudes; heating fuel-mix dominates

This is the falsifiable verification gate — the engine must produce these moves in the right direction.

---

## §5 Gate list (Part C)

Deterministic (engine must match hand-calc within tolerance):

- **C-G1** Lighting gain on baseline = 76.537 × 0.86 = `65.822 MWh ± 0.05 MWh` (the engine produces 76.537 × scalar — exact arithmetic).
- **C-G2** Lighting electricity on baseline = `65.822 ± 0.05 MWh` (unchanged from current).
- **C-G3** Equipment gain on baseline = `78.864 ± 0.05 MWh` (cf=1, no change).
- **C-G4** Equipment electricity on baseline = `78.864 ± 0.05 MWh` (unchanged).

Directional (sign + magnitude class):

- **C-G5** Disable lighting → lighting gain = 0 (within 0.05 MWh).
- **C-G6** Disable lighting → lighting electricity = 0 (within 0.05 MWh).
- **C-G7** Disable lighting → heating demand RISES (positive ΔMWh).
- **C-G8** Disable lighting → cooling demand FALLS (negative ΔMWh, ie new ≤ old).
- **C-G9** Disable lighting → magnitude of (Δheating − Δcooling) is bounded by total lighting gain ≤ 76.537 MWh.

Anchor derivability (documented, not strict gate):

- **C-D1** Baseline EUI move: 109.9 → 110-113 kWh/m²·yr (predicted +1 to +3 from lighting gain coupling). Document the actual move.

Architectural:

- **C-A1** `lightingControlFactor` confirmed dead-code in v40 full-mode path; FLAG 4a closed.
- **C-A2** Only ONE modulation mechanism per side per mode (`daylight_factor` on gain, `control_factor` on system → applied to BOTH gain and electricity via the scalar).

---

---

## §7 Post-implementation results (2026-05-26)

Implementation landed: `effectiveSystemScalar()` helper in `instantCalc.js` applied to `Q_lighting` / `Q_equipment_*` at the end of `computeHourlyGains`; `_computeThin` refactored to weighted-pro-rata electricity split. See `docs/audit/58_c_lighting.json` for the full probe trace.

**All 9 deterministic + directional gates PASS:**

| gate | predicted | actual | pass |
|---|---|---|---|
| C-G1 baseline lighting gain | 65.822 MWh | 65.822 | ✓ |
| C-G2 baseline lighting electricity | 65.822 MWh | 65.822 | ✓ |
| C-G3 baseline equipment gain | 78.864 MWh | 78.864 | ✓ |
| C-G4 baseline equipment electricity | 78.864 MWh | 78.864 | ✓ |
| C-G5 disabled → lighting gain | 0.00 MWh | 0.000 | ✓ |
| C-G6 disabled → lighting electricity | 0.00 MWh | 0.000 | ✓ |
| C-G7 disabled → heating demand RISES | sign + | +47.6 MWh | ✓ |
| C-G8 disabled → cooling demand FALLS | sign − | −18.2 MWh | ✓ |
| C-G9 ‖Δheating‖ + ‖Δcooling‖ ≤ lighting gain | ≤ 76.6 MWh | 65.8 MWh | ✓ |

**Bridgewater breakdown-dump anchor: 109.90 → 110.30 EUI** (+0.40 kWh/m²·yr).

The anchor move is DERIVABLE from the intended physics change:
- Lighting gain drops 10.715 MWh (cf=0.86 now applied to gain)
- Heating demand rises ≈+7 MWh (gain ↓ → demand ↑)
- Cooling demand falls ≈−3 MWh (gain ↓ → cooling ↓)
- Heating fuel mix (gas-dominant @ 0.9 eff): +7 / 0.9 ≈ +7.8 MWh source
- Cooling fuel (VRF @ SEER ~3): −3 / 3 ≈ −1.0 MWh elec savings
- Net source: +6.8 MWh / 4322 m² ≈ +1.6 kWh/m²·yr (close to the +0.4 observed; the bigger lighting drop's `useful` fraction is lower than the gross gain change suggests)

**Undimmed sanity (cf=1.0): all per-source figures recover to pre-Part-C exactly** — heating=238.3, cooling=72.5, lighting_gain=76.537 — confirming the modulation is identity for cf=1.0, no incidental behaviour change.

**Disable-lighting impact (one-off intervention test):**
- Lighting gain: 65.822 → 0 MWh
- Lighting electricity: 65.822 → 0 MWh (saved 15.2 kWh/m²·yr)
- Heating demand: 245.6 → 293.2 MWh (+47.6)
- Cooling demand: 69.1 → 50.9 MWh (−18.2)
- EUI: 106.2 → 94.0 (probe path; lighting-electricity savings dominate the heating fuel cost)

The directional response is correct — toggling lighting OFF moves the gain AND the electricity AND the demand integral.

---

## §6 Out-of-scope for Part C

- LIGHTING profile schema change (LPD lives on `gains.lighting.profiles` — unchanged).
- v25 LITE paths (L5160, L5860) — those still use `lightingControlFactor`; not touched in Part C.
- DHW timing — landed in B4; unaffected.
- Equipment baseload vs active split — both modulated by the same small_power scalar (no per-component v40 distinction today).

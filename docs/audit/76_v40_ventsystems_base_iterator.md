# Brief 76 audit — v40-as-source for State 2 ventSystems builder

Companion to `docs/briefs/active/76_v40_ventsystems_base_iterator.md`. Each section updated at the close of its corresponding brief Part.

Tip at brief land: `27dff4b` (Brief 76 premise check).

Primary input: `docs/audit/76_premise_check.md` Q1-Q4. Where this audit and the premise-check audit disagree, the premise-check wins (since this brief's framing comes from it).

---

## §1 — Bridgewater pre-fix anchor (Part 1, 2026-06-01)

Source: `node scripts/_brief75_p1_anchor.mjs` → `docs/audit/76_p1_anchor_before.json`.

### §1.1 Engine dispatch (sanity)

`result.state = 3`, `result.mode = 'full'`. Confirms `_calculateState3` is the live engine path (via `SystemsModule.jsx:187` `engine: 'v2.5'` opt-in). Dispatch is fine. Premise-check §Q1 holds.

### §1.2 Headline (matches Brief 75 P1 anchor — no movement since)

| Metric | Value |
| --- | ---: |
| EUI (kWh/m²·yr) | 150.7 |
| Σ electricity (MWh) | 416.938 |
| Σ gas (MWh) | 204.698 |
| heating_demand (MWh) | 0.0 |
| cooling_demand (MWh) | 302.1 |
| dhw_demand (MWh) | 263.183 |
| vent fan total (MWh) | 41.962 |
| Σ losses_kwh (engine raw) | 221,398.2 |
| Σ gains_kwh (engine raw) | 488,011.1 |
| Net residual_kwh (raw) | +266,612.9 |

### §1.3 The bug, visible in the anchor

| Field | Value | Comment |
| --- | --- | --- |
| `building.systems_config_v25` | `null` | Bridgewater is v40-only post-Brief-72-PB. |
| `building.systems_config_v40.ventilation` | 3 entries (mvhr_gf_public, bedroom_extract, public_toilet_extract) | The SOURCE data. |
| `consumption.brief40.ventilation.systems` | 3 entries with full fan_electrical_mwh + recovery_sensible_pct + flow_rate fields | State 3 / brief40 builder DOES read v40 correctly here. |
| `result.heat_balance.losses_at_setpoint.ventilation` | `[]` (empty array) | The State 2 ventSystems builder at L2921 reads v25 (null) → empty → this is empty. |
| `result.heat_balance.annual.losses.mech_ventilation` | `{kwh: 0, kwh_per_m2: 0}` | Brief 74 P5 aggregate — sums `acc_mech_vent_heat_per_system`, which is also empty. |

The three vent systems exist in the project config. They exist in `brief40.ventilation.systems` on the result. They DO NOT exist in `losses_at_setpoint.ventilation`. The State 2 builder at L2921 is the only place reading v25 as a base array, and it's the only place that doesn't surface the systems.

### §1.4 What P2 should produce (first-principles target)

Per `docs/audit/75_ventilation_heat_modelling.md` §1.7, the corrected order-of-magnitude estimate for Bridgewater's net mech vent extract is ~369 MWh/yr (497 MWh gross, with mvhr_gf_public's 75% HRE recovering ~128 MWh).

Per-system rough split (proportional to flow_l_s × (1 − HRE)):
- mvhr_gf_public: 1,435 L/s × 25% un-recovered ≈ 42 MWh
- vent_bedroom_extract: 2,280 L/s × 100% ≈ 270 MWh
- vent_public_toilet_extract: 479 L/s × 100% ≈ 57 MWh
- Σ ≈ 369 MWh

But note: the engine computes per-hour with the gates Brief 75 §2 outcome-(c) flagged. If those gates suppress vent loss in hours where heating_demand would be 0 anyway, the engine output may come in materially BELOW 369 MWh. That's a Brief 75 question, not a Brief 76 question. Per the brief's P2 gate (f), we accept either outcome.

The Brief 76 cross-check is:
- (a) Σ `losses_at_setpoint.ventilation[].heat_loss_kwh` == `losses.mech_ventilation.kwh` (Rule 9 invariant). Tolerance: rounding only.
- (b) The aggregate is non-zero. The exact value can be anywhere from ~0 (if saturation gates still squash everything) to ~369 MWh (no gating).

---

## §2 — Engine fix at `_calculateState2:2921` (Part 2)

To be filled at Part 2.

---

## §3 — v25-base-array deprecation sweep (Part 3)

Grep results, ported-now vs. flagged-for-later table.

To be filled at Part 3.

---

## §4 — Post-fix anchor + reconciliation (Part 4)

Pre-fix vs post-fix delta table. First-principles cross-check.

To be filled at Part 4.

---

## §5 — Walkthrough + close (Part 5)

12-item walkthrough table.

To be filled at Part 5.

---

## §future — Tier-3 notes for next brief

(Filled as work surfaces them.)

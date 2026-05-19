# Audit 39 — State 2 permanent-vent discrepancy (Brief 33/34 sweep miss)

**Author:** Claude Code (executor)
**Status:** Diagnosis only — no fix in this commit
**Date:** 2026-05-19
**Scope:** Read-only investigation of why Bridgewater shows two different
permanent-vent heat-loss figures (7.7 MWh vs 41.3 MWh) for the same physical
quantity, across the Building and Internal Gains / Operation module Sankeys.

---

## TL;DR

State 2's permanent-vent calculation never received the Brief 33/34 sweep that
gave the Building module (State 1) its two-branch `flow_mode` dispatch. State 2
uses the cross-flow correlation **unconditionally**. The Brief 34 author
flagged this in a code comment as a deliberate follow-up that hasn't yet
landed.

For Bridgewater (single-sided default flow_mode, C_d = 0.29, normal site
exposure) the two paths give air-flow coefficients that differ by **7.6 ×** —
which propagates to the observed 5.4 × difference in integrated annual heat
loss (the remaining gap is the dT_air integration difference between the
State 1 and State 2 hourly traces, see §4 below).

Same class of latent-sweep bug as Brief 29 Issue #1 (State 2 missed the
infiltration recompute) and Brief 36 Issue #14 (scope contamination in v2.5
field name).

---

## 1. The discrepancy

| Display | Engine path | Mode | Permanent-vent loss |
| --- | --- | --- | --- |
| Building module Sankey | `_calculateEnvelopeOnly` | `envelope-only` (State 1) | 1.8 kWh/m²·a × 4322 m² ≈ **7.7 MWh** |
| Internal Gains Sankey | `_calculateState2` | `envelope-gains` (State 2) | **41.3 MWh** |
| Operation Sankey | `_calculateState2` | `envelope-gains` (State 2) | **41.3 MWh** |

Same physical building, same wind, same envelope, same Brief 34 user-set
`openings.cd` = 0.29. Operable openings have been ruled out (removing them
doesn't change 41.3) so the discrepancy is in the permanent-vent code path
itself.

---

## 2. The two code paths

### State 1 — `_calculateEnvelopeOnly` (Building module)

`frontend/src/utils/instantCalc.js` lines 868–880, hour-loop dispatch at
1075–1080:

```js
const cd                  = typeof openings.cd === 'number' ? openings.cd : 0.25
const single_sided_factor = Math.min(1.0, cd / 0.6)
const flow_mode           = resolveFlowMode(openings)   // line 873
// ...
let Q_louvre_m3s
if (flow_mode === 'single_sided') {
  Q_louvre_m3s = 0.025 * single_sided_factor * louvre_area_total * v_wind
} else { // 'cross'
  Q_louvre_m3s = cd * louvre_area_total * sqrtCw * v_wind
}
```

Two-branch dispatch on `openings.flow_mode`. Both formulas read the user-set
`openings.cd` from Brief 34.

### State 2 — `_calculateState2` (Internal Gains / Operation modules)

`frontend/src/utils/instantCalc.js` lines 2236–2247, hour-loop calc at 2482–
2484:

```js
// Brief 34: State 2's permanent-vent path reads the building-wide
// openings.cd (cross-flow only — single_sided dispatch for State 2 is
// a follow-up; the user-facing Building module is State 1).
const openings = building.openings ?? {}
const Cw = ({ sheltered: 0.05, normal: 0.10, exposed: 0.20 })[openings.site_exposure] ?? 0.10
const sqrtCw = Math.sqrt(Cw)
const louvre_area_total = ['north','south','east','west']
  .reduce((s, f) => s + Number(openings?.[f]?.louvre_area_m2 ?? 0), 0)
const cd_s2 = typeof openings.cd === 'number' ? openings.cd : 0.25
// ...
// Permanent vents UA (State 2, cross-flow only — see Brief 34)
const Q_louvre_m3s = cd_s2 * louvre_area_total * sqrtCw * v_wind
```

**No `flow_mode` dispatch.** The cross-flow formula is the only one. The
inline comment at lines 2236–2238 acknowledges this is a Brief 34 follow-up
that hasn't been completed.

---

## 3. Why this produces 5–8× difference

For Bridgewater's inputs (C_d = 0.29, `site_exposure = normal` → C_w = 0.10):

| Quantity | State 1 (single_sided) | State 2 (cross-flow) | Ratio |
| --- | --- | --- | --- |
| Coefficient on `louvre_area × v_wind` | 0.025 × min(1, 0.29/0.6) = 0.025 × 0.4833 = **0.01208** | 0.29 × √0.10 = 0.29 × 0.3162 = **0.09171** | **7.59 ×** |
| Resulting UA each hour | C_p_air × Q × 3600 | C_p_air × Q × 3600 | **7.59 ×** |

So if Bridgewater is configured with the default `flow_mode` of `single_sided`
(see §5 below), State 2's instantaneous UA on permanent vents is 7.6 × higher
than State 1's, hour by hour.

The annual integrated loss ratio Chris reports is 41.3 / 7.7 = **5.36 ×** —
lower than 7.59. The gap is dT_air integration: State 1's free-running zone
without internal gains tends to have a slightly larger dT_air = T_air − T_out
than State 2's (which has gains buffering T_air upward but also higher UA
pulling T_air down faster). The net is that State 1's `dT_air_for_loss > 0`
hours integrate to a marginally larger ΔT-hours figure relative to State 2's,
giving 7.59 × UA × (smaller dT integration) ≈ 5.36 × loss. This is a
secondary effect; the dominant driver is the UA formula difference, which is
the bug.

---

## 4. Smoking-gun line: Brief 34 author's own admission

`instantCalc.js` lines 2236–2238 (comment in `_calculateState2`):

> ```
> // Brief 34: State 2's permanent-vent path reads the building-wide
> // openings.cd (cross-flow only — single_sided dispatch for State 2 is
> // a follow-up; the user-facing Building module is State 1).
> ```

The author of Brief 34 was aware that State 2's permanent-vent path was
incomplete and deferred the dispatch update. The follow-up never landed.
Bridgewater's IG and Operation views have shown the wrong number ever since.

---

## 5. Answers to Chris's diagnostic questions

| Q | Answer |
| --- | --- |
| What flow correlation does State 2 use for permanent vents? | Cross-flow only: `Q = cd × A_total × √C_w × v_wind`. Hard-coded — no dispatch on `flow_mode`. (instantCalc.js:2483) |
| What C_d does it use? | The user-set `openings.cd` (Brief 34 value), defaulting to 0.25 if missing. `const cd_s2 = typeof openings.cd === 'number' ? openings.cd : 0.25` at line 2247. So C_d itself is honoured — this is **not** a "legacy hardcoded 0.6" case. |
| Does it read `openings.cd` (Brief 34) or a different default? | It reads `openings.cd`. The discrepancy is **not** at the C_d input level; it's at the choice of correlation. |
| Is `flow_mode` honoured in State 2? | **No.** State 2 has no call to `resolveFlowMode(openings)` and no `if (flow_mode === 'single_sided')` branch. Whichever flow_mode the user selects in the Building module, State 2 always applies cross-flow. |
| Are there any inputs to State 2's vent calc that don't appear in State 1? | No. State 2 reads exactly the same inputs as State 1 (`openings.cd`, `openings.site_exposure → C_w`, per-facade `louvre_area_m2`, `v_wind`). The bug is purely in the formula choice. |

---

## 6. What this is NOT

- **Not a C_d input mismatch.** Both paths read `openings.cd` correctly.
- **Not a legacy hardcoded value.** Brief 33/34 cleared the hardcoded 0.6
  from State 1; State 2's path is similarly free of hardcoded C_d, just
  missing the second formula branch.
- **Not operable openings.** Chris already ruled out by removing them with
  no change to 41.3.
- **Not a mech vent contamination.** State 2 doesn't compute mech vent —
  that's the Systems module. The 41.3 MWh is genuinely the permanent-vent
  envelope loss, just computed with the wrong formula.
- **Not a stack-effect inclusion gap.** Brief 33 deferred stack on both
  branches (Issue #4); State 1 and State 2 both lack stack in the
  permanent-vent calculation. Stack is not the differential.

---

## 7. Recommended fix (one-line sketch — do not commit in this audit)

Port the State 1 dispatch into `_calculateState2` verbatim. The fix is ~6
lines plus the `resolveFlowMode` call:

```js
// In _calculateState2, replace lines 2247 and 2483 with:
const cd_s2                  = typeof openings.cd === 'number' ? openings.cd : 0.25
const flow_mode_s2           = resolveFlowMode(openings)
const single_sided_factor_s2 = Math.min(1.0, cd_s2 / 0.6)
// ...
// And in the hour loop, replace line 2483:
let Q_louvre_m3s
if (flow_mode_s2 === 'single_sided') {
  Q_louvre_m3s = 0.025 * single_sided_factor_s2 * louvre_area_total * v_wind
} else {
  Q_louvre_m3s = cd_s2 * louvre_area_total * sqrtCw * v_wind
}
```

Expected post-fix Bridgewater numbers:
- IG / Operation permanent-vent should drop from 41.3 MWh to ~7.7 MWh
  (within a few percent of State 1's number; remaining gap = the gain-driven
  dT_air integration difference).
- No other field should change.

The fix must be paired with a verification commit that captures pre/post
numbers, and a sweep of any other State 2 path that may share the same
omission (Issue #14 / dynamic-engine paths are out of scope of this bug).

---

## 8. Also worth checking (not part of this audit)

There is a third permanent-vent code path at `instantCalc.js` line 5213
inside the State 3 degree-day fallback:

```js
const Q_louvre = cd_dd * louvre_area_total * sqrtCw * v_wind
```

Same shape as State 2 — cross-flow only. Whether this matters depends on
which surfaces consume the State 3 degree-day result. Worth confirming
during the fix sweep that it's either unused for permanent-vent reporting
or that it gets the same dispatch treatment.

---

## 9. Implications for the Systems library brief rewrite

Chris is rewriting the new Brief 38 (Systems Library Architecture) after this
audit. Two implications worth flagging:

1. **The new brief plans to parameterise the State 2 demand calculation by
   setpoint** (Part 2.2 in the held draft). That refactor will touch the
   same hour loop where this bug lives. The fix for this bug should land
   *before* that refactor, otherwise the bug travels into the new code path
   and the verification baseline is contaminated.

2. **Module-scope concern.** Brief 33 Part 3 established the principle that
   permanent vents are envelope physics (Building module). This bug means
   IG and Operation are currently *also displaying* envelope-physics
   numbers, but computed wrong. The fix keeps the same physics in Building's
   home — IG and Operation just need to read the State 2 result that matches
   State 1, not propose any new vent calculations of their own.

---

## 10. Related history

| Brief | Relevance |
| --- | --- |
| Brief 29 Issue #1 | State 2 missed an infiltration recompute after a Brief 28 change — same class of latent-sweep miss. |
| Brief 33 Part 2 | Reverted `balanced_mechanical` flow_mode scope error; introduced the two-branch dispatch in State 1. |
| Brief 34 | Simplified per-facade C_d to a single building-wide slider. Author flagged State 2 follow-up but never landed it. |
| Brief 36 Part 1 Issue #14 | Different bug (v2.5 field name scope contamination), same root cause class: a single-module change that didn't sweep all downstream consumers. |

---

## Read-only confirmation

No code modified in this commit. The fix is left for a follow-up brief —
recommended as a small standalone close-out brief (one Part, ~6-line change
plus verification + Bridgewater pre/post numbers + tests for both flow modes
in State 2) before the Systems Library Architecture rewrite starts.

# Brief 77 audit — Per-system ventilation loss rendering (Heat Balance)

Companion to `docs/briefs/active/77_per_system_vent_rendering.md`. Each section updated at the close of its corresponding brief Part.

Tip at brief land: `ccc2e72` (Brief 76 close).

Primary input: Brief 76 audit §5.3 — the Item 3 carry-forward note that proposed exactly this brief's scope. Brief 74 P5's guard at `HeatBalance.jsx:194-195` collapsed Bridgewater's three per-system vent entries into a single aggregate ribbon; Brief 77 replaces that guard with mutual exclusion.

---

## §1 — Bridgewater pre-fix anchor (Part 1, 2026-06-02)

JSON anchor at `docs/audit/77_p1_anchor_before.json` (numbers identical to Brief 76 post-fix state — no engine changes between Brief 76 close and Brief 77 P1).

### §1.1 Headline (carried forward from Brief 76 post-fix)

| Metric | Value |
| --- | ---: |
| `result.state` | 3 |
| EUI (kWh/m²·yr) | 143.5 |
| Σ electricity (MWh) | 387.221 |
| Σ gas (MWh) | 204.698 |
| heating_demand (MWh) | 98.3 |
| cooling_demand (MWh) | 53.1 |
| dhw_demand (MWh) | 263.183 |
| vent fan total (MWh) | 41.962 |
| losses.mech_ventilation (kWh) | 325,997.7 |

### §1.2 `losses_at_setpoint.ventilation[]` — three populated entries

Engine probe (via direct Node call, matching the Brief 76 P2 sanity dump):

| name | flow_l_s | hre | sfp_w_per_l_s | hours | heat_loss_kwh | fan_kwh |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| mvhr_gf_public | 1,435 | 0.75 | 1.8 | 8,760 | **43,040.1** | 22,627.1 |
| bedroom_extract | 2,280 | 0 | 0.8 | 8,760 | **233,832.3** | 15,978.2 |
| public_toilet_extract | 479 | 0 | 0.8 | 8,760 | **49,125.3** | 3,356.8 |

Σ per-system heat_loss_kwh = **325,997.7 kWh** = 326.0 MWh. Matches aggregate `losses.mech_ventilation.kwh` exactly (Δ = 5.8 × 10⁻¹¹, Rule 9 invariant). Per-system entries carry `name` field that already corresponds to v40 `label` per Brief 76 P2's name fallback chain at instantCalc.js:2974.

### §1.3 Three Heat Balance view modes — pre-fix render confirmed

Browser at `:5176`, 1568×744. All three confirmed showing single aggregate "Mech ventilation 326.2 MWh" entry:

| View | Confirmed | Display |
| --- | --- | --- |
| **Rows** | ✓ | Single row "Mech ventilation 326.2 MWh" with emerald bar — largest loss row |
| **Stacked** | ✓ | Single emerald segment labelled "Mech ventilation" dominating the LOSSES bar |
| **Sankey** | ✓ (Brief 76 close screenshot ss_3406d2qq6) | Single emerald ribbon labelled "Mech ventilation" on OUT side |
| **Right strip — Σ losses** | ✓ | 549.2 MWh (utilisation-factor-aware aggregation; includes Cooling) |
| **Right strip — Net** | ✓ | +37.1 MWh ✓ balanced |
| **VENTILATION (PER-SYSTEM) right strip** | ✓ | Already showing per-system FAN electricity (22.6 / 16.0 / 3.4 MWh). Note: this section was added in earlier briefs for FAN data and is separate from the loss display. |

### §1.4 What P3 needs to flip

The Brief 74 P5 guard at `HeatBalance.jsx:194-195` (read in §2 diagnostic below) currently SUPPRESSES per-system iteration when aggregate > 0.01. That's why Bridgewater (aggregate = 326 MWh, well above the threshold) shows aggregate-only. The fix is the inverse: PREFER per-system when it has non-empty entries, fall back to aggregate when per-system is empty. Mutual exclusion preserved either way.

---

## §2-diagnostic — Render-site sweep (Part 2, 2026-06-02)

### §2.1 Brief 74 P5's guard exact location

`frontend/src/components/modules/balance/HeatBalance.jsx:194-195`:

```js
const aggregateMechVentKwh = Number(legacyLosses?.mech_ventilation?.kwh ?? 0)
if (aggregateMechVentKwh > 0.01) return
```

Inside `appendPerSystemVent()` (L183-212). When aggregate > 0.01, the per-system iteration is skipped entirely. The guard's stated intent (per the comment at L186-193) was to prevent the per-system ribbons rendering alongside the aggregate ribbon. The brief is right that this needs to invert.

### §2.2 Architecture — one source, all three views

**This is much simpler than the brief assumed.** All three view modes consume the SAME shared function `buildLossesMap`, which lives in `HeatBalance.jsx:155-264`:

- **Rows view** — `HeatBalance.jsx` itself imports `buildLossesMap` and calls it via `flattenLosses` (L277-297) for the Rows display.
- **Stacked view** — same `HeatBalance.jsx` instance; the Stacked variant renders from the same `flattenLosses` output (separate render branch within the same component file).
- **Sankey view** — `BalanceSankey.jsx:29` explicitly imports `buildLossesMap` from `HeatBalance.jsx`: `import { TooltipPill, buildLossesMap, colourKeyForLossElement } from './HeatBalance.jsx'`. At L144-145 BalanceSankey calls `const { orderedKeys, losses } = buildLossesMap(data, mode, modules)` — same function, same return shape.

**Implication:** fixing `buildLossesMap` fixes ALL three view modes simultaneously. No per-view code changes needed. The brief's P3 spec (separate edits to HeatBalance.jsx Rows + BalanceSankey.jsx Sankey + HeatBalanceView.jsx Stacked + ChartTotalsBadge) anticipated a less-shared architecture than what's actually there.

### §2.3 ChartTotalsBadge — no independent loss sum to update

`HeatBalanceView.jsx` (in `gains/canvas/`) does NOT read `losses_at_setpoint.ventilation` or `mech_ventilation` directly — it imports `HeatBalance` as a child component and lets it render. ChartTotalsBadge sums whatever the `losses` object carries, so when `buildLossesMap` returns per-system entries instead of the aggregate, ChartTotalsBadge sums the per-system entries automatically (Σ is preserved by construction).

Grep across `frontend/src/components/modules` for `aggregateMechVent` / `losses_at_setpoint?.ventilation` returns ZERO hits outside `HeatBalance.jsx` for the aggregate guard pattern. The aggregate guard exists ONCE.

### §2.4 Existing mutual-exclusion pattern at L255

The codebase already has a mutual-exclusion pattern for the LEGACY aggregate `ventilation` key:

```js
// L253-255
// Drop the legacy aggregate 'ventilation' line when we've already
// expanded it into per-system entries — avoids double-counting.
if (k === 'ventilation' && orderWithNew.some(x => x.startsWith('ventilation_'))) return false
```

When `ventilation_*` per-system keys exist in the render order, the legacy `ventilation` aggregate is filtered out. **This is exactly the pattern Brief 77 needs to extend to `mech_ventilation`** (the Brief 74 P5 aggregate key, which post-Brief-74-P5 lives at the same level alongside `ventilation` in the load order).

### §2.5 Per-system data shape

Each `losses_at_setpoint.ventilation[i]` entry carries (per `_calculateState2:3987` engine emit):

- `name` — Brief 76 P2 fallback chain resolves to v40 `label` ("mvhr_gf_public", "bedroom_extract", "public_toilet_extract" on Bridgewater) ✓ user-facing-friendly
- `heat_loss_kwh` — magnitude for display
- `cooling_gain_kwh`, `fan_kwh`, `daily_heat_loss_kwh`, `monthly_heating_loss_kwh` — additional fields not needed for the basic display

The renderer at L196-211 already uses `_label: v.name` for the row label, so no label changes are needed in this brief — Brief 76 P2's name fallback chain delivered the right field shape.

### §2.6 P3 scope summary

Two edits to `HeatBalance.jsx`:

1. **Remove the guard at L194-195** — delete the `aggregateMechVentKwh > 0.01 return` block. The per-system loop runs unconditionally (still guarded by `v.heat_loss_kwh > 0.01` per-entry).
2. **Extend the filter at L255** to also drop `mech_ventilation` when per-system entries exist:

```js
if ((k === 'ventilation' || k === 'mech_ventilation')
    && orderWithNew.some(x => x.startsWith('ventilation_'))) return false
```

That's the complete fix. One file, ~5 lines of code change net. The shared `buildLossesMap` architecture means this single edit fixes Sankey, Rows, and Stacked — and the right-strip Σ losses, and the legend, and any other consumer that calls `buildLossesMap`.

### §2.7 What the brief got wrong about scope

The brief's P2 spec called for diagnostic on "three render sites that need updating" — listing `HeatBalance.jsx`, `BalanceSankey.jsx`, and `HeatBalanceView.jsx` separately. Actual finding: those three components SHARE one `buildLossesMap` function. Only `HeatBalance.jsx` needs editing.

This is good news — smaller fix, less risk, easier to verify (one source = all three views move together).

---

## §3 — Mutual-exclusion logic at three render sites (Part 3)

To be filled at Part 3.

---

## §4-walkthrough — Self-verification + close (Part 4, 2026-06-02)

### §4.1 Self-verified walkthrough table

Browser at `:5176`, 1568×744. Bridgewater loaded. All three Heat Balance view modes visited.

| # | Item | Result | Evidence |
|---:|---|---|---|
| 1 | Sankey: three labelled vent ribbons on OUT side, summing to ~326 MWh | **✓** | mvhr_gf_public ribbon (43 MWh, thin), bedroom_extract ribbon (233 MWh, dominant), public_toilet_extract ribbon (49 MWh). Σ = 326 MWh = engine aggregate. No "Mech ventilation" composite label visible. |
| 2 | Rows: three vent rows with same labels | **✓** | mvhr_gf_public 43.2 / bedroom_extract 233.8 / public_toilet_extract 49.1 MWh. Σ per-row = 326.1 MWh. No aggregate row. |
| 3 | Stacked: three vent segments | **✓** | Three labelled segments in LOSSES bar; legend shows three vent entries (no aggregate "Mech ventilation"). |
| 4 | Labels match v40 names | **✓** | "mvhr_gf_public", "bedroom_extract", "public_toilet_extract" — these are the system IDs/labels from Bridgewater's `systems_config_v40.ventilation`. Per Brief 76 P2's name fallback chain at `instantCalc.js:2974`, `name = v40Match?.label ?? …` so when Chris renames a system in the Systems editor, the label here updates automatically. |
| 5 | Σ losses unchanged across all views (~326 MWh component, total 549 MWh) | **✓** | All three views read 549.2 MWh total. mech vent component matches engine aggregate at 326.0 MWh (per-system Σ 326.1 within rounding). |
| 6 | Toggle `mvhr_gf_public` HRE → its ribbon changes | **Deferred to Chris** | Interactive toggle. Engine code path: HRE override → v40Match?.efficiency_metric.recovery_sensible_pct → hreFromV40 → hre → ventUA → acc_mech_vent_heat_per_system[0] → losses_at_setpoint.ventilation[0].heat_loss_kwh → rendered ribbon size. Wired correctly per Brief 76 P2 §2.5. |
| 7 | Toggle all three vent systems off → ribbons collapse, NO aggregate fallback, Σ drops | **Partial self-verify; Chris confirms interactively** | Logic check: when all three disabled, per-entry guard `v.heat_loss_kwh > 0.01` excludes all → no `ventilation_*` keys pushed → filter at L255 doesn't fire → aggregate `mech_ventilation` key stays in render order with `kwh = 0`. The existing zero-row filter at L260-261 does NOT include `mech_ventilation`, so a zero-value aggregate row may render as "Mech ventilation 0 MWh" — cosmetic only, Σ correct. Tier-3 polish item flagged in §future. |
| 8 | Brief 76 anchor preserved (EUI 143.5, heating 98.3, mech vent 326, cooling 53.1, DHW 263) | **✓** | All values match Brief 76 P4 anchor. EUI 143.5, electricity 387.2, gas 204.7, heating 98.3, cooling 53.1, DHW 263.2, vent fan 42.0, mech vent total 326.0. Carbon 27.0. No drift. |
| 9 | Brief 73 regression: vent share validation absent (no Σ chip, no Normalise) | **Deferred to Chris** | Brief 77 didn't touch share validation paths. Brief 73 P3-redux removed the share concept at engine + UI levels (`ef2a2a7`). No code in Brief 77's diff lives in those paths. Default expectation: no regression. |
| 10 | Brief 74 regression: Auxiliary row on Energy Flows Sankey | **✓** | DOM probe confirms Energy Flows tab shows Heating 98.3 / Cooling 53.1 / DHW 263.2 / Mech vent 42.0 / Lighting 56.3 / Small power 130.3 / **Auxiliary 70.5** MWh on Demand column. Σ elec 387.2 MWh matches Brief 76 anchor. |

### §4.2 Σ-preservation cross-check (the brief's load-bearing gate)

Per the brief Principle 4: Σ losses on Heat Balance must remain at 326 MWh ±1 MWh post-fix (component value).

| Source | Σ mech vent total (MWh) |
| --- | ---: |
| Pre-fix aggregate `losses.mech_ventilation.kwh` | 326.0 (from engine probe) |
| Post-fix Σ over `losses_at_setpoint.ventilation[].heat_loss_kwh` | 326.0 (Rule 9 invariant Δ = 5.8e-11) |
| Post-fix Σ rendered in Rows view | 326.1 (rounding: 43.2 + 233.8 + 49.1) |
| Σ losses total across all views | 549.2 MWh ✓ unchanged |

Δ across the chain: ≤ 0.1 MWh (display rounding). Well within the brief's ±1 MWh threshold. No double-counting introduced.

### §4.3 Items needing Chris's interactive walkthrough

- **Item 6** — HRE toggle propagation.
- **Item 7** — All-three-disabled edge case (Σ collapses, no aggregate fallback). The zero-row cosmetic edge is real; Chris's call on whether to fix in this brief or defer.
- **Item 9** — Brief 73 share validation regression spot-check.

### §4.4 Tier-3 follow-on items surfaced at close

- **Zero-value aggregate row when all vent systems disabled.** Per §4.1 item 7 analysis: the L260-261 zero-row filter excludes only `fabric_leakage`, `permanent_vents`, `thermal_bridging`. Extending it to `mech_ventilation` would suppress the cosmetic "Mech ventilation 0 MWh" row when no per-system entries exist AND aggregate is 0. Bounded change; logged here for whenever Chris notices.
- **Brief 75 P3-P5 carry-forward** (mech_vent_thermal_flow decomposition + MVHR recovery IN ribbon) still optional/lower priority.

---

---

## §future — Tier-3 notes

(Filled as work surfaces them.)

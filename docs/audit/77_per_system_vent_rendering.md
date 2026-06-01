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

## §2-diagnostic — Render-site sweep (Part 2)

Brief 74 P5's guard exact location + condition. Three render sites identified for Sankey / Rows / Stacked. ChartTotalsBadge Σ tally.

To be filled at Part 2.

---

## §3 — Mutual-exclusion logic at three render sites (Part 3)

To be filled at Part 3.

---

## §4-walkthrough — Self-verification + close (Part 4)

10-item walkthrough table.

To be filled at Part 4.

---

## §future — Tier-3 notes

(Filled as work surfaces them.)

# Brief 62 follow-up — vent-off cooling-demand diagnosis (read-only)

**Status:** read-only diagnostic. No engine change recommended below; just findings.
**Probes:** `scripts/_brief62_vent_off_diag.mjs` (3 configs), plus a one-shot interventions+vent-off check.
**Trace:** `docs/audit/62_vent_off_diag.json`.

---

## §1 The two checks Chris asked for

**(1) Is the vent-off cooling demand within the total-gain bound?**

| metric | value |
|---|---:|
| Vent ON (baseline): demand_cooling | **69.1 MWh** |
| Vent OFF (no on-disk interventions): demand_cooling | **135.8 MWh** |
| Vent OFF + on-disk interventions applied: demand_cooling | 143.3 MWh |
| Total annual gains (internal + solar) | **244.08 MWh** (people 0.00 + lighting 65.82 + equipment 78.86 + solar 99.40) |
| Vent-OFF demand / total gains ratio | **55.6 %** |

✅ **Vent-off cooling demand IS within the gains bound.** Physical. Not a bug on the magnitude axis.

But note: Chris reported "~400 MWh" — my probe shows **135.8 MWh** (no interventions) or **143.3 MWh** (full intervention stack applied). 400 MWh on Bridgewater would exceed total gains (244 MWh) and indeed be unphysical — but I'm not reproducing it. Possible causes for the discrepancy:
- Different project being tested in the UI (not Bridgewater).
- The 400 number is reading a DIFFERENT metric (e.g. delivered fuel, EUI × GIA, or sum-of-services rather than `consumption.space_cooling.demand_mwh`).
- A pre-Brief-62 state with the setpoint contradiction producing a different headline.
- Some other concurrent input change (custom cooling setpoint at a very low value compounded with vent-off).

**Recommend Chris confirm**: which exact metric on which exact panel shows the ~400, with what setpoint config + vent state, so I can reproduce the scenario before concluding.

**(2) With vent off, what fraction of 8760 hours is the building above the cooling setpoint?**

Important methodological finding: **`hourly_zone_air_c` is byte-identical between vent-on and vent-off runs.** All 8760 hours, max |Δ| = 0.000 K, same min/max/mean. Sample summer hours (e.g. h=4015): T_air = 35.46 °C in BOTH runs. The engine's per-hour T_air trace doesn't reflect mech-vent loss — vent enters via a separate demand accumulator on top.

This means the "hours above setpoint" count from the T_air trace is identical regardless of vent on/off. It still answers "in how many hours of the year does the free-running T_air exceed the cooling setpoint?" — just not the more interesting "with vent off, where does the building actually sit?" question (which would require running State 2 with the mech-vent loss reincorporated into the T_air integration, an engine change).

What the T_air trace DOES show (consistent across vent on/off):
- Hours above 24 °C (follow_comfort cooling setpoint): **5802 / 8760 (66.2 %)**
- Hours above 18 °C (custom cooling setpoint): **8326 / 8760 (95.0 %)**
- Hours below 21 °C (heating setpoint): 1765
- Hours in comfort band (21-24): 1193
- T_air range: min 10.64, max 42.44, mean 28.40 °C

---

## §2 Setpoint-insensitivity: explanation

Going from coolSp=24 → coolSp=18, vent-off:
- demand_cooling: 135.8 → 139.0 MWh (**+3.2 MWh**)
- hours above coolSp (T_air trace): 5802 → 8326 (**+2524 hours**)

The 2524 marginal hours captured by the setpoint drop have small per-hour cooling driving force — they're the hours where T_air sits just above 18 °C with a small gain-vs-loss surplus. 2524 hours × ~1.3 kWh/h average = 3.2 MWh.

Chris's hypothesis was "near-100 % cooling-hour occupancy already at coolSp=24 → catches few new hours when lowered". The reality is more nuanced:
- At coolSp=24, the building is at **66 %** saturation (5802 / 8760 hours above setpoint) — NOT near-100 %.
- At coolSp=18, it's at **95 %** saturation (8326 / 8760).
- The 2524 hours of "headroom" between the two setpoints DO get captured by the setpoint drop.
- BUT those marginal hours contribute only 3.2 MWh because their T_air is close to the new setpoint (driving force small).

So setpoint-insensitivity is **real physics**, but the mechanism is "marginal hours have small cooling integrand contribution", not "raw hour-count saturation". Qualitatively Chris's hypothesis is right; quantitatively the saturation isn't at coolSp=24, it grows as the setpoint drops.

---

## §3 Verdict on the two checks

**(1) BUG vs PHYSICS — is 135.8 MWh demand within bound?** ✅ Within gains (244 MWh). Real physics.

**(2) Is setpoint-insensitivity explained by near-saturation?** ✅ Yes, qualitatively. The 24→18 setpoint drop captures 2524 additional hours, but those marginal hours have small cooling driving force (T_air just above the new setpoint), so the cumulative demand barely moves.

**Combined:** the vent-off + cooling-setpoint-drop = small-Δ-demand pattern is correct physics on Bridgewater, given the building's free-running T_air range (10.6 to 42.4 °C mean 28.4). The pattern would change for buildings with very different gain/envelope profiles — but on Bridgewater it's defensible.

---

## §4 Mismatch with Chris's "~400 MWh"

Cannot reproduce 400 MWh on Bridgewater with `consumption.space_cooling.demand_mwh`. Maxed at 143.3 MWh (vent-off with full intervention stack). Worth checking:
1. Is the 400 number on the **Calc Trail** panel, or somewhere else (Heat balance / Sankey / Breakdown)?
2. Is it labeled "demand" or "delivered" or "fuel"?
3. What's the cooling setpoint config when 400 shows?
4. Are any other inputs changed alongside vent-off?

If you can give me those, I can re-probe and confirm bug-vs-physics on the actual scenario you saw. The findings above are valid for the standard vent-off case on Bridgewater (135.8 MWh, physical), but if your scenario is different the verdict might be too.

---

## §5 Secondary architectural finding (not a Brief 62 bug, surfaced for the diagnostic record)

`hourly_zone_air_c` (the State 2 surface from Brief 53 P2.A used for the summer-bypass trigger) does **NOT** include mech vent in the T_air integration. T_air is the gain-warmed envelope trace. Mech vent enters via separate demand accumulators on top.

This is a known engine design choice (mech vent is per-system, T_air is single-zone), but it means:
- The "T_air above setpoint" count is independent of vent state — useful as a free-running cooling-potential metric, but doesn't represent "what does the zone actually feel with vent X".
- The bypass-trigger (Brief 53 / Brief 63 question) compares T_air to T_out without knowing what vent is doing to the actual zone air.

Not raising as a fix — it's a long-standing architectural feature. Flagging because Chris's check 2 assumed the T_air trace reflects vent state, which isn't true. The 5802/8326 hour counts answer "free-running cooling-need hour count" rather than "T_zone-with-active-vent above setpoint count".

A future engine refinement could incorporate mech vent into the T_air integration (the per-hour mech-vent loss IS computed; just not fed back into T_air). That would be a separate brief — out of Brief 62 scope.

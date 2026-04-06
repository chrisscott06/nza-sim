# Brief 18a: CRREM Data Correction — Replace Approximations with Real Pathway Values

BEFORE DOING ANYTHING:
1. Read CLAUDE.md
2. This is a data-only change. No UI changes, no logic changes. Just replace numbers.

---

## Context

The CRREM pathway data in `benchmarks.py` was approximated during Brief 05. We now have the actual values from the CRREM V2 Risk Assessment Tool (v2.07), confirmed against the official Excel tool set to 1.5°C / United Kingdom / Hotel.

**Key differences from our approximations:**
- EUI starts at 264 (we had 280) and PLATEAUS at 95 kWh/m² from 2037 onwards (we had it declining to 55 by 2060)
- Carbon starts at 56.13 (we had 80) and declines to 0.60 by 2050 (we had 2)
- Our pathway was 15-35 kWh/m² too lenient on EUI and 24-80% too high on carbon

This MUST be corrected before any client-facing output.

1 part. Simple data swap.

---

## PART 1: Replace CRREM pathway data

**File(s):** `nza_engine/library/benchmarks.py`, `frontend/src/components/modules/building/LiveResultsPanel.jsx` (CRREM target constant), `frontend/src/components/modules/results/CRREMTab.jsx` (if it has hardcoded targets)

**Replace `CRREM_HOTEL_UK_15` with the real values:**

```python
CRREM_HOTEL_UK_15 = {
    "name":          "CRREM 1.5°C — UK Hotel",
    "display_name":  "CRREM 1.5°C Pathway — UK Hotel",
    "description":   "CRREM 1.5°C decarbonisation pathway for UK hotels. "
                     "Real values from CRREM V2.07 Risk Assessment Tool. "
                     "EUI based on gross energy demand. EUI plateaus at 95 kWh/m² from 2037 "
                     "(grid decarbonisation means further EUI reduction is not needed).",
    "pathway":       "1.5C",
    "country":       "UK",
    "building_type": "hotel",
    "source":        "CRREM V2.07 Risk Assessment Tool — 1.5°C, United Kingdom, Hotel",
    "eui_targets": {
        2020: 264.0, 2021: 248.6, 2022: 234.1, 2023: 220.4, 2024: 207.6,
        2025: 195.5, 2026: 184.1, 2027: 173.3, 2028: 163.2, 2029: 153.7,
        2030: 144.7, 2031: 136.3, 2032: 128.3, 2033: 120.8, 2034: 113.8,
        2035: 107.1, 2036: 100.9,
        2037: 95.0,  # ← PLATEAU: grid decarbonisation means no further EUI reduction needed
        2038: 95.0, 2039: 95.0, 2040: 95.0, 2041: 95.0, 2042: 95.0,
        2043: 95.0, 2044: 95.0, 2045: 95.0, 2046: 95.0, 2047: 95.0,
        2048: 95.0, 2049: 95.0, 2050: 95.0,
    },
    "carbon_targets": {
        2020: 56.13, 2021: 52.95, 2022: 49.09, 2023: 45.32, 2024: 41.66,
        2025: 38.28, 2026: 34.74, 2027: 31.49, 2028: 28.38, 2029: 25.42,
        2030: 22.51, 2031: 20.04, 2032: 17.61, 2033: 15.30, 2034: 13.13,
        2035: 11.08, 2036: 9.14, 2037: 7.33, 2038: 5.78, 2039: 4.54,
        2040: 3.53, 2041: 2.98, 2042: 2.56, 2043: 2.19, 2044: 1.86,
        2045: 1.56, 2046: 1.34, 2047: 1.13, 2048: 0.94, 2049: 0.77,
        2050: 0.60,
    },
}
```

**Also update the EUI gauge CRREM target constant** wherever it appears in the frontend. Search for any hardcoded CRREM target values (e.g. `CRREM_TARGET = 85` or `CRREM_TARGET = 215`) and update to the correct 2026 value:

```js
// The CRREM target for the EUI gauge should be dynamic based on current year
// For 2026: 184.1 kWh/m²
// But ideally read from the library data, not hardcoded
const CRREM_TARGET = 184  // 2026 UK Hotel 1.5°C target
```

Better yet: if the gauge currently hardcodes a target, change it to read from the CRREM pathway data for the current year. That way it automatically updates as time passes.

**Also update `CRREM_HOTEL_UK_2` (2°C pathway)** if we have 2°C data. If not, add a note that only 1.5°C has been verified against the official tool. The 2°C approximations should be flagged as unverified.

**Do NOT change:**
- The grid carbon intensity projections (National Grid FES) — these are from a different source and may still be reasonable
- The gas carbon factor (0.183 kgCO₂/kWh) — this is from UK Government GHG Conversion Factors and is correct
- Any calculation logic — only the pathway target VALUES change

**Commit message:** "Brief 18a: Replace CRREM approximations with real V2.07 pathway data — UK Hotel 1.5°C"

**Verify:**
1. Check `benchmarks.py`: 2020 EUI should be 264.0, 2037+ should be 95.0, 2020 carbon should be 56.13
2. Navigate to Results → CRREM & Carbon: the pathway line should now start lower (264 vs 280) and plateau at 95 from 2037
3. The EUI gauge on the Building module should show the correct 2026 target (184 kWh/m²)
4. If the Bridgewater model is at ~83 kWh/m², it should be BELOW the 95 kWh/m² plateau — permanently compliant after improvements
5. Report: "CRREM data corrected. EUI pathway: 264→95 (plateaus 2037). Carbon: 56.13→0.60. 2026 target now 184 kWh/m² (was 215). Gauge updated. Bridgewater modelled EUI 83 kWh/m² is below permanent 95 threshold — compliant."

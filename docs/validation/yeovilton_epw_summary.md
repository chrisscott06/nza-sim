# Yeovilton EPW — summary stats (validation extract, 2026-05-14)

**Source:** `data/weather/current/GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw`
parsed at 2026-05-14T13:24:23Z. Raw JSON in `docs/validation/_dump.json`
(key `weather`). 8,760 hourly rows. Pure data extraction — no analysis.

---

## Site

| Field | Value |
|---|---|
| Location | Yeovilton.AF, ENG |
| WMO ID | 038530 |
| Dataset | TMYx 2011-2025 |
| Latitude | 51.0064° N |
| Longitude | −2.6428° E |
| Time zone | UTC+0 |
| Elevation | 22.9 m |
| Hours in file | 8,760 |

---

## Outdoor temperature

| Metric | Value °C |
|---|---:|
| Annual mean | 11.26 |
| Annual max | 30.20 |
| Annual min | −6.80 |
| Summer max (Jun–Aug) | 30.20 |
| Winter min (Dec–Feb) | −6.80 |

The annual max equals the summer max and the annual min equals the winter
min on this EPW — i.e., the peak hot hour falls in Jun-Aug and the peak
cold hour falls in Dec-Feb, as expected for UK climate.

---

## Wind

| Metric | Value m/s |
|---|---:|
| Annual mean | 3.93 |
| Annual max | 18.5 |

---

## Solar — global / direct / diffuse on horizontal

| Metric | Value kWh/m²·yr |
|---|---:|
| Global horizontal (GHI) | 1,094.5 |
| Direct normal (DNI) | 1,165.3 |
| Diffuse horizontal (DHI) | 491.2 |

---

## Solar irradiance on vertical surfaces, per compass direction

Computed via `frontend/src/utils/solarCalc.js::computeHourlySolarByFacade`
(the same helper the production Static engine uses). Each direction
gives the annual incident kWh per m² of vertical glazing facing that
compass bearing, before any g-value / frame / shading reductions.

| Direction | kWh/m²·yr |
|---|---:|
| N  | 378.9 |
| NE | 503.4 |
| E  | 711.1 |
| SE | 866.9 |
| **S**  | **889.1** |
| SW | 806.5 |
| W  | 629.5 |
| NW | 448.4 |

Peaks at S, drops toward N as expected. For Bridgewater at orientation
42°, F1 (building-local north) faces NE → incident irradiance ≈ 503 kWh/m²/yr.
F3 (building-local south) faces SW → ≈ 806 kWh/m²/yr. F2 (east →
SE) ≈ 867 kWh/m²/yr. F4 (west → NW) ≈ 448 kWh/m²/yr.

---

## Degree days

| Metric | Value °C·day |
|---|---:|
| HDD (base 15.5 °C, daily-mean method) | 1,735.7 |
| CDD (base 22 °C, daily-mean method) | 2.8 |

**Method:** Daily mean outdoor T = mean of the 24 hourly T values for
that day. HDD day-contribution = max(0, baseC − dailyMean). CDD
day-contribution = max(0, dailyMean − baseC). Summed over 365 days.

The CDD-22 of 2.8 is essentially zero because Yeovilton's daily-mean
temperature very rarely exceeds 22 °C — peak hour does (max 30.2 °C) but
the daily mean is lower. Cooling demand at this site is driven by
internal gains + solar swamping the envelope's ability to shed heat,
not by outdoor air being hotter than indoor.

For reference: the Static engine's State 1 cooling demand on Bridgewater
is 108.6 MWh against a comfort upper of 25 °C — that comes from the
solar/envelope dynamics, not from outdoor T > 25 °C very often.

---

## Hand-calc sanity checks (for spreadsheet cross-reference)

**Annual HDD-15.5 × UA estimation** (quick envelope-loss sanity):
- UA_fabric (centre-of-element) ≈ U_wall × A_wall + U_roof × A_roof + U_floor × A_floor + U_glaz × A_glaz
  ≈ 0.18 × 1142 + 0.16 × 864 + 0.22 × 864 + 1.40 × 739
  ≈ 205.6 + 138.2 + 190.1 + 1034.6
  ≈ **1,568 W/K**
- UA_leakage = AIR_HEAT_CAPACITY × ACH × Volume = 0.33 × 0.2 × 11,064 ≈ **730 W/K**
- UA_total ≈ 2,298 W/K
- Annual loss ≈ HDD × 24 × UA_total = 1735.7 × 24 × 2298 / 1e6 ≈ **95.7 MWh/yr**

Static engine reports total losses 184.7 MWh/yr — about 1.9× the HDD
estimate. The 2× factor is expected because the engine's `dT_air > 0`
loss gate accumulates **whenever the zone is warmer than outside**, not
just below the heating base — internal gains push the zone well above
the base of 15.5 °C and conduction continues to bleed heat.

---

## File pointers

- Raw EPW file: `data/weather/current/GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw`
- Raw JSON dump: `docs/validation/_dump.json` (key `weather`)
- Solar projector: `frontend/src/utils/solarCalc.js`
- EPW spec: <https://designbuilder.co.uk/cahelp/Content/EnergyPlusWeatherFileFormat.htm>

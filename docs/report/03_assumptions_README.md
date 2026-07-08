# HIEX Bridgwater — Report Assumptions & Method (read alongside the tables)

Demonstrator-grade modelling: every number is defensible with a stated assumption, ranges
are carried, no false precision. Baseline = `report_baseline_v1` (clean Bridgewater, aux
experiment removed). Engines: NZA-Sim v2.5 (headline) + EnergyPlus 25-2-0 (validation).

## Tariffs & carbon factors
- **Electricity tariff:** 28 p/kWh (flat, no escalation).
- **Gas tariff:** 7 p/kWh (flat).
- **Electricity carbon:** the **FES / declining grid pathway** (NOT the CRREM property-target
  curve). Anchor points (gCO₂/kWh, linear-interpolated): 2024 **190** · 2026 **150** · 2030
  **50** · 2035 **15** · 2040 **8** · 2050 **5**. Source: DESNZ Green Book + National Grid FES;
  mirrors `frontend/src/data/ukGridCarbonTrajectory.js` (Brief 89).
- **Gas carbon:** **0.18316 kgCO₂/kWh**, constant (design note).
- **No discounting / NPV** — simple payback only (demonstrator simplicity).

## The four metrics (design note, exact definitions)
1. **EUI reduction** — Δ kWh/m²/yr on GIA **4,215 m²**, gross demand (**PV excluded** per CRREM).
2. **Lifetime GHG to 2050** — annual fuel deltas × year-by-year factors (elec on the declining
   grid pathway, gas constant), **capped at measure life**, from the 2026 report year.
3. **£/tCO₂e** — central capex (incl. stated on-costs) ÷ lifetime tonnes. The MACC ranking metric.
   Divided by the *displayed* (1-dp) lifetime for report internal-consistency.
4. **Simple payback** — central capex ÷ year-1 £ saving at 28p/7p.

## Measure lives (CIBSE Guide M indicative, per note)
controls/settings **10y** · plant **15y** · PV **25y** · fabric **30y**. Applied per intervention
in `interventions.py`.

## Class B derived-scalar bases (verbatim from the design note)
- **1.2 WWHR** — DHW demand scalar **0.82** (shower fraction 65% × HX effectiveness 45% ×
  config factor 0.6 ≈ −18%). Modelled as `dhw_demand_litres_per_person_per_day` ×0.82.
- **1.3 exhaust-air ASHP** — preheat-stage COP **+0.4** absolute (3.0→3.4), ASHP preheat share only.
- **3.1 VRF commissioning** — sensitivity **band** none / **central +0.4** / strong (managed 3.9);
  central is the stack member, none/strong are the reported band.
- **3.2 VRF replacement (energy)** — heating/cooling **−20%** via rated-SCOP substitution
  (eff 3.0→3.75 isolated; **3.4→4.25 cumulative**, computed on the post-3.1 state = the
  anti-double-count guard).

## Class C off-model bases (formulae stated)
- **1.5 VRF→DHW interlink** — monthly: recoverable = cooling × (1 + 1/EER) × **55% capture**;
  usable = min(recoverable, monthly DHW preheat demand); elec saved = usable ÷ preheat COP.
  → 20.6 MWh/yr, 14.4 tCO₂e, EUI −4.9.
- **3.2 refrigerant carbon** — charge 112 kg (0.35 kg/kW × 320 kW) × 3% leak × (GWP 2088→675)
  = **4.7 tCO₂e/yr** avoided → 71 t over 15y.
- **7.1 PV** — 50 kWp × 950 kWh/kWp = 47.5 MWh/yr, **85% self-consumption**; **EUI unchanged by
  construction** (CRREM gross-demand rule); carbon on the declining grid pathway. Export (15%)
  excluded (conservative).

## The four L-flags (allowance only — no credible published benchmark)
1.3 exhaust-over-ASHP ducting · 1.5 cooling→DHW interlink module · 2.1 MVHR plenum builder's
work · hotel-scale WWHR install (1.2). These surface as **"allowance-only"** in the tables.

## Stated engineering assumptions (Chris to sanity-check — see OVERNIGHT_FINDINGS.md)
- 1.1 low-flow **−19.5%** DHW (shower 65% × flow −30%). · 5.2 communal lighting **−15%**. ·
  3.4 glazing **g 0.55→0.42** (nearest library construction `double_low_e`; target 0.40). ·
  3.5 brise soleil on **south + west** (SW/S/W of the 4-orientation box). · 2.2 fan duty **−28%**
  flow + cube-law SFP derate. · 4.2 plug **−25%**. · 1.4 ASHP SCOP **2.9**.

## Known modelling limitations (design note does NOT resolve)
- **Cumulative DHW measures share config paths** (1.1/1.2 on demand-litres; 1.3/1.4 on ASHP
  efficiency) → the declarative engine's last-write-wins under-compounds them, so **cumulative
  DHW savings (Table 2) are a lower bound**. Isolated (Table 1, the MACC) is unaffected.
- **2.3 heat-recovery bypass** has no clean static-engine representation (seasonal control) —
  modelled effect ≈ 0, flagged "no-model". A near-free control with an uncaptured small cooling benefit.
- **VRF-eff double-count (3.1 & 3.2)** handled by the note's guard (3.2 on the post-3.1 state).

## Honest-limits paragraph (for the report, from the design note)
> Class C measures and Class B scalars are transparent engineering assumptions, not simulation
> outputs — each carries its stated basis and range. The dual-engine apparatus (NZA-Sim +
> EnergyPlus, Brief 95) validates the Class A set; the report says which is which.

## Files
- `HIEX_intervention_metrics.csv` / `.xlsx` (3 sheets: Isolated MACC · Cumulative spine · EP validation)
- `00_baseline.md` · `01_cost_reconciliation.md` · `02_run_manifest.md` · `OVERNIGHT_FINDINGS.md`
- Engines: `scripts/report/{interventions,benchmarks,offmodel,metrics,build_tables}.py`, `run_nza.mjs`, `run_ep_mappable.py`

# Brief 100 (DRAFT): Interventions Library — XLSX export + off-model savings + narratives

**Grounding:** the structural investigation this session (agent report) — the `cumulativeDelta` record
(`interventionsEngine.js:531`), the four metric functions, the `PerInterventionView` isolated view, and
the `offmodel.py` calculators. **Purpose:** make every intervention's story explorable — off-model
measures show their real numbers, each carries a plain-language narrative, and the whole Library
exports to one XLSX with metrics + calc trail + cost plan + narrative.

## BEFORE DOING ANYTHING
1. Confirm receipt: quote the Goal + the four locked decisions.
2. Branch `chris/interventions-export` off main. Land this brief as P1's first commit.
3. Read CLAUDE.md, STATUS.md, the investigation report, `PerInterventionView.jsx`, `offmodel.py`.
4. **The physics engine is untouched.** No `instantCalc.js`, no assembler, no `derive_systems_for_sim`.
   `--fixture` anchors 132.6 / 126.0 byte-identical at start and close. (Off-model fallbacks change
   only *intervention* displayed metrics — never the baseline anchor, which has no interventions.)

## Goal
Every intervention in the live Bridgewater Library is fully explorable and exportable:
- **Off-model measures** (PV 7.1, interlink 1.5, refrigerant 3.2) show their real off-model savings
  (carbon / £ / avoided-import kWh), badged "off-model", instead of looking dead — while staying
  honest on EUI (PV EUI Δ stays 0 per the CRREM gross-demand rule).
- **Each intervention carries a plain-language narrative** (how it works + energy & cost assumptions).
- **One XLSX export** from the Library: per intervention — the four metrics, the calc trail (EUI,
  per-service demand baseline→post, per-fuel, envelope), the cost plan (lines + on-costs), and the
  narrative.

## The four locked decisions
1. **XLSX** (add an `xlsx`/`exceljs` dep; multi-sheet workbook).
2. **Off-model: fold into headline metrics (badged) AND a separate off-model section** in the export.
3. **Off-model rolls into isolated AND strategy/roadmap totals** → the fallback lives in the shared
   metric functions (`computeLifetimeCarbon`, `computeAnnualOperationalSaving`), not only in the view.
4. **Reuse `notes`** as the single narrative field, expanded so each covers energy AND cost.

## New schema field (Interventions §3)
Add an optional `off_model` object to the persisted intervention:
```
off_model: {
  annual_elec_kwh_saved, annual_gas_kwh_saved,   // avoided delivered energy (0 where n/a)
  annual_gbp_saved,                               // operational £ saving/yr
  lifetime_tco2e,                                 // lifetime carbon saving
  eui_delta_kwh_m2,                               // demand-intensity change (0 for PV — gross-demand)
  basis                                           // one-line method string (from offmodel.py)
}
```
Document in `docs/audit/41_interventions_schema.md` §3 + a patch-migration note (Rule: schema-flexibility).
Each field is what the measure *actually* affects — PV: carbon+£+avoided-import, EUI 0; interlink:
elec+£+eui; refrigerant: carbon only.

## Parts

### P1 — Off-model field + seed + metric fallbacks (fixes the "PV shows nothing" gap)
1. Add `off_model` to the schema doc. Extend the seed adapter (`scripts/seed_hiex_interventions.py`)
   to compute `off_model` for 1.5 / 3.2 / 7.1 from `scripts/report/offmodel.py` and write it onto those
   three live interventions (via the API PUT, same path as Brief 99).
2. Metric fallbacks: in `PerInterventionView.jsx` AND (decision 3) in `computeLifetimeCarbon` /
   `computeAnnualOperationalSaving`, when engine `perFuel` is empty but `intervention.off_model` exists,
   read the off-model values. Badge the cards "off-model". EUI Δ reads `off_model.eui_delta_kwh_m2`
   (0 for PV → EUI stays 0, but carbon/£/payback populate).
3. Commit. **Falsifiable:** on live Bridgewater, PV shows lifetime carbon + £/tonne + payback (not
   blank), EUI Δ = 0, badged off-model; interlink + refrigerant likewise; the strategy summary's
   portfolio totals include the off-model carbon (decision 3).

### P2 — Narratives (reuse notes, expand to cover energy + cost) + small bug fixes
1. Ensure each of the 22 `notes` carries a clear energy sentence AND a cost sentence (expand the thin
   ones from `interventions.py` assumption/basis + offmodel basis). Re-seed via the API.
2. Display the narrative in the isolated view (a "How this works" panel under the Impact tab).
3. Fix the two investigation bugs: dead `?? d.dhw_demand_mwh` fallback (`PerInterventionView.jsx:360`
   → `per_service.dhw`); render ventilation/lighting/small_power in the Demand tab (data exists).
4. Commit. **Falsifiable:** every intervention shows a 2-part (energy + cost) narrative; Demand tab
   shows all six services.

### P3 — The XLSX export
1. Add the `xlsx` dep (`npm install`, note Windows `--force` per CLAUDE.md). Build a Library "Export
   XLSX" button using the Blob+anchor download pattern (`ChartPrintModal.jsx:128`).
2. Workbook sheets: **(a) Summary** — one row/intervention: label, class/flag, theme, EUI Δ, kWh saved,
   lifetime tCO₂e, £/tonne, payback, capex, off-model badge. **(b) Calc trail** — per intervention:
   per-service demand baseline→post→Δ (all six services), per-fuel elec/gas, envelope losses.
   **(c) Cost plans** — per intervention: groups → lines (name/qty/unit/rate/total) + on-costs + total.
   **(d) Narratives** — label + energy narrative + cost narrative + off-model basis.
3. Commit. **Falsifiable:** clicking Export downloads a `.xlsx`; opening it shows the 4 sheets with all
   22 interventions; a spot-check row (1.4) matches the UI (£105,700, EUI Δ −26.1); PV row shows its
   off-model carbon/£.

### P4 — Verify (browser) + close
1. Browser render check on live Bridgewater: PV/interlink/refrigerant show off-model metrics + badge;
   narratives render; Export downloads a valid workbook; open it and verify the sheets.
2. `--fixture` anchors byte-identical. STATUS, archive brief, current.md, push, PR open — NOT merged.
3. Commit. **Falsifiable:** screenshot of PV with populated off-model metrics + a narrative; the
   exported workbook; anchors 132.6 / 126.0.

## MUST NOT
Touch the physics engine (`instantCalc.js` / assembler / derive) · fake an EUI reduction for PV (EUI Δ
stays 0; only carbon/£ populate) · move the baseline anchor · split off-model into the demand engine ·
merge unattended.

## Escalate (stop-and-write)
An off-model value from `offmodel.py` can't be reconciled to the report · adding the `xlsx` dep pulls a
CSP-incompatible bundle · a metric fallback would change the baseline anchor · the narrative expansion
needs source facts not in `interventions.py`/`offmodel.py` (don't invent — flag).

## Open question for Chris (pre-P1)
Export scope — **current live Library (the 22 as seeded)** only, or should the export also work for the
**composed strategy** (ordered spine with cumulative deltas)? P1–P4 assume the isolated Library. Strategy
export is a small add-on (same data, cumulative instead of isolated) if wanted.

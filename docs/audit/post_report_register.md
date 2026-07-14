# Post-report register — anchor-moving / pipeline-structural backlog

Deliberate changes that either **move the NZA anchor** (132.6 / 126.0 byte-identical) or
**restructure a results pipeline**, held until *after* the HIEX demonstrator report ships so
the report's numbers stay frozen against a stable engine. Each is a separate briefed change
with its own sign-off — none is a bug, all are known and named.

Consolidated from the closed 98-C convergence brief's `OUT (parked, Chris-gated)` block
(`docs/briefs/archive/98C_convergence_COMPLETED.md` §OUT) so the backlog outlives the brief.

| # | Item | What it changes | Moves the NZA anchor? | Source / evidence |
|--:|---|---|:--:|---|
| **1** | **Path (b) — rewire the tool's EP pipeline** | Re-point `/api/ep/*` from `validation/energyplus/` (Brief 95: `state_builder` + `generate_full_idf`, eppy) to the **`nza_engine` converged assembler** (`nza_engine/generators/epjson_assembler.py`, 98-C). Retire the duplicate building→EP translation. | No — EP-side. But retires a **second, drifting** building model. | The validation pipeline's live-Bridgewater baseline **cooling 130.3 MWh vs the converged 88.3** (+47.6%) and heating 96.4 vs 107.2 (−10.1%) proves the two EP translations have drifted. The tool's EP columns therefore can't back the 98-C convergence story until unified. (2026-07-14 gate run.) |
| 2 | Thermostat — NZA-side setback option | Add an overnight setback regime to NZA `instantCalc.js` (vs today's continuous 21/24 band) as an *option*. 98-C closed this EP-side by inheriting NZA's flat band; the NZA-side variant is the parked alternative. | **Yes** | 98-R gap #6 (`docs/audit/98C_after.md`), classed `NZA-side (+ decision)`. |
| 3 | Fan-electricity accounting | Book MVHR/VRF fan electricity as a separate delivered channel in NZA (currently null/folded); EP books 55.9 MWh. Raises EUI. | **Yes** | 98-R gap #11 (`docs/audit/98C_after.md`), `NZA-side (anchor-moving)`. |
| 4 | NZA thermal-mass placeholder | Replace the `TUNE_INTERNAL_MASS` placeholder with a derived internal-mass basis. | **Yes** | 98-C OUT list; `instantCalc.js` `TUNE_INTERNAL_MASS`. |
| 5 | Clamp-reset review | Review the cooling/heating clamp-reset logic (Brief 64 lineage). | **Yes (likely)** | 98-C OUT list; Brief 64 `cooling_clamp_and_control_strategy`. |

**Discipline (unchanged):** these come as deliberate anchor-moving briefs *after* the report,
one at a time, each re-baselining the anchor with Chris's sign-off. Until then the anchor
stays 132.6 / 126.0 byte-identical and `instantCalc.js` is not touched.

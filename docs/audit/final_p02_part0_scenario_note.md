# Final P02 — Part 0 scenario finalization (Model 2 vs Model 2.1)

**Brief:** `final-p02-run.md`. **Date:** 2026-07-17. **Decision:** Chris — report ships on **Model 2 (185.1)**.

## (a) Model 2.1 vs pinned Model 2 — full diff (the "what changed" identified)
Leaf-value diff of the two scenario snapshots (building_config + construction_choices + comfort_band):

| Field | Model 2 | Model 2.1 |
|---|---|---|
| `systems_config_v40.ventilation[0].summer_bypass` (GF `mvhr_gf_public`) | absent (None) | **True** |

**Exactly one differing value.** construction_choices: 0 diffs. comfort_band: 0 diffs. Nothing hidden —
Model 2.1 is Model 2 plus the single GF `summer_bypass` flag. Engine effect: cooling 50.23→42.63 MWh,
EUI 185.1→183.3, elec 572,398→564,836.

## Why Model 2 (185.1) is the legal baseline
The calibrated baseline must equal the meter by construction (elec = 572,400 metered, closed by the
147.75 MWh residual). Model 2.1 (183.3 / 564,836) is an **un-re-closed intermediate** — turning on the GF
bypass removed 7.6 MWh of cooling without re-sizing the residual, so it sits 1.3% under the meter. It is
not a legal baseline until the residual is re-closed. Every section 1–3 report page was written and issued
from Model 2 (185.1).

## (b) Model 2.1 parked (not deleted, not pinned)
Renamed to **"Model 2.1 - bypass-in-baseline candidate (DO NOT USE for P02)"** — preserved as a scenario
so the candidate isn't lost. Live inputs, active scenario, and the pinned baseline_snapshot all restored
to **Model 2** (GF `summer_bypass` removed). Snapshot *values* of Model 1 / Model 2 untouched; only the
active/pinned pointer and the 2.1 label changed. Live re-verified: EUI 185.1 / elec 572,398 / gas 207,700.

## (d) P03 follow-up (logged, not done tonight)
**Fold GF summer_bypass into the baseline properly:** set it true on the GF units, re-run, and **re-pin the
residual so the baseline re-closes at elec 572,400 / EUI 185.1** (the residual grows ~7.6 MWh to absorb the
recovered cooling). Batch with the **gated thermal-bridging full-mode fix** — both re-size the residual, so
they belong in the same post-P02 engine window. Until then, P02 ships on Model 2 (185.1).

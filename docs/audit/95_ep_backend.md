# Brief 95 — EnergyPlus Results Backend for Interventions — audit

## §1 — EP version pin + Box-validation gate (Part 1)

**Pin.** `validation/energyplus/ep_config.json` → EnergyPlus **25.2.0-cf7368216c** at
`/Applications/EnergyPlus-25-2-0` (binary + IDD + WeatherData + ExampleFiles). `ENERGYPLUS_DIR` still
overrides. 26.1.0 upgrade is a separate future decision (Decision 7).

### Box gate — 25-2-0 reproduces the reference BYTE-IDENTICALLY

Re-ran the Brief 81–85 Box flow against 25-2-0: `run.py` (EP 25-2-0, box IDF) → `compare.py` vs the NZA-Sim
reference. EP ran clean — **3 warnings, 0 severe**, ~1.5 s. This also **closes Brief 93's deferred EP
smoke-test caveat**.

**Version invariance (the substantive gate):** the fresh 25-2-0 EP result is **byte-identical to the
previously-committed EP reference — 0 of 42 metrics moved** (heating 3.2775, cooling 0.6768, EUI 166.6, all
fabric/solar/infiltration/mech-vent figures unchanged). The version change introduces **zero** divergence; the
pin holds cleanly.

**Gated tolerance table (`compare.py`, NZA-Sim v2.5 vs EP 25-2-0):**

| Metric | NZA-Sim | EnergyPlus | Δ (NZA−EP)/EP | Tol | Result |
|---|---|---|---|---|---|
| EUI | 160.4 | 166.6 | −3.7% | ±10% | ✅ PASS |
| Heating demand | 2.492 | 3.278 | **−24.0%** | ±15% | ❌ FAIL |
| Cooling demand | 1.407 | 0.677 | **+107.9%** | ±15% | ❌ FAIL |
| Fabric conduction (total) | 5.454 | 4.909 | +11.1% | ±20% | ✅ PASS |
| Mech-vent (net, coil-run hrs) | 0.919 | 0.887 | +3.6% | ±15% | ✅ PASS |
| Monthly heating profile r | — | — | 0.993 | ≥0.85 | ✅ PASS |
| Monthly cooling profile r | — | — | 0.945 | ≥0.85 | ✅ PASS |

### Gate reading (Chris-authorised 2026-07-07)

`compare.py`'s literal verdict is FAIL on 2/7 gated metrics — but **heating −24.0% / cooling +107.9% are the
established, documented Brief 81–85 characterisation**, exactly the "heating −24% / cooling +108% territory"
this brief predicts (P3) and the +108% cooling residual Brief 95 exists to investigate. They are NZA-Sim↔EP
divergences deliberately surfaced by the harness ("never tuned away"), **not** version regressions — proven by
the byte-identical version invariance above (25-2-0 = the reference EP numbers exactly).

The P1 gate is therefore read as **"25-2-0 reproduces the established characterisation"** — which it does
exactly — **PASS, proceed**. (A literal all-green reading is impossible: the cooling residual is the reason
for the brief.) Chris confirmed proceeding on this reading (2026-07-07). Reproduction command:
`ENERGYPLUS_DIR=/Applications/EnergyPlus-25-2-0 validation/.venv/bin/python validation/energyplus/run.py`
then `validation/compare.py --stdout`.

_Info rows (not gated) unchanged from the Brief 81–85 record: glazing conduction +58.9%, heat recovery −49.7%
(framing differences documented in Brief 83 §3.4/§5.2); people/lighting/equipment gains 0.0%._

## §2 — ZZ TEST seed + fixture rule

`scripts/seed_test_project.py` creates/replaces the **"ZZ TEST — do not use"** project in the local DB from
`validation/fixtures/bridgewater_anchor_v2.yaml`. Idempotent (delete-by-name then insert = clean recreate on
every run). UI verification for Brief 95 uses ZZ TEST only — never Chris's real projects. CLAUDE.md gains the
two-line fixture rule.

> **Implementer's-choice deviation (documented):** the brief names `seed_test_project.mjs`, but node here has
> neither a YAML parser nor a SQLite driver (no repo node project), while Python has both (stdlib `sqlite3` +
> the harness venv's `pyyaml`). The seed is written in Python for a zero-dependency, robust implementation.

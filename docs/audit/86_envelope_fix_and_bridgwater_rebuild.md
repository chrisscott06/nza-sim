# Audit — Brief 86: Envelope-Only Heat-Balance Fix + HIEX Bridgwater Rebuild + Persistence

Branch: `feat/envelope-fix-bridgwater-rebuild` (cut from `feat/energyplus-validation` tip `7b9b252`).

## Part 2 — Envelope-only heat-balance 500: DIAGNOSIS (no assembler change required)

**Brief premise:** "the envelope-only epJSON assembler simply isn't requesting [Zone Mean Air
Temperature]... Fix the assembler." **Finding: the premise does not hold for this codebase.**

### Evidence
1. `nza_engine/generators/epjson_assembler.py:1719` emits `"Output:Variable": _output_variables()`
   **unconditionally** — for every `mode`, including `envelope-only`. No mode guard.
2. `_output_variables()` (line 658) already lists `Zone Mean Air Temperature` **and**
   `Zone Operative Temperature` at Hourly. `key_value: "*"`.
3. Git: that request was added **2026-05-12** in Brief 26 Part 6 (`a5f16ef`). `assemble_epjson`
   is the **only** epJSON builder — there is no separate envelope-only assembler missing it.

### Actual cause of the 500
The `GET /api/projects/{id}/simulations/{run_id}/balance?mode=envelope-only` endpoint
(`api/routers/projects.py:788`) does **not** run a sim — it reads an **existing** run's
`eplusout.sql` and re-interprets it. The only completed run on disk for the HIEX Bridgwater
project (`12cf7cc4…`) is **`683c1509`, dated 2026-04-04** — a *full-mode VRF* run created a month
**before** the temp-output feature existed. Its `input.epJSON` requests **0** temperature
variables; its SQL contains none (20 vars, all energy/flux). There are **zero** envelope-only
runs for the project. `_get_heat_balance_state1` (`sql_parser.py:1539`) therefore correctly raises
— the temperature genuinely isn't in that stale SQL.

**Conclusion:** the parser is correct; the assembler is correct; the SQL is stale. The fix is to
produce a **fresh envelope-only run** with the current assembler — which requires the project's
geometry/fabric, lost in the machine migration and rebuilt in Parts 3–5. Part 2's "re-run → 200"
verification is thus **gated on the rebuild**; the assembler edit the brief describes is a no-op.
Re-sequenced (Chris, 2026-06-25): rebuild first, verify envelope-only 200 after.

### JSX half (buildingSections.jsx ~line 990)
No stray `>` found on this branch; the file already contains escaped `&gt;` occurrences and
`npm run build` is **clean** (exit 0, no JSX warnings). Considered already-resolved; line numbers
have drifted since the brief was authored.

## Part 3 — BLOCKED pending fabric inputs
The brief supplies glazing (U1.1/G0.55 bedroom; U1.0/G0.27 curtain wall), permeability
4.64 m³/(h·m²)@50Pa, GIA 4,215 m², 5 storeys, Yeovilton EPW — but **not** the opaque
wall/roof/floor U-values, glazing proportions, or footprint dimensions (they live in external
BRUKL/schedule docs `26002-NZA-XX-XX-SH-X-0010 v2`). Neither the DB nor the April-4 epJSON snapshot
holds the real BRUKL fabric (both are stock-library defaults). Awaiting confirmed figures from Chris
before writing — no synthetic U-values (CLAUDE.md: library is the single source of truth).

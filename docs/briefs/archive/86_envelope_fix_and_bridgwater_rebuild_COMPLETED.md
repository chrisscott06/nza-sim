# Brief — NZA-Sim: Envelope-Only Heat-Balance Fix + HIEX Bridgwater Model Rebuild + Input Persistence
*Project: HIEX Bridgwater (UUID 12cf7cc4-9bdc-41bc-ab4e-24e044fbad9d) · NZA-Sim*

---

## BEFORE DOING ANYTHING
- [ ] Read this brief in full. Confirm receipt by quoting the title and this paragraph back to Chris.
- [ ] Read `CLAUDE.md` and `STATUS.md` in the repo root.
- [ ] Read the relevant Notion design notes: Brief 74 (Heat Balance mech-vent loss ribbon), Brief 75 (full ventilation heat modelling + Bridgewater heating-demand-zero diagnostic), Brief 82 (zone-temp delta diagnostic), Brief 83 (MVHR recovery booking). These bear directly on the envelope-only heat balance and the rebuild.
- [ ] Read the existing code being modified: the epJSON assembler and `nza_engine/parsers/sql_parser.py` (esp. `_get_heat_balance_state1` around line 1540).
- [ ] Confirm clean working tree; confirm origin in sync.
- [ ] Land this brief at `docs/briefs/active/<NN>_envelope_fix_and_bridgwater_rebuild.md` as Part 1's first commit.
- [ ] Run the session-start reconciliation pass (`ls docs/briefs/active/`, `cat docs/briefs/current.md`, `tail STATUS.md`, `git log --oneline -20`). If `active/` is stale, first commit is the cleanup commit.

---

## GOAL
Restore the envelope-only heat balance (currently 500-erroring), then rebuild the HIEX Bridgwater model from confirmed data because the populated inputs were lost in a machine migration, and finally add input persistence so a project can never be lost this way again. The envelope-only heat balance is the evidential backbone of the report's "ventilation acts as the cooling system" finding, so it must work before the rebuild is verified against it.

---

## SCOPE
**IN:**
- Fix the envelope-only heat-balance 500 error (epJSON assembler not requesting zone temperature output).
- Cosmetic JSX fix in `buildingSections.jsx` (~line 990).
- Full repopulation of the HIEX Bridgwater project inputs (geometry, fabric, systems, loads, calibration) from the confirmed data in this brief.
- Add project input export/snapshot persistence.

**OUT:**
- No changes to the natural-ventilation / purge calculation method (Chris will assess separately — leave the capability intact, see Design decisions).
- No new engine modes.
- No `npm install` / `node_modules` / `package-lock.json` changes pushed (Linux-vs-Windows rule).
- No refactor of the heat-balance parser beyond what the fix requires.

---

## DESIGN DECISIONS ALREADY AGREED (intent)
- **Geometry is deliberately simplified:** single thermal zone, simple cube, 5 storeys, GIA 4,215 m², fixed glazing proportions. Thermal-bridging assumptions are *slightly reduced* to compensate for the clean-cube simplification so overall fabric heat loss stays realistic. This is intentional, not an approximation to "fix".
- **Windows are modelled as sealed** — the real building has no openable lights, so the window-openings section is left empty. **Do NOT disable the natural-ventilation/purge capability in the engine** — it stays available so Chris can test openable-window purge as an intervention later. Sealed is a baseline *input*, not a capability removal.
- **The bug is a missing output request, not a parser defect.** The State-1 parser correctly needs Zone Mean Air Temperature; the envelope-only epJSON assembler simply isn't requesting it. Fix the assembler, not the parser's expectation.
- **Calibration philosophy:** the bottom-up physics lands short of metered ~180 kWh/m²/yr. An inferred base load is added (in auxiliary) to reconcile — labelled inferred, cause-to-be-confirmed-by-metering. Engine output is canonical; do not tune physics to hit the target — add the explicit base load and document it.
- **Evidence hierarchy:** use BRUKL *inputs* only (U-values, tested air permeability, datasheet G-values), never BRUKL output figures.

---

## PRINCIPLES / CONSTRAINTS
- One Part = one commit, including STATUS.md and any audit-doc update.
- Browser-verify at the walkthrough point using MCP browser tools; capture numeric evidence, not "looks right".
- Variable boundaries must stay explicit (raw demand / post-MVHR / delivered / source fuel) — do not reintroduce boundary-mismatch.
- If a baseline number moves, document the movement from first principles in the audit doc.

---

## PARTS

### Part 1 — Land brief + reconciliation
Land this brief on disk; run reconciliation pass; cleanup commit if `active/` is stale.
**Done:** brief at `docs/briefs/active/`, tree clean, STATUS.md notes brief opened.
**Commit:** `chore: land envelope-fix-and-rebuild brief + reconcile`

### Part 2 — Fix envelope-only heat balance + cosmetic JSX
- In the epJSON assembler, for **envelope-only mode**, add the required Output:Variable request(s): `Zone Mean Air Temperature` (and/or `Zone Operative Temperature`) at Hourly frequency, so the EnergyPlus SQL contains what `_get_heat_balance_state1` reads.
- Re-run the sim so SQL regenerates; confirm `GET /api/projects/{id}/simulations/{sim}/balance?mode=envelope-only` returns 200.
- Fix the stray `>` inside JSX in `frontend/src/components/modules/building/buildingSections.jsx` (~line 990) — escape as `&gt;` or wrap in a string literal.
**Files:** epJSON assembler, `buildingSections.jsx`.
**Done (falsifiable):** envelope-only balance endpoint returns 200; heat-balance view renders; Vite JSX warning gone.
**Commit:** `fix: request zone temperature in envelope-only epJSON; escape JSX gt`

### Part 3 — Rebuild geometry + fabric
- Single-zone cube, 5 storeys, GIA 4,215 m², fixed glazing proportions, reduced thermal-bridging adjustment.
- Air permeability **4.64 m³/(h·m²) @ 50 Pa** (tested; SBEM used 5.0 — use 4.64).
- Bedroom glazing (G1/G2): **U 1.1 W/m²K, G 0.55**. Ground-floor curtain wall (G3): **U 1.0, G 0.27** (SunGuard).
- Walls/roof/floor U-values from BRUKL design spec (inputs only).
- Window openings: **none** (sealed). Capability left intact.
- Weather: `GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw`.
**Done:** geometry + fabric entered; envelope-only heat balance renders sensible losses.
**Commit:** `feat: rebuild Bridgwater geometry + fabric`

### Part 4 — Rebuild systems
- VRF (10 condensers, R-410A, heat-recovery): R01 14HP twin + 10HP follower; R02–R10 10HP (~28 kW) each. Heating COP ~3.0, cooling EER ~3.5.
- Electric panel heaters in HRV-served zones.
- DHW: gas-led + Toshiba Estia ASHP pre-heat (gas DHW-only). Anchor to metered gas 134.8 MWh.
- 2 DX splits (Toshiba RAV), R-410A.
- Ventilation: 5× HRV (G.01–G.05, SFP 2.0, 80% HR); extract EF G.01–G.04 (SFP 0.8), EF 1.01–4.01 (SFP 0.4), EF R.01 roof Vent-Axia ~2,292 l/s. Designed continuous. Total fan energy ~152 MWh/yr at 24h.
**Done:** systems entered; systems Sankey renders; fuel split ~70% elec / 30% gas.
**Commit:** `feat: rebuild Bridgwater systems`

### Part 5 — Rebuild loads + calibrate
- Small power + equipment ~186 MWh/yr (~44 kWh/m²/yr), ~97% to internal gains. Lifts ~3,500–7,000 kWh/yr total (standby-dominated; not the old 2,400).
- Lighting: assume LED, no auto-M&T.
- Add **inferred base load** (auxiliary) to reconcile modelled EUI to metered **~180 kWh/m²/yr** and reproduce the flat load shape. Label inferred / cause-to-be-confirmed-by-metering.
**Done (falsifiable):** calibrated EUI within ~2% of 180; internal gains drive cooling, bedroom extract drives heating (the heat-balance finding reproduces).
**Commit:** `feat: rebuild Bridgwater loads + inferred base-load calibration`

### Part 6 — Input persistence
- Add export/snapshot of the full project inputs (geometry, fabric, systems, loads, schedules) to a single JSON, committable to the repo.
- Ideally timestamped DB snapshots on save for rollback. At minimum, rebuild reproducible from one committed inputs file.
- Done AFTER rebuild so the snapshot captures the good state.
**Done:** export produces a JSON that round-trips to recreate the project; documented in STATUS.md.
**Commit:** `feat: project input export/snapshot persistence`

### Part 7 — Close
Archive brief to `archive/`, STATUS.md close-out (handover-ready), `current.md` repointed, single push.

---

## VERIFICATION (non-negotiable, falsifiable)
- Envelope-only balance endpoint returns **200**; heat-balance renders with/without ventilation.
- Calibrated EUI within **±2% of 180 kWh/m²/yr**.
- Fuel split ~**70% electricity / 30% gas**.
- Heat-balance signs: **internal gains → cooling demand; bedroom extract → heating demand**; stripping ventilation collapses heating and raises cooling.
- Export JSON round-trips to recreate the project (load into a fresh project, EUI matches within rounding).
- Four-way agreement (Engine / Live Results / Sankey / Profiles) on the headline EUI.

---

## WHAT MUST NOT HAPPEN
- Do not disable or alter the natural-ventilation/purge capability (only leave openings empty).
- Do not tune engine physics to hit 180 — reconcile via the explicit inferred base load only.
- No `npm install` pushed; no `node_modules`/`package-lock.json` changes.
- No BRUKL output figures used as inputs.
- No silent scope expansion — escalate instead.

---

## WHEN TO ESCALATE / STOP
- If the envelope-only fix needs more than the output-variable addition (i.e. the parser itself is wrong), stop and surface — diagnosis would then be incomplete.
- If calibration can't reach ±2% of 180 without distorting physics, stop and report the gap rather than forcing it.
- If `active/` or `current.md` disagree on the canonical brief, stop and ask before any work.
- After 3 approaches to any blocker, stop and escalate with what was tried.

---

## INDEPENDENT REVIEW TRIGGER
This brief touches the engine and produces correctness-invisible outputs (an EUI, a heat balance). Independent review is therefore **mandatory and proactive**: before close, Claude Chat reads the relevant source on GitHub (epJSON assembler + sql_parser State-1 path, and the rebuilt inputs) and checks against this brief's intent. The agent that built it does not grade it. Chris authorises the fix.

---

## CLOSE
`git mv` brief to `docs/briefs/archive/<NN>_..._COMPLETED.md`; STATUS.md close-out written for a stranger (what works, headline EUI, what's fragile, next steps); `current.md` repointed; single push.

---
*Source data: fabric/systems schedule (26002-NZA-XX-XX-SH-X-0010 v2), DHW calculator, small-power calculator, refrigerant workbook, 505 ventilation review. Figures confirmed with Chris unless marked "to confirm".*

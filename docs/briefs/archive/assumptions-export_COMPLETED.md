# Brief — Assumptions Export (single-sheet Excel)

**Repo:** NZA-Sim
**Land at:** `docs/briefs/active/assumptions-export.md` (first commit, before any code)
**Tier:** Standard. No design note — read-only export, no engine or schedule changes. Rationale below.
**Date:** 2026-07-14 · **Author:** Claude Chat (authorised by Chris)

---

## BEFORE DOING ANYTHING

- [ ] Confirm receipt: quote this brief's title and first paragraph back.
- [ ] Land this brief at `docs/briefs/active/assumptions-export.md` — Part 1's first commit. No code before this.
- [ ] Read `CLAUDE.md`, `STATUS.md`, and this brief in full.
- [ ] Session-start reconciliation: `ls docs/briefs/active/` · `cat docs/briefs/current.md` · `tail STATUS.md` · `git log --oneline -20`. If active/ holds a different brief or current.md claims one, STOP and surface before any work.
- [ ] Confirm clean tree and origin in sync.
- [ ] Branch: `chris/assumptions-export`.
- [ ] Read the existing inputs page and schedule modules before writing anything — the export must read the same state objects the inputs page reads, not a parallel copy.

---

## Goal

Add a one-click **"Export assumptions"** button to NZA-Sim that writes every model input assumption for the currently loaded scenario to a single Excel worksheet — fabric, internal gains, occupancy, DHW, and baseline system settings. One click, one file, one sheet, no profiles.

## Why this exists (intent — resolve ambiguity in this direction)

The HIEX Bridgwater CRREM report (26002-505-XX-XX-RP-X-1000) is being finalised **today**. Report page 3.5 ("Calibrating the Model") contains a Parameter / Datasheet value / Adjusted in-service value table that is currently all `[ ]` placeholders, and page 3.2 (Occupancy, Gains & Usage Profiles) asserts a bottom-up gains build-up. This export is the evidence behind both: it becomes the single auditable record of what the model assumed, exported once per scenario (baseline as-specified now; calibrated scenario later when it exists — same button, run twice, two files, two columns of the report table).

It is a **snapshot of inputs**, not a calculation workbook — so hard values are correct here, not live formulas. It must be a faithful readout of live model state: if the export and the inputs page ever disagree, the export is wrong.

Secondary intent: the export must **surface** the known schedule-drift discrepancy (inputs imply ~201 average concurrent occupants; the schedule emits ~330), not average over it or hide it. The export is a truth-telling instrument.

## Scope

**IN:**
- Export button on the inputs/overview page (follow existing UI conventions for placement and styling).
- Single `.xlsx`, single worksheet, generated client-side or via the existing API — whichever matches current project architecture.
- Parameters listed in the schema below.
- One derived line: schedule-realised average concurrent occupants (computed from the occupancy schedule exactly as the DHW engine consumes it).
- File naming: `nza-sim_assumptions_<scenario-name>_<YYYY-MM-DD>.xlsx`.
- Metadata stamp rows: scenario name, export timestamp, app version / git SHA if available.

**OUT — explicitly:**
- Hourly/weekly usage profiles (inputs only, per Chris).
- Any change to the occupancy schedule logic or the DHW engine (the 330-vs-201 drift bug and the 50 L/p/day default are a separate, already-scoped fix — do not touch).
- Creating the calibrated scenario itself.
- Charts, formatting beyond legibility, multi-sheet structure, import/round-trip.

## Design decisions already agreed

1. **Schema mirrors the report table.** Columns: `Category | Parameter | Value | Units | Basis/Source`. Categories and parameters:
   - **Building metadata:** GIA (m²); number of physical rooms; number of occupied rooms.
   - **Fabric:** U-values (walls, roof, ground floor, glazing); thermal bridging assumption; air permeability (m³/h·m² @50 Pa); glazing G-values; permanent openings / trickle vent equivalent area.
   - **Internal gains:** people per occupied room (peak input); sensible gain per person (W); latent gain per person (W); equipment/plug load assumption (W/m² or W/room — export in whatever unit the model stores); lighting load assumption.
   - **Occupancy (derived — flag as DERIVED in Basis column):** schedule-realised average concurrent occupants; annual occupant-hours.
   - **DHW:** litres/person/day; storage/tap temperature assumptions; gas/electric plant split settings as configured.
   - **Systems — baseline settings:** heating SCOP; cooling EER; heat recovery efficiency (HRV); specific fan powers (SFP) per fan system; `[CONFIRM with Chris: "FCAPs" from voice note interpreted as SCOPs/EERs + SFPs — if it means something else, e.g. fan capacities or F-factors, amend this block before starting]`.
2. **Values are hard values, not formulas.** Snapshot, not calc workbook. (NZA's blue/black/green live-formula convention applies to calculation workbooks, not input records — deliberate exception, agreed.)
3. **Export reads live state.** Same source of truth as the inputs page renders. No hardcoded values, no parallel config file.
4. **Scenario-stamped, run-per-scenario.** No baseline/calibrated dual columns in v1 — the two report columns come from exporting each scenario when both exist.
5. **The derived occupancy line is mandatory** and must come from the schedule pathway the engine actually uses, so the known drift is visible in the export.

## Principles / constraints

- If a listed parameter does not exist as a discrete input in the codebase, do NOT invent or hardcode it — record it in the escalation list and continue with the rest.
- Any new package: add to `package.json` only. **Never run `npm install` and push results; never push `package-lock.json` changes** (Bible rule — this cost a full day on PABLO). Flag the package to Chris to install locally.
- Follow existing state-access patterns; no refactors "while you're in there".
- Keep the sheet legible: bold header row, category grouping, column widths — nothing fancier.

## Parts (one commit each)

### Part 1 — Land brief + export data collector
- Commit 1a: this brief at `docs/briefs/active/assumptions-export.md`.
- Then: a pure function (e.g. `collectAssumptions(scenarioState)`) returning a structured array of `{category, parameter, value, units, basis}` rows covering the full schema, including the derived occupancy computation (reuse the engine's schedule aggregation — import it, don't reimplement it).
- Unit-level sanity: log the collected rows for the HIEX scenario; confirm every schema row present or escalated.
- Commit: `feat(export): assumptions collector with derived occupancy line`
- Done when: collector returns complete row set for the loaded scenario with no hardcoded values.

### Part 2 — XLSX generation + button
- Wire collector to xlsx generation; add the button; filename and metadata rows per scope.
- Commit: `feat(export): one-click assumptions xlsx export`
- Done when: clicking the button in the browser downloads a well-formed single-sheet xlsx for the loaded scenario.

### Part 3 — Verification + close
- Run the full verification block below in the browser; document results with numbers in `docs/audit/` (short note is fine — findings + the three check numbers).
- `git mv` brief to `docs/briefs/archive/assumptions-export_COMPLETED.md`; update `STATUS.md`; repoint `current.md`; push.
- Commit: `chore(export): verify + close assumptions-export brief`

## Verification (non-negotiable, falsifiable)

With the HIEX Bridgwater scenario loaded:
1. **Exact-match check:** every exported value equals the value shown on the inputs page, verified item-by-item in the browser. One mismatch = fail.
2. **Known-number tripwire:** the derived "schedule-realised average concurrent occupants" line must reproduce **≈330.6** (2,896,450 person·h ÷ 8,760 h), and sit alongside inputs implying 134 × 3 peak. If the export shows ~201 or ~402 instead, the collector is reading the wrong pathway — fail, do not "fix" by adjusting the schedule.
3. **File integrity:** file opens in Excel with no repair prompt; single sheet; metadata rows populated; filename matches convention.
4. Screenshot the button, the download, and the opened sheet in the audit note.

## What MUST NOT happen

- No changes to schedule logic, DHW engine, or any calculation pathway.
- No `npm install` results or lockfile pushed.
- No formula-based workbook; no hardcoded parameter values anywhere in the collector.
- No silent renaming of parameters — labels in the export match the inputs page vocabulary.
- No scope creep into the calibrated-scenario work or profile export.

## When to escalate / STOP

- A schema parameter has no discrete home in model state (list it; ask whether to omit or add an input — adding an input is out of scope without authorisation).
- The derived occupancy cannot be computed without importing engine internals in a way that risks side effects.
- The 330.6 tripwire fails and the cause isn't obvious after read-only diagnosis — report findings first (audit before fix).
- Any brief-on-disk mismatch at session start.
- Three failed approaches on anything — stop, report what was tried.

## Independent review

Standard tier: browser verification (above) + Chris's walkthrough — export the HIEX scenario and spot-check ~10 values against the inputs page and against the 505 workbooks. No fresh-eyes source review required (correctness is visible: every number is checkable on screen).

## Final report

Confirm: Parts committed and pushed · verification numbers (checks 1–3) · escalated parameters, if any · any divergence from this brief, however small, with one line on why (Lessons capture).

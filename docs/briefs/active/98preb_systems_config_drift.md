# Brief 98-pre-b: Fix systems_config Drift — One Source of System Truth for /api/simulate

**Prerequisite for Brief 98 P0 (paused) — the config layer must be trustworthy before any NZA-vs-EP table is built on it.**
**Grounding evidence:** `docs/audit/98pre_gas_heating_fix.md` (root-cause section) — read it.
**Canonical:** the two Brief 98 design notes. Bible rule: specifics with citation, or silence.

## The finding (from 98-pre, evidenced)
Two system configs coexist on a project:
- **`systems_config_v40`** — the rich config NZA-Sim's instant engine reads (correct: Bridgewater = VRF heating, VRF cooling).
- **`systems_config`** (simple) — what the main `/api/simulate` EnergyPlus reads. On Bridgewater it was **stale on both heating (said gas, should be VRF) and cooling** — the exact contradiction that produced the invalid-object fatal in 98-pre.

They drift because they're maintained separately: edits land on v40 (the UI path), the simple copy isn't kept in sync. **Consequence: any project whose v40 has been edited risks `/api/simulate` silently simulating the wrong systems.** This isn't demo-only — it undermines the "Run EnergyPlus" button for real client work, and it would silently corrupt Brief 98 P0's residual table.

## BEFORE DOING ANYTHING
1. Confirm receipt: quote the finding + Goal.
2. Branch `chris/fix-systems-config-drift` off fresh `main` **(merge PR #6 first — this builds on the 98-pre gas-heating fix).** Land this brief at `docs/briefs/active/98preb_systems_config_drift.md` as the first commit.
3. Read CLAUDE.md, STATUS.md, the 98-pre audit root-cause section, both design notes.
4. **NZA-Sim's instant engine is NOT touched.** `--fixture` anchors byte-identical (126.0 / 132.6) at start and close.

## Goal
Make `/api/simulate` read from a single source of system truth so it can never silently simulate stale systems. Either derive the simple `systems_config` from `systems_config_v40` at simulate time, or have the main sim read `v40` directly. End state: for any project, the systems EnergyPlus simulates are provably the systems NZA-Sim uses — no manual sync, no drift.

## Scope
**IN:** diagnose exactly where the two configs are written and why they diverge · choose the fix (derive-on-read vs read-v40-directly) with justification · implement it so `/api/simulate` always reflects v40 · prove it on report_baseline (VRF) and on at least one edited project · a migration/consistency check for existing projects carrying stale simple configs.
**OUT:** NZA-Sim engine changes · the second fatal (VRF-cooling node reconciliation — its own brief) · the 0.5 ACH infiltration default (measure-first, later) · Results UI · the P0 residual table (resumes after this).

## Decisions already agreed
1. **One source of truth = `systems_config_v40`.** It's the one the UI edits and NZA-Sim reads. The fix makes `/api/simulate` honour it — never the other way round (do not make v40 follow the stale simple copy).
2. Prefer **derive-on-read** (translate v40 → the simple shape at simulate time) IF the main sim genuinely needs the simple shape; prefer **read-v40-directly** if the generators can consume v40 without a translation layer. Implementer decides from the code, documents which and why.
3. Existing projects with stale simple configs must not silently keep simulating wrong — they get corrected or the stale field is ignored in favour of derived-from-v40.
4. Fixing the data flow so the sim reads true systems is in scope; changing what those systems *are* is not.

## Parts

### P1 — Diagnose the write/read paths
1. Land brief; confirm PR #6 merged; anchors intact.
2. Map it precisely: where is `systems_config` written, where is `systems_config_v40` written, which does `/api/simulate` read, and at what point they diverge. Cite files+lines.
3. Decide derive-on-read vs read-v40-directly; record the choice + justification in `docs/audit/98preb_config_drift.md`.
4. Commit: `Brief 98-pre-b P1: config write/read paths mapped + fix approach chosen`.
**Falsifiable:** the audit doc names every write site and the read site with file:line, and states the chosen approach with reasons.

### P2 — Implement single-source-of-truth
1. Implement the chosen fix so `/api/simulate` always reflects `systems_config_v40`.
2. Handle existing stale projects (derive-on-read makes this automatic; if not, add a consistency step).
3. Commit: `Brief 98-pre-b P2: /api/simulate reads from systems_config_v40 (single source)`.
**Falsifiable:** with v40 = VRF and a deliberately-stale simple config = gas, `/api/simulate` now simulates VRF (proven via the emitted epJSON heating/cooling objects), not gas.

### P3 — Prove + close
1. Run `/api/simulate` on report_baseline_v1 (VRF) → 0 fatal, systems = VRF. Then edit a project's v40 (e.g. swap a system) and confirm the next sim reflects the edit with no manual sync.
2. Record both runs' system objects in the audit doc.
3. `--fixture` anchors byte-identical (NZA-Sim untouched). STATUS, archive brief, current.md, push, PR open — NOT merged.
4. Commit: `Brief 98-pre-b P3: proven single-source on baseline + edited project`.
**Falsifiable:** two runs demonstrate the sim tracks v40; both anchors byte-identical; `.err` fatal = 0 on the VRF baseline.

## MUST NOT
Touch NZA-Sim's `instantCalc.js` or outputs · make v40 follow the stale simple config (truth flows one way) · change what the systems ARE (only which config the sim reads) · chase the second fatal or the 0.5 ACH default here · build Results UI · fake a sync that leaves drift possible.

## Escalate (stop-and-write)
The generators genuinely can't consume v40 and the simple shape carries data v40 lacks (document the gap — the translation may need real work) · a THIRD config source appears (the audit hinted cooling reads from a third place — if real, map it, may need its own fix) · fixing the read path would require NZA-Sim-side changes · 3-strikes on the sim accepting the derived config.

## Independent review (mandatory — engine data-flow, correctness-invisible)
Claude Chat reads on GitHub: the write/read path map, the chosen single-source mechanism, the proof that a v40 edit propagates to the sim, the stale-project handling, and confirmation NZA-Sim was untouched. The agent that fixed it doesn't grade it.

## Close
Archive · STATUS · current.md · PR open · then Brief 98 P0 resumes on a config layer that can no longer drift — the residual table it builds will reflect the true systems.

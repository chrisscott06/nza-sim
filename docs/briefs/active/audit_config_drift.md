# Audit Brief: systems_config Drift — Root Cause, Blast Radius, Fix Faithfulness

**Type:** Tier-2 read-only audit. **Changes nothing.** No code edits, no migrations, no fixes — findings only. Any fix that follows is a separate authorised brief.
**Why:** the EnergyPlus path was simulating a stale ("wrong") building because it read legacy configs the UI no longer writes. 98-pre-b fixed the read path (derive-on-read). Before EnergyPlus numbers go into a client-facing report, we need a documented, first-principles answer to three questions — not the builder's word. This is the evidence trail for an industry audience.

## BEFORE DOING ANYTHING
1. Confirm receipt: quote the three questions below.
2. Branch `chris/audit-config-drift` off main (PR #7 merged — confirm). Land this brief at `docs/briefs/active/audit_config_drift.md` as the first commit. This is the ONLY commit that changes files; everything else writes to the audit doc.
3. Read CLAUDE.md, STATUS.md, the two 98-pre audit docs, `nza_engine/systems_from_v40.py`.
4. **Read-only on all engine/config code.** No behaviour changes. If a fix is discovered as necessary, STOP-and-write — do not fix.

## Goal
Produce `docs/audit/config_drift_rootcause.md` answering three questions with evidence (git SHAs, file:line, DB query results):
1. **When and why did the two configs diverge?** Which commit stopped writing `systems_config` / `systems_config_v25` and moved to `systems_config_v40`? Was it a deliberate migration that orphaned the old columns, or an accident? How long has `/api/simulate` been reading stale data?
2. **What's the blast radius?** For every project in the DB, does the stored simple `systems_config` match what `derive_systems_for_sim()` produces from its v40? List which projects were drifted and by how much (which systems differ). Was any past EnergyPlus result produced against a stale building?
3. **Is the fix faithful across ALL fields, not just heating/cooling?** 98-pre-b caught one hidden-term omission mid-build (LPD collapse inflating lighting 15.7→68.8). Audit the derive for any OTHER field the simple config carries that v40-derive might drop or mis-map — enumerate every field the assembler reads from the simple config and confirm each is either correctly derived from v40 or correctly preserved from the existing config.

## Parts

### P1 — Divergence history (Question 1)
1. `git log` the write sites: `projects.py` around the `systems_config` column write, `epjson_assembler.py` around the v25 gates, and wherever v40 became the UI's write target. Find the commit(s) that shifted the write path.
2. Report: the SHA(s), date(s), the brief that did it, and whether the old columns were deliberately left as fallback or simply orphaned. State how long EP-via-`/api/simulate` has been reading stale systems.
3. Write findings to the audit doc. Commit: `Audit P1: config divergence history`.
**Falsifiable:** a dated commit trail in the audit doc; a clear "deliberate migration / accident" verdict with evidence.

### P2 — Blast radius (Question 2)
1. Read-only DB pass: for each project, compare stored `systems_config` (+ v25 gates) against `derive_systems_for_sim(v40)`. Tabulate: project id/name · drifted? · which services differ · magnitude.
2. Cross-check run history: were any recorded EP runs done against a now-known-stale config? (The 98-pre audit noted a 2026-04-03 gas-heating run — trace which config that used.)
3. Write the table to the audit doc. Commit: `Audit P2: drift blast radius across projects`.
**Falsifiable:** every project classified drifted/clean with the differing services named; any historically-stale EP run identified.

### P3 — Fix faithfulness across all fields (Question 3)
1. Enumerate every field the epJSON assembler reads from the simple `systems_config` (systems.*, the flat fallbacks, LPD/EPD, natural_ventilation, dhw_setpoint, sfp_override, pump_type, mode, v25 gates — all of them).
2. For each field, classify under the current derive: (a) correctly derived from v40, (b) correctly preserved from existing config, or (c) AT RISK — could be dropped or mis-mapped (like the LPD bug was). Any (c) is a finding.
3. Verify against a real run: derive for report_baseline_v1, diff the derived simple-config against what a faithful hand-build would contain; note any field that changed unexpectedly.
4. Write the field-by-field table to the audit doc. Commit: `Audit P3: derive faithfulness field audit`.
**Falsifiable:** a complete field table with every field classified a/b/c; zero (c) findings, or each (c) explicitly flagged for a follow-up fix brief.

### P4 — Close + verdict
1. Plain-English summary at the top of the audit doc: what happened, since when, who's affected, is it fixed. Written so Chris can quote it to an industry audience.
2. Verdict line: is the drift fully closed by 98-pre-b, or does any (c) finding need a follow-up fix brief?
3. STATUS, archive brief, current.md, push, PR open — NOT merged (this is documentation; Chris reads the audit doc, then decides on any follow-up).
**Falsifiable:** the audit doc opens with a quotable plain-English answer to all three questions; a clear fixed / not-fully-fixed verdict.

## MUST NOT
Change any engine/config/assembler code · run a migration · "fix" a drifted project · alter NZA-Sim · modify the derive (even if a bug is found — STOP-and-write instead) · touch fixtures.

## Escalate (stop-and-write)
A field-level (c) finding that means the derive is still unfaithful (report it; it gates trusting EP numbers) · evidence the divergence corrupted data beyond the systems config · a project whose v40 itself is wrong (that's upstream of this fix).

## Independent review
Chris reads the audit doc. If P3 finds any (c) field, Claude Chat reviews it on GitHub before a follow-up fix is briefed. No merge needed — the value is the document.

## Close
Archive · STATUS · current.md · PR open · the deliverable is `docs/audit/config_drift_rootcause.md` — the evidence trail behind "we found why EnergyPlus was simulating a stale building, here's the blast radius, here's the proof it's fixed."

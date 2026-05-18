# NZA SIMULATE — Project Rules

**Read this entire file before doing anything. These rules apply to every session, every task, every line of code.**

---

## What is NZA Simulate?

NZA Simulate is a web-based building energy simulation and analytics platform, powered by EnergyPlus. React frontend, FastAPI backend, SQLite database. It helps energy consultants define buildings parametrically, run EnergyPlus simulations, and present results through clear, stunning visualisations — load profiles, energy flow Sankey diagrams, fabric analysis, and scenario comparisons.

This tool is a sibling to Pablo (NZA's electricity cost analytics platform). It shares Pablo's design system, architectural patterns, and development philosophy.

---

## Environment

1. **Working directory:** `C:\Dev\nza-simulate` on Chris's machine. This is a local folder — NOT on OneDrive. The OneDrive copy rule is inherited from Pablo and is non-negotiable.
2. **Why not OneDrive:** OneDrive syncs `.git` internals and `node_modules` in the background, causing corrupted git objects, SQLite WAL desync, npm install failures, and ghost files. This is unfixable — these tools are fundamentally incompatible with OneDrive's sync. Do not suggest moving to OneDrive. Ever.
3. **Servers:** Backend runs on port 8002 (`python -m uvicorn api.main:app --host 127.0.0.1 --port 8002` from project root). Frontend runs on port 5176 (`npm run dev` from `frontend/`). Two terminal windows required. Ports are deliberately different from Pablo (8001/5175) so both tools can run simultaneously.
4. **Data files are local-only.** The `data/` folder (containing weather files, simulation outputs, and any SQLite databases) is in `.gitignore`. It does not exist on GitHub. If you clone the repo fresh, the backend creates an empty database on startup — but library items (constructions, system templates, profiles, weather files) will need to be re-ingested or copied from a working installation.
5. **npm install on Windows:** Use `npm install --force` if you get EBADPLATFORM errors on Windows.
6. **Launcher:** `C:\Dev\nza-simulate\go.bat` starts both servers and opens the browser. Double-click to run. This file is gitignored — it lives only on Chris's machine. Do not delete it. Do not modify it without asking Chris.
7. **EnergyPlus installation:** EnergyPlus must be installed locally. Default path: `C:\EnergyPlusV26-1-0\` (updated to V26.1.0 per Brief 30 Phase 0.3 schema lock 2026-05-18; previously V25-2-0). The backend reads the `ENERGYPLUS_DIR` environment variable, falling back to this default. Output:Variable names in the assembler + parser are confirmed valid for V26.1.0 — see `docs/audit/30_phase0_schema_lock.md` for the verified list.

---

## Non-negotiable technical rules

1. **EnergyPlus is the single source of truth for simulation results.** The backend generates epJSON, runs EnergyPlus, and parses the SQLite output. The frontend displays what the backend returns. No inline physics calculations in JSX files. No approximations that bypass the engine.
2. **Never generate synthetic data.** If a simulation hasn't been run, show an empty state. Do not create fake profiles, placeholder curves, or demo results. Do not use Math.random(). Empty is always better than fake.
3. **Library is the single source of truth for inputs.** Every construction, system template, occupancy profile, weather file, and schedule is a library item loaded via ProjectContext. No hardcoded U-values, no embedded schedules, no magic numbers. If a required library item is not assigned, the module shows an empty state — not defaults.
4. **Geometry schema is the contract.** The JSON geometry schema (documented in the project brief) is the boundary between any geometry input method and the epJSON generator. The generator consumes the schema without caring how it was produced. Do not bypass the schema by writing epJSON directly from UI state.
5. **Calculation engines live in `nza_engine/`.** All EnergyPlus input generation, simulation orchestration, and results parsing happens in Python in the `nza_engine/` directory. The API layer (`api/`) is a thin REST wrapper. The frontend calls API endpoints and renders results.
6. **Do not modify files outside your current task scope.** If the brief says "build the Sankey diagram," do not touch the 3D viewer, do not refactor the geometry generator, do not add components that weren't asked for. Stay in scope.

---

## Lessons from Brief 29 / Brief 30 (2026-05 audit)

These rules were learned the hard way during the May 2026 audit and dynamic-engine rebuild work. They supersede the earlier rules where they conflict — specifically Rule 1's "no inline physics in JSX" framing is refined by Rule 8 below (Static engines that are explicitly labelled as such may compute physics inline; code paths that claim to be the simulator's output may not).

7. **The Dynamic engine in any tool that wraps a slow authoritative simulator (EnergyPlus, IES, TAS, etc.) must consume that simulator's own outputs as the source of truth for displayed quantities.** If a layer between the simulator and the UI re-implements the calculation, that layer IS the engine, regardless of what the UI calls it. The wrapper's job is to request, read, aggregate, and display — never to compute physical quantities the simulator can produce. (Brief 29 Issue #8 / Bible lesson 1. **This refines Rule 1's intent:** inline physics is permitted in Static engines that are explicitly labelled as such; it is forbidden in code paths that claim to be the simulator's output.)

8. **State suppression in a multi-state model must remove the relevant objects from the simulation, not mute them via parameter widening.** "No systems" means no system objects in the model file. Muted setpoints, zero schedules, and disabled availabilities do not constitute suppression — the simulator's default behaviours in the muted state will contaminate the supposedly-suppressed result. (Brief 30 Principle 4.)

9. **Every term entering a demand integral, energy balance, or aggregate must appear as a line in the displayed breakdown.** Internal display consistency tests (display A = display B) are insufficient; the reconciliation must verify integrand-vs-display, not display-vs-display. Failing this invariant at any save/run point is a blocker bug. (Brief 29 Issue #6, raised to S3 in sign-off review. The Brief 28-IM-Polish POL-M3 `ReconciliationRow` shipped a display-to-display check that did NOT catch the door bug — both displays were missing the term in the same way. The replacement integrand-vs-display invariant is a Brief 30 Phase 1.4 deliverable.)

10. **Do not invoke exotic physical mechanisms (sky radiation, lumped-mass artefacts, CTF differences, "engine accuracy") to explain a number that violates basic building physics.** The gap is almost always a hidden integrand term, a display omission, or a wrong-topology assumption. Diagnose with instrumentation; do not defend with mechanism. Specifics with citation and magnitude, or silence. Banned phrases (extending the Brief 29 list): "radiative loss to sky lowering zone air temperature", "lumped 2-node mass artefact inflating demand by 30–60%", "T_zone swings below T_out on cold nights", "Dynamic uses CTF and Static uses 2-node so they're just different", "Dynamic is more accurate", "Static is more accurate", any unquantified appeal to "engine differences".

11. **Parameter binding at an API boundary can silently disable a feature without raising any error.** Every mode-like parameter in a request handler needs an integration test that verifies the parameter is honoured end-to-end, not just bound. (Brief 29 Issue #13 re-diagnosis / Bible lesson 2. FastAPI POST endpoints with `param: str = "default"` treat the parameter as query-string-only by default; JSON-body callers get the default silently. Mitigation pattern: use a Pydantic body model with `Body(default_factory=...)` plus query-param fallback, or be explicit with `Query(...)` annotation.)

12. **Default to rebuild, not refactor, when foundational assumptions have changed.** AI-built code is amenable to rebuild because the institutional knowledge lives in the briefs and the bible, not the code itself. Refactoring preserves the shape of the original (wrong) assumptions as interface constraints. Decline rebuild only when active dependencies would be broken in flight or when documentation cannot reconstruct what would be deleted.

13. **When a problem keeps having "the real root cause" turn out to be one level deeper than the previous diagnosis, the working assumption should be that more layers remain.** Continue diagnostic discipline; do not accept the latest plausible cause as final until the symptom is fully explained and verifiable from end to end. (Brief 29/30 multi-layer diagnostics / Bible lesson 3. The Issue #13 cascade: "lumped 2-node artefact" → "VRF + DSOA not muted by setpoints" → "API silently drops mode from JSON body" — three diagnoses, each more shallow than the next.)

---

## Process rules

1. **Read before you code.** At the start of every session, read this file, then STATUS.md, then the current task brief (`docs/briefs/current.md`). Confirm what you understand before touching any code.
2. **One part at a time.** Complete one part of the brief. Verify it in the browser. Commit it. Then move to the next part. Do not start Part 2 until Part 1 is verified and committed.
3. **Verification means evidence.** Every completed part must have:
   * A clean build (`npm run build` with zero errors)
   * Browser verification at 1440×900 of every affected page/tab
   * Number checks against expected values (if specified in the brief)
   * Sanity checks: Does the EUI fall within CIBSE TM54 benchmarks? Do surface areas in the 3D viewer match manual calculations? Do running hours make physical sense?
   * If you see smooth curves, perfectly round numbers, or physically impossible values (COP > 10, negative heating demand, pump running > 8760 hours) — something is wrong. Stop and investigate.
4. **Three strikes then escalate.** If a fix doesn't work, try up to 3 different approaches. If none work, stop. Describe the problem clearly: what you tried, what happened, what you think the options are. Do not keep guessing. The human will decide what to do next.
5. **No scope creep.** Do not add features, components, or "improvements" that weren't asked for in the brief. If you think something should be added, note it in STATUS.md under "Suggestions" — do not implement it.
6. **Sanity check your work.** After making changes, open the tool in the browser and interact with it. Do the numbers make sense? Does the 3D viewer match the inputs? Does changing a U-value change the heating demand? This basic check catches most problems.

7. **Documentation hygiene is part of the commit, not after it.** Every commit that closes a brief part, lands a fix, or changes architecture must update STATUS.md as part of the same commit, not as a queued follow-up. If "cleanup + STATUS.md" is in the todo list at the end of a commit, the commit is incomplete. Brief management (rename closed briefs to `*_COMPLETED.md`, move to `archive/`, update `current.md`) is part of the same discipline. (Brief 31 documentation reconciliation, May 2026 — documentation drift across Briefs 26–30 was caught only by post-hoc human verification; this rule exists to prevent recurrence.)

8. **Verify documentation alignment at the start of every session.** Read STATUS.md and CLAUDE.md against the actual state of `docs/briefs/active/` and recent commits. If they diverge, the first commit of the session is the reconciliation. Do not begin new work against an inaccurate self-description of the project. (Brief 31, May 2026.)

9. **Multi-step work is briefed, not commanded.** Any task that touches more than one file or takes more than one commit is written as a numbered brief in `docs/briefs/active/` before work begins. The brief contains a BEFORE-DOING-ANYTHING checklist, numbered Parts with file paths and verification steps, and a "deliverables" section that includes documentation updates as numbered Parts (not as advisory text). Mid-chat instructions that span multiple files/commits without a brief are incomplete and should be returned to the architect for proper briefing. (Brief 30 / Brief 31, May 2026.)

---

## Git and backup rules

1. **Commit after every completed part.** Each commit should have a descriptive message: "Part 1: Geometry generator produces valid epJSON for rectangular buildings" not "updates" or "fixes."
2. **Push to GitHub after every merge to main.** Not at the end of the session — after every merge. If the session crashes, the work is safe on GitHub.
3. **If a merge conflict occurs, stop.** Describe the conflict clearly. Do not force-resolve, do not force-push, do not rebase without asking the human first.
4. **Banned git commands.** Never run these without explicit permission from Chris:
   * `git clean` (deletes untracked files — this WILL destroy the data folder)
   * `git reset --hard` (discards all uncommitted changes)
   * `git push --force` or `git push -f` (rewrites remote history)
   * `git rebase` (rewrites history — merge instead)
   * Any command that deletes or moves files in `data/` or `projects/`

---

## Data safety rules

1. **The `data/` directory contains weather files, simulation outputs, and the database.** It is NOT in git. If it is deleted, the data is gone.
2. **Before any risky operation, back up the database.** Copy the database file to a timestamped backup. Risky operations include: npm install, package upgrades, any script that writes to the database, any migration or schema change.
3. **Never run `rm -rf`, `del /s`, or recursive delete commands** anywhere near the project root or data directory.
4. **EnergyPlus simulation outputs are ephemeral.** They live in `data/simulations/{run_id}/` and can be regenerated by re-running the simulation. The library items and project configuration are what matter.

---

## Brief management

1. **Active brief:** `docs/briefs/current.md` — this is always the brief being worked on right now.
2. **Brief archive:** When a brief is completed, rename it to `docs/briefs/archive/NN_Title_COMPLETED.md` and copy the next brief to `current.md`.
3. **Brief numbering:** `00_project_brief.md` is the master project brief (permanent reference). Task briefs start at `01`.
4. **Brief format:** Every brief follows the standard structure — BEFORE DOING ANYTHING checklist, context paragraph, numbered parts, each part with file paths, commit message, and verification steps.

---

## Status tracking

After completing each part, update STATUS.md with:

* **Last completed:** What was just finished
* **Current state:** What's working, what's not
* **Next task:** What the brief says to do next
* **Known issues:** Anything broken or suspicious
* **Suggestions:** Ideas for improvements (do not implement — just note them)
* **Safety checks:** Worktree list, main branch status, push confirmed

---

## What not to touch (unless the brief explicitly says to)

This list will be updated as we confirm which parts of the codebase are stable:

* The geometry JSON schema (once established)
* The epJSON generator core logic (once verified against EnergyPlus)
* ProjectContext and library data flow infrastructure
* The design system (colours, typography, component styles)
* The sidebar, routing, and navigation shell

---

## Reference documents

* **Project brief:** `docs/briefs/00_project_brief.md` — full scope, architecture, and design decisions
* **Pablo design system:** `docs/pablo_design_system_reference.md` — colour palette, typography, component patterns to inherit
* **EnergyPlus documentation:** https://energyplus.readthedocs.io/en/latest/

---

## When something contradicts these rules

If a task brief asks you to do something that conflicts with this file, **this file wins.** Flag the contradiction to Chris and wait for a decision. These rules exist because we learned the hard way what happens without them.

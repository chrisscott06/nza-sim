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
7. **EnergyPlus installation:** EnergyPlus must be installed locally. Default path: `C:\EnergyPlusV25-2-0\` (update if version changes). The backend reads the `ENERGYPLUS_DIR` environment variable, falling back to this default.

---

## Non-negotiable technical rules

1. **EnergyPlus is the single source of truth for simulation results.** The backend generates epJSON, runs EnergyPlus, and parses the SQLite output. The frontend displays what the backend returns. No inline physics calculations in JSX files. No approximations that bypass the engine.
2. **Never generate synthetic data.** If a simulation hasn't been run, show an empty state. Do not create fake profiles, placeholder curves, or demo results. Do not use Math.random(). Empty is always better than fake.
3. **Library is the single source of truth for inputs.** Every construction, system template, occupancy profile, weather file, and schedule is a library item loaded via ProjectContext. No hardcoded U-values, no embedded schedules, no magic numbers. If a required library item is not assigned, the module shows an empty state — not defaults.
4. **Geometry schema is the contract.** The JSON geometry schema (documented in the project brief) is the boundary between any geometry input method and the epJSON generator. The generator consumes the schema without caring how it was produced. Do not bypass the schema by writing epJSON directly from UI state.
5. **Calculation engines live in `nza_engine/`.** All EnergyPlus input generation, simulation orchestration, and results parsing happens in Python in the `nza_engine/` directory. The API layer (`api/`) is a thin REST wrapper. The frontend calls API endpoints and renders results.
6. **Do not modify files outside your current task scope.** If the brief says "build the Sankey diagram," do not touch the 3D viewer, do not refactor the geometry generator, do not add components that weren't asked for. Stay in scope.

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

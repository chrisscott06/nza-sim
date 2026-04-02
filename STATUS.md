# NZA SIMULATE — Status

## Last completed

Project scaffolding — CLAUDE.md, STATUS.md, folder structure, .gitignore, project brief, Pablo design system reference.

## Current state

* Repo structure created, no code yet
* CLAUDE.md rules established (adapted from Pablo)
* Project brief committed as `docs/briefs/00_project_brief.md`
* Pablo design system reference committed as `docs/pablo_design_system_reference.md`
* No frontend, no backend, no EnergyPlus integration yet

## Next task

Brief 01: Phase 1 Foundation — Backend can generate valid epJSON from parametric inputs, run EnergyPlus, and return parsed results.

## Known issues

* EnergyPlus not yet installed / path not confirmed on Chris's machine
* Weather file (Manchester EPW for Bridgewater) not yet sourced
* go.bat not yet created (Chris to set up locally)
* Ports 8002/5176 chosen to avoid conflict with Pablo — confirm these are free

## Suggestions

* Source the Bridgewater Hotel dimensions and orientation from 505 Group site survey data before starting Phase 1
* Confirm EnergyPlus version to target (25.2.0 is latest stable as of April 2026)
* Consider whether Bridgewater HH data from 505 Group can be used for model calibration in Phase 4

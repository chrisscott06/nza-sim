# Brief 34 — Simplify Permanent Openings UI

> **Repo front matter (Brief 34 Part 1 commit 2026-05-18):**
> **Progress:** Part 1 in flight (this commit) — per-facade type / dimensions / resistance UI replaced by a single building-wide C_d slider. The `computeCd` helper stays in `openingCoefficients.js` as a code utility (still referenced by the methodology doc). Bridgewater migrated to `cd = 0.2324` (area-weighted mean of the two facades' Brief 33 Part 2 derived values).
> **Authorised:** 2026-05-18 by Chris.

---

**Author:** Claude Chat (architect)
**Authorised by:** Chris Scott
**Status:** Active.
**Date opened:** 2026-05-18
**Target outcome:** The Permanent Openings panel exposes one user control for C_d (a global slider) and one for C_w (the existing Site exposure dropdown). The per-opening geometry calculator stays in code as a utility but is no longer wired to the UI.

---

## BEFORE DOING ANYTHING

1. Read this entire brief.
2. Read CLAUDE.md.
3. Read STATUS.md as currently on disk; confirm last entry is Brief 33 Part 2 (commit `c6a415b`).
4. Confirm working tree clean: `git status --short`.
5. Confirm `origin/main == local main`: `git fetch origin && git log origin/main..main && git log main..origin/main` both return empty.
6. Do not begin Part 1 until all five checks pass.

---

## Scope statement

This brief touches the Building module only. The Building module is envelope-only per CLAUDE.md "Module scopes" (forthcoming in Brief 33 Part 3, but the principle already governs Building's behaviour). No systems, no operation, no mechanical anything. Permanent vents remain passive envelope openings, wind-driven.

This brief is a UI simplification, not a physics change. The flow correlations (`cross` and `single_sided`), the wiring through `withMode`, and the engine's reactivity to input changes (all delivered in Brief 33 Part 1 / Finding 1 / Part 2) remain unchanged.

---

## Context

Brief 33 Part 2 introduced per-opening geometry-aware C_d. Each opening has a `type` (orifice / slot / louvre / trickle_vent / fixed_grille), dimensions, and resistance features (mesh / flap / acoustic baffle). The UI exposes all of these on the Permanent Openings panel, per facade.

This is too much UI for a tool at this level of fidelity. The Building module is for rapid pre-feasibility, not detailed design. A user comparing scenarios cares about "what if the vents were leakier" — not "what if F1 had mesh + flap but F3 had just mesh." The detailed calculator implies a precision that the rest of the model doesn't have, and it clutters a panel that most buildings barely use (most non-domestic buildings don't have trickle vents to this extent).

Simplify to two controls:

- **C_d** — one global slider, 0.15 to 0.65, labelled with anchor points at canonical opening types (trickle vent, louvre, open window). Default 0.25 — typical for the trickle-vent case Bridgewater represents. User adjusts if needed.
- **C_w** — the existing Site exposure dropdown (Sheltered / Normal / Exposed). Already fine; no change.

The geometry calculator (`computeCd` in `openingCoefficients.js`) stays in code as a reference utility. Not wired to the UI. If someone wants to reinstate geometry-aware derivation later, the calculator is there.

---

## Principles

1. **No physics changes.** Flow correlations and the engineering correction on `single_sided` (the `min(1.0, C_d/0.6)` factor from Brief 33 Part 2) stay as-is. C_d enters the calculation the same way; it's just sourced from a single user-input value instead of a per-opening derivation.
2. **Provenance preserved.** The slider shows its current value clearly. Anchor labels along the slider make the typical-value mapping visible. C_w continues to show its derivation from the Site exposure dropdown.
3. **Per-facade opening area stays.** Area per facade is the meaningful physical input. The simplification removes type/dimensions/resistance UI, not the area sliders.
4. **No dead code.** `computeCd` in the codebase is allowed to remain as a utility (could be useful later) but everything that *only* exists to wire it to the UI is deleted. No commented-out blocks. No "for future use" UI components left hanging.

---

## Parts

### Part 1 — Replace per-facade geometry UI with a single C_d slider

**Files touched:**
- `frontend/src/components/modules/building/BuildingDefinition.jsx` — replace the per-facade `Type / Dimensions / Resistance / Derived C_d` rows with a single building-wide C_d slider
- `frontend/src/context/ProjectContext.jsx` — replace the per-opening `type`, `internal_resistance`, `width_mm`, `height_mm` fields with a single building-wide `cd` field (default 0.25)
- `frontend/src/utils/instantCalc.js` — read `building_config.openings.cd` instead of calling `computeCd(opening)` per facade
- `frontend/src/utils/instantCalc.js` — `withMode` `passThroughOpenings` / `passFace` — update the allowlist to pass through the new `cd` field and remove the now-unused `type`, `internal_resistance`, `width_mm`, `height_mm` field allowlists
- `scripts/34_simplify_cd_migration.py` (new) — idempotent migration: read each project's existing per-opening C_d derivations, take the mean (or just default to 0.25 if not present), set as the building-wide `cd`. Strip the per-opening geometry fields.
- `docs/audit/29_permanent_vent_methodology.md` — note that the tool exposes a single user-input C_d slider; the geometry-based derivation tables remain in the doc as reference for users who want to look up appropriate values manually
- `frontend/src/utils/openingCoefficients.js` — leave the file as-is. It remains a utility. Add a header comment noting it is no longer wired to the UI as of Brief 34, with a reference back to this brief.

**Steps:**

1.1 Add a global `cd` field to `DEFAULT_PARAMS.openings` in `ProjectContext.jsx`, default `0.25`. Remove the per-opening `type`, `internal_resistance`, `width_mm`, `height_mm` defaults.

1.2 In `BuildingDefinition.jsx`, replace the per-facade geometry block with a single building-wide slider control near the top of the Permanent Openings panel, immediately below the Flow topology dropdown:

```
C_d (discharge coefficient)
[slider: 0.15 ───●─── 0.65]        Current: 0.25
              0.25      0.40        0.60
           Trickle    Louvre       Open
            vent                  window
```

The anchor labels are visual guides along the slider track, not separate inputs. Hovering over an anchor label shows a tooltip with the typical use case ("0.25 — trickle vent with mesh and flap (typical)"). The current value displays as a numeric readout to two decimal places next to the slider.

The slider step is 0.01. The slider value is the building-wide C_d applied to every facade that has a non-zero opening area.

1.3 In `instantCalc.js`, replace the per-opening `computeCd(opening)` calls in `_calculateEnvelopeOnly` with a read of `building_config.openings.cd`. The `single_sided` engineering correction stays — `Q = 0.025 · A · v_wind · min(1.0, cd / 0.6)`. The `cross` correlation uses `cd` directly per `Q = cd · A · √Cw · v_wind`.

1.4 In `withMode`'s `passThroughOpenings` / `passFace`, update the allowlist: pass through `cd` at the building-openings level. Remove `type`, `internal_resistance`, `width_mm`, `height_mm` from the per-facade allowlist.

1.5 Apply the same substitution to `_calculateState2` and `calculateInstantDegreeDay` if those still have per-opening `computeCd` calls from Brief 33 Part 2's coverage. (Brief 33 Part 2's report said they did. Same pattern: read `cd` once, use it.)

1.6 Author `scripts/34_simplify_cd_migration.py`:

- For each project under `projects/`, read its `openings` config
- If it has per-facade `type` / `internal_resistance` / `width_mm` / `height_mm`: compute the would-be C_d via `computeCd` for one facade, set that as the new building-wide `cd`. If multiple facades disagree, take the area-weighted mean. Strip the per-facade geometry fields.
- If it has no per-facade geometry: set `cd` to the default `0.25`.
- Idempotent — re-running on an already-migrated project is a no-op.
- Run it. Confirm Bridgewater's `cd` is approximately `0.23` (matching the Brief 33 Part 2 derivation), and that the per-facade geometry fields are gone.

1.7 Update `openingCoefficients.js` header comment:

```javascript
// Discharge coefficient lookup tables and resistance multipliers for
// passive envelope openings. Sources: CIBSE Guide A §4.6 Table 4.20;
// AIVC Technical Note 32; BS EN 16798-7.
//
// NOTE: As of Brief 34, the UI exposes a single user-input C_d slider
// instead of deriving C_d per opening from geometry. This file remains
// as a utility — the methodology doc continues to reference the lookup
// tables for users who want to choose an appropriate slider value
// manually. If geometry-aware derivation is reinstated in future, the
// hooks are here.
```

1.8 Update `docs/audit/29_permanent_vent_methodology.md` to add a short note at the head of the C_d section: "The tool's UI exposes a single user-input C_d slider per building. The geometry-based lookup tables below remain as a reference for users choosing an appropriate slider value. Anchor labels on the slider correspond to canonical opening types from this table."

1.9 Build clean. Browser walkthrough at 1440×900:

- Permanent Openings panel shows: Flow topology dropdown, Site exposure dropdown with C_w provenance, C_d slider with anchor labels, per-facade area sliders. No type dropdown, no dimensions input, no resistance checkboxes, no per-facade derived C_d display.
- Slider default is 0.25 for new projects; Bridgewater shows ~0.23 (migrated value).
- Dragging the slider changes the permanent vent number on Heat Balance reactively.
- Switching Flow topology between `single_sided` and `cross` produces different numbers (Brief 33 Finding 1 fix still works).
- Switching Site exposure on `cross` produces different numbers (Brief 33 Finding 1 fix still works).
- Setting the slider to 0.60 produces visibly higher vent loss than 0.25.

**Verification:**
- Build clean, zero errors
- Grep returns zero matches for `internal_resistance` or `trickle_vent` in `BuildingDefinition.jsx` and `ProjectContext.jsx` (computeCd's internal references are allowed to remain in `openingCoefficients.js`)
- Bridgewater's `cd` is ~0.23 post-migration
- Slider drives Heat Balance reactively
- All Brief 33 reactivity (flow_mode, site exposure) still works

**Commit message:**
```
Brief 34: Simplify Permanent Openings UI to single C_d slider

Replaces per-facade type / dimensions / resistance UI with one
building-wide C_d slider, default 0.25, range 0.15–0.65, with anchor
labels at canonical opening types (trickle vent, louvre, open window).

The geometry calculator (computeCd in openingCoefficients.js) remains
as a utility but is no longer wired to the UI. The methodology doc
continues to reference the lookup tables as a manual reference for
users choosing an appropriate slider value.

Bridgewater migrated from per-facade derivation (C_d ≈ 0.23) to a
single C_d = 0.23. No physics changes.

Closes the over-precision concern raised after Brief 33 Part 2 walkthrough.
```

**STATUS.md update in same commit:** Brief 34 entry. Note that the Building module is now considered structurally complete for Static; next briefs target the other Static modules or the Dynamic rebuild per Chris's direction.

---

## Final report (paste in chat after Part 1)

1. New origin/main HEAD SHA
2. Bridgewater permanent vent number on Heat Balance (with the migrated C_d ≈ 0.23 and `single_sided` flow mode)
3. Confirmation that the slider drives the number reactively
4. Confirmation that Flow topology and Site exposure dropdowns still drive the number reactively (Brief 33 Finding 1 fix preserved)
5. Confirmation that grep returns zero matches for `internal_resistance` or `trickle_vent` in `BuildingDefinition.jsx`

---

## What MUST NOT happen in this brief

- No changes to flow correlations or the engineering correction on `single_sided`
- No reintroduction of `balanced_mechanical`, `mech_extract`, or any systems concept into the Building module
- No deletion of `openingCoefficients.js` (it stays as a utility)
- No touches to `sql_parser.py`, `epjson_assembler.py`, or simulation API (Dynamic remains paused)

## When to escalate

- If the simplification breaks Brief 33 Finding 1's wiring (dropdowns no longer driving the number) — pause and report
- If the migration produces wildly different C_d values for Bridgewater than the Brief 33 Part 2 derivation (~0.23) — pause and report
- If at any point the panel reintroduces visual complexity beyond "Flow topology, Site exposure, C_d slider, per-facade area" — pause and report

## Standing by for authorisation to begin Part 1.

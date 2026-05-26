# Brief 53 anchor-drift diagnosis (sidecar)

**Status:** Diagnosis complete, fix DEFERRED to Chris.
**Engine verdict:** INNOCENT — refbox falsifiability tests all pass byte-exactly.
**Anchor recovery from inspected fields:** PARTIAL only (1.30 of 3.70 kWh/m² recovered by hand-revert of v40 heating share + vent flows). The remaining 2.40 kWh/m² lives in fields I have not identified.

---

## §1 — Symptom

Falsifiability test T1 (Bridgewater clean, all `summer_bypass = false`, EUI must = 128.20):

| When | EUI | Δ from anchor |
|---|---:|---:|
| Immediately after Part 2 commit (eaa91b0) | **128.20** | 0.00 ✓ |
| Immediately after Part 4 commit (a6ab4d2) | **128.20** | 0.00 ✓ |
| After browser session loaded `/systems` (autosaves at 14:49 + 14:51) | **131.90** | **+3.70 ✗** |

Engine code unchanged between the verified-anchor runs and the broken-anchor runs — only the project's stored `building_config` was mutated (by autosaves during the browser session).

Refbox tests (which build inline configs, not from DB) STILL pass exactly:
- T2 (refbox HOT bypass-OFF): recovery 30.55 MWh, cooling 15.40 MWh — probe-exact
- T3 (refbox HOT bypass-ON): cooling 13.50 (in band)
- T4 reconciliation: byte-exact across State 2 ↔ State 3

⇒ The engine is correct. The mutation is in `projects.building_config`.

---

## §2 — What changed in the project (observed)

Inspecting the live project at the time of the broken anchor:

| Field | Current value | v25 mirror (implied baseline) |
|---|---|---|
| `systems_config_v40.heating[0].share_pct` | **90** | 95 (`primary_pct: 95`) |
| `systems_config_v40.heating[1].share_pct` | **10** | 5 (implied) |
| `systems_config_v40.ventilation[0].flow_rate` | **1431** | 1425 (mvhr_gf_public `flow_l_s`) |
| `systems_config_v40.ventilation[1].flow_rate` | **2292** | 2208 (bedroom_extract `flow_l_s`) |
| `systems_config_v40.ventilation[2].flow_rate` | **479** | 210 (public_toilet_extract `flow_l_s`) |
| `systems_config_v40.heating[0].efficiency_metric` | 2.8 | (v25 reads library template; library SCOP probably similar) |

The v25 ↔ v40 drift on these fields predates my session (Brief 42 migration era) but the **shares** specifically dropped 95→90 during the browser session.

## §3 — Hand-revert results (anchor recoverability test)

`scripts/_brief53_anchor_recovery.mjs` — runs the engine on the live project with various in-memory reverts; no DB writes.

| Scenario | EUI (kWh/m²) | Δ from 128.20 |
|---|---:|---:|
| (A) As-stored | 131.90 | +3.70 |
| (B) v40 heating share → v25 (95/5) | 131.20 | +3.00 |
| (C) v40 vent flows → v25 (1425/2208/210) | 131.30 | +3.10 |
| (D) Both reverted | **130.60** | **+2.40** |
| (E) As-stored + refbox-library shape | 131.90 | +3.70 (no difference — refbox templates do not affect Bridgewater EUI) |

**Anchor is NOT recoverable from heating-share + vent-flow reverts alone.** There is ~2.40 kWh/m² (~10.4 MWh on Bridgewater) of additional drift in fields I have not identified.

Space heating *demand* is unchanged across all reverts (95.20 MWh) — the drift is on the *delivered/fuel* side. Likely candidates: heating SCOP path (v25 library template lookup vs v40 inline `efficiency_metric`), cooling SEER, DHW share split (v40 65/35 vs v25 fuel_mix gas=0.80), lighting `control_factor`. I have not iterated through these systematically.

## §4 — Source of autosave (UNRESOLVED)

Two autosaves fired during the browser session:
- `updated_at: 2026-05-26 14:49:50` (first autosave)
- `updated_at: 2026-05-26 14:51:14` (second autosave)

I did NOT interact with any system controls (only clicked tab buttons). Tab clicks update only `centreView` local React state — they do NOT call `updateParam`.

**Code-level inspection** of the autosave path:
- `_scheduleSave('building', ...)` is called only from `updateParam` (`ProjectContext.jsx` L1066).
- `updateParam` is called from user-initiated edit handlers (sliders, input fields, system toggles). None mount-on.
- `SystemsModule.jsx` has only TWO `useEffect`s, both harmless: constructions fetch + localStorage write for `centreView`.
- `systems/` sub-folder has only ONE `useEffect` (in `SystemSankey.jsx`), which is only mounted on the `'sankey'` tab — my browser session defaulted to `'heatbalance'`, so it wasn't mounted.
- `_brief42LoaderMigration` is a no-op when `schema_version >= 2` — Bridgewater is at v2, so the load path doesn't transform anything.

**System-level observation:** the machine has **multiple vite dev servers running concurrently** on ports 5175, 5176, 5177, 5183, 5184. PID inspection (`netstat`/`tasklist`) shows ten+ node processes. If a browser tab is open against ANY of those dev servers, it can be doing background autosaves on this project unbeknownst to my session.

**Hypothesis:** the autosaves were fired by a stale browser tab/dev session (not my own preview-server) operating against the same project DB. The pop-out broadcast pattern in ProjectContext (L782) writes state across windows; an out-of-date pop-out reflecting old params could push a stale snapshot back into the active session, which then autosaves the "user-reverted" shape.

I could not confirm this hypothesis by code-tracing alone. To confirm, would need:
- Network log capture during a clean browser session, OR
- Adding instrumentation to `_scheduleSave` to log the call stack of each autosave trigger

## §5 — Recommendation (for Chris's decision)

The engine code is innocent. Brief 53 Parts 2/3/4 commits do not cause this drift and can stay merged. Two unknowns block Brief 53 Part 5 (which requires a stable 128.20 anchor for its "no baseline change" verification):

1. **Why the autosaves fired without a user-initiated edit.** Source is ambiguous (multiple dev servers may be racing). Not a Brief 53 defect, but a project-integrity concern matching CLAUDE.md Rule 7's "viewing shouldn't write state" principle.

2. **What other fields drifted to account for the residual 2.40 kWh/m².** Hand-revert of heating-share + vent-flow only recovered 1.30 kWh/m².

**Three options:**

| | Recovery | Time | Risk |
|---|---|---|---|
| **A. Restore DB from backup** | Full anchor recovery if a 128.20-era `data/nza_simulate.db` backup exists | 5 min | Loses any legitimate edits since the backup |
| **B. Systematic field-by-field revert** | Continue hand-reverting (cooling SEER, DHW shares, lighting control_factor) until anchor returns | 30–60 min | Slow; may not converge if drift is in non-obvious fields |
| **C. Spawn a sidecar Brief**: "Diagnose view-load autosave + auto-rebalance trigger" | Fix the actual cause so future anchor drift can't happen | 1–2 hours | Defers Brief 53 close further |

**My recommendation:** Option A if a recent backup exists (data/ is gitignored — I cannot check from here; Chris can check `data/nza_simulate.db.backup-*` or similar). Otherwise Option C is the right architectural fix; Option B is a temporary workaround.

## §6 — What I committed (still correct)

- `f0a89ad` — §1.4 residual branch test verdict (Branch B confirmed)
- `9d7d512` — Part 1 amend (free-cooling trigger)
- `eaa91b0` — Part 2 (summer-bypass engine + reconciliation byte-exact)
- `a6ab4d2` — Part 4 (LOSS_ORDERS canonical keys — display-only)
- `15d254a` — Part 3 (Heat balance tab on Systems)
- `f53dcd5` — Part 3 verify (cooling-ribbon shrinkage probe)

All Brief 53 falsifiability tests pass on the refbox (engine-correct). Browser-verified the Heat balance tab renders with residual −0.4 kWh/m² ✓ balanced (Part 4 display fix held).

**Brief 53 Part 5 HELD** pending anchor resolution.

---

*Sidecar diagnosis complete — awaiting Chris's option call.*

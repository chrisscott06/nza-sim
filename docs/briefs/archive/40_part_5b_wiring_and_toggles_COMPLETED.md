# Brief 40 Part 5b — Wiring fix and enable toggles ✅ CLOSED

**Status:** ✅ closed 2026-05-19. All three Sections shipped + browser walkthrough 15/15 PASS.

**Closing commits:**
- Section A — engine-side v40 displacement + share validation + --force migration: `e0dd1af`
- Section B — per-system + per-service enable toggles: `b3838cd`
- Section C — browser walkthrough 15/15 PASS via Claude in Chrome MCP: `fb2e439`
- Brief 40 close (this archive): see Brief 40 close commit

**Outcome:**
- Bridgewater EUI dropped 116.9 → 83.8 kWh/m²·yr (−28%) on first --force migration, entirely from DHW tap-mix correction surfacing in headline via Option A engine-side displacement
- DHW ratio 224.2 / 373.7 = 0.600 exactly — audit §4.3 falsifiable target met
- Heating SCOP 5.12 → 2.5 produces +16.1 MWh electricity (hand-calc exact)
- Per-system + per-service enable toggles working end-to-end
- 10 of 15 walkthrough items STRONG PASS with exact hand-calc verification
- 3 minor findings logged (DHW validation-zero-demand, small_power empty array, lighting label quirk) — none block close

**Verification audit doc:** `docs/audit/40_walkthrough_diagnosis.md` §12 carries the full 15-item walkthrough report.

**Brief was authored by Claude Chat (architect), dropped via Downloads 2026-05-19. Folded into archive at Brief 40 close.**

---

## Original brief content (verbatim, for archival completeness)

---

# Brief 40 Part 5b — Wiring fix and enable toggles

**Author:** Claude Chat (architect)
**Authorised by:** Chris Scott
**Status:** Active. Extension to Brief 40 — addresses the walkthrough finding that the new UI sliders don't affect engine output, plus the missing per-system enable toggle.
**Date opened:** 2026-05-19
**Target outcome:** Editing a system in the new Brief 40 left panel produces a visible change in EUI, Sankey, and Live Results — within the same render cycle. Each system has an on/off toggle. Each service has a batch on/off toggle. After this Part lands, Chris can open Systems, toggle a heat pump off, watch the gas boiler take 100% of demand, and see the EUI and fuel split move accordingly.

This is one of two Parts addressing walkthrough findings. Part 5c (pop-out refactor for left panel UX) follows after 5b walkthrough confirms wiring works.

---

## BEFORE DOING ANYTHING

1. Read this entire brief.
2. Read CLAUDE.md end to end. Particularly Rule 14 (envelope parity — unlikely to fire here but check) and Process Rules 7 (documentation hygiene), 10 (scope statement), 11 (stop dev server before migrations).
3. Read STATUS.md as currently on disk; confirm last entry is Brief 40 Part 5 (commit `71598d1` or later).
4. Read `docs/audit/40_systems_library_schema.md` end to end — this brief extends its schema with the `enabled` field.
5. Read `docs/audit/40_walkthrough_diagnosis.md` if it was produced. If not, this brief incorporates the diagnosis inline.
6. Read the current state of `frontend/src/utils/systemsEngine.js` and `frontend/src/utils/instantCalc.js` `_calculateState3` around line 4018 (the v25 fallback point) and the `consumption.brief40` attachment point.
7. Read the current state of `frontend/src/components/modules/systems/SystemsModule.jsx` and `frontend/src/components/modules/systems/SystemEditorCard.jsx` (or wherever the per-system editor lives in the post-Part-3 rewrite).
8. Confirm working tree clean: `git status --short`.
9. Confirm `origin/main == local main`.
10. Do not begin Part 5b until all nine checks pass.

---

## Scope statement

This brief touches:
- **`systemsEngine.js`** — Option A engine-side displacement (v40 drives the consumption block for a service when populated for that service); engine respects `enabled` flag.
- **`instantCalc.js`** — the displacement logic that decides v25 vs v40 per service in `_calculateState3`; possibly the `consumption.{service-block}` assembly.
- **`scripts/40_bridgewater_systems_migration.py`** — `--force` flag.
- **`docs/audit/40_systems_library_schema.md`** — schema update for `enabled`, mathematics update for share validation, walkthrough diagnosis backfill.
- **`SystemsModule.jsx` + `SystemEditorCard.jsx`** (or equivalent) — per-system toggle, per-service batch toggle.
- **`DEFAULT_PARAMS`** in `ProjectContext.jsx` — default `enabled: true` for seeded systems.
- **`withMode.js`** allowlist — add `enabled` field per system per the ALLOWLIST DRIFT discipline.

Per CLAUDE.md "Module scopes" Systems section (expanded in Brief 40 Part 1), this work stays inside the Systems module's concerns. No envelope physics touched. Rule 14 unlikely to fire — but the brief includes a check.

---

## Operational mode — keep ploughing through

Per Chris's authorisation: this brief runs end-to-end without phase-by-phase sign-off pauses. Authorisation granted up-front for all sections. Walkthrough sign-off after the engine and UI work before close. Stop and escalate only for the conditions in "When to escalate" below.

Final report at end.

This brief is structured as three sections plus walkthrough, plus close. Sections can be combined into one or two commits if it makes the diff easier to review. The end-of-section deliverables are what matter, not the commit count.

---

## Principles

1. **Verify before fixing.** Before writing any code, confirm the diagnosis: Bridgewater's project JSON on disk — does `systems_config_v40` exist? Is it populated for every service? Does the engine actually have a per-service v25-vs-v40 selection, or is it all-or-nothing? If the diagnosis turns out to be different from what we think, the fix is different — don't assume.

2. **Per-service displacement, not all-or-nothing.** A project could be partway through migration with v40 populated for heating but not DHW. The engine should read v40 per service when populated, fall through to v25 per service when not. This is the "Option A engine-side displacement" Claude Code outlined.

3. **Disabled systems are completely out of the calc.** Filter before share validation. Share validation checks `sum(enabled systems' share_pct) === 100`. Disabled system's share value preserved on disk but ignored.

4. **Service-level batch toggle is a UX shortcut, not a separate field.** Clicking "service off" sets `enabled: false` on every system in that service. The underlying state is per-system; the toggle is just a convenience macro.

5. **Browser verification is mandatory, not optional.** Claude Code must boot the dev server, load Bridgewater in a real browser (Chrome via its browser tools), and verify each walkthrough item before claiming the section is done. Code-side reasoning is not sufficient — the whole point of Part 5b is that the previous walkthrough surfaced wiring problems that code-side verification missed.

6. **No pre-assumed numerical targets.** Per Brief 40 Principle 6. When toggles flip, the resulting numbers are what they are. Verify against hand calc where possible, but don't calibrate.

7. **Documentation hygiene per Process Rule 7.** Each section's commit includes its STATUS.md + audit-doc update.

---

## Section A — Diagnose then fix the wiring

**Goal:** Sliders in the new Brief 40 left panel produce visible changes in EUI, Sankey, and Live Results immediately.

**Files touched:**
- `docs/audit/40_walkthrough_diagnosis.md` (new or extended) — diagnosis output
- `frontend/src/utils/instantCalc.js` — `_calculateState3` displacement logic
- `frontend/src/utils/systemsEngine.js` — engine respects v40 when populated
- `scripts/40_bridgewater_systems_migration.py` — `--force` flag

**Steps:**

A.1 **Diagnose.** Single read-only inspection commit (or fold into Section A's main commit if findings confirm the hypothesis cleanly). Answer:
- Is `systems_config_v40` populated in Bridgewater's project JSON on disk? If yes, for which services?
- Is `systems_config_v25` still populated? Yes/no per service?
- When `_calculateState3` runs on Bridgewater, what does it actually use for each service — v25 or v40?
- Where does the Sankey + Live Results read from? `consumption.space_heating.{primary,secondary}` (Brief 38 polish) — does that block reflect v40 or v25?
- The UI section list — does it write to `systems_config_v40.{service}[]` or somewhere else?
- The share-sum validation on heating shows 90% with the engine still computing — is the validation UI-only, or does it fire engine-side?

Capture findings in `docs/audit/40_walkthrough_diagnosis.md`. Cross-link from the Brief 40 schema doc.

A.2 **Engine-side displacement.** In `_calculateState3`, for each service:
- If `systems_config_v40.{service}` exists AND is a non-empty array of enabled systems, use it. The systems engine (`systemsEngine.js`) computes the service block.
- Else fall through to `systems_config_v25` (the Brief 38 polish path).
- The output `consumption.{service-block}` is the same shape regardless of source. Sankey + Live Results don't need to know which path produced it.

This means partial migrations work — Bridgewater can be on v40 for heating and v25 for DHW until full migration completes.

A.3 **`systemsEngine.js` respects v40 population.** When called per service, compute proportional split + setpoint diagnostic + tap-mix (for DHW) using v40 systems. If v40.{service} is empty array, return null/sentinel so the displacement logic in `_calculateState3` falls through to v25. **The engine never silently produces zero — empty array is a signal, not a result.**

A.4 **Share validation engine-side.** Sum of enabled systems' `share_pct` must equal 100 (within rounding tolerance ~0.5%). If not, engine raises a controlled error that the UI displays — not a silent compute-anyway. The 90%-and-computing behaviour in the screenshot is a bug: validation must block compute, not just warn.

A.5 **Migration script `--force` flag.** Currently the migration script is idempotent — re-running on a project that already has v40 is a no-op. Add a `--force` flag that overwrites v40 from current v25 (or from defaults if v25 is incomplete). Use case: re-migrating Bridgewater after a schema refinement.

A.6 **Re-migrate Bridgewater.** Stop dev server (Process Rule 11). Run `python scripts/40_bridgewater_systems_migration.py --force`. Confirm Bridgewater's project JSON now has `systems_config_v40` populated for every service: heating (2 systems), cooling (1), DHW (2), ventilation (3), lighting (1 thin), small_power (1 thin). Restart dev server.

A.7 **Verify wiring in browser.** Boot the dev server. Load Bridgewater in a real browser. For each service:
- Confirm the left panel section shows the migrated systems (correct labels, shares, efficiencies)
- Confirm the right Live Results panel + Sankey numbers match expectation (DHW thermal should be ~60% of pre-Brief-40 per the tap-mix correction; other services unchanged from Brief 38 polish baseline)
- Confirm clicking a slider on a system (e.g. change a SCOP from 3.0 to 4.0) produces immediate change in EUI and Sankey
- Confirm changing share % triggers the validation warning if total != 100
- Confirm dragging a share to redistribute (e.g. heating 60/40 → 80/20) updates the Sankey ribbon widths and blended efficiency

If any of the six services fails to wire through, that's an escalation — pause and report. Don't proceed to Section B until A.7 is fully green.

**Section A commit message:**

```
Brief 40 Part 5b Section A: Wire v40 through to engine + Live Results

Diagnosis at docs/audit/40_walkthrough_diagnosis.md confirmed:
[summary of actual findings — what was populated, what wasn't,
where the gap was].

Engine-side displacement: _calculateState3 reads systems_config_v40
per service when populated; falls through to systems_config_v25 when
empty. systemsEngine.js returns sentinel when v40.{service} is empty
array so the engine never silently produces zero.

Share validation now engine-side: sum(enabled.share_pct) != 100
blocks compute and surfaces error. Previously the 90% case computed
silently which masked the wiring bug.

Migration script gains --force flag; Bridgewater re-migrated; all
six services on v40 with the per-system schema.

Browser verification: each service's left-panel slider now produces
immediate change in EUI + Sankey + Live Results. Tap-mix DHW
correction visible (~60% of pre-Brief-40 thermal). All other
services unchanged from Brief 38 polish baseline.
```

STATUS.md + audit doc in same commit.

---

## Section B — Per-system and per-service enable toggles

**Goal:** Each system has an on/off toggle. Each service has a batch on/off toggle. Disabled systems are completely out of the engine calc — share validation only counts enabled systems.

**Files touched:**
- `docs/audit/40_systems_library_schema.md` — schema gains `enabled` field
- `frontend/src/context/ProjectContext.jsx` — DEFAULT_PARAMS gets `enabled: true` on every seeded system; backward-compat for existing v40 entries missing the field
- `frontend/src/utils/withMode.js` — allowlist `enabled` per system
- `frontend/src/utils/systemsEngine.js` — filter disabled systems before share computation
- `frontend/src/components/modules/systems/SystemEditorCard.jsx` — per-system toggle in card chrome
- `frontend/src/components/modules/systems/SystemsModule.jsx` (or equivalent service section header component) — per-service batch toggle

**Steps:**

B.1 **Schema add.** Each v40 system gains `enabled: boolean` field. Default `true`. Missing field treated as `true` for backward compat with any existing v40 entries on disk. Document in audit doc § "Per-system enable toggle (Part 5b)."

B.2 **DEFAULT_PARAMS update.** Every system seeded in defaults gets `enabled: true` explicitly. Belt-and-braces.

B.3 **withMode allowlist.** Add `enabled` to the per-system fields passed through to the engine. Per Brief 33 Finding 1 ALLOWLIST DRIFT — every new field that needs to reach the engine must be in the allowlist or it silently drops.

B.4 **Engine respects `enabled`.** In `systemsEngine.js`, every per-service compute function filters disabled systems first:
- `enabled_systems = systems.filter(s => s.enabled !== false)`
- Share validation: `sum(enabled_systems.share_pct) === 100` (within tolerance)
- Computation only operates on enabled_systems
- If `enabled_systems.length === 0` for a service: the service's delivered = 0, fuel = 0, source_energy = 0. Same shape as v25's service-level `enabled: false`.
- Disabled system's share_pct is preserved on disk (visible in the editor card) but ignored at compute time.

B.5 **Per-system toggle UI.** Each `SystemEditorCard` gets a toggle in its card chrome (header area, left of collapse/delete buttons). Visual:
- Enabled: green dot or filled power-icon button
- Disabled: grey dot, card body greyed out (opacity-50 or similar), pointer-events on the controls remain so user can re-enable
- The toggle itself stays clickable when disabled (so user can re-enable)
- Tooltip on the toggle: "Enable this system" / "Disable this system"

B.6 **Per-service batch toggle.** In each service section header, a small toggle next to the share-validation badge. Click flips `enabled` on every system in the service:
- All enabled → all disabled
- All disabled → all enabled
- Mixed → all enabled (so user can always recover from a partial state)

Tooltip: "Disable all heating systems" / "Enable all heating systems" etc.

B.7 **Share validation only counts enabled systems.** UI badge in section header shows "Shares sum to N% (of enabled)" where N is the enabled-share-sum. If N != 100, the badge is amber/red.

B.8 **"Normalise" quick-fix scales enabled systems only.** When the user clicks Normalise on a service whose enabled-share-sum != 100, the function scales each enabled system's share_pct proportionally to land at 100. Disabled systems are untouched.

B.9 **Browser verification.**
- Toggle Bridgewater's gas boiler off (heating service). Air-source heat pump's share auto-redistributes? No — share validation just shows "Sum of enabled = 60%" (the heat pump's share). Click Normalise. Heat pump goes to 100%. EUI moves accordingly (no more gas branch in Sankey for heating).
- Toggle the heat pump off too. Now heating service has zero enabled systems. Service delivered_mwh = 0 in Live Results. Sankey heating bar disappears. EUI drops by the heating amount.
- Toggle service-level off for ventilation. All three vent systems disabled. Ventilation electrical = 0 in Live Results. Toggle service-level back on. All three re-enabled. Numbers restored.
- Verify: disabled system's share_pct preserved on disk (re-enable it, share is what it was before).
- Verify: heating shares-sum-of-enabled validation reflects only enabled systems' shares.

**Section B commit message:**

```
Brief 40 Part 5b Section B: Per-system and per-service enable toggles

Schema gains enabled: boolean per system (default true, missing
treated as true). DEFAULT_PARAMS seeds enabled: true explicitly.
withMode allowlist updated per ALLOWLIST DRIFT discipline.

Engine respects enabled: disabled systems filtered before share
computation. Share validation sums enabled systems only. Service
with zero enabled systems produces delivered = 0 (same shape as
v25 service-level enabled: false).

Per-system toggle in SystemEditorCard chrome. Per-service batch
toggle in section header. Normalise quick-fix scales enabled
systems only; disabled systems' share values preserved on disk.

Browser verification: toggling Bridgewater's gas boiler off
isolates heating to the heat pump; toggling both off zeroes
heating service; ventilation batch-toggle works.
```

STATUS.md + audit doc in same commit.

---

## Section C — Browser verification report

**Goal:** Document the full verified behaviour, with screenshots if Claude Code's browser tools support capture.

**Files touched:**
- `docs/audit/40_walkthrough_diagnosis.md` — append "Part 5b verification" section
- STATUS.md — Part 5b verification summary

**Steps:**

C.1 In a real browser (not code-side reasoning), walk this checklist on Bridgewater and document the outcome of each step:

1. Open Systems module. Confirm six service sections visible. Heading shows correct system counts per service.
2. Heating section: confirm 2 systems (heat pump + gas boiler), correct shares (60/40 or whatever migration produced), correct headline efficiencies.
3. Heating section: change heat pump SCOP from 3.0 to 4.0 via slider. Verify EUI in right panel drops within 1 second of slider movement. Verify Sankey "Electricity" branch from heating narrows correspondingly.
4. Heating section: toggle heat pump off. Verify share validation shows "Sum of enabled: 40%". Click Normalise. Gas boiler share goes to 100%. Sankey now shows heating served entirely by gas; EUI rises.
5. Heating section: toggle gas boiler off too. Now heating service has zero enabled. Verify heating bar disappears from Sankey. Verify Live Results "Heating: X / 175.1 MWh" shows delivered = 0.
6. Re-enable both heating systems. Verify shares + numbers restored to step 4's state, then step 3's state, then original.
7. Cooling: change setpoint via Custom radio + slider from default 24°C to 20°C. Verify diagnostic appears on cooling card showing positive delta (overcool). Verify EUI moves accordingly.
8. DHW: change tap_outlet_temp from 40°C to 30°C. Verify DHW thermal drops further (hot fraction smaller). Confirm Live Results DHW number drops.
9. DHW: toggle one of two DHW systems off. Verify Normalise works. Verify Sankey reflects the surviving system.
10. Ventilation: open service-level toggle, flip off. All three vent systems disabled. Verify Ventilation rows in Live Results all go to 0. Toggle back on; restored.
11. Lighting + small_power: change control_factor on lighting from 1.0 to 0.7 (simulating daylight dimming). Verify lighting electrical drops to ~70% of previous; EUI moves; Sankey reflects.
12. Library: save the modified heating heat-pump system as a library item. Add a new heating system from library. Confirm fields populate. Delete the new system. Original two systems intact.
13. UnifiedScheduleEditor: open any system's schedule editor via the Control group "Open schedule editor →" button. Confirm pop-out behaves exactly as in Internal Gains / Operation (Brief 37 component).
14. Reload the browser page. Confirm all edits persist (the project autosave is working).
15. Navigate away to Building module, back to Systems. Confirm state preserved.

C.2 Capture findings:
- All 15 items: PASS / FAIL / partial
- Any anomalies — note even small things (slow update, console error, off-by-rounding)
- Any unexpected EUI movements with first-principles explanation

C.3 If anything fails, do not close. Diagnose, fix in a follow-up commit within Part 5b, re-verify.

**Section C commit message:**

```
Brief 40 Part 5b Section C: Browser verification of wiring + toggles

15-item walkthrough on Bridgewater documented in
docs/audit/40_walkthrough_diagnosis.md § "Part 5b verification."

[Summary of pass/fail. Any anomalies and how they were resolved.]

Part 5b end-state: every slider, dropdown, toggle, and library
action in the Systems module produces a visible change in EUI,
Sankey, and Live Results within the same render cycle. Bridgewater
configurable across the proportional-split + enable-toggle space.
```

STATUS.md update in same commit.

---

## Close (after Sections A, B, C complete and Chris signs off)

**Files touched:**
- STATUS.md — Part 5b close-out summary
- `docs/audit/40_walkthrough_diagnosis.md` — final state
- No archive yet — Brief 40 stays open through Part 5c (pop-out refactor) and final Part 6 close

**Commit message:**

```
Brief 40 Part 5b close: Wiring fix + enable toggles verified

Sections A/B/C landed. Bridgewater configurable across the full
Brief 40 proportional-split + enable-toggle space; every UI control
produces visible change in EUI/Sankey/Live Results.

Brief 40 stays open. Part 5c (left-panel pop-out refactor) follows.
```

---

## Final report (paste in chat after close commit)

1. New origin/main HEAD SHA
2. Section A: where was the wiring broken? One-paragraph diagnosis summary.
3. Section A: which service displacement paths were actually changed in the engine?
4. Section B: confirmation of enable-toggle wiring through schema → engine → UI.
5. Section C: pass/fail per the 15-item walkthrough. Anomalies and resolutions.
6. Bridgewater EUI before Part 5b, after migration re-run, after a meaningful intervention (e.g. heat pump SCOP 3.0 → 4.0). Three numbers, with first-principles explanation of each movement.
7. Confirmation that `docs/briefs/active/` still contains Brief 30 (paused) + Brief 40 (still active for Part 5c + Part 6 close).
8. CLAUDE.md and STATUS.md current.

---

## What MUST NOT happen in Part 5b

- No code changes to `sql_parser.py`, `epjson_assembler.py`, simulation API endpoints (Dynamic remains paused per Brief 32 Part 1).
- No envelope-physics changes — Rule 14 unlikely to fire, but if it does (because share validation refactoring touches a State 2 helper somehow), the parity rule applies.
- No left-panel UX restructure — that's Part 5c's job. Don't touch the section list shape or fold any of the editor card into a pop-out. Only the per-system toggle in card chrome and per-service batch toggle in section header are new UI.
- No calibration of Bridgewater post-fix numbers — they are what the engine produces from the new wiring.
- No silent compute on share-sum != 100 — validation must block.
- No bundling Part 5c (pop-out refactor) into 5b.
- No partial commits — each Section is one commit including its STATUS.md + audit-doc updates.
- No skipping the browser verification on grounds of "the code looks right" — Section C exists because Section A's wiring problem was the kind of bug that code-side reasoning misses. Real browser, real Bridgewater, real numbers.

---

## When to escalate

Pause and escalate to Chris ONLY if:

- The diagnosis in A.1 turns out to be fundamentally different from the hypothesis (e.g. it's not a displacement problem but a state-management problem where the UI mutations aren't reaching the engine at all)
- The migration script can't be made `--force`-safe without breaking other projects that may exist
- Any of the six services can't be made to wire through cleanly via the displacement approach (suggests the v40 schema or `systemsEngine.js` has a structural problem)
- A walkthrough item in Section C fails in a way that suggests a deeper bug beyond Part 5b's scope
- The enable-toggle work surfaces a bug in the v25 fallback (e.g. v25 doesn't respect a per-service-level disable in a way that breaks once v40 enable is added)
- Documentation hygiene starts slipping

Otherwise, plough through Sections A → B → C → close. Final report at end.

---

## Notes for Claude Code on the discipline pattern

This Part follows the pattern that's worked for Briefs 36, 39, 41, 42, and Brief 40 Parts 1–5:

- **Read everything before starting.** The BEFORE-DOING-ANYTHING checklist exists because missing one of those checks is how earlier-session briefs accumulated context errors. Don't skip.
- **Section A's diagnosis is read-only.** Don't start writing fix code until the diagnosis is captured. The diagnosis may turn out to be different from the hypothesis — better to learn that in 20 minutes of reading than 4 hours of fixing.
- **Browser verification is mandatory.** Section C is not "optional confidence." It's how we know Part 5b actually fixed the problem the walkthrough surfaced. Code-side reasoning was insufficient last time; that's why we're here. Boot the dev server, load the page, click the things.
- **Audit doc updates land in the same commit as the code.** Per Process Rule 7.
- **If a Section finds a deeper bug, log it in `29_open_issues.md` and continue.** Don't expand Part 5b to absorb new issues — they become follow-up work.

Standing by for authorisation to begin Section A.

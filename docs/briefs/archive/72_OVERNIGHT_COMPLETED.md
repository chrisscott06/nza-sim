# Brief 72 OVERNIGHT — DB recovery + P3 resume + auxiliary loads + DHW shape, autonomous

**Author:** Claude Chat (architect)
**Authorised by:** Chris (28 May 2026 late evening — explicitly for overnight autonomous execution)
**Mode:** PLOUGH-THROUGH. Chris is asleep and unavailable. Standard escalation triggers from Brief 72 are downgraded — see "Autonomous decision authority" below.
**Lineage:** Continuation of Brief 72 after the DB-loss incident. Brief 72 P1 (`df8387f`) and P2 (`18d1146`) audit doc are landed. P3 engine edits are uncommitted on disk. This document covers everything from here to Brief 72 close, including DB recovery and Bridgewater re-creation, executed without Chris in the loop.

---

## What happened, briefly

During Brief 72 P3, the shared `data\nza_sim.db` was wiped to empty schema (139 KB) at 22:34:56 — almost certainly because the worktree backend, sharing the data directory via junction with the main backend, caused a SQLite WAL/path-resolution conflict on cleanup. No WAL/SHM sidecars survived. Forensic check complete; OneDrive cloud version history shows only a 6-April version that pre-dates Bridgewater's 5-May creation. **Loss is permanent on the project state side.** All code, all briefs, all audit docs, and the P3 engine edits in working tree are intact.

Two new Bible rules (landed in Notion late evening): worktree diagnostics never share a data directory with main backend; local DB snapshot discipline is mandatory before any further DB-touching work.

---

## Autonomous decision authority (because Chris is asleep)

You are authorised to make every operational decision needed to land this brief end-to-end without Chris. Apply these in order of preference:

1. **If a decision is documented in this brief, in the design note (`https://www.notion.so/36ed645e05cc81ac89b9d5bc14355a39`), or in Bible addenda — follow the documented path.**
2. **If undocumented but obvious — pick the cleaner option, log it in the audit doc under §autonomous-decisions, proceed.** Examples: "snapshot retention is documented as 14 days; backup script keeps 14" is documented. "Should the snapshot path live under `C:\Users\ChrisScott\Backups\nza-sim-db\` or under `C:\NZA-Backups\`?" is undocumented-obvious — pick the first (matches Windows user-data convention), log, move on.
3. **If undocumented and genuinely ambiguous — pick the more conservative option, log it loudly, proceed.** Example: a P3 schema migration finds projects with `people_per_room != 1.5` — conservative = preserve those projects' density values rather than coerce. Log and continue.
4. **Hard STOP only for:** (a) data-loss risk, (b) anything that would push broken code to main and break the dev server for tomorrow, (c) the H1 engine cross-wire hypothesis (which P2 already refuted, so this shouldn't fire), (d) a Rule 14 finding that gain_fraction enters an instantCalc.js integration loop AND the three-state landing breaks.

You may NOT:
- Stash, abandon, or revert the existing uncommitted P3 engine edits without committing them first.
- Touch the OneDrive backup at all (still per CLAUDE.md).
- Disable or skip the daily snapshot scheduled task once it's set up.
- Push diagnostic/debug code to main (existing rule, reaffirmed).
- Sit waiting for Chris on anything other than the four STOP conditions above. Plough through.

---

## BEFORE DOING ANYTHING

1. Confirm receipt by quoting this brief's title and first paragraph in your audit doc opening, with the SHA at tip of main (`f97c089` expected).
2. `git status` — confirm the P3 engine edits are still on disk (`frontend/src/utils/instantCalc.js` modified, `frontend/src/utils/systemsEngine.js` modified). If they're gone, STOP — that's data loss type (a).
3. Read the Bible addenda landed this evening (Notion page `32dd645e-05cc-813b-881e-dd454053e238` comments). Two new rules apply.
4. Read the existing `docs/audit/72_auxiliary_loads_dhw_shape.md` — the canonical Bridgewater anchor numbers in §1 are the regression target for the re-created Bridgewater in Part A below.
5. Read `docs/audit/72_occupancy_intervention_disagreement.md` — the P2 discriminator finding (DHW reads phantom `people_per_room`) is the substantive justification for P3.

---

## Parts

The brief is split into a recovery phase (Parts A–C) before resuming the original Brief 72 P3-onwards. Total ≈12 commits. Each part is one commit unless noted.

---

### Part A — Local DB snapshot discipline (NEW; precondition per Bible addendum)

Before any DB-touching work. Build a Windows-Task-Scheduler routine that protects against this happening again.

**Implementation:**
- Create `scripts/snapshot-db.ps1` in the repo. Logic: copy `data\nza_sim.db` (and `.db-wal`, `.db-shm` if present) to `C:\Users\ChrisScott\Backups\nza-sim-db\nza_sim_YYYY-MM-DD_HHMM.db`. Keep last 14 snapshots; delete older.
- Test the script manually once — it should produce a snapshot in the backup dir.
- Register the script as a Windows Scheduled Task: name `nza-sim-db-daily-snapshot`, trigger daily at 02:00 local, action `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <repo>\scripts\snapshot-db.ps1`. Run as current user, "Run whether user logged on or not", "Do not start if on battery only" UNTICKED (laptops sleep, we want it to fire on wake).
- Document the backup path + task name in `CLAUDE.md` under a new "Backup discipline" section, alongside the existing database-location notes.

**Gate:** the manual snapshot test produces a file in `C:\Users\ChrisScott\Backups\nza-sim-db\`. `Get-ScheduledTask -TaskName "nza-sim-db-daily-snapshot"` returns the task.

**Commit:** `Brief 72 PA: local DB snapshot discipline (Bible rule)`.

**Note:** Code can't actually click through the Task Scheduler UI; use `Register-ScheduledTask` PowerShell cmdlet with `New-ScheduledTaskAction` + `New-ScheduledTaskTrigger` + `New-ScheduledTaskSettingsSet`. That's fully scriptable from a non-interactive session.

---

### Part B — Re-create Bridgewater from canonical anchors and screenshots

Use the existing project-creation flow in the UI via your MCP browser tools — same way as a normal user. Project name: **"HIX Bridgewater"** (exact match — used in the audit doc and worth keeping consistent).

**Source of truth for every value:** the audit doc `docs/audit/72_auxiliary_loads_dhw_shape.md` §1 anchor table. Plus the screenshots embedded throughout the Brief 71/72 conversation history in Chris's chat (you cannot see those directly; rely on the audit doc + the data points below extracted from the P2 discriminator dump).

**Numbers you MUST hit (within ~1% rounding tolerance):**

Building / envelope:
- Number of rooms (num_bedrooms): **138**
- Reported GIA (EUI denominator): **4125 m²**
- Geometry GIA (length × width × floors): **4322 m²** (per the screenshot — leave geometry inputs to produce this automatically; don't override)
- Heating setpoint: **21.0 °C**
- Cooling setpoint: **24.0 °C**
- Thermal bridges H_TB: **120.82 W/K**

Internal Gains → Occupancy:
- Density: **3** (NOT 4 — Bridgewater BASELINE is density 3; "Occupancy 4" was the intervention)
- Basis: **people/room**
- Occupancy rate: **100%**
- Sensible heat: **75 W/person**
- Latent heat: **55 W/person**
- (`people_per_room` field is being retired in P3; in re-creation it will default to whatever the current code seeds — that's fine, P3 removes it next)

Internal Gains → Lighting + Equipment:
- Best-effort to match the screenshots. The exact lighting LPD and equipment power densities aren't in the discriminator dump verbatim; from the Systems Energy flows view we know Lighting delivered = 128.6 MWh and Small power delivered = 116.7 MWh at baseline. Set lighting + equipment magnitudes such that the engine produces these totals within a few %. If you can't hit them exactly, leave a note in the audit; the P3 anchor will be whatever the re-created Bridgewater produces, not the pre-loss numbers.

Systems → Heating: two systems, Active setpoint strategy
- System 1 share: **90%**, SCOP **2.8** (VRF heat recovery dual function)
- System 2 share: **10%**, COP **1.00** (Electric panel heater)

Systems → Cooling:
- One system, EER **3.5** (VRF heat recovery dual function)

Systems → DHW:
- Basis: per_person
- 80 L/person/day
- Two systems: ASHP DHW preheat SCOP 2.5, plus gas boiler calorifier 90% efficiency
- Share split per the Systems screenshot (DHW HP first stage, gas boiler trim)

Systems → Ventilation: three systems
- `mvhr_gf_public`: 22.6 MWh fan electricity
- `bedroom_extract`: 16.0 MWh fan electricity
- `public_toilet_extract`: 3.4 MWh fan electricity
- Total ventilation fan electricity: 42.0 MWh
- (Specific flow rates / SFP values: best-effort to hit those totals; if you can read the seeded defaults from the engine that produce these totals, use them.)

Systems → Lighting and Small Power: per the totals above (128.6 and 116.7 MWh delivered).

**Gates (must pass before moving to Part C):**
- EUI **130.0 ± 0.5 kWh/m²·yr**
- Σ electricity **356.3 ± 2 MWh**
- Σ gas **180.1 ± 2 MWh**
- Heating demand **55.9 ± 1 MWh**, delivered **55.9 ± 1 MWh** (well, delivered = demand/SCOP+gas — see audit table)
- Cooling demand **87.6 ± 1 MWh**
- DHW demand **210.5 ± 1 MWh**

If any gate fails by more than the tolerance, iterate the inputs (Code may need to look at engine source to identify which input drives the failing number — that's fine, same diagnostic discipline as a normal brief).

**Acceptance:** Bridgewater re-created within tolerance. Audit doc updated with §re-create-bridgewater showing the achieved numbers vs the canonical anchor, and any deviations explained.

**Commit:** `Brief 72 PB: re-create HIX Bridgewater post-DB-loss (anchor reconciled)`.

**If a gate cannot be hit within tolerance after ~3 iterations:** log the deviation, accept the new baseline as the canonical post-loss Bridgewater, document the movement from first principles in the audit. Do NOT tweak the engine to match the old numbers. Proceed with the new baseline as the P3 anchor.

---

### Part C — Run the P2 discriminator regression (verify re-created Bridgewater behaviour)

Use the existing `scripts/_brief72_p2_discriminator.mjs` script approach — but THIS TIME, take project state as a JSON fixture, not as a live-DB read. Build the discriminator to:
1. Load the re-created Bridgewater's project JSON via the API once (read-only, the live DB is now real again).
2. Cache it into a JSON fixture file at `docs/audit/fixtures/bridgewater_post_recreate.json` (write to disk — useful regression artefact).
3. Run `calculateInstant(building, …, { mode: 'full', comfortBand, engine: 'v2.5' })` against the fixture, with the Occupancy 4 patch applied to a singleton stack.
4. Output the same JSON the original discriminator did.

**Gate:** discriminator output reproduces the symptom (DHW unchanged at ~210.5 MWh across baseline vs `interventions[0]`). This confirms re-created Bridgewater has the SAME bug, which is what we want — it means the headcount decoupling is in the engine code, not the project data.

If DHW DOES move in the re-created Bridgewater, that's unexpected (suggests recreation accidentally fixed the bug by setting people_per_room to match density — possible if the UI seeds it from density on new projects). Log it and proceed to P3 anyway; P3 retires the field regardless.

**Commit:** `Brief 72 PC: P2 discriminator regression on re-created Bridgewater`.

---

### Part 3 (resumed) — Occupancy headcount unification + capture parity

This is the original Brief 72 P3 from the brief on disk. Engine edits are already on disk uncommitted — review them, complete them, commit.

**Per the original brief P3:**
- `ProjectContext.jsx DEFAULT_GAINS.occupancy`: remove `people_per_room` field.
- `OccupancySection.jsx`: remove the "People per room" UI control (the 1.5 visible in screenshots).
- All engine reads of `people_per_room` — `systemsEngine.js _computeDhw`, `useAnnualGains.js` legacy avg-occupants path, anywhere else `grep -rn "people_per_room"` finds it — switch to `computeTotalOccupants` (which reads `num_bedrooms × density` for per_room basis, or `density × gia_m2` for per_m2 basis).
- Schema migration: existing projects with `people_per_room` saved — drop the field. If any project (including re-created Bridgewater) has `people_per_room != 1.5`, log a console warning listing project IDs.
- Add `building.num_bedrooms` to `patchCapture.js`. Run the capture-parity audit per Principle 8: `grep -rn "building\." engine/ | sort -u` to find every building.* field the engine reads, cross-check against patchCapture.js regex coverage, list gaps in audit §4 / P3.

**Engine edits already on disk** (`instantCalc.js` 38 lines, `systemsEngine.js` 19 lines) cover the engine-side switch to `computeTotalOccupants`. Review them, verify they match the design note's "single source of truth" requirement, then complete the UI removal + schema migration + capture additions, then commit the lot together.

**Gates (all must pass):**
- (a) Bridgewater anchor preserved: EUI ± 0 vs Part B's achieved number.
- (b) **Density 3 → 4 on Bridgewater moves DHW from 210.5 MWh to ~561 MWh** (ratio ≈ density × num_bedrooms / old-phantom-headcount of 207).
- (c) "Occupancy 4" intervention applied via patch produces the same DHW change as (b).
- (d) Discriminator re-run (Part C method) shows `dhw_demand_after0_mwh` now MOVES — was 210.547 in P2, should now be ~561 with density 4.

**Commit:** `Brief 72 P3: occupancy headcount unification + num_bedrooms capture`.

---

### Part 4 — Schema (auxiliary loads + gain_fraction)

Per the original brief P4. `ProjectContext.jsx DEFAULT_GAINS`: add `gain_fraction: 1.0` to lighting + equipment profile defaults; add `auxiliary` top-level (empty `profiles: []`). Migration helper for existing projects.

**Gate:** anchor unchanged from P3 number.

**Commit:** `Brief 72 P4: gain_fraction + auxiliary loads schema (+migration)`.

---

### Part 5 — Engine wiring (auxiliary loads)

Per the original brief P5. `useAnnualGains.js`: emit per-profile `auxiliary_kwh` + `auxiliary_gain_kwh`; apply `gain_kwh = electricity_kwh × gain_fraction` for lighting/equipment/auxiliary.

**Rule 14 check mandatory** — confirm in commit message whether `gain_fraction` enters any `instantCalc.js` State 1 / State 2 / inline-legacy integration loop. If yes, all three states change in this commit. If autonomous judgement says it ballons to Tier 3 scope, STOP and leave a note (this is one of the four hard-stop conditions).

**Gate:** anchor unchanged with `gain_fraction = 1.0` everywhere; catering @0.50 test case splits correctly (run it in pure Node against the fixture from Part C).

**Commit:** `Brief 72 P5: gain_fraction engine wiring + auxiliary rollups`.

---

### Part 6 — Colour token

Per the original brief P6. `gainColours.js` (`auxiliary: '#4B5563'` + label) AND `balanceColours.js INTERNAL_COLOURS` (`auxiliary: '#4B5563'`), same commit. `GAINS_ACCENT` untouched.

**Commit:** `Brief 72 P6: auxiliary colour token (same hex in both palettes)`.

---

### Part 7 — Auxiliary section UI

Per the original brief P7. New `AuxiliarySection.jsx` (modelled on `EquipmentSection.jsx`, no `standby_factor`), six-item preset picker, inline `Heat gain: NN%` per profile row, mounted in `InternalGainsModule.jsx` below Equipment.

**Was originally a HARD STOP for Chris's walkthrough — DOWNGRADED for autonomous mode.** Replace with self-verification: use MCP browser tools to load Bridgewater, open Internal Gains, confirm:
- Auxiliary section renders below Equipment in `#4B5563`
- "Add profile" opens six-item picker (External lighting, Catering, Pumps, Small power, Lifts, Custom)
- Selecting Catering creates a profile with gain_fraction = 50%
- Adding a 5 W/m² catering baseload moves heat balance and electricity correctly (use Calc trail or engine output to verify direction + magnitude — sign correctness is the main gate)

Log self-verification results in audit doc §walkthrough-P7. If anything fails, treat as Tier-2 within the brief: short diagnostic in the audit, bounded fix, re-verify. Don't expand scope.

**Commit:** `Brief 72 P7: Auxiliary loads section + preset picker`. (If a self-verification fix is needed, a separate P7b commit is fine.)

---

### Part 8 — gain_fraction editor on existing sections

Per the original brief P8. Inline `Heat gain: NN%` editor on LightingSection + EquipmentSection headers. 0–100 integer percent, tooltip per design note B.2.

**Was originally a HARD STOP — DOWNGRADED for autonomous mode.** Self-verification:
- Lighting + Equipment sections now show `Heat gain: 100%` editor
- Setting Equipment to 50%: equipment_gain_kwh halves, equipment_kwh (electricity) unchanged
- Setting Lighting daylight_factor = 0.6 AND gain_fraction = 0.5 produces the half-gain-but-daylight-suppressed-electricity result expected (non-collapse regression — design note B.8 #7). Run as a 3-way pure-Node test against the Part C fixture if browser-side is hard to verify exactly.
- Anchor byte-equal at `gain_fraction = 1.0` (design note B.8 #8).

**Commit:** `Brief 72 P8: gain_fraction inline editor on lighting + equipment`.

---

### Part 9 — DHW load-shape UI

Per the original brief P9. `ServiceSectionHeader.jsx DHWServiceFields`: add a `LabeledSelect` (flat / follow_occupancy), mirror `dhw_demand_basis` LabeledSelect pattern at L188-196, caption per design note D.1.

DHW volume default stays at **80 L/p/day** — Chris explicit on this.

**Gate:** default flat; follow_occupancy persists across reload; `consumption.brief40.dhw.hourly_kwh` reshapes; annual total unchanged.

**Commit:** `Brief 72 P9: DHW load shape UI surface`.

---

### Part 10 — Intervention patch capture

Per the original brief P10. `interventions/patchCapture.js`: four gain_fraction/auxiliary regex rows + DHW load-shape row. (`num_bedrooms` already added in P3.)

**Gate:** each new field change captured as an intervention without warnings.

**Commit:** `Brief 72 P10: intervention capture for gain_fraction, auxiliary, DHW load shape`.

---

### Part 11 — Close

STATUS.md updated to reflect Brief 72 complete. `current.md` repointed to whatever Chris's likely next brief is — leave it pointing at "ready for Chris's review post-Brief-72" placeholder, don't pick the next brief autonomously.

Run the full walkthrough (design note B.9 + D.4 + P3 headcount gates) using MCP browser tools. Log every result in audit doc §11-walkthrough as ✓/✗ with brief commentary on any ✗.

`git mv docs/briefs/active/72_auxiliary_loads_dhw_shape.md docs/briefs/archive/72_auxiliary_loads_dhw_shape_COMPLETED.md`. Add the OVERNIGHT addendum brief (this file) alongside it as `72_auxiliary_loads_dhw_shape_OVERNIGHT_COMPLETED.md`.

**Final report comment at the top of the audit doc.** Three sections:
1. **What landed:** SHAs for PA through P11, brief one-liner per commit.
2. **What didn't:** any gate that failed, any deviation from the brief Code took unilaterally, anything Chris should review first thing.
3. **Open questions for Chris:** anything that hit one of the four STOP conditions and was therefore deferred. If nothing hit a STOP, this section says "None — full plough-through, ready for review."

**Commit:** `Brief 72 P11: close + walkthrough + archive`.

---

## What MUST NOT happen

- The local DB snapshot scheduled task NOT being in place by end of Part A. This is the non-negotiable precondition.
- Bridgewater re-creation tweaking engine code to hit the old anchor numbers (Bible rule).
- `people_per_room` surviving in any code path after P3.
- `gain_fraction` and `daylight_factor` merged.
- Single variable carrying both electricity and gain.
- Auxiliary colour landing in only one palette file.
- The DHW volume default moved off 80 L/p/day.
- Any of the deferred load types (BMS/IT/EV) sneaking in.
- Diagnostic / debug code pushed to main.
- Worktree-shared-data-directory pattern recurring (use scratch DBs or pure-Node fixtures).
- Chris being pinged before he wakes up unless one of the four hard STOPs fires.

---

## Notes for the morning report

When Chris reads the audit on GitHub, he needs to see at a glance: did it work, what's the new Bridgewater state, what should he sanity-check first. Make the §final-report section short, scannable, and honest. If something is half-done, say so — don't paper over.

The Brief 74 (interventions diagnostic harness + tab redesign) and Brief 76 (WWHR) are queued for after this. Don't start them. Don't write design notes for them autonomously. They wait for Chris.

---

Sleep well, Chris. Code's got it.

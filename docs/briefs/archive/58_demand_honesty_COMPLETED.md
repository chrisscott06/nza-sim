# Brief 58 — Demand-honesty cluster: metadata, DHW basis, internal-gains restructure (occupancy + auxiliary loads), lighting/gains decoupling

**Author:** Claude Chat (architect). **Authorised by:** Chris.
**Type:** Tier 3, multi-part. ONE brief, sequenced parts, each independently shippable and committed separately.
**Repo:** github.com/chrisscott06/nza-sim (public). **Canonical design note:** Notion `367d645e-05cc-81af-93d7-fc57bfc45faf` (the diagnostics/audit note — read the "Internal-gains / electric-loads unification" and "demand-honesty" entries).
**Supersedes drafted Briefs 52 (DHW) and 54 (metadata)** — their content is folded in here. Do not separately resurrect 52/54.

---

## Summary

Four related pieces of "make the demand inputs honest and put each quantity where it physically belongs":

- **Part A — Building metadata page.** A small single-source-of-truth page for the three genuinely building-level constants: `num_rooms`, `reported_gia` (EUI denominator), `comfort_band` (retires the e462a21 stopgap). NOT occupancy — see Part B.
- **Part B — Internal-gains restructure: occupancy as a sensitivity input + DHW basis fix + DHW load-shape toggle.** `people_per_room` moves INTO Internal Gains as a first-class sensitivity lever (it's a gain, not metadata). DHW demand switches from occupant-HOURS to HEADCOUNT, reading occupancy from Internal Gains. A toggle chooses whether DHW timing follows the occupancy hourly profile or sits flat (magnitude identical either way).
- **Part C — Lighting/gains decoupling fix.** Toggling lighting/small power must move internal gains (and therefore heat/cooling demand), because that electricity ≈100% becomes space gain.
- **Part D — Auxiliary energy in Internal Gains.** A new sub-section (within Internal Gains, possibly renaming that module) for catering / external lighting / pumps / other small power — each a single entity with an electrical consumption AND a gain-interaction fraction.

**Cut from this brief:** the Schedule-tab resolution (was a candidate Part E). It's elevated to its own planned follow-up — the "operating-profile viewer" brief — to be done AFTER this one, when the DHW/gains/auxiliary profiles exist to render. See "Planned follow-up" at the end.

**Anchor:** verification DB (port 8003), Bridgewater clean **128.20**. Each part states whether it moves the anchor and why. Any move must be DERIVED (hand-calc first), never calibrated.

---

## BEFORE DOING ANYTHING

1. Read this brief in full. Confirm receipt by quoting this brief's title and the first line of the Summary back to Chris.
2. Read `CLAUDE.md`, `STATUS.md`, `docs/briefs/current.md`. Confirm no other active brief; if `active/` or `current.md` claims a different brief, STOP and surface to Chris.
3. Read the canonical Notion design note (`367d645e-05cc-81af-93d7-fc57bfc45faf`) — the demand-honesty and internal-gains-unification entries are the design rationale this brief implements.
4. Confirm clean working tree and `origin/main` in sync (`git status`).
5. Confirm you are on the verification DB (port 8003, frontend :5178). Back up `data/nza_sim_cc.db` before starting.
6. Land this brief on disk at `docs/briefs/active/58_demand_honesty.md` as Part A1's first commit.
7. Read — before touching — the code each part modifies (per-part "Read first" lists below).

---

## Scope

**In scope:** a building-metadata page (num_rooms, reported_gia, comfort_band); canonical comfort_band resolution (retiring the e462a21 stopgap); reported_gia as the EUI denominator with the geometry/physics split; moving people_per_room into Internal Gains as a sensitivity input; the DHW headcount-basis fix; the DHW load-shape toggle; the lighting/gains decoupling fix; an auxiliary-energy sub-section within Internal Gains.

**Out of scope (MUST NOT touch):**
- Geometry/floor-plan physics — `geometry_floor_area` stays derived and drives all physics. This brief does NOT change how heat loss / envelope areas are computed.
- The Schedule tab (deferred to the follow-up brief).
- Intervention stacking / patch composition (Brief 55, done).
- Ventilation/bypass (Brief 53, done).
- The MVHR recovery accounting (Brief 50, done).
- Any engine-physics change that isn't explicitly a part below.

---

## Principles

1. **Each quantity lives where it physically belongs.** Building constants → metadata page. Occupancy and electrical loads → Internal Gains (they're gains). Only `num_rooms`, `reported_gia`, `comfort_band` are true building metadata.
2. **Resolve once, read everywhere, thread nowhere.** comfort_band resolved at one canonical point; no call site hand-threads it. This RETIRES the e462a21 stopgap (does not extend it).
3. **Physics vs presentation boundary.** `geometry_floor_area` drives absolute energy (kWh); `reported_gia` drives the per-m² presentation (EUI denominator) only. Declared separately, never fused.
4. **A load and its gain are ONE entity.** Lighting, small power, and auxiliary loads each carry both an electrical/fuel consumption AND an internal-gain fraction; both consequences move together (no decoupling).
5. **Magnitude vs shape are separate for DHW.** Headcount sets the magnitude; the load-shape toggle only redistributes timing. Total kWh is invariant to the toggle.
6. **Don't calibrate.** Derive every anchor move from first principles; engine output is canonical.
7. **Declare boundaries in names** (the recurring boundary-mismatch discipline): `dhw_demand_headcount_mwh`, not `dhw_kwh`; `reported_gia` vs `geometry_floor_area`; etc.

---

## PART A — Building metadata page (single source of truth)

Building-level constants only: `num_rooms`, `reported_gia`, `comfort_band`. (Occupancy is NOT here — it's a gain, Part B.)

**Read first:** every consumer of `comfort_band` (the two `calculateInstant` call sites — SystemsModule + InterventionsModule including the e462a21 stopgap; the engine's State 2 + State 3 setpoint resolution; ProjectContext.comfortBand; the projects DB columns; building_config JSON). Every consumer of GIA / floor area (the EUI-denominator division; where geometry floor area is computed from the plans). Where `num_rooms` currently lives.

### A1 — Metadata audit (read-only) + canonical comfort_band design
- Produce `docs/audit/58_metadata.md`: consumer map for comfort_band, GIA, num_rooms; the canonical comfort_band resolution design (one resolution point, no call-site threading); the EUI-denominator location; the first-principles statement that `reported_gia == geometry_gia ⇒ 128.20 unchanged`.
- Commit: `Brief 58 A1: metadata audit + canonical comfort_band design (read-only)`.
- **HARD STOP** for Chris's sign-off on the comfort_band resolution design before any refactor.

### A2 — Canonical comfort_band resolution (retire the e462a21 stopgap)
- Resolve comfort_band at ONE canonical point; both SystemsModule and InterventionsModule call `calculateInstant` WITHOUT hand-threading the band. Delete the e462a21 stopgap threading (do not keep it as a fallback).
- Commit: `Brief 58 A2: canonical comfort_band resolution (retire e462a21 stopgap)`.
- **Verification:** Systems EUI == Scenarios baseline EUI == 128.20, cross-route drift exactly 0. `grep` confirms no call site hand-threads comfort_band. Engine git diff over physics = 0 (this is wiring, not physics).
- **CHECKPOINT:** drift == 0 AND grep clean.

### A3 — reported_gia input + GIA two-role split
- Add `reported_gia` as a metadata input, defaulting to the current geometry-derived GIA on load. Route the EUI denominator to read `reported_gia`. `geometry_floor_area` continues to drive ALL physics (heat loss, mass, envelope) untouched.
- Commit: `Brief 58 A3: reported_gia input + EUI normalised against it (physics stays geometry-driven)`.
- **Verification (falsifiable):** reported_gia == geometry_gia ⇒ Bridgewater EUI == 128.20 exactly. Set reported_gia = 1.1 × geometry ⇒ EUI == 128.20 / 1.1 exactly; absolute kWh (heat loss etc.) UNCHANGED.
- **CHECKPOINT:** both gates pass; no physics number moved.

### A4 — Divergence flag + metadata page assembly
- Flag when `|reported_gia − geometry_gia| / geometry_gia > 10%` (warn: legitimate convention gap OR mis-entered geometry; show both numbers).
- Assemble the metadata page/section holding num_rooms, reported_gia (+ geometry_gia shown read-only for comparison), comfort_band. Move `num_rooms` off the inputs-page-as-tunable to here (single source).
- Commit: `Brief 58 A4: GIA divergence flag + metadata page assembly`.

---

## PART B — Internal-gains restructure: occupancy sensitivity input + DHW basis fix + DHW load-shape toggle

Reads Part A only for `num_rooms`. Occupancy (`people_per_room`) MOVES INTO Internal Gains here.

**Read first:** the occupancy gain path in `computeHourlyGains` (where `people_per_room` feeds occupancy gains); the DHW demand calculation (`annual_occupant_hours × … / 86,400 × hot_fraction`) in instantCalc.js / systemsEngine.js; the tap-mix `hot_fraction` derivation; where `people_per_room` is currently stored and read.

### The occupancy move (people_per_room → Internal Gains, as a sensitivity input)
`people_per_room` is fundamentally an internal gain (it drives occupancy gains), so its home is the Internal Gains section — presented as a first-class **sensitivity lever** (a clearly-placed input Chris can flex to see the effect across gains, cooling, and DHW). This brief OWNS this move/rename; nothing else renames it.

### The DHW bug
DHW energy is currently driven by occupant-HOURS: `annual_occupant_hours × (L/p/day × cp × ΔT)/86,400 × hot_fraction`. The `/86,400` integrates a per-second draw over every occupant-SECOND, so DHW scales with how LONG people are present. **Wrong** — DHW is a per-HEAD event (one guest, one shower, regardless of dwell time). After this part, `annual_occupant_hours` must NOT appear in the DHW path.

### Three layers (each declares its boundary)
1. **Volume→energy (UNCHANGED, correct):** tap-mix `hot_fraction = (tap−cold)/(storage−cold) = 0.64`. Keep.
2. **Demand magnitude (THE FIX):** `dhw_demand_headcount_mwh = occupants × L_per_person_per_day × cp × ΔT_tap × days / 3.6e9`, where `occupants = people_per_room × num_rooms` (occupancy from Internal Gains, num_rooms from Part A).
3. **Load SHAPE (the toggle):** choose whether DHW timing **follows the occupancy hourly profile** (the same profile that drives occupancy gains — so the draw tracks when people are present) OR sits **flat/baseload** (storage decouples draw from carrier). **The annual total kWh is IDENTICAL either way** (hard invariant, <0.01 MWh). The toggle only redistributes across the clock.

NOTE on the tricky bit (Chris flagged): the *magnitude* is always headcount-based; the toggle is purely *timing*. "Follows the fact that it's 3 people" (flat headcount) vs "follows the 3 people's hourly occupancy profile" are the two toggle states — same total, different shape.

### Parts
- **B1 — DHW + occupancy audit (read-only) + hand-calc.** `docs/audit/58_dhw.md`: the current occupant-hours path; the proposed headcount formula; the occupancy-move plan; and the FIRST-PRINCIPLES predicted new DHW demand (occupants × L/p/day × cp × ΔT_tap × 365 / 3.6e9), recorded BEFORE any engine change. Commit: `Brief 58 B1: DHW + occupancy audit + headcount hand-calc (read-only)`. **HARD STOP** — Chris signs off the predicted DHW number and the occupancy-move plan.
- **B2 — Move people_per_room into Internal Gains (sensitivity input).** Relocate the input; occupancy gains read it from its new home; confirm occupancy GAINS are unchanged by the move (same numbers, new location). Commit: `Brief 58 B2: people_per_room → Internal Gains sensitivity input`. Gate: occupancy-gain numbers identical pre/post move; 128.20 held.
- **B3 — DHW headcount basis.** Replace the occupant-hours formula with the headcount formula reading occupancy from Internal Gains. `grep` confirms `annual_occupant_hours` is GONE from the DHW path. Commit: `Brief 58 B3: DHW demand on headcount basis`. Gate: engine DHW demand matches the B1 hand-calc within ±0.5 MWh.
- **B4 — DHW load-shape toggle.** Add the follow-occupancy-profile vs flat-baseload toggle. Commit: `Brief 58 B4: DHW load-shape toggle (follow-occupancy vs flat)`. Gate: annual DHW total IDENTICAL with toggle on vs off (<0.01 MWh); only the hourly/profile shape changes.

---

## PART C — Lighting/gains decoupling fix (correctness)

**Read first:** the lighting / small-power load path AND the lighting/equipment internal-gain path in `computeHourlyGains`; `lightingControlFactor()` and `daylight_factor` (FLAG 4a — confirm they don't double-apply).

### The bug
Toggling lighting / small power OFF changes electricity but NOT internal gains, so heat/cooling demand don't respond. Lighting/equipment electricity ≈100% becomes space gain — the load and its gain are wrongly decoupled.

### Fix
Make the lighting/small-power load and its internal gain ONE entity with two consequences. Toggling or dimming the load moves BOTH the electrical consumption AND the gain (and therefore heating ↑ / cooling ↓ as gains fall). Resolve FLAG 4a in passing: confirm `lightingControlFactor` and `daylight_factor` are not double-applying; reduce to one mechanism.

- Commit(s): `Brief 58 C: lighting/small-power load-gain coupling` (+ a second commit if FLAG 4a needs a separate clean-up).
- **Verification (falsifiable):** disabling lighting drops electricity AND raises heating demand / lowers cooling demand (internal gains fall by the lighting gain). Dimming reduces power AND gain together. Only ONE lighting-control mechanism remains; no double-application.
- Hand-calc first: predict the gain reduction (lighting kWh ≈ gain kWh) and the resulting heating/cooling demand move, then match the engine.

---

## PART D — Auxiliary energy in Internal Gains

A new sub-section WITHIN Internal Gains (rename the module if it now clearly holds more than "gains" — Chris to decide the name at A-stage; default keep "Internal Gains" unless it reads wrong).

**Read first:** the Internal Gains module structure and how gains feed the State 2 demand integral; the gains-layer data model (to add load entities with a gain_fraction).

### What (Chris's spec)
Loads that fill the gap to the metered total: external lighting, catering (electric here), pumps, other small/equipment power. Each load is ONE entity with an electrical consumption AND a first-class `gain_fraction`.

### Gain fractions (Chris's defaults — configurable)
- Default auxiliary gain interaction **~8%**.
- External lighting ≈ **0%** (it's outside — electricity, no space gain).
- Catering **partial** (much exhausted up the hood; ~50% sensible — configurable).
- Internal small power / pumps mostly internal.

### Architecture (Option 1, decided — preserves the chain)
The load is a GAIN with a fuel carrier. Data lives in the GAINS layer (preserves the envelope→gains→demand→systems→fuel flow). The Internal Gains auxiliary sub-section is the editing surface, writing back to the gains layer. Does NOT invert the chain (no systems-feeding-demand-backwards).

- Commit(s): `Brief 58 D: auxiliary-energy loads in Internal Gains (electrical + gain_fraction)`.
- **Verification (falsifiable):** adding an auxiliary load adds electricity AND adds `gain_fraction × consumption` to the heat balance (raises cooling / lowers heating). An external-lighting load at gain_fraction 0 adds electricity but NOT gain. Toggling an auxiliary load moves both consequences (same discipline as Part C).
- Hand-calc first per representative load: predict the electricity add and the gain add, then match.

---

## Walkthrough checklist (Chris, browser, on :5178 verification server)

1. Metadata page shows num_rooms, reported_gia, comfort_band; geometry_gia shown read-only beside reported_gia. ✓/✗
2. reported_gia defaults to geometry_gia → Bridgewater EUI still 128.20. ✓/✗
3. Set reported_gia 10% higher → EUI drops by exactly 1/1.1; absolute kWh unchanged. ✓/✗
4. GIA divergence flag fires >10%, shows both numbers. ✓/✗
5. Change comfort_band on the metadata page → Systems and Scenarios reflect it identically (cross-route drift 0, structural not stopgap). ✓/✗
6. `people_per_room` now lives in Internal Gains as a clearly-placed sensitivity input; flexing it changes occupancy gains, cooling, and DHW together. ✓/✗
7. DHW demand now matches the headcount hand-calc (B1 number); `annual_occupant_hours` no longer drives it. ✓/✗
8. DHW load-shape toggle: flip follow-occupancy vs flat → DHW annual total unchanged, only the profile shape moves. ✓/✗
9. Disable lighting → electricity drops AND heating demand rises / cooling falls (gains moved). ✓/✗
10. Dim lighting → power and gain both reduce. ✓/✗
11. Add an auxiliary catering load → electricity up AND heat balance shifts by its gain fraction. ✓/✗
12. Add an external-lighting load at 0% gain → electricity up, heat balance unchanged. ✓/✗
13. No-intervention baseline still 128.20 at reported==geometry. ✓/✗

---

## What MUST NOT happen

- Do NOT put occupancy on the metadata page — it's a gain, it goes in Internal Gains (Part B).
- Do NOT keep the comfort_band stopgap alive "as a fallback" — A2 RETIRES it.
- Do NOT let `reported_gia` touch the physics — denominator only; geometry drives physics.
- Do NOT override `geometry_floor_area` with a typed number.
- Do NOT let `annual_occupant_hours` survive in the DHW path after B3.
- Do NOT let the DHW load-shape toggle change the annual total (timing only).
- Do NOT invert the chain in Part D (systems feeding demand-side gains) — Option 1 only.
- Do NOT calibrate to hold 128.20 if reported_gia differs — the ratio change is correct.
- Do NOT touch the Schedule tab (deferred).

---

## When to escalate

- A1: the canonical comfort_band resolution point is ambiguous (engine-side vs context-side) — surface for Chris's design call.
- A2 checkpoint: cross-route drift ≠ 0 after retiring the stopgap.
- A3 checkpoint: 128.20 doesn't hold at reported==geometry (the denominator swap touched something it shouldn't).
- B1: the headcount hand-calc and the current engine DHW are wildly different in a way that suggests a second DHW bug — surface before B3.
- B2: occupancy-gain numbers change when people_per_room is moved (the move should be location-only).
- C/D: a fix appears to need a chain inversion or an engine-physics change beyond the stated scope.
- Standard: 3 approaches per failure, then stop and surface.

## Final report (at close)

- Each part's falsifiability gate result (drift 0; 128.20 at reported==geometry; GIA ratio exact; DHW == hand-calc; load-shape total invariant; lighting toggle moves gains; auxiliary load moves both consequences).
- Confirmation `annual_occupant_hours` is gone from the DHW path (grep).
- Confirmation no call site threads comfort_band (grep), stopgap retired.
- Confirmation geometry/physics numbers unchanged (only the denominator moved).
- New anchor statement (should remain 128.20 at reported==geometry; any move derived).

On sign-off: `git mv` brief to `docs/briefs/archive/58_demand_honesty_COMPLETED.md`, STATUS.md close-out, current.md repointed, single push. Update the Notion diagnostics note: comfort_band stopgap retired, occupancy relocated to gains, DHW on headcount basis, auxiliary-energy layer live.

---

## Planned follow-up (NOT this brief)

**Schedule / operating-profile viewer brief.** Elevate the old Schedule-tab question into an operating-profile viewer: for any system or load, show its actual assigned hourly/seasonal profile, reading live from the model. It becomes the verification surface for the demand-shaping this brief creates (confirm the DHW follow-occupancy toggle, the lighting/auxiliary profiles, etc.), built on the Brief-44 interactive-visualiser pattern. Do it AFTER Brief 58, when there are real profiles to render. (Brief 44 open item: if the current Schedule tab reads real schedules, keep+fix; if hardcoded, remove.)

## Other queue (per current.md)

- Brief 51 (panel surfacing) — likely already satisfied by the 4d282ba display fix; RE-READ before opening, probably delete.
- "Show-the-working" panel rows (`delivered ÷ efficiency = fuel` per service) — small UI tweak, do whenever.
- Harness-vs-probe fixture discrepancy (129.60/131.90 — refbox templates leaking into Bridgewater lookup) — PIN before leaning on the harness for Part A's cross-route parity checks.
- Post-Brief-50 audit: State 3 region via line-range URLs; FLAG 2b (third dormant recovery path grep).

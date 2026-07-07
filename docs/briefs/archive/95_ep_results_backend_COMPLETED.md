# Brief 95: EnergyPlus Results Backend for Interventions

**Canonical design notes (Notion, NZA-Sim product page — these win over this brief on any disagreement):**
1. "Design note: EnergyPlus as canonical-results layer for Interventions"
2. "Design note: Interventions library/strategy decoupling + Apply-gated recalc"
Also binding: "Testing Reference Discipline — fixtures vs playground" (Development Bible).

---

## BEFORE DOING ANYTHING

1. Confirm receipt: quote this brief's title and Goal back.
2. **Precondition:** PR #1 (Brief 94) is merged to `main`. If not merged, STOP and say so.
3. Branch: delete the stale empty `chris/ep-interventions-backend`, re-cut it from post-94 `main`, push. All work here.
4. Land this brief at `docs/briefs/active/95_ep_results_backend.md` as Part 1's first commit.
5. Read CLAUDE.md, STATUS.md. Session-start reconciliation. Surface disagreements before working.
6. Fixture baseline: run `scripts/_brief93_anchor.mjs --fixture` — output must be byte-identical to the Brief 94 close record. This brief NEVER changes NZA-Sim engine numbers; this is re-checked at close.

---

## Goal

Give the Interventions module a second results backend: translate the strategy stack (baseline + selected intervention states) into EnergyPlus models, run them as a user-triggered batch, and display EnergyPlus results side-by-side with NZA-Sim's (NZA-Sim | EP | Δ%) per intervention and on the trajectory. Primary investigation target: cooling-affecting interventions, where NZA-Sim's characterised +108% cooling residual makes its numbers least trustworthy and EP's most valuable.

## Intent

NZA-Sim authors at slider speed; EP validates at physics depth. One interventions stack (declarative patches — single source of truth), two results backends. The interaction rule is already set by Brief 94: nothing expensive runs until the user asks (Apply-gating there, a manual "Validate with EnergyPlus" batch here). We are NOT building a second interventions engine and NOT replacing NZA-Sim's displayed numbers — side-by-side first, EP-as-truth is a future toggle, out of scope.

## Scope

**IN:** EP version pin + Box-validation gate · ZZ TEST seed script + CLAUDE.md fixture-rule lines · full-project fixture → IDF generation · patch→EP translation with mappability classification · config-hash-keyed run cache · batch runner with progress · run-selection matrix UI · side-by-side results + trajectory overlay · cooling-interventions delta analysis.

**OUT:** EP-as-truth display mode · multi-zone · physics for percentage-adjustment patches · cost layer (Brief 91b quarantine) · report export of EP results · ANY change to NZA-Sim engine output · auto-run of EP on any state change.

## Decisions already agreed (do not relitigate)

1. One stack, two backends. Translation layer, not a second engine.
2. Runs are user-selected: cumulative chain toggle (N+1 runs) + per-intervention isolated checkboxes (+1 each). Nothing runs unselected.
3. Manual batch trigger only. Progress visible. Instant engine remains the live surface.
4. Config-hash cache: every EP run keyed by a hash of its fully-resolved config; cached results never re-run; isolated runs survive stack reordering by construction.
5. Mappability: physical-parameter patches (fabric U, infiltration, glazing g/U, HRE/SFP, SCOP/EER/efficiency, LPD, EPD, setpoints) → EP. Percentage-adjustment patches → flagged "NZA-Sim only", excluded from EP; the EP cumulative chain skips them with a visible marker.
6. Display: side-by-side NZA-Sim | EP | Δ% per intervention; both engines on the trajectory.
7. EP version: **pin to installed 25-2-0** (Part 1 gates on the Box validation holding against it). 26.1.0 upgrade is a separate future decision.

## Principles

- Fixture rule throughout: every baseline and regression reference cites a committed fixture at a commit — never the live DB. UI verification uses the ZZ TEST project.
- EP results are stored alongside, never written over, NZA-Sim results.
- Deterministic generation: same resolved config → byte-identical IDF (the harness's existing discipline).
- One Part = one commit. Browser verification for UI parts, on ZZ TEST.

---

## PART 1: Version pin, Box gate, ZZ TEST seed, CLAUDE.md

1. Land brief. Set `validation/energyplus/ep_config.json` to the installed EnergyPlus **25-2-0** (path + IDD).
2. **Gate:** re-run the Brief 81–85 Box validation (`validation/compare.py` flow) against 25-2-0. The established tolerances must hold. If any fails → STOP, report the failing metric; the version decision goes back to Chris. This also closes Brief 93's deferred smoke-test caveat.
3. ZZ TEST seed script: `scripts/seed_test_project.mjs` — creates/replaces a project named **"ZZ TEST — do not use"** in the local DB from `validation/fixtures/bridgewater_anchor_v2.yaml`. Idempotent (re-run = clean recreate). Add one header comment to the fixture: "Frozen reference incl. aux-load experiments (EUI 132.6) — do not 'correct'; frozen is the point."
4. Add the fixture rule to CLAUDE.md (two lines: fixtures are the only regression references; UI verification uses ZZ TEST, never Chris's projects).
5. Commit: `Brief 95 P1: EP pinned 25-2-0 (Box gate PASS) + ZZ TEST seed + fixture rule in CLAUDE.md`.

**Falsifiable:** compare.py tolerance table pasted into `docs/audit/95_ep_backend.md`, all rows PASS; seed script run twice → exactly one ZZ TEST project.

## PART 2: Full-project fixture → runnable IDF

Extend the harness generator (currently Box-fixture-only) to consume the **full project-dump fixture** (`bridgewater_anchor_v2.yaml`): real geometry, real constructions, infiltration, the per-system ventilation set (MVHR units + extract), DHW (gas calorifier + ASHP preheat two-stage), heating/cooling systems (VRF via the established PTHP surrogate + performance curves), lighting/equipment loads, and schedules resolved from the fixture.

1. `validation/energyplus/generate_full_idf.py` (or extend `generate_idf.py` with a fixture-shape switch — implementer's choice, document it).
2. Run the generated IDF in EP 25-2-0 with the project's weather file. Zero fatal errors. Severe warnings listed in the audit doc with one-line dispositions.
3. Determinism: build twice → byte-identical.
4. Commit: `Brief 95 P2: full-Bridgewater IDF generation — runs clean on 25-2-0`.

**Falsifiable:** `.err` fatal count = 0; determinism check output in audit doc; EP annual results parse to the normalised shape the harness already defines.

## PART 3: Baseline dual-engine characterisation

Run the frozen fixture through BOTH engines. Record in the audit doc, per metric (EUI, heating, cooling, DHW, mech-vent, gas, elec, monthly heating/cooling shapes): NZA-Sim | EP | Δ%.

This is **characterisation, not pass/fail** — the Box arc predicts heating −24% / cooling +108% territory; the full building will differ. No tolerance gate; the table IS the deliverable. It becomes the reference frame for reading every intervention delta in P8.

Commit: `Brief 95 P3: baseline dual-engine characterisation table`.

**Falsifiable:** complete table in audit doc, no blank cells, monthly shapes plotted or tabulated.

## PART 4: Patch translation + state builder + mappability

1. **Classifier:** every library intervention's patches classed physical vs percentage at read time. Physical patch keys map to EP model edits; anything else → `nza_sim_only: true`.
2. **State builder:** from the strategy refs (enabled, ordered): baseline state; cumulative prefix states (skipping NZA-Sim-only items, with the skip recorded on the state); isolated states (baseline + one item). Each state = fully-resolved project config.
3. **Config hash:** stable hash of the resolved config (sorted-key canonical JSON). Unit-test: reordering the stack does not change isolated-state hashes; toggling an unrelated item does not change others' hashes.
4. **Translation:** resolved config → IDF via P2's generator. Every physical patch type in the Bridgewater stack must translate; a physical patch with no mapping → escalate, don't silently drop.
5. Commit: `Brief 95 P4: patch translation, state builder, config-hash — unit-tested`.

**Falsifiable:** unit tests green covering: hash stability properties above; a mixed stack (physical + percentage) yields correct state count with skips recorded; two different U-value patches produce differing IDFs at exactly the construction being patched.

## PART 5: Batch runner + cache

1. DB: `ep_runs` table — config_hash (unique), state descriptor, status, started/finished, normalised results JSON, EP version, fixture/commit provenance.
2. Runner: queue of selected states → sequential EP execution (one at a time; these are minutes-scale) → parse → store. Cached hash → skip, mark "cached". Failures stored with the `.err` tail, never retried silently.
3. API: start batch, poll progress (per-state status), fetch results.
4. Commit: `Brief 95 P5: EP batch runner + config-hash cache`.

**Falsifiable:** run a 2-state batch twice — second invocation performs 0 EP executions, both served from cache; a deliberately-broken state records FAILED with error tail and doesn't block the rest of the queue.

## PART 6: Run-selection UI + trigger

In the Interventions module (strategy view):
1. "Validate with EnergyPlus" panel: cumulative-chain toggle + per-intervention isolated checkboxes. NZA-Sim-only items shown disabled with the flag. Live count: "7 runs selected · ~N min · 3 cached".
2. Run button → progress (per-state: queued/running/done/failed/cached). Non-blocking — the rest of the app stays usable.
3. Browser verification on **ZZ TEST**.
4. Commit: `Brief 95 P6: run-selection matrix + batch trigger UI`.

**Falsifiable (browser, ZZ TEST):** selecting/deselecting updates the run count correctly (cumulative = enabled-mappable N+1); cached states shown as cached before running; progress reflects the queue live.

## PART 7: Side-by-side results

1. Per-intervention results (marginal/cumulative/isolated views): add EP columns — NZA-Sim | EP | Δ% — populated where a matching config-hash result exists; em-dash where not run; "NZA-Sim only" badge where unmappable.
2. Trajectory: EP-derived line/points overlaid alongside NZA-Sim's (visually distinct, labelled). NZA-Sim's line unchanged.
3. Stale-guard: if the stack or a definition changed since a result's hash was computed, the EP figure greys out as "stale — re-run" (hash mismatch does this for free).
4. Browser verification on ZZ TEST.
5. Commit: `Brief 95 P7: side-by-side NZA-Sim | EP | Δ% + trajectory overlay`.

**Falsifiable (browser):** edit a definition + Apply → its EP cells grey to stale; re-run → repopulate; NZA-Sim numbers identical throughout (fixture anchor spot-check).

## PART 8: Cooling delta investigation (the payoff)

1. On ZZ TEST's stack, run isolated EP states for every cooling-affecting intervention present (solar control glazing, shading, ventilation strategy, setpoint changes — whatever the stack holds).
2. Write `docs/audit/95_cooling_deltas.md`: per intervention — NZA-Sim isolated impact | EP isolated impact | Δ%, against the P3 baseline frame; 3–5 sentences of honest reading (where the +108% residual shows up, whether intervention *deltas* track better than absolute levels — they may).
3. Commit: `Brief 95 P8: cooling-interventions delta analysis`.

**Falsifiable:** every cooling-affecting item in the stack has a filled row; the note distinguishes level-error from delta-error explicitly.

## PART 9: Close

1. Fixture invariant: `--fixture` anchor byte-identical to P1. Any drift → do not close, escalate.
2. STATUS.md, archive brief, repoint current.md, push, open PR to main. Do NOT merge — Chris walkthrough + independent review first.
3. Report: Box gate result, baseline characterisation headline, cache hit demo, cooling-delta headline, run-time per EP state.

---

## What MUST NOT happen

- No changes to NZA-Sim engine output — `instantCalc.js` and the calibration pathway untouched (fixture anchor enforces this).
- No EP auto-runs on state change, ever.
- No cost-layer edits (Brief 91b quarantine).
- EP results never overwrite or restyle NZA-Sim's results — side-by-side only.
- No live-DB baselines anywhere; UI verification only on ZZ TEST.
- No silent retry of failed EP runs; no silent dropping of unmappable-but-physical patches.

## Escalate / stop when

- P1 Box gate fails any tolerance against 25-2-0 → version decision returns to Chris.
- Full-building IDF fatal errors survive 3 distinct fix attempts → report the `.err` diagnosis + options.
- Per-state EP runtime exceeds ~5 min → batch UX assumption breaks; report before building further.
- A physical patch type in the real stack has no honest EP mapping.
- Closing fixture anchor drifts.

## Independent review (mandatory — engine-adjacent)

After P9, Claude Chat reads on GitHub: the translation layer + state builder + hash tests, the full-IDF generator diff, one generated IDF vs its config, the P3/P8 audit tables, and the stale-guard wiring. Merging agent doesn't grade.

## Close

Archive · STATUS · current.md · PR open · Chris walkthrough on ZZ TEST: select runs → watch batch → read side-by-side → check a cooling intervention's Δ% → confirm NZA-Sim numbers never moved.

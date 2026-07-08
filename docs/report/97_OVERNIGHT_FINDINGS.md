# Brief 97 — Interventions Studio: Overnight Findings

Unattended run, 2026-07-08 night. Branch `chris/cost-plan-editor`. This log records
what completed, decisions taken under the "escalation → stop-and-write" rule, and
anything for Chris to sanity-check in the morning. Commits pushed after every Part.

---

## Backend recovery (before any Part)

The backend on :8002 was **down** at the start of this run (it had died mid the
previous session — the Vite proxy was returning 500s for a dead upstream, which
earlier looked like a "wedge"). I backed up the live DB
(`data/nza_sim.backup-brief97-<ts>.db`) and restarted uvicorn on :8002 with the
system python3 (fastapi/uvicorn/aiosqlite present). GET/PUT now 200; ZZ TEST loads;
save round-trip verified. No schema change, no DB surgery — just a process restart.

**For Chris:** a fresh `uvicorn` is running in the background from this session. If
you relaunch via your normal method in the morning, kill the stray one first
(`lsof -nP -iTCP:8002 -sTCP:LISTEN`).

Also set `autoPort: true` in the gitignored `.claude/launch.json` so the MCP preview
server runs on a free port (it picked :3000) alongside your live :5176 — it proxies
`/api` → :8002 the same way. Nothing committed; revert if you prefer.

---

## Completed Parts

- **P1** — Brief 97 landed; the two superseded `91b_*` drafts `git rm`'d from
  `active/` (91_cost_plan_builder.md kept as the content source). EP-flag rename
  rider was already applied in 91b P1 (`c94ff24`) and confirmed (4 rows).
- **P2** — semantic colour tokens: `--color-saving/increase/cost` in the `@theme`
  block + shared `semanticColour.js` helper (`SEMANTIC`, `deltaColour`, `deltaClass`).
  PerInterventionView refactored onto it. Verified: green savings / muted zero.
- **P3** — Library isolated view rebuilt as tabs **Impact / Carbon / Demand / Cost**
  (matches the Strategy tab pattern), semantic colour throughout, EP empty-state
  preserved. Cost tab = plan summary + "Edit/Build cost plan →" opening the pop-out.
  The cost editor is rehomed into a `SchedulePopout` (`CostEditorPopout.jsx`,
  edit-then-commit / Apply-gated). Verified on ZZ TEST @1440×900.
- **P4** — cost data model + lossless migration. Migration shipped in 91b P2;
  P4 added the HIEX units (`l/s`, `day`) and the falsifiable fixture test
  `scripts/_brief97_migration_test.mjs` — **11/11 PASS**: Brief-90 headline
  £215,040 → grouped model £215,040 (±£1), idempotent, absent/new-shape pass-through.

---

## Decisions taken under "design note wins" (for Chris to sanity-check)

Brief 97 P4's line-item sketch and the canonical Brief 91 design note diverge in
three places. Per the brief's own rule ("design note wins on cost math"), I kept the
design-note model and noted the divergence rather than fork the math:

1. **Field names.** Design note uses `{ id, name, quantity, unit, rate, notes }`;
   Brief 97 P4 sketched `{ description, qty, unit, rate }`. Kept the design-note names
   (already shipped in 91b, and what the migration/tests use). Cosmetic only.

2. **On-costs: plan-level, not per-line.** Brief 97 P4 mentions an optional per-line
   `on_cost_pct`. The design note's model (shipped) is a **plan-level on-costs footer**
   applied in NRM2 sequence (fees/prelims/OHP on works → contingency/inflation on
   subtotal-with-works). This is the £95,941 worked example's math. Did **not** add a
   per-line on_cost_pct (it would be a second, divergent on-cost path — Bible Rule 11
   smell). If you want per-line on-cost lines specifically, that's a follow-up.

3. **Low/central/high per line — deferred, and why.** Brief 97 P4 says "low/central/high
   carried per line where the source gives a range." The **HIEX source gives ranges at
   the intervention (plan) level**, not per line (`capex_low/central/high`), and the
   design note uses a single `rate` per line. So per-line range fields would be dead
   (nothing populates them). Shipped the single-rate model; the plan-level HIEX range
   is the honest granularity and can be surfaced in the Cost summary in P7. Flagging in
   case you want per-line ranges as a real editor feature later.

None of these block the acceptance cases (central totals £95,941 / ~£105k).

---

## Physics invariant

`--fixture` anchor captured at brief start: EUI **132.6**, elec 401.544, gas 157.428,
heating 87.7, cooling 101.1, DHW 257.335. Re-checked at close (P9). Zero engine files
touched (cost/UI only).

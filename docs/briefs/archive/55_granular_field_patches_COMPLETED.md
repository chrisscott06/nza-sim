# Brief 55 — Granular field-level system patches (fix order-dependent intervention stacking)

**Type:** Architecture fix brief (Tier 3). This is the CORRECTNESS fix for the patch-overlap bug (Finding D), with a live reproduction in hand.
**Depends on:** Brief 53 closed. Runs against the isolated verification DB (port 8003, anchor 128.20). NO concurrent engine-physics work.
**Engine baseline:** verification DB Bridgewater clean 128.20. The no-intervention baseline MUST stay 128.20 — this brief changes how interventions PATCH, not the engine physics.
**Canonical context:** Diagnostics note `367d645e-05cc-81af-93d7-fc57bfc45faf` → "Finding D" entries (CORRECTION 25 May + REPRODUCED LIVE 26 May).

---

## Background — the bug, stated plainly

When you create a system intervention (e.g. "VRF 4.0"), the tool stores a **whole-object snapshot** of the entire `systems config v40` — every system, every share, the MVHR, all of it — with the one field changed. Same for "MVHR Bedrooms". When two such interventions are STACKED, the tool applies the snapshots one on top of another, and a snapshot says "the systems config IS this entire picture" — so whichever intervention is applied LAST overwrites the system state of everything below it (last-write-wins). The "Overridden by a later intervention" warning is this mechanism.

**The engine is innocent.** It computes correct EUI for whatever inputs it receives. The bug is upstream: the intervention layer hands it DIFFERENT inputs depending on stack order, because the snapshots collide before the engine runs. The engine does perfect arithmetic on the wrong numbers.

### Live reproduction (Brief 53 walkthrough, 26 May 2026) — the falsifiability fixture
Same two interventions, two orders, two DIFFERENT cumulative after-stack EUIs:
| Order | Marginals | After-stack EUI |
|---|---|---|
| [VRF 4.0, MVHR Bedrooms] | VRF −7.5, MVHR **+5.8** | **130** |
| [MVHR Bedrooms, VRF 4.0] | MVHR −1.7, VRF −5.8 | **124** |

**130 ≠ 124 is the bug.** The cumulative state after applying the same two measures to the same baseline MUST be order-independent. It isn't. Also: MVHR showing **+5.8 (an INCREASE)** violates the hard invariant that an isolated SCOP/demand-reducer can never raise EUI — it's being charged for system state the other snapshot overwrote.

### The fix, in one sentence
Stop storing snapshots; store **edits**. "VRF 4.0" stores only "set heating efficiency_metric = 4.0". "MVHR Bedrooms" stores only the field(s) it changes. Stacked, they no longer overwrite each other — each changes its own field, they COMPOSE, and the cumulative becomes order-independent (130/124 → one number).

### Why this is "one fix, three wins"
The whole-object snapshot is the root of THREE logged problems:
1. **Order-dependent cumulative / last-write-wins** (this brief's primary target).
2. **Broad PatchedInputBadge prefix-matching** — badges highlight too many fields because the patch is the whole object, not the changed field.
3. **No per-field change flags** (deferred from Brief 47) — impossible while patches are whole-object; trivial once patches are field-level.
Field-level patching fixes the root, so all three resolve together.

---

## BEFORE DOING ANYTHING
1. Read this brief in full. Confirm receipt by quoting the title + the Background's first line.
2. Read CLAUDE.md / STATUS.md / current.md. Confirm Brief 53 is CLOSED and you're on the verification DB (8003).
3. Read the code you will touch BEFORE touching it:
   - **Brief 41 §6 patch semantics** — how interventions store and apply patches. Find where a system intervention's patch is captured (the `systems config v40` whole-object snapshot) and where it's applied to produce each stacked state.
   - `interventionsEngine.js` — the stack runner that applies patches cumulatively (the marginal/cumulative pass). Confirm it applies patches by REPLACING the systems object vs MERGING.
   - The intervention editor — where a system edit becomes a patch (this is where the snapshot is captured; it must instead capture only the changed field path + value).
   - `PatchedInputBadge` prefix-matching logic (win #2) and any per-field-flag plumbing (win #3).
   - The patch SHAPE/type definition — what a patch object looks like today (whole `systems_config_v40`) vs what it must become (a list of `{path, value}` field edits, or a deep-merge partial).
4. Produce `docs/audit/55_granular_patch.md` BEFORE code: the current patch shape; the proposed field-level patch shape; every place patches are captured, stored, applied, and read (badges); the migration story for EXISTING saved interventions (whole-object snapshots already in projects) — they must keep working or be migrated.

---

## Scope
**In scope:** the patch representation for SYSTEM interventions (whole-object → field-level/merge); the capture point (editor), the apply point (stack runner), and the read points (PatchedInputBadge, per-field flags); migration of existing saved system-intervention patches.

**Out of scope (do NOT touch):**
- Engine physics (instantCalc.js / systemsEngine.js demand/fuel math). The engine is innocent — this is the patch layer only. If a fix seems to need engine changes, STOP and surface.
- Non-system interventions (envelope/fabric, infiltration, etc.) IF they already patch granularly — confirm in the audit; only convert whole-object ones. (Many envelope interventions may already be field-level; check before touching.)
- The marginal/cumulative telescoping math itself (it's correct by construction — Brief 48 §7.2; the inputs feeding it are the problem, not the math).
- DHW basis (52), metadata (54), ventilation (53 done), auxiliary-energy layer (future). No feature work.

---

## Principles
1. **Patches are edits, not snapshots.** A system intervention stores only the field path(s) it changes and the new value(s) — never the whole config.
2. **Composition over replacement.** Stacking applies edits cumulatively; two interventions touching DIFFERENT fields both survive; two touching the SAME field is the only legitimate last-write-wins case (and should be flagged to the user as a genuine conflict, not silently resolved).
3. **Order-independence is the acceptance test.** Same set of interventions, any order → same cumulative. This is the falsifiability gate, with the 130/124 reproduction as the fixture.
4. **Engine untouched.** The 128.20 baseline holds; only the inputs-assembly changes.
5. **No silent conflict.** If two interventions genuinely edit the same field, surface it (the "Overridden" warning becomes a real same-field-conflict signal, not a side effect of snapshot collision).
6. **Existing interventions must not break.** Migrate or back-compat the whole-object snapshots already saved in projects.

---

## Parts (one commit each)

### Part 1 — Patch-layer audit (read-only)
- `docs/audit/55_granular_patch.md`: current patch shape (whole-object); proposed field-level shape; capture/store/apply/read map; which intervention types are already granular vs whole-object; migration plan for existing saved patches; confirm the engine needs NO change.
- Reproduce the 130/124 fixture on the verification DB and record it as the PRE-FIX baseline (the exact two-order test).
- Commit: `Brief 55 Part 1: patch-layer audit + 130/124 reproduction baseline (read-only)`.
- **CHECKPOINT:** the field-level patch shape + migration plan agreed with Chris BEFORE refactoring. Confirm engine is out of scope (no instantCalc/systemsEngine edits needed).

### Part 2 — Field-level patch representation + apply (the core fix)
- Change the system-intervention patch from whole `systems_config_v40` snapshot to a field-level representation (`{path, value}` edits, or a deep-merge partial — pick per Part 1 and document).
- Change the stack runner to APPLY patches by deep-merge/field-set onto the cumulative state, not by replacing the systems object. Two interventions on different fields compose.
- Migrate existing saved whole-object patches (Part 1's plan): either convert on load to field-level, or detect-and-handle. Existing projects must still open and compute.
- **Falsifiability (the fixture):** re-run the two-order test. [VRF, MVHR] cumulative MUST equal [MVHR, VRF] cumulative. The 130/124 must collapse to ONE number.
- Commit: `Brief 55 Part 2: field-level system patches — compose instead of collide`.
- **CHECKPOINT (primary gate):** cumulative after-stack is order-independent (C1 == C2 to rounding). If they still differ, the merge isn't composing — STOP and surface. AND: no intervention shows a positive marginal unless a real physical mechanism exists (MVHR/VRF must not show +increase).

### Part 3 — SCOP-invariant + marginal-reconciliation verification (on the reference box)
- Use the reference box (not Bridgewater): add a SCOP-improvement intervention + an MVHR intervention; reorder through every permutation; assert:
  - cumulative constant across all orders;
  - isolated SCOP improvement → ΔEUI ≤ 0 at every position (never positive);
  - marginals reconcile to cumulative differences at each position (telescoping holds).
- Commit: `Brief 55 Part 3: refbox order-independence + SCOP-invariant regression fixture`.
- **CHECKPOINT:** all three refbox assertions pass. This fixture becomes the permanent regression guard for the patch layer.

### Part 4 — PatchedInputBadge precision + per-field change flags (the other two wins)
- Now patches are field-level, fix PatchedInputBadge to highlight ONLY the changed field(s), not the broad prefix match.
- Wire per-field change flags (deferred from Brief 47) — now trivial since the patch declares exactly which fields changed.
- Commit: `Brief 55 Part 4: precise patch badges + per-field change flags (enabled by granular patches)`.

### Part 5 — Same-field conflict signal
- When two stacked interventions genuinely edit the SAME field, surface a real conflict signal (repurpose/clarify the "Overridden by a later intervention" warning so it now means "two interventions edit this same field" — a legitimate user-facing conflict, not a snapshot artefact).
- Commit: `Brief 55 Part 5: genuine same-field conflict signal`.

### Part 6 — Walkthrough + close
- Report: 130/124 → one number; refbox order-independence + SCOP-invariant pass; badges precise; existing projects still open.
- Chris browser walkthrough (below).
- On sign-off: archive, STATUS.md (note patch layer now field-level, Finding D closed), current.md repoint, mark Finding D RESOLVED in the diagnostics note.

---

## Falsifiability targets (the fix is wrong if any fail)
1. **Order-independence (PRIMARY):** [VRF, MVHR] after-stack EUI == [MVHR, VRF] after-stack EUI. The 130/124 collapses to one number.
2. **No spurious increase:** no isolated SCOP/demand-reducer intervention shows a positive marginal at any position (unless a real mechanism, e.g. airtightness→cooling, is identified and explained).
3. **Marginals reconcile:** each intervention's marginal == (cumulative-with) − (cumulative-without) at its position (telescoping intact).
4. **Baseline untouched:** no-intervention verification DB = 128.20 exactly; engine files unchanged (`git diff` shows no instantCalc/systemsEngine physics edits).
5. **Refbox regression fixture:** the Part 3 permutation test passes and is committed as a permanent guard.
6. **Existing projects:** saved whole-object interventions still open and compute (migration works).
7. **Badges precise:** PatchedInputBadge highlights only changed fields.

## What MUST NOT happen
- Do NOT touch engine physics — the engine is innocent; this is the patch layer.
- Do NOT "fix" order-dependence by forcing a canonical sort order — that hides the bug; the cumulative must be genuinely order-independent because patches compose.
- Do NOT silently resolve same-field conflicts — surface them (Principle 5).
- Do NOT break existing saved interventions — migrate them.
- Do NOT calibrate; the engine numbers fall out of correctly-composed inputs.
- Do NOT expand into DHW/metadata/auxiliary-energy feature work.

## When to escalate
- Part 1: the fix appears to need engine changes (it shouldn't — if it does, the diagnosis is wrong, surface it).
- Part 2 checkpoint: cumulative still order-dependent after merge (composition isn't working), OR existing projects fail to open (migration broke).
- Part 3: SCOP invariant still violated on the refbox (a deeper attribution issue beyond patch overlap).
- Three-approach limit per failure, then stop.

## Walkthrough checklist (Chris, browser)
1. Verification DB baseline still 128.20 (or live-DB equivalent), no-intervention. ✓/✗
2. Stack [VRF 4.0, MVHR Bedrooms] → note after-stack EUI. ✓/✗
3. Reorder to [MVHR Bedrooms, VRF 4.0] → after-stack EUI is THE SAME. ✓/✗ (the 130/124 fix)
4. Neither intervention shows a positive marginal (no spurious +increase). ✓/✗
5. A genuinely same-field pair (two interventions editing the same SCOP) surfaces a clear conflict signal. ✓/✗
6. PatchedInputBadge highlights only the field each intervention changed. ✓/✗
7. An older saved project with existing interventions still opens and computes. ✓/✗
8. Marginal/cumulative waterfall still reconciles (telescoping). ✓/✗

## Sequencing note
After this (Finding D closed): the demand-honesty cluster — DHW basis (52), metadata page (54, retires comfort_band stopgap), auxiliary-energy layer (new), and the lighting/gains-decoupling bug. Plus Brief 51 (panel surfacing) and the post-Brief-50 audit (FLAG 2b/4a greps). Correctness (this brief) before features (that cluster).

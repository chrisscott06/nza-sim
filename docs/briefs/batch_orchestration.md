# Batch Orchestration — Brief 27 Cleanup + Brief 28 + Brief 29

**Status:** Active. Sequential execution with halt conditions and progress checkpointing.

**Started:** _(Claude Code fills in)_
**Last updated:** _(Claude Code updates each part)_
**Current state:** `pending` | `running` | `halted_for_review` | `complete`

---

## What's in this batch

Five briefs in sequence. Each brief's individual file is in `docs/briefs/active/`:

1. **`27_cleanup.md`** — Heat Balance prop bug + divergence doc correction. ~1 hour.
2. **`28_prereq_free_running_ep.md`** — Run and persist a true free-running EP simulation for Bridgewater so engines compare comparable outputs. ~3 days.
3. **`28a_visible_polish.md`** — Static/Dynamic rename, kWh/m²·yr readouts, canvas restructure, Pavlo port, engine toggle wiring. ~2 weeks.
4. **`28b_physics_overhaul.md`** — Solar model upgrade (HDKR/Perez), multi-layer CTF mass model in Static engine. ~3 weeks.
5. **`29_building_completion.md`** — State 1 diagnostic views (Free-running Temp, Heat Loss Breakdown), Building UI principles conformance, constants cleanup, BREDEM phasing factors. ~2 weeks.

Total estimated time: ~7 weeks of focused work.

---

## Execution rules

### Sequence

Briefs execute in order. Do not start Brief N+1 until Brief N is genuinely complete (regression green, completion checklist filled, archive done).

The progress document (`docs/batch_progress_2026_05.md`) is updated at every part boundary.

### Pre-flight checks before starting each brief

1. State 1 isolation regression: 40/40 byte-identical (Live + EP both)
2. State 2 isolation regression: 21/21 byte-identical (Live + EP both)
3. Build clean (`npm run build` / equivalent — no errors)
4. Git working tree clean (no uncommitted changes from previous brief)
5. Last commit is the close-out of the previous brief, archive file in place

If any pre-flight fails, halt before starting the brief and report.

### Per-part discipline

Each brief is structured into parts. Each part:

1. Reads relevant context (state contracts, divergences doc, completion checklist)
2. Does the work
3. Verifies per the part's verification criteria
4. Updates `docs/batch_progress_2026_05.md` with status, commit hash, key decisions
5. Commits with a clear message
6. Pushes

### Brief close-out

Each brief closes with:
1. Completion checklist filled in (`docs/module_checklists/{module_or_brief}_{brief_id}.md`)
2. STATUS.md narrative updated
3. Brief file moved from `docs/briefs/active/` to `docs/briefs/archive/` with `_COMPLETED.md` suffix
4. `current.md` updated to point at the next brief in the batch
5. Pre-flight checks for the next brief verified

Then proceed to the next brief without pause.

---

## Halt conditions

### Hard halts — immediate stop

Stop all work, commit current state to a WIP branch (do NOT merge to main), update progress doc to `halted_for_review`, write halt report.

- **HH1.** State isolation regression breaks. Was 40/40, drops to anything less for State 1; same for 21/21 on State 2.
- **HH2.** BREDEM expected ranges aren't met after the brief's fixes have landed and the brief claims completion.
- **HH3.** A walkthrough-blocking bug is discovered mid-brief that can't be cleanly fixed within the current part.
- **HH4.** A finding emerges that suggests the brief's premise is wrong (like the physics audit invalidating original Brief 28's solar-fix priority).
- **HH5.** Build breaks and can't be fixed within the same part.
- **HH6.** A test that was passing starts failing without a clear understanding of why.

### Soft halts — complete current part, then halt

Finish the part in flight cleanly, commit, then halt and report. Don't start the next part.

- **SH1.** BREDEM expected ranges miss by more than 30% in a direction the brief didn't predict.
- **SH2.** Engine agreement (Static vs Dynamic) materially worse at part-end than at brief-start.
- **SH3.** Confidence in completion checklist drops below 6/10 on the brief just completed (don't proceed to next brief).

### Not halt-worthy — document and proceed

- Aesthetic UI choices where the brief is ambiguous (apply `docs/ui_principles.md`, document choice in progress doc)
- Library/implementation choices where multiple are reasonable (pick one, document why)
- Minor scope ambiguities (resolve per closest analogous decision in existing codebase, document)
- Performance optimisations that could wait (defer to backlog, document)

### Halt report format

When halted, write `docs/batch_halt_report.md` with:

```markdown
# Batch Halt Report — {date} {time}

**Halt condition triggered:** {HH1 / HH2 / ... / SH1 / SH2 / SH3}
**Brief:** {brief id}
**Part:** {part id}
**Specific issue:** {one paragraph}

## What was attempted
{narrative}

## What's blocking
{specific blocker}

## What's needed from Chris
{specific decision or input required}

## State of the work
- WIP branch: {branch name}
- Last clean commit: {hash}
- Files modified but not committed: {list}
```

---

## Progress document format

`docs/batch_progress_2026_05.md` — updated after each part. Format:

```markdown
# Batch Progress — Brief 27 Cleanup + Brief 28 + Brief 29

**Current state:** running
**Last update:** {timestamp}

## Brief 27 Cleanup
| Part | Status | Start | End | Commit | Notes |
|------|--------|-------|-----|--------|-------|
| 1. Heat Balance prop bug | complete | ... | ... | abc123 | |
| 2. Divergence doc correction | in-progress | ... | | | |

## Brief 28a Visible Polish
| Part | Status | ... | ... | ... | ... |

(etc.)

## Decisions log

Format: {part id} — {decision} — {rationale}

## Halts

(empty if none)
```

---

## Brief 28b warning — physics scoping caveat

The physics audit invalidated several assumptions from Brief 28's original scope. Specifically:

- The "23.5% conduction divergence" pattern was an artefact of comparing Static's free-running output to a Dynamic run that was HVAC-clamped, not free-running.
- The "38% solar over-count" was overstated by ~10×. Real per-facade deviation is +19% NNE / −10% SSW, aggregate +1%.
- The dominant cause of Static's summer max divergence is the lumped two-node mass model, not the sky model.

Brief 28b (physics overhaul) is being scoped on the basis of the audit's recommendations, but the audit itself notes that the prerequisite (a true free-running EP run, which is Brief 28-prereq in this batch) hasn't been done yet. When that prereq lands, the actual divergence picture may shift.

**If during Brief 28b, findings suggest a different physics fix is the right priority, halt under HH4 and flag rather than completing a fix that doesn't address the real problem.** This is the safety valve. The intent is not to "complete Brief 28b at all costs" — it is to do the right physics work, even if that means halting and re-scoping.

---

## Walkthrough strategy

All briefs in this batch complete without your walkthrough. Walkthroughs happen in a batch at the end:

1. When all 5 briefs are complete, halt automatically with state `complete_pending_walkthrough`.
2. Update progress doc with full summary.
3. Wait for Chris's walkthrough verdict before any further work.

Confidence ratings in completion checklists are Claude Code's self-assessment. Chris's walkthrough may produce a different rating, in which case follow-up briefs queue.

---

## What this batch is NOT

- Not a substitute for state progression beyond State 2. Brief 30 (Operation v2 / State 2.5) and beyond are not in this batch.
- Not a substitute for Chris's design decisions on big architecture (e.g., the multi-layer CTF approach to thermal mass is a category choice Claude Code makes, not a design Chris pre-approved).
- Not a substitute for Chris's domain judgement (e.g., whether BREDEM expected ranges should be revised for building-type-specific phasing).

If a decision in this batch crosses into "Chris should weigh in," document and proceed conservatively (default to the closest existing pattern) and flag for review at the walkthrough.

---

## Estimated timeline

| Brief | Estimate | Cumulative |
|-------|----------|------------|
| 27 cleanup | 1 hour | 1 hour |
| 28-prereq free-running EP | 3 days | 3 days |
| 28a visible polish | 2 weeks | ~2.5 weeks |
| 28b physics overhaul | 3 weeks | ~5.5 weeks |
| 29 building completion | 2 weeks | ~7.5 weeks |

Total: ~7-8 weeks of focused Claude Code work, depending on what surfaces.

---

## Sequence rationale

**Why 27 cleanup first:** Five-minute work that unblocks Heat Balance. Easy win, low risk, gets one bug off the list.

**Why divergence doc correction second:** Same housekeeping batch. Corrects an overstated claim before it propagates into more docs.

**Why free-running EP prereq before Brief 28a:** Engine toggle wiring in Brief 28a Part 5 needs both engines producing comparable outputs. Without the free-running EP run, the toggle would show divergence that isn't physically meaningful — exactly what the audit warned against. Doing the prereq first means the toggle, when shipped, is genuinely useful.

**Why Brief 28a (visible polish) before Brief 28b (physics overhaul):** Visible improvements ship sooner; physics work has more uncertainty; the audit's findings on physics priorities depend on data we'll have after Brief 28a. Pause-and-reassess opportunity at Brief 28a close.

**Why Brief 29 last:** Depends on Brief 28a's chart components (Pavlo port), Brief 28b's physics improvements (so Building module's diagnostic views are honest), and the established UI patterns. Lands the State 1 diagnostic views that have been deferred since Brief 26.1.

---

## Starting checklist

Before kicking off Brief 27 cleanup:

- [ ] All 5 brief files in `docs/briefs/active/`
- [ ] Progress document `docs/batch_progress_2026_05.md` created and initialised
- [ ] Halt report template understood
- [ ] Pre-flight checks pass on current main:
  - [ ] State 1 isolation: 40/40 byte-identical
  - [ ] State 2 isolation: 21/21 byte-identical
  - [ ] Build clean
  - [ ] Git working tree clean
  - [ ] `current.md` points at Brief 28 (will be updated as briefs complete)
- [ ] Confirm understanding: walkthrough is at the END of the batch, not between briefs

When all the above is true, start with Brief 27 cleanup.

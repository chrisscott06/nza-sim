# Current brief

**Active:** [`active/27_cleanup.md`](active/27_cleanup.md) — Heat Balance prop bug + divergence doc correction. ~1 hour.

This pointer file is updated each time a brief in the batch closes. See [`batch_orchestration.md`](batch_orchestration.md) for the full 5-brief plan, sequencing, halt conditions, and per-part discipline.

## Batch state (Brief 27 cleanup + Brief 28 + Brief 29)

| Order | Brief | Status |
|-------|-------|--------|
| 1 | [`active/27_cleanup.md`](active/27_cleanup.md) | in flight |
| 2 | [`active/28_prereq_free_running_ep.md`](active/28_prereq_free_running_ep.md) | queued |
| 3 | [`active/28a_visible_polish.md`](active/28a_visible_polish.md) | queued |
| 4 | [`active/28b_physics_overhaul.md`](active/28b_physics_overhaul.md) | queued |
| 5 | [`active/29_building_completion.md`](active/29_building_completion.md) | queued |

After all 5 briefs close, batch halts under `complete_pending_walkthrough` and waits for Chris's walkthrough verdict.

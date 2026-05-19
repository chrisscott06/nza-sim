# Brief 42 — Per-opening cd + flow_mode migration audit

**Status:** Bridgewater pre-fields documented from persisted state at session start; post-fields to be backfilled by Chris after running `scripts/42_per_opening_cd_flowmode_migration.py` (Part 3 deliverable) and the Part 5 walkthrough.

**Linked work:**
- Brief 42 Part 1 (schema): commit `0b4dcb6`
- Brief 42 Part 2 (engine, three-location parity): commit `29e3609`
- Brief 42 Part 3 (this audit + migration script): commit pending
- Brief 41 Part 5 / Issue #17 (predecessor — operable-opening flow_mode dispatch): closed, `5bbdbd1`

---

## Migration contract

The script reads each project's persisted `building.openings.cd` and `building.openings.flow_mode`, writes those values onto every per-facade entry (north / south / east / west) and onto every operable opening (`operable_openings[]`), then removes the building-wide fields. `openings.site_exposure` stays building-wide.

Behaviour at migration time is unchanged because the per-opening values are *copies* of the building-wide values (Brief 42 Principle 5 — "Migration must preserve current behaviour"). Per-opening divergence happens after the user edits in Parts 4 / 5.

If a project has no persisted `openings.cd` or `openings.flow_mode` (e.g. a freshly-created project), the Brief 42 Part 1 DEFAULT_PARAMS seeds are used: cd 0.40 (louvre), flow_mode 'single_sided'.

Idempotent: re-running the script is a no-op because (a) building-wide fields are already removed and (b) per-facade / per-opening fields are already present.

Stop-dev-server discipline per CLAUDE.md Process Rule 11.

---

## Bridgewater — pre-migration

Captured from the persisted building config in the on-disk SQLite (per the Brief 41 Part 0 diagnostic state confirmed in `docs/audit/41_operable_openings_diagnostic.md`).

### Building-wide openings block

| Field            | Pre-migration value |
|------------------|---------------------|
| `cd`             | (to be confirmed by Chris) — most recently observed 0.29 in Brief 41 walkthroughs |
| `flow_mode`      | (to be confirmed by Chris) — most recently observed 'single_sided' |
| `site_exposure`  | (to be confirmed by Chris) — likely 'normal' (Cw = 0.10) |
| `schedule`       | (to be confirmed by Chris) |

### Per-facade openings

| Facade | `louvre_area_m2` | `openable_fraction` | `cd` (pre) | `flow_mode` (pre) |
|--------|-----------------|---------------------|-----------|-------------------|
| north  | (to confirm)    | (to confirm)        | absent — inherits building-wide | absent — inherits building-wide |
| south  | (to confirm)    | (to confirm)        | absent — inherits building-wide | absent — inherits building-wide |
| east   | (to confirm)    | (to confirm)        | absent — inherits building-wide | absent — inherits building-wide |
| west   | (to confirm)    | (to confirm)        | absent — inherits building-wide | absent — inherits building-wide |

### Operable openings

Pre-migration each operable opening lacks `cd` and `flow_mode` (Brief 41 Part 2 dropped per-opening `discharge_coefficient` + `wind_coefficient`; Brief 42 Part 1 added `cd` + `flow_mode` to the schema but persisted entries don't yet carry them).

| Opening (name / id) | Type | `area_m2` | `height_m` | Control mode | `cd` (pre) | `flow_mode` (pre) |
|---------------------|------|-----------|-----------|--------------|-----------|-------------------|
| (to confirm — e.g. "gf_entrance_door") | door | (to confirm) | (to confirm) | (to confirm — e.g. always) | absent — inherits building-wide | absent — inherits building-wide |

---

## Migration script execution

To be filled in by Chris when running the script. Expected console output shape (one block per project that's actually changed):

```
OK: 'Bridgewater'
    seed: cd = 0.290, flow_mode = 'single_sided'
    facades: <N> written, <M> already had per-facade values
    operable openings: <P> written, <Q> already had per-opening values
    building-wide cd / flow_mode removed: True
      - <name>                        type=door    area=4.0 m2  cd=0.290  single_sided
      - <name>                        type=window  area=1.5 m2  cd=0.290  single_sided
```

Re-running should print:

```
NO-OP: 'Bridgewater' -- already migrated (4 facades + N operable openings already have cd + flow_mode)
```

---

## Bridgewater — post-migration (pre-walkthrough)

Captured immediately after migration script runs, before any per-opening edits in Parts 4/5. **Should match pre-migration values** (Brief 42 Principle 5).

| Facade | `cd` (post) | `flow_mode` (post) |
|--------|------------|---------------------|
| north  | (Chris fills) | (Chris fills) |
| south  | (Chris fills) | (Chris fills) |
| east   | (Chris fills) | (Chris fills) |
| west   | (Chris fills) | (Chris fills) |

| Opening | `cd` (post) | `flow_mode` (post) |
|---------|-------------|---------------------|
| (Chris fills, one row per opening) | | |

### Engine output reconciliation

State 1 / State 2 Bridgewater MWh figures captured post-migration should be **invariant** vs. pre-migration (Principle 5). If they aren't, escalation trigger 2 fires ("Read-side bug where opening values don't match pre-migration building-wide values").

| Metric (post-migration, pre-Part-5-edits) | Expected | Observed | Match? |
|-------------------------------------------|----------|----------|--------|
| Heating demand (MWh/yr)                   | Same as pre-Brief-42 baseline | (Chris fills) | (Chris) |
| Cooling demand (MWh/yr)                   | Same as pre-Brief-42 baseline | (Chris fills) | (Chris) |
| Permanent louvre loss (MWh/yr)            | Same as pre-Brief-42 baseline | (Chris fills) | (Chris) |
| Operable door loss (MWh/yr)               | Same as Brief 41 Part 5 baseline | (Chris fills) | (Chris) |

---

## Bridgewater — post-walkthrough (Part 5 per-opening edits)

After the user has exercised the Part 4 / Part 5 UI to set per-opening values intentionally. Captures the magnitude of the change Brief 42's whole point is to enable.

Suggested walkthrough edit (Bridgewater reception door):
- Before: cd 0.29 / single_sided (migrated copy of the building-wide value — sensible for a trickle vent, wrong for a 4 m² reception door)
- After: cd 0.60 / cross (Brief 42 Part 1 Door defaults — a door connecting opposite sides of a building through a corridor)

| Metric | Before edit | After edit (cd 0.60 / cross) | Δ |
|--------|-------------|------------------------------|----|
| Operable door loss (MWh/yr) | (Chris fills) | (Chris fills) | (Chris) |
| Heating demand (MWh/yr) | (Chris fills) | (Chris fills) | (Chris) |

**Expected sign:** door loss should *increase substantially* under cross-flow because the cross-flow correlation (`Q = cd × A × √Cw × v_wind`) lacks the EN 16798-7 single-sided engineering correction factor of `0.025 × min(1, cd/0.6)` that throttles wind-driven flow through a single-sided opening. The physics catches up with the user's intent ("this is a reception door, not a trickle vent").

Per Brief 33 Principle 1 / Brief 41 Part 5 framing: no numerical target. The number is what the physics produces. Order-of-magnitude bracket for a 4 m² door under cross-flow at UK coastal wind (~5 m/s avg) is hundreds of MWh — the Brief 41 Part 0 diagnostic's 646 MWh figure is in this bracket (cross-flow physics correctly applied; what was wrong was that *every* operable opening was being treated as cross-flow, not that cross-flow physics on a door is itself unreasonable).

---

## Sign-off

- [ ] Pre-migration table backfilled with persisted Bridgewater values (Chris)
- [ ] Migration script executed; output captured here (Chris)
- [ ] Post-migration table backfilled (Chris)
- [ ] Engine output invariance verified pre-edits (Principle 5)
- [ ] Walkthrough edit captured with magnitude of change
- [ ] Brief 42 close (Part 6)

# Audit: systems_config Drift — Root Cause, Blast Radius, Fix Faithfulness

**Read-only Tier-2 audit. Changes no engine/config/assembler code, runs no migration.**
Branch `chris/audit-config-drift`, cut off `chris/fix-systems-config-drift` (PR #7, intentionally
open) so the derive-on-read fix (`nza_engine/systems_from_v40.py`) is present to audit.

> **Plain-English summary (top-line answer — filled at P4).**
> _(see § Verdict at the bottom once P2/P3 complete)_

Three questions:
1. When and why did the two configs diverge?
2. What's the blast radius across projects, and were past EnergyPlus results stale?
3. Is the 98-pre-b derive faithful across ALL fields, not just heating/cooling?

---

## P1 — Divergence history (Question 1)

### The three configs and when each entered
| Config | Introduced | Role |
|---|---|---|
| simple `systems_config` (DB column) | **Brief 04** `443564e` (project CRUD) | original flat systems shape; written by `PUT /{id}/systems`, project create/update/clone |
| `systems_config_v25` (in building_config) | **Brief 28f** `9ebe0ac`; assembler enabled-gate read added **Brief 28-IM** `2967014` | per-service `enabled` gates the EP assembler reads (`epjson_assembler.py:1418-1421`) |
| `systems_config_v40` (in building_config) | **Brief 40** `94d7288`/`18d52b7`/`e0dd1af` (2026-05-19) | rich per-service arrays; **the UI's write target and NZA-Sim's read source** from Brief 40 on |

### What Brief 40 did (2026-05-19) — the divergence origin
Brief 40 was a **deliberate** systems-model migration:
- `94d7288` Part 2 — new Systems **engine** (proportional split, setpoints, DHW tap-mix) reading v40.
- `18d52b7` Part 3 — Systems module **UI rebuilt** to edit v40 (`params.systems_config_v40.{service}[i]`).
- `e0dd1af` Part 5b — **wired v40 through to the engine + Live Results** (the NZA-Sim instant path).
- A one-time loader migration populated v40 from the prior config (refined later by Brief 42 `b852ffe`).

From Brief 40 on, **the Systems UI writes only v40.** The simple `systems_config` column and the
v25 gates are no longer the per-system editor's write target.

### The orphan — the EP `/api/simulate` path was never migrated
`api/routers/projects.py` (which contains `simulate_project`, the `/api/simulate` EnergyPlus path)
**never referenced `systems_config_v40` anywhere in its entire git history** until Brief 98-pre-b:

```
$ git log --oneline -S 'systems_config_v40' -- api/routers/projects.py
c83dc94  Brief 98-pre-b P2: /api/simulate reads from systems_config_v40 (single source)
```

`simulate_project` kept reading `project["systems_config"]` — the simple column the UI stopped
maintaining at Brief 40. It was the **sole physics consumer** of that column (the only other reads
are `_row_to_project` deserialisation at `:103` and the `PUT /systems` merge at `:482`).

### Deliberate migration, or accident? → **Accidental orphan, not a deliberate fallback.**
Evidence it was overlooked rather than intentionally kept:
- **No v40→simple sync exists anywhere** in the codebase's history — backend or frontend. The only
  v40→simple translation is the 98-pre-b derive itself. So nothing ever kept the simple column
  current after Brief 40.
- **No code or comment** marks the simple column as a deliberate EP fallback. The Brief 40 work
  migrated the *instant engine + Live Results* to v40 and simply did not touch the separate EP
  `/api/simulate` read path.
- v25 gates are the same story: still written by the roadmap/intervention engine
  (`roadmapEngine.js`) but **not** by the per-system Systems editor — so the assembler's enabled
  gates could also lag v40.

The migration of the instant engine was intentional; the EP path was left behind because Brief 40's
scope was the instant/Live-Results engine, and the EnergyPlus wrapper was a separate, un-migrated
consumer nobody re-pointed.

### How long was `/api/simulate` exposed to stale systems?
**~51 days (7 weeks):** Brief 40 (2026-05-19) → Brief 98-pre-b (2026-07-09). The *window of
possibility* opened at Brief 40; a given project actually went stale the moment its v40 was edited
without the simple column being re-written. Freshly-created projects never v40-edited could still
match. **P2 quantifies which projects actually drifted.**

**P1 verdict:** the drift originated at Brief 40 (2026-05-19) as an accidental orphaning of the
EnergyPlus `/api/simulate` read path when the systems model deliberately migrated to `v40` for the
instant engine and UI. `/api/simulate` read the un-maintained simple `systems_config` column (and
v25 gates) for ~7 weeks until Brief 98-pre-b re-pointed it at v40 via derive-on-read.

---

## P2 — Blast radius (Question 2)

Read-only comparison (`scripts/_audit_config_drift_blast.py` → `config_drift_blast.json`): for every
project, the dispatch the **stored** simple config would produce (what `/api/simulate` emitted
*before* 98-pre-b) vs the dispatch **`derive_systems_for_sim(v40)`** produces (what it emits now).
DB opened read-only (`data/nza_sim.db`, `mode=ro`).

### Per-project drift (4 projects)
| Project | has v40? | Drifted? | Differing services (stored → v40) |
|---|---|---|---|
| **Bridgewater Hotel** `12cf7cc4` | yes | **DRIFTED** | heating **gas → VRF** · ventilation **MEV → MVHR** |
| **ZZ TEST — do not use** `zztest00` | yes | **DRIFTED** | ventilation **MEV → MVHR** (heating/cooling/DHW match) |
| Bridgewater — Enhanced Fabric `5092bba3` | no | no | no v40 → derive falls back to stored, no drift possible |
| New Project `c17af731` | no | no | no v40 → derive falls back to stored, no drift possible |

**2 of 4 drifted — both projects that carry a v40.** The real client project (Bridgewater Hotel)
was wrong on **two** services: the simple config said **gas heating + MEV**, while v40 (what
NZA-Sim displays) is **VRF heating + MVHR**. A full-systems `/api/simulate` run on it from the
stored config would have modelled a materially different building. (The two v40-less projects can't
drift; note they also can't be read by NZA-Sim's v40 path — a separate, pre-existing matter, not
this drift.)

### Were any EP results actually produced against a stale building? → **No — the exposure was latent, not realised.**
`simulation_runs` in `nza_sim.db`, **61 runs total**, read-only:
- **60 runs are 2026-04-02 → pre-05-19 — they predate v40** (Brief 40 = 2026-05-19). At that time
  the simple config *was* the canonical source, so they were not stale-vs-v40. (Includes the
  2026-04-03 Bridgewater runs the 98-pre audit named — EUI 75.4/73.7/83.5, full mode, pre-v40:
  they correctly used the then-canonical simple config; not a drift artefact.)
- **Exactly 1 run after Brief 40**: Bridgewater, **2026-06-25 12:25:22** (run `2e9d639f`) — but its
  `simulation_mode = envelope-only`. Envelope-only (State 1) **forces ideal loads and bypasses the
  systems dispatch entirely** (`epjson_assembler.py:1405` `hvac_mode = "ideal_loads" if (state1 or
  state2)`), so it never read the drifted systems config (its snapshot carries no systems dispatch;
  heating/cooling = 0, a free-run envelope check).

So although Bridgewater's stored config was materially wrong from 2026-05-19 on, **no full-systems
EnergyPlus result was ever generated from a drifted config** between Brief 40 and Brief 98-pre-b.
The "Run EnergyPlus" button would have produced a stale gas+MEV Bridgewater — but no such run was
executed on a drifted project in that window. **No client-facing stale EP result exists in the DB.**

**P2 verdict:** blast radius = 2 of 4 projects drifted (Bridgewater Hotel materially, on heating +
ventilation; ZZ TEST on ventilation). Realised impact = **zero** — every full-systems EP run
predates v40, and the only post-migration run was envelope-only (systems-independent). The risk was
real and latent; it was never cashed into a wrong client number.

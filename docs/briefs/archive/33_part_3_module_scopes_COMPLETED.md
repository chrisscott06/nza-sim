# Brief 33 Part 3 — CLAUDE.md Module Scopes

**Author:** Claude Chat (architect)
**Authorised by:** Chris Scott
**Status:** Active. Closes Brief 33.
**Date opened:** 2026-05-18
**Target outcome:** CLAUDE.md gains a "Module scopes" section that defines what each module computes and what it does not. The Building module scope is detailed; Operation and Systems are stub entries to be expanded later. Two new process rules lock in the discipline. Documentation-only commit.

---

## BEFORE DOING ANYTHING

1. Read this entire brief.
2. Read CLAUDE.md, particularly the existing "Non-negotiable technical rules" and "Process rules" sections.
3. Read STATUS.md as currently on disk; confirm last entry is Brief 34 (commit `f702687`).
4. Confirm working tree clean: `git status --short`.
5. Confirm `origin/main == local main`: `git fetch origin && git log origin/main..main && git log main..origin/main` both return empty.
6. Do not begin Part 1 until all five checks pass.

---

## Scope statement

This brief touches CLAUDE.md only. No code changes. No engine changes. No UI changes. Documentation-only commit.

The intent is to lock in the architectural discipline that prevented `balanced_mechanical` from being a permanent structural problem (it was caught and reverted in Brief 33 Part 1). The same discipline will govern future briefs as we audit and rework the remaining Static modules.

---

## Parts

### Part 1 — Add "Module scopes" section to CLAUDE.md

**Files touched:** `CLAUDE.md` only.

**Steps:**

1.1 Add a new section to CLAUDE.md titled "Module scopes", placed between the existing "Non-negotiable technical rules" and "Process rules" sections.

The section starts with a short preamble:

```markdown
## Module scopes

These statements define what each module computes and what it does not.
They are the canonical scope contract for the module. A brief or feature
that asks for behaviour outside the stated scope is asking for the wrong
module and must be flagged before work begins.
```

1.2 Under the preamble, add the Building module scope statement (full detail):

```markdown
### Building module — State 1 envelope-only

**Computes:**
- Conduction losses through opaque envelope (walls, roof, ground floor)
- Conduction losses through glazing
- Thermal bridging losses (linear and point)
- Solar gains through glazing
- Infiltration heat loss through the q50-rated envelope leakage area
- Permanent vent heat loss through always-open passive openings
  (trickle vents, louvres, fixed grilles, holes in the envelope)
- Heating and cooling demand to maintain a user-defined comfort band

**Does not compute and does not contain:**
- Occupancy, people, occupancy schedules
- Lighting, equipment, plug loads
- HVAC of any kind (no IdealLoads, no VRF, no heat pumps, no boilers,
  no chillers, no fan coils, no terminal units)
- Mechanical ventilation of any kind (no MVHR, no MEV, no extract fans,
  no supply fans, no extract rates, no heat recovery)
- Operable windows or doors (anything with a control schedule or
  temperature-responsive operation)
- DHW
- Controls, thermostats, deadbands, setbacks
- System efficiencies, COPs, SCOPs, MVHR effectiveness, distribution losses
- Delivered energy, primary energy, or carbon

**Notes on permanent vents specifically:**
Permanent vents are passive openings in the envelope. They are always
open. They are driven by wind (and stack where vertical separation
exists). They have no schedule. They have no control. They have no
relationship to any mechanical system in the building. If a building
has a bathroom extract fan, that fan is modelled in the Systems module
— not by changing how the trickle vent calculates flow.

**Notes on the comfort band:**
The setpoint used in heating/cooling demand calculation is a
user-defined comfort band, not a system setpoint. It is a constraint
on what the building needs from a hypothetical system, not a property
of an actual system. The Building module asks: "given this envelope,
what demand would a system need to satisfy to hold this comfort band?"
The system itself does not exist in this module.

If a calculation requires any input from the "does not compute and does
not contain" list, that calculation is in the wrong module. Move it or
remove it. Do not import non-envelope concepts into the Building
module's data model, calculations, or UI.
```

1.3 Add a stub for the Operation module:

```markdown
### Operation module — scope (stub, to be expanded when Operation is reworked)

**Computes:**
- Occupancy schedules (people, sensible/latent gains)
- Lighting use (gains; electrical end-use accounting is Systems)
- Equipment use (gains; electrical end-use accounting is Systems)
- Operable windows and doors (control logic, manual schedules,
  temperature-responsive operation)
- Manually operated blinds and shading devices

**Does not contain:**
- HVAC of any kind
- Mechanical ventilation, heat recovery
- Controls that depend on installed equipment (e.g. daylight dimming
  is Systems because it requires a control system; manual switch use
  is Operation because it is occupant behaviour)
- Electrical end-use energy (the kWh delivered; only the heat gains
  to the zone live here)
- Envelope physics (conduction, infiltration, permanent vents — all
  Building)

This stub will be expanded into a full scope statement when the
Operation module is reworked. Briefs touching Operation must declare
which of these scope items they affect.
```

1.4 Add a stub for the Systems module:

```markdown
### Systems module — scope (stub, to be expanded when Systems is reworked)

**Computes:**
- Heating system (boiler, heat pump, district heat, etc.)
- Cooling system (chiller, heat pump, etc.)
- Mechanical ventilation (MVHR, MEV, extract fans, supply fans) and
  associated fan power, heat recovery effectiveness, defrost penalties
- DHW (storage, distribution, primary fuel)
- Lighting controls (daylight dimming, occupancy sensors — anything
  that modifies the lighting use defined in Operation)
- Electrical end-use accounting (kWh delivered for lights, equipment,
  fans, pumps, plant)
- Conversion from envelope demand → delivered energy → primary energy
  → carbon

**Does not contain:**
- Envelope physics (Building)
- Occupancy or manual operation (Operation)
- Permanent vents — these are passive envelope features in Building,
  not mechanical ventilation

This stub will be expanded into a full scope statement when the Systems
module is reworked. Briefs touching Systems must declare which of these
scope items they affect.
```

**Verification:** CLAUDE.md contains the new "Module scopes" section with the Building scope statement (full detail) and Operation / Systems stubs.

---

### Part 2 — Add process rules

**Files touched:** `CLAUDE.md` only.

**Steps:**

2.1 In CLAUDE.md's existing "Process rules" section, append:

```markdown
10. **Briefs touching a module must state the module's scope at the top.**
    Any brief that modifies a module's data model, engine, or UI must
    include a scope statement (one paragraph or short list) confirming
    the brief's work fits within that module's declared scope per the
    "Module scopes" section. If a brief asks for work outside the stated
    scope, stop and flag — the brief belongs to a different module or
    needs to be rescoped.

11. **Stop the dev server before running migration scripts.** Autosave
    in the running app can produce partially-stripped intermediate
    states that race against a manual migration, leaving the persisted
    config in a half-migrated state that the next migration run
    misreads. The pattern caught in Brief 34: a one-shot migration that
    stripped the geometry fields ran while the dev server's autosave
    persisted a config with some fields already gone, causing the
    migration to read defaults instead of the source values. Standard
    practice for any migration script: (a) stop the dev server, (b) run
    the script, (c) verify the result by re-running the script (it
    should be a no-op on a clean migration), (d) restart the dev
    server.
```

**Verification:** CLAUDE.md contains process rules 10 and 11.

---

### Part 3 — Single commit and push

**Files touched:** `CLAUDE.md`, `STATUS.md`.

**Steps:**

3.1 Update STATUS.md with Brief 33 Part 3 close-out. Mark Brief 33 fully closed (Parts 1, 2, and 3 all complete). Note that the Building module is now structurally complete for Static, with the scope contract architecturally documented.

3.2 Single commit with this message:

```
Brief 33 Part 3 close: CLAUDE.md module scopes

Adds "Module scopes" section to CLAUDE.md defining what the Building
module computes and what it does not. Operation and Systems are stub
entries to be expanded when those modules are reworked. Building scope
is fully detailed.

Adds process rule 10: briefs touching a module must include a scope
statement confirming the brief's work fits the module.

Adds process rule 11: stop the dev server before running migration
scripts to prevent autosave race conditions (caught in Brief 34).

No code changes. Closes Brief 33 (Parts 1, 2, 3 all complete). Building
module structurally complete for Static-only operation.
```

3.3 Push to origin/main. Verify origin == local.

**Verification:**
- CLAUDE.md contains the new "Module scopes" section and process rules 10, 11
- STATUS.md reflects Brief 33 fully closed
- origin/main HEAD == local HEAD

---

## Final report (paste in chat after Part 3)

1. New origin/main HEAD SHA
2. Confirmation that CLAUDE.md "Module scopes" section is in place
3. Confirmation that process rules 10 and 11 are in place
4. STATUS.md "Last completed" first line

---

## What MUST NOT happen in this brief

- No code changes. CLAUDE.md and STATUS.md only.
- No expansion of the Operation or Systems scope stubs beyond what's specified here. Detail comes when those modules are reworked, not now.
- No new architectural enforcement systems, contract assertions, or safety machinery. The discipline is documented; enforcement is via brief structure and human review, not automated.

## Standing by for authorisation to begin Part 1.

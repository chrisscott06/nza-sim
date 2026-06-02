# Brief 81 — EnergyPlus validation harness (Bridgewater-Box first rung)

**Branch:** `feat/energyplus-validation` (cut from `main` tip `d8a6207`, Brief 77 close).
**Authority:** Full autonomous overnight (Opus 4.8). Architect: Claude Chat. Authorised by Chris 2026-06-02.
**NEVER merge or push to `main` during this brief.**

This audit document is the running record of Brief 81. One section per part (§1–§10),
plus this §0 receipt + §1 premise-check written at P1.

---

## §0 — Receipt confirmation (per brief "BEFORE DOING ANYTHING" step 1)

**Brief title:** *Brief 81 — EnergyPlus validation harness (Bridgewater-Box first rung) — OVERNIGHT.*

**First paragraph of "Why this brief exists" (quoted):**
> After five weeks of building NZA-Sim's custom JavaScript dynamic simulation engine, the team has hit the limit of internal validation. This week alone, Briefs 75/76/77 surfaced a major bug cycle where the model's headline numbers were wrong for four days because first-principles hand-calculations missed an upstream issue (`_calculateState2:2921` reading v25-only ventilation when Bridgewater is v40). The fix landed at commit `ccc2e72`, but the time-to-discovery was unacceptable.

**Tip of `main` at branch cut:** `d8a6207` ("Brief 77 P4 close: walkthrough self-verify + archive + STATUS").
The brief expected `ccc2e72 or later`; `d8a6207` is later (Brief 77 commits landed after the Brief 76
fix `ccc2e72`). ✓

**Design note:** read in full from Notion (https://www.notion.so/373d645e05cc8163929dca9070e8d261,
fetched 2026-06-02T19:07). Key decisions absorbed: build EnergyPlus the EnergyPlus way (single
integrated sim, compare at OUTPUT level only); long-lived feature branch; Phase 5 iteration + CI
deferred to later briefs; overnight scope = Phases 1–4 for Bridgewater-Box only.

**STATUS.md reconciliation:** confirmed reconciled at Brief 77 close — STATUS.md top section reads
"✅ Brief 77 — CLOSED 2026-06-02" with the preserved anchor (EUI 143.5, heating 98.3, cooling 53.1,
mech vent 326.0 MWh, Σ losses 549.2, Σ gains 586.3, Net +37.1). ✓

---

## §1 — Premise-check & divergences from the brief

The brief grants Code premise-check authority (Brief 76 precedent): where the brief's recommended
approach contradicts the actual state of the repo or EnergyPlus best practice, push back here, propose
the correct approach, and execute that instead — documenting the divergence for Chris's morning review.
Four divergences identified at P1, all conservative (less new tooling, no behaviour change, more reuse
of the already-validated stack):

### D1 — EnergyPlus is already installed. Use it; skip the fresh contained install.

**Brief Part 4 says:** "Install EnergyPlus locally in a contained location: `tools/energyplus/` under the
repo (gitignored) OR a Docker container … target: EnergyPlus 23.2.0 or newer LTS."

**Actual state:** EnergyPlus is **already installed** on this machine at:
- `C:\EnergyPlusV26-1-0\` ← the version the NZA-Sim backend is pinned to (CLAUDE.md "EnergyPlus
  installation"); its assembler + parser Output:Variable names are *confirmed valid for V26.1.0* in
  `docs/audit/30_phase0_schema_lock.md`.
- `C:\EnergyPlusV24-1-0\` (older, also present).

**Decision:** Use the existing **`C:\EnergyPlusV26-1-0\`** install. Rationale:
1. It satisfies every Part-4 *hard requirement* already: the runner finds EnergyPlus via an
   environment variable / config (not a global PATH entry — `ENERGYPLUS_DIR` is currently unset and EP
   is **not** on PATH), and the install dir is outside the repo so nothing is committed.
2. V26.1.0 (June-2025 release) is newer than the brief's 23.2.0 LTS floor, and is the exact version
   NZA-Sim's own EnergyPlus path was schema-locked against — using it keeps Output:Variable names
   verified rather than guessed.
3. Avoids the 90-minute install risk the brief itself flags as a hard-STOP trigger.

Part 4 therefore becomes **"verify the existing install + run the bundled example"** rather than
"install fresh." A small config file (`validation/energyplus/ep_config.json` or an env var read) points
the runner at `C:\EnergyPlusV26-1-0\`, overridable, never relying on a global install.

### D2 — Weather: use NZA-Sim's actual Bridgewater EPW (Yeovilton), not London/Heathrow.

**Brief Bridgewater-Box spec says** (Weather): "London (Heathrow, IWEC TMY3 …), latitude 51.4775°N …"
but **immediately also says**: "Reuse whichever weather file NZA-Sim is currently using for Bridgewater;
we want both engines reading the same source data."

**Actual state:** the only EPW present in the repo's project weather dir is
`data/weather/current/GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw` — **Yeovilton, Somerset**.
Bridg**w**ater is a Somerset town; Yeovilton (RNAS Yeovilton, ~25 km away) is the nearest long-record
station, so this is the file the live Bridgewater project reads (to be re-confirmed in P2/P3 against the
project's `building_config.weather_file`).

**Decision:** Use **`GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw`** for **both** engines. The
overriding instruction in the spec is "same source data for both engines"; matching that is far more
important to a clean comparison than matching the architect's incidental "London Heathrow" placeholder.
Document the exact filename + lat/long (read from the EPW header) in the box YAML fixture (P2).

### D3 — Architecture clarification: the live engine is JS; the backend EP path is dormant.

CLAUDE.md describes NZA-Sim as "powered by EnergyPlus" with a backend (`nza_engine/` — epJSON
assembler, geometry/HVAC generators, runner, parsers). **However**, `nza_engine/config.py` defaults
`ENERGYPLUS_DIR` to a **macOS** path (`/Applications/EnergyPlus-25-2-0`); on this Windows machine the
env var is unset, so the backend EP path is **dormant**. All of this week's engine work (Briefs 74–77)
was on the JS engine `frontend/src/utils/instantCalc.js`, which is what the live UI runs.

**Implication for the brief (none — it's already correct):** Brief 81 validates the **JS engine** against
an **independent** hand-authored EnergyPlus build. We do **not** reuse `nza_engine/epjson_assembler.py`
to produce the reference (that would couple the reference to NZA-Sim's own geometry schema and defeat
independence — exactly what the design note warns against). We **do** mine `nza_engine/` and
`docs/audit/30_phase0_schema_lock.md` as a *syntax reference* for correct V26.1.0 IDF object/variable
names, honouring the brief's "do NOT guess IDF syntax" instruction.

### D4 — Engine-run method: pure-Node fixture path, not a live-DB project write.

**Brief Part 2 falsifiability says:** "Hand-load the YAML into a fresh NZA-Sim project in the local DB.
Run the engine on it." The brief separately forbids "Modifying any NZA-Sim project in the live DB"
(existing projects) but permits a *new* Bridgewater-Box project.

**Decision:** Run the JS engine **pure-Node** against the fixture (the loader builds the
`calculateInstant(...)` params object directly from the YAML), exactly as Briefs 74–77 anchor probes
did (`node scripts/_brief7N_p1_anchor.mjs`). Rationale: Brief 72 PA's data-safety rule names the
"pure-Node fixture path" as **preferred for read-only diagnostics**, it needs no backend/SQLite
contention, and it is fully reproducible from the committed fixture — which is the entire point of a
versioned validation fixture. No writes to the live DB at any point. (A DB project can be created later
if Chris wants the box visible in the UI; it is not required for the comparison.)

### Risk flagged at P1 — `eppy` on Python 3.14.2

System Python is **3.14.2** (very new, Oct-2025). `eppy` (Part 6) has historically lagged new CPython
releases. Mitigation plan: install `eppy` into a **contained venv** (`validation/.venv`, gitignored);
if it will not install/import on 3.14, fall back to (a) a known-good Python if one is present, or
(b) authoring the IDF generator with direct templating against the IDD instead of eppy, or (c) per the
brief's hard-STOP, document the eppy blocker and ship the hand-authored IDF + runner without the
generator. Decided at P6, not pre-borrowed here.

---

## §2 — Bridgewater-Box YAML fixture + NZA-Sim anchor  *(P2 — pending)*

## §3 — Bridgewater v1 YAML fixture (frozen anchor)  *(P3 — pending)*

## §4 — EnergyPlus install verification + bundled example  *(P4 — pending)*

## §5 — Hand-authored Bridgewater-Box IDF + first run  *(P5 — pending)*

## §6 — Python IDF generator (eppy) + byte-stability  *(P6 — pending)*

## §7 — EnergyPlus runner + output normaliser  *(P7 — pending)*

## §8 — NZA-Sim result extractor (matching schema)  *(P8 — pending)*

## §9 — Comparison report (first-pass results)  *(P9 — pending)*

## §10 — Close summary + handoff  *(P10 — pending)*

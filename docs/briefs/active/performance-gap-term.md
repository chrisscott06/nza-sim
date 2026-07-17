# Brief — First-class performance-gap (unattributed residual) term

**Status:** QUEUED (design agreed; not yet started) · **Author:** engine-design follow-up (from the auxiliary inert-input reassessment) · **Opened:** 2026-07-15
**Origin:** `docs/briefs/active/bridgwater-auxiliary-inert-input-audit.md` §Follow-ups + the 2026-07-15 design discussion with Chris.
**Branch:** cut a fresh branch off `main` **only after the gate clears** (see BEFORE-DOING-ANYTHING step 0). Do NOT build on any scenario branch.
**GATED:** approved-in-principle but blocked — see the gate. This changes engine roll-ups → the export "Outputs" engine SHA will move. Expected.
**RE-GATE (Final-P02, 2026-07-17):** the P02 number-freeze point has moved to the close of
`final-p02-run` (branch `chris/final-p02-run`); Model 2 re-closes at elec 572,398 / gas 207,700 /
EUI 185.1 on that run's engine. Gate (a) below is now satisfied by the final-p02-run merge (not the
earlier stack); gate (b) — the TB fix landing first — still holds and TB is itself re-gated to the
same close. Record the **post-TB** residual on the final-p02-run engine as the migration baseline.
**Sequenced AFTER:** `docs/briefs/active/thermal-bridging-fullmode-apply.md` (the TB fix re-sizes the residual this brief migrates — see D-Gate).

---

## Module scope (Process Rule 10)

This brief introduces a **new calibration-layer concept** — the per-fuel *performance gap / unattributed residual*. It is **not** building physics (not Building/State 1), **not** an internal gain (not Internal Gains), and **not** a demand-serving system. It is a reconciliation term that exists only where a measured anchor is present, and it rolls into the fuel-split / carbon / EUI totals (**Systems** module scope: "Fuel split, carbon, total EUI roll-ups across all systems") and is referenced by **Interventions** (exclusion behaviour). It touches those two modules' roll-up/exposure and exclusion surfaces only.

**This is a NEW module-scope entry, not a Systems sub-scope (decided, Chris 2026-07-15).** The brief's entire premise is that the gap is a property of **model-vs-meter**, not of the building; rescoping it into Systems would contradict the design it implements. Part 1 adds a short **Module scopes** entry to `CLAUDE.md` for the calibration-layer residual (per-fuel, signed, excluded-from-physics). **There is no "rescope into Systems" off-ramp** — that path is dead. **Auxiliary (`gains.auxiliary`) is explicitly out of scope and untouched** — see Scope OUT.

---

## BEFORE DOING ANYTHING

0. **GATE — DO NOT START UNTIL BOTH ARE TRUE.**
   - **(a) Same gate as the TB fix:** the full PR stack is merged to `main` (**#20** Model-1, **#22** Model-2 close, **Brief B**, **Brief C**) **and P02's numbers are frozen** — the Model-2 close (**elec 572.400 / gas 207.700 / EUI 185.1**) is issued and locked. If any stack PR is open, STOP and wait.
   - **(b) The TB fix has landed.** `thermal-bridging-fullmode-apply.md` must be merged first, because it moves the anchor and **re-sizes the Model-2 residual** (its Parts 5–6; ≈+1.6 MWh net-electricity into the modelled side, shrinking the residual by the same amount while the 572.400 total is preserved). Starting before TB lands would migrate a residual value that TB is about to change. Record the **post-TB** residual value and engine SHA as the migration baseline.
   If either is unmet, do not cut the branch, write the probe, or touch any file.
1. Read `CLAUDE.md` in full — this brief lives on **Rule 11** (one canonical quantity, one exposure, one read path) and **Rule 9** (every term entering an aggregate is a displayed line).
2. Read `docs/briefs/active/bridgwater-auxiliary-inert-input-audit.md` (why this exists; why `gains.auxiliary` is the wrong long-term host) and its probe `scripts/_aux_inert_input_probe.mjs`.
3. Read the Model-2 close note `docs/audit/bridgwater-model2-calibrated_close.md` — the interim `auxiliary_residual_unattributed` entry, its interventions-exclusion behaviour, and its export markers are what this brief supersedes and must preserve.
4. Confirm the DB snapshot task is `Ready` and back up the live DB before any scenario re-persist (`…\Backups\nza-sim-db\nza_sim_pre-perfgap_<date>.db`).
5. Establish the green baseline to diff against **before** touching anything: `node scripts/_brief93_anchor.mjs --fixture` and an export of both scenarios (the migration acceptance test in Verification 1 diffs against these).

---

## Goal

Replace the interim residual (carried on an `auxiliary_residual_unattributed` entry) with a **first-class, per-fuel, signed performance-gap term** that lives at the calibration layer, is **pinned** (never auto-balancing), **displays its live drift**, records its **thermal treatment explicitly**, is **carbon-aware per fuel**, is **excluded from interventions by default**, and appears as an **honestly-labelled line** in the Outputs sheet and Sankey — without changing any issued headline number.

## Why this exists (intent)

The two-model methodology's deliverable is the *quantified unknown*: metered − modelled, per fuel, after every defensible input adjustment is exhausted. The interim implementation hosts that unknown on a load category (`gains.auxiliary` / an equipment entry). That is a category error with four concrete costs, established in the design discussion:

- **Semantic overloading** — a real auxiliary load (external lighting, plant-room pumps) and an epistemic gap end up in the same bucket and can't be separated.
- **Sign** — a gap can be negative (over-de-rated / double-counted); a W/m² gain hates negatives, a delivered-energy residual handles them.
- **Per-fuel + carbon** — the fuel split of the residual moves the CRREM trajectory (electricity carries falling grid carbon; gas ~flat). A fuel-agnostic "kWh gap" can't express this.
- **Honesty of label** — the client report's whole point is "here is the energy we cannot yet explain"; the Outputs row must not say "Auxiliary".

The structural insight: **every fuel's meter−model gap is resolved one of two ways — absorbed by a defensible input move, or declared as an explicit residual.** Bridgewater gas goes via the input move (DHW re-anchored to the gas meter → gas residual ≈ 0 by construction); Bridgewater electricity has no honest single input to move → residual. Same building, two fuels, two mechanisms. This term is the honest home for the second mechanism, per fuel. It only exists where a measured anchor is present — pure bottom-up modelling with no meter has no gap, only modelled numbers with a confidence rating. Hence: calibration layer, not `building_config`.

## Scope

**IN:** a per-fuel signed residual data model at the calibration/scenario layer; canonical single exposure + one read helper (Rule 11); dedicated per-fuel residual line(s) in Outputs + Sankey, labelled "unattributed"; **promoting the Outputs Auxiliary row from a derived plug to a genuine end-use line** so it and the residual are cleanly separate (D7); carbon per fuel; interventions exclusion (default); pinned value with live-drift display; explicit per-entry thermal-treatment field; two population modes (explicit value / balance-to-meter-then-pin); **migration** off the interim `auxiliary_residual_unattributed` entry preserving the issued close; doc updates.

**OUT (explicit, do not re-litigate):**
- **`gains.auxiliary` load semantics are untouched.** It stays a genuine internal-gains load category with its real physics (`gain_fraction`, schedule, `area_share`, occupancy relationship) for loads that legitimately change zone heat gain — external lighting, unheated plant-room parasitics, catering. The residual is a **separate** concept; renaming or repurposing auxiliary is out of scope and was explicitly decided against (Chris, 2026-07-15). *(In scope, and distinct from the above: the Outputs **presentation** of auxiliary changes from a derived plug to a canonical read — D7 — so auxiliary carries only real loads and the residual sits on its own line. That is a display fix, not a semantics change.)*
- Any change to the issued P02 close numbers, the Model-1 baseline, the occupancy schedule shape, or the TB fix.
- Live auto-balancing of the residual (see D1 — pinned only).
- New packages / lockfile pushes; a scenario-management UI beyond what already exists.

## Design decisions (agreed)

**D1 — Pinned + visible drift.** The residual is a **pinned** number — it never auto-balances. A live auto-balance (residual = anchor − model, recomputed on every input change) would silently absorb every edit and hide exactly the thing the residual exists to expose. Instead: the pinned value is frozen at calibration time, and the **UI displays the live `meter − model` delta beside the pinned value** so drift is surfaced, not absorbed. When the live delta diverges from the pinned residual, that divergence is information (the model moved since calibration) — it is shown, never auto-reconciled.

**D2 — Per-fuel, signed, delivered-energy.** One entry per fuel carrier that has a residual (electricity, gas, … oil/biomass/district as needed). Value is **signed** delivered-energy kWh/yr (negative allowed). Optional continuous-equivalent W/m² is **display-only**, never the stored quantity. Each entry: `{ fuel, value_kwh_yr (signed, pinned), label, confidence, thermal_treatment, excluded_from_interventions }`.

**D3 — Explicit thermal-treatment field.** Every residual entry carries an explicit `thermal_treatment` field, **default `none` (no zone heat gain; equivalent to gain_fraction 0)**, recording the assumption "carried as thermally neutral pending identification" rather than leaving it implicit. If a future identification says a residual actually dumps heat into a conditioned zone, the field is set deliberately — the default is explicit, not silent.

**D4 — Two population modes.** (i) **Explicit** — the analyst enters the pinned value directly. (ii) **Balance-to-meter-then-pin** — compute `anchor − model` once at calibration and **pin the result** (generalises the DHW-anchor pattern). Mode (ii) computes once and freezes; it does not stay live (that is D1).

**D5 — Canonical exposure + carbon (Rule 11).** Expose the residual **once** — a single `consumption.residual` (per-fuel, signed) — read everywhere through **one** helper (e.g. `engineReads.readResidual`). No alias fields. Carbon flows per fuel through the existing canonical factor read path (do not add a second factor source). It joins `consumption.total` fuel/EUI/carbon roll-ups as a displayed line (Rule 9), never as a hidden term or a plug residual.

**D6 — Interventions exclusion (default).** Each entry is `excluded_from_interventions: true` by default — you cannot retrofit an unknown. Interventions must skip residual entries in improvement math unless an entry is explicitly opted in. This preserves the interim behaviour (see Migration).

**D7 — Auxiliary and residual are separate lines, never merged (decided, Chris 2026-07-15).** Post-migration the export Outputs sheet carries **two distinct things**: (i) **Auxiliary** as a genuine end-use line — *real loads only* (external lighting, plant-room parasitics), read from a canonical `consumption.auxiliary` value, legitimately small or zero; and (ii) the **residual** as its own dedicated per-fuel line(s), clearly labelled **"unattributed"**. They are **never merged, netted, or co-reported on one row.** This closes the pre-existing defect where the Outputs "Auxiliary" row is a *derived plug* (`elecTotal − Σ named end-uses`, `assumptionsExport.js:338`) — a plug would silently swallow the residual, which is exactly the conflation this brief exists to prevent. Auxiliary must therefore become a genuine read (Rule 9/11) as part of this brief; the separation is the whole point, made visible in the audit artefact. Same rule applies to the Sankey ribbons (auxiliary ribbon ≠ residual ribbon).

**D-Gate — Sequencing.** Gate (a) merge-stack + P02 frozen; gate (b) after the TB fix, which re-sizes the residual. Baseline = the **post-TB** pinned residual and SHA.

## Migration plan (supersedes the interim residual)

This brief **supersedes the `auxiliary_residual_unattributed` residual entry** that Model-2 ships (the equipment-class entry per D2 of the Model-2 brief, or the `gains.auxiliary` home per the 2026-07-15 decision — whichever the P02 close was issued on). Migration re-homes that residual onto the new term. It **re-homes, it does not re-value**: the headline stays put.

Migration must preserve, exactly:
1. **The issued close** — elec **572.400** / gas **207.700** / EUI **185.1** (as they stand after the TB fix; TB preserves the same headline while shrinking the residual component, so the target is unchanged).
2. **The interventions-exclusion behaviour** — the migrated residual is excluded from improvement math exactly as the interim entry was.
3. **The export markers** — whatever provenance/label markers the interim residual carried in the export continue to appear (now on the honest "performance gap" line).

**Acceptance test:** a **before/after export-compare** of both scenarios. The interim-entry export (before) and the performance-gap-term export (after) must show byte-identical headline close, identical intervention results, and equivalent export markers — the only intended diffs are the residual's **line label/home** and the engine SHA. Any headline movement is a STOP.

## Parts (one commit each)

1. **Land brief + `CLAUDE.md` Module-scopes entry** for the calibration-layer residual (new module-scope entry — no Systems rescope; the off-ramp is dead per D-module-scope). Commit: `docs(perfgap): land performance-gap term brief + module scope`
2. **Data model + canonical exposure** — per-fuel signed residual at the calibration layer; `consumption.residual` single exposure + `readResidual` helper; `thermal_treatment` (default none), `excluded_from_interventions` (default true), `label`, `confidence`. No engine roll-up yet. Commit: `feat(perfgap): residual data model + canonical exposure`
3. **Roll-up + carbon + separate Outputs/Sankey lines (D7)** — residual joins fuel-split / EUI / carbon per fuel as its own labelled "unattributed" line(s); **and** promote Auxiliary from the derived plug (`assumptionsExport.js:338`) to a genuine `consumption.auxiliary` end-use line, so the two never share a row or net against each other. Commit: `feat(perfgap): counted residual + genuine auxiliary line, separated`
4. **Pinned value + live-drift display (D1)** — store pinned; compute and display live `meter − model` beside it; balance-to-meter-then-pin mode (D4). Commit: `feat(perfgap): pinned residual with visible live drift`
5. **Interventions exclusion (D6)** — residual skipped in improvement math by default. Commit: `feat(perfgap): exclude residual from intervention math`
6. **Migration + acceptance** — migrate the interim `auxiliary_residual_unattributed` residual onto the new term; before/after export-compare proving the close, exclusion, and markers are preserved. Commit: `feat(perfgap): migrate interim residual + export-compare acceptance`
7. **Verify, re-export both scenarios, audit note, STATUS.md, close.** Commit: `chore(perfgap): verify + close`

## Verification (falsifiable)

1. **Migration preserves the close** — before/after export-compare: headline elec 572.400 / gas 207.700 / EUI 185.1 byte-identical; intervention results identical; export markers equivalent. Only the residual line's label/home and the SHA differ.
2. **Signed** — a negative residual value flows to the total correctly (construct a test scenario where model > meter for one fuel).
3. **Per-fuel carbon** — moving 100 MWh of residual from electricity to gas changes the carbon total by exactly the factor difference (canonical read path); CRREM trajectory responds.
4. **Pinned, not live (D1)** — change a modelled input; the pinned residual does **not** move; the displayed live `meter − model` delta **does** move and equals the new gap.
5. **Thermal treatment explicit (D3)** — default `none` produces zero zero-zone heat gain (no heating/cooling movement vs interim); setting a non-none treatment moves demand deliberately and is recorded.
6. **Interventions exclusion (D6)** — an enabled retrofit does not act on the residual; opting one in explicitly does.
7. **Rule 9 / Rule 11** — the residual appears as one displayed line; grep confirms a single exposure + single read helper, no alias.
8. **Auxiliary load semantics untouched** — `gains.auxiliary` and `systems_config_v40.auxiliary` behaviour byte-identical to pre-brief (re-run `scripts/_aux_inert_input_probe.mjs`; toggle-ON/OFF table unchanged). Only the export *presentation* changes (D7).
9. **Separation (D7)** — the Outputs sheet shows Auxiliary and the residual as **two distinct rows**; Auxiliary is a genuine read (set aux magnitude → Auxiliary row moves; residual row does not), the residual is its own pinned per-fuel line; construct a case with a real auxiliary load **and** a residual and confirm neither nets into the other and the Auxiliary row is no longer a plug (does not absorb an injected unexplained delta).

## What MUST NOT happen

- Auto-balancing residual (D1); silently absorbing drift instead of displaying it.
- Any movement of the issued P02 close, the Model-1 baseline, or the TB fix's numbers.
- A second exposure/alias of the residual (Rule 11); a plug-residual Outputs row (Rule 9).
- **Auxiliary and residual merged, netted, or co-reported on one row** (D7) — including leaving Auxiliary as a derived plug that absorbs the residual.
- Touching `gains.auxiliary` load semantics or renaming it (its export presentation changing per D7 is intended, and is not a semantics change).
- Starting before the gate (merge-stack + P02 frozen **and** TB landed).

## Escalate / STOP

- **E1:** migration export-compare shows any headline movement → STOP; the interim residual and the new term disagree on value, not just home.
- **E2:** TB fix not yet merged, or P02 not frozen → do not start (gate).
- **E3:** the residual concept can't be expressed without touching Building/Internal-Gains physics → rescope; it has leaked out of the calibration layer.
- Three failed approaches on anything → stop and describe.

## Coordination

- Originated in `bridgwater-auxiliary-inert-input-audit.md`. That brief's "canonical `consumption.auxiliary` line" follow-up is now **folded into this brief** (D7 / Part 3): auxiliary must become a genuine line here so the residual can sit separately. It is no longer a standalone follow-up.
- Gated behind and re-baselined on `thermal-bridging-fullmode-apply.md`.
- Supersedes the interim residual described in `bridgwater-model2-calibrated.md` (D2) and its close note.
```

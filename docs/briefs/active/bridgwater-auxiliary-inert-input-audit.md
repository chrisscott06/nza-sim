# Brief — Auxiliary "inert input" reassessment (gains.auxiliary consumption audit)

**Repo:** NZA-Sim
**Land at:** `docs/briefs/active/bridgwater-auxiliary-inert-input-audit.md`
**Tier:** Standard — **diagnosis + decision brief.** Its conclusion is *do not implement (a) or (b) as originally framed*; it exists to correct the record and re-point the Model-2 brief. No engine code changes are authorised by this brief.
**Date:** 2026-07-14 · **Author:** Claude Code (investigating the Model-1 audit Finding 1)
**Coordinates with:** `docs/briefs/active/bridgwater-model2-calibrated.md` (D2/D3), `docs/audit/bridgwater-baseline-model1_close.md` (Finding 1).
**RE-GATE (Final-P02, 2026-07-17):** the P02 number-freeze point has moved to the close of
`final-p02-run`. The Final-P02 parity audit (`docs/audit/final_p02_parity_audit.md`) already
records the corrected `gains.auxiliary` finding (consumed on the production path, gated ×0 by the
disabled Brief 92 Systems toggle) — this brief's documentation corrections re-gate against that run
and remain no-engine-action.

---

## Module scope (Process Rule 10)

Touches **Internal Gains** (the `gains.auxiliary` category — magnitude/schedule/gain_fraction) and **Systems** (the Brief 92 `systems_config_v40.auxiliary` on/off entry). Both are in-scope for those modules as declared in CLAUDE.md → Module scopes (Systems "Electrical end-use accounting for lighting and small power … thin entries that read the heat gain from Internal Gains and apply controls"). This brief proposes **no** work in the Building (State 1 envelope-only) module — auxiliary is an internal gain / electrical end-use, not envelope physics, so Rule 14's *three-location* mandate does **not** apply to it (State 1 must not contain it). This is a documentation/coordination brief; it recommends against the engine change it was asked to scope.

---

## BEFORE DOING ANYTHING

- [x] Read `CLAUDE.md`, the Model-1 audit close note, and the active Model-2 brief.
- [x] Reproduce the Finding-1 claim against the **live** Bridgewater config (READ-ONLY; GET only; no DB writes) on the production engine path.
- [ ] Chris decides the fork in §7 before any follow-up work starts.

---

## 1. The claim under test

Model-1 audit (`docs/audit/bridgwater-baseline-model1_close.md`) **Finding 1 (MAJOR):**

> "The instant engine does not consume `gains.auxiliary` at all — neither as an electrical end-use nor as a thermal gain."

Proof cited: setting `gains.auxiliary.profiles[0].magnitude.value` to 0.0 / 0.3 / 7.0 W/m² yields identical output (elec 294.959 MWh, gas 207.599, EUI 119.2) to three decimals.

**This finding is false in its mechanism.** The observation (magnitude moved nothing) is real; the *interpretation* (engine ignores the category) is wrong. The category is consumed end-to-end on the production path. The magnitude moved nothing because the load was **gated to zero by a Systems switch the audit never flipped on.**

## 2. What the engine actually does (verified)

`gains.auxiliary` is consumed on the production **State 3 / v2.5** path (the path the app, the exports, and the `_brief93_anchor.mjs` regression harness all use — they pass `system_templates`, or `engine:'v2.5'`, which routes to `_calculateState3`):

| Stage | Location | What happens |
|---|---|---|
| State 2 gains loop | `instantCalc.js:2372-2404` | `Q_auxiliary_electricity = gia · magnitude · area_share · scheduleFraction`; `Q_auxiliary = Q_e · gain_fraction` |
| **Brief 92 gate** | `instantCalc.js:2450-2458` | `auxScalar = effectiveSystemScalar(systems_config_v40.auxiliary)` multiplies **both** the electricity and the gain. Disabled ⇒ `auxScalar = 0` ⇒ both zeroed. |
| State 2 emit | `instantCalc.js:4285-4288` | `heat_balance.annual.gains.internal.auxiliary.{kwh, electricity_kwh}` |
| State 3 electricity total | `instantCalc.js:5258-5264` (Brief 74 P3) | `electricity_total_kwh += internal.auxiliary.electricity_kwh` |
| State 3 Sankey | `instantCalc.js:5421-5426` (Brief 74 P3) | `grid → auxiliary → aux_del` ribbon |
| systemsEngine rollup | `systemsEngine.js:892-937` (Brief 72 P5) | `fuel_split.electricity += auxiliaryElecMwh` |

## 3. Reproduction (live Bridgewater `12cf7cc4`, State 3, READ-ONLY)

Script: `scratchpad/aux_probe.mjs` (fetches the live config via GET, runs `calculateInstant` in-process, no writes). Live config: `gains.auxiliary.profiles[0].magnitude = 0.3`, `gain_fraction = 0`, and **`systems_config_v40.auxiliary[0].enabled = false`.**

**Systems auxiliary toggle OFF (current live state):**

| aux magnitude | electricity MWh | gas MWh | EUI | aux elec kWh |
|---|---:|---:|---:|---:|
| 0.0 | 294.959 | 207.599 | 119.2 | 0 |
| 1.5 | 294.959 | 207.599 | 119.2 | 0 |
| 7.0 | 294.959 | 207.599 | 119.2 | 0 |

Identical — **this exactly reproduces the audit** (elec 294.959, EUI 119.2). Cause: `auxScalar = 0`.

**Systems auxiliary toggle ON:**

| aux magnitude | electricity MWh | gas MWh | EUI | aux elec kWh |
|---|---:|---:|---:|---:|
| 0.0 | 294.959 | 207.599 | 119.2 | 0 |
| 1.5 | 350.357 | 207.599 | 132.4 | 55,398 |
| 7.0 | **553.482** | 207.599 | 180.6 | **258,523** |

The load scales exactly with magnitude. **7 W/m² → +258.5 MWh** — precisely the "~258 MWh residual" the two-model methodology wants counted.

**Thermal-gain side also works** (toggle ON, magnitude 7): `gain_fraction` 0 → 1 raises cooling electricity from 553.482 to 585.441 MWh (+32 MWh of extra cooling from 258.5 MWh of added zone heat). So the engine consumes auxiliary as **both** an electrical end-use **and** a thermal gain — the opposite of Finding 1's claim.

## 4. Root cause of the audit error

`systems_config_v40.auxiliary.enabled = false` on Bridgewater. `effectiveSystemScalar` of a present-but-disabled entry is `0` (Brief 92, `instantCalc.js:2450`). The audit varied the **Internal-Gains magnitude** but never enabled the **Systems auxiliary switch**, so it correctly observed zero movement and mis-attributed it to "engine ignores `gains.auxiliary`". This is the exact Rule-13 failure mode ("the real root cause is one level deeper"): the deeper cause is a *disabled system toggle*, not a *missing wire*.

Note the D1 correction (7 → 0.3 W/m², relabel "External lighting") set the magnitude but left the Systems toggle off — so as-specified it *should* contribute ~11 MWh if the toggle were on; with it off it contributes 0. That is a **data/state** question, not an engine gap.

## 5. The one genuinely inert location

The **inline-legacy 'full' path** (`instantCalc.js:6717+`) reads none of the `gains.*` profiles — not auxiliary, and not profile-based lighting/equipment either (it uses legacy `systems.lighting_power_density` / `equipment_power_density`). It returns no v2.5 `consumption` shape at all for this config. This is the **already-queued inline-legacy rationalisation debt** (CLAUDE.md Rule 14; `docs/audit/39_calculation_flow_map.md` Option A) — *not* auxiliary-specific, and not what production uses. It is out of scope here.

## 6. Why neither (a) nor (b) should be implemented as framed

- **(a) "Wire `gains.auxiliary` into the electricity balance as a real end-use line in all three envelope-physics locations."** Redundant: State 2 and State 3 already do this (Briefs 72 P5 / 73 P5 / 74 P3 / 92). Adding a second wire would create a *second independent exposure* of a quantity that already has one — the exact boundary-mismatch-in-waiting Rule 11 forbids. State 1 must not contain it (envelope-only scope). **Reject.**
- **(b) "Retire the UI category and route auxiliary loads through a Systems auxiliary entry the engine already counts."** Already effectively shipped: Brief 92 created `systems_config_v40.auxiliary` as exactly that Systems on/off entry, and the engine counts `gains.auxiliary` **through** it. "Retiring" the Internal-Gains category would delete the magnitude/schedule/gain_fraction inputs the counted path reads. **Reject.**

**Recommendation (c): take no engine action.** `gains.auxiliary` is a demonstrably-counted electrical-end-use (and optional thermal gain) on the production path, gated by the Brief 92 Systems auxiliary toggle. The correct deliverables are documentation corrections plus a re-point of the Model-2 brief.

## 7. DECISION REQUIRED — impact on the active Model-2 brief

`bridgwater-model2-calibrated.md` **D2** instructs the residual onto the equipment class *because it believes `gains.auxiliary` is inert*, and its **D3** lists `gains.auxiliary` as the "known NOT-CONSUMED case", and **"What MUST NOT happen"** says *"Residual on `gains.auxiliary` … "*. All three are now factually wrong. `gains.auxiliary` + the Brief 92 toggle is a proven-counted pathway — and it is *semantically the auxiliary residual*.

**Chris's call** (changes the agreed methodology + the client deliverable):
1. **Move the Model-2 residual onto `gains.auxiliary`** (enable `systems_config_v40.auxiliary`, set the calibrated magnitude; the D2 before/after export proof still applies) — the honest naming, and it lands the residual where the report says it is. **Recommended.**
2. **Keep it on the equipment class** (as D2 currently reads) and simply correct D3/“MUST NOT” to state `gains.auxiliary` is counted-but-not-chosen. Less semantically clean but minimal churn to the agreed brief.

Either way, the Model-1 audit Finding 1 and the Model-2 D3 "known case" must be corrected.

> **DECISION (Chris, 2026-07-15): option 1 — move the Model-2 residual onto `gains.auxiliary`.**
> The residual is implemented by enabling `systems_config_v40.auxiliary` and setting the calibrated
> profile magnitude; the D2 before/after export proof (Outputs delta == residual) still holds. The
> documentation corrections (deliverables 2 & 3) are **deferred to Chris's own review** — this session
> made no edits to `bridgwater-baseline-model1_close.md` or `bridgwater-model2-calibrated.md`.

## Deliverables (documentation only — no engine code)

1. This brief (landed).
2. **Correct** `docs/audit/bridgwater-baseline-model1_close.md` Finding 1: replace "engine does not consume `gains.auxiliary`" with the reproduced truth (counted on State 3; gated off by the disabled Brief 92 Systems toggle). Keep the 294.959/119.2 numbers — they are the toggle-OFF numbers and remain correct.
3. **Re-point** `bridgwater-model2-calibrated.md` D2/D3/"MUST NOT" per the §7 decision.
4. Note the two follow-ups below in STATUS.md → Suggestions (do **not** implement here).

## Follow-ups to note, not implement (Process Rule 5)

- **Canonical `consumption.auxiliary` line.** The Outputs sheet currently derives "Auxiliary" as a *plug residual* (`elecTotal − Σ six named end-uses`, `assumptionsExport.js:338`), not from a dedicated `consumption.auxiliary` field. It reconciles by construction but hides the term when the toggle is off. **Now folded into `docs/briefs/active/performance-gap-term.md` (D7 / Part 3)** — auxiliary must become a genuine end-use line there so the performance-gap residual sits on its own separate, honestly-labelled line; the two are never merged or netted (Chris, 2026-07-15). No longer a standalone follow-up.
- **UX guard.** A non-zero Internal-Gains auxiliary magnitude contributes nothing while the Systems auxiliary toggle is off — the exact trap that misled the audit. A hint in the Internal Gains / Systems UI ("auxiliary is switched off in Systems") would prevent recurrence.

## Verification (falsifiable — all satisfied by `scratchpad/aux_probe.mjs`)

1. Toggle OFF: magnitude 0/1.5/7 → identical elec 294.959 (reproduces the audit). ✅
2. Toggle ON: magnitude 7 → elec 553.482 = 294.959 + 258.523; the delta equals `internal.auxiliary.electricity_kwh`. ✅
3. Toggle ON, magnitude 7, `gain_fraction` 0→1 → cooling electricity moves (thermal-gain consumption). ✅
4. `electricity_total_kwh` includes `internal.auxiliary.electricity_kwh` — code (`instantCalc.js:5258-5264`) and delta agree. ✅
```

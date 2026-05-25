# Brief 49 — MVHR recovery boundary diagnostic (diagnosis-first, hard stop before fix)

**Author:** Claude Chat (architect)
**Authorised by:** Chris Scott
**Status:** Active. Diagnosis-first brief — HARD STOP after the diagnosis, before any fix.
**Date opened:** 2026-05-25
**Target outcome:** Determine, with evidence, why toggling MVHR on/off on Bridgewater changes the demand→delivered display by ~61 MWh but barely changes EUI/electricity (~0 MWh observed, ~22 MWh expected). Identify which side of the accounting is correct and which is wrong, name the exact boundary at which the mismatch occurs, and report it for review. **Do NOT fix the engine in this brief** — the fix is a separate brief once we know which side is wrong.

This is the single highest-priority engine question on the project: it sits at the heart of the tool's physics-based credibility. If heating-delivered and fuel-consumed don't reconcile through MVHR, every heat-pump-vs-boiler comparison, every electrification case, is built on numbers that don't tie out.

---

## BEFORE DOING ANYTHING

0. **Session-start documentation reconciliation pass (mandatory).** Per Process Rule 8:
   - `ls docs/briefs/active/` — should be empty (Brief 48 archived)
   - `cat docs/briefs/current.md`
   - `tail -50 STATUS.md`
   - `git log --oneline -20`
   - If any check fails, the first commit is the cleanup commit.
1. Read this entire brief.
2. Read CLAUDE.md — especially the boundary-declaration discipline (Module Scopes + the diagnostics-note boundary-mismatch principle).
3. Read the diagnostics note: **NZA-Sim — Visualisation + reactivity audit** (https://www.notion.so/367d645e05cc81af93d7fc57bfc45faf). The "boundary-mismatch family" section and Findings E.2 are the canonical reference. The Brief 44 history (Diagnostic 248%, daily-profiles electricity) is the precedent — same family.
4. Confirm working tree clean, origin in sync.
5. **This is a DIAGNOSIS brief. Apart from the brief-file landing commit and the final diagnosis-document commit, NO code changes.** Read-only investigation. No fixes, no defensive patches, no "while I'm here" tidy-ups.
6. Land this brief at `docs/briefs/active/49_mvhr_recovery_boundary_diagnostic.md` as the first commit.

---

## The observation to explain (Finding E.2, confirmed)

On clean Bridgewater (~121.9 EUI), toggling the ventilation systems OFF:
- **MVHR ON:** demand→delivered Heating = **28.9 / 90.3** MWh (implied recovery ≈ 61 MWh). EUI 121.9, electricity ~284.
- **MVHR OFF:** demand→delivered Heating = **90.3 / 90.3** MWh. EUI **121.9**, electricity **283.9**.

**The contradiction:** ~61 MWh of recovery toggles on/off, the demand/delivered display changes accordingly, but EUI and electricity barely move (~0 MWh change; ~22 MWh expected at SCOP ~2.8).

So the recovery affects the demand/delivered bookkeeping but NOT the fuel consumed. The two accounting paths are decoupled. One is right, one is wrong. **The brief's job is to determine which.**

---

## The two hypotheses (the diagnosis must distinguish them)

**Hypothesis 1 — the FUEL side is correct; the demand/delivered DISPLAY is wrong.**
The heating load is genuinely small, so MVHR genuinely saves little fuel, and the EUI being flat is correct. In that case the demand→delivered "28.9 / 90.3" display is misleading — it implies a 61 MWh recovery that doesn't translate to real delivered-heat reduction. The bug is in how the demand/delivered figures are computed or displayed (a presentation/boundary bug, lower severity).

**Hypothesis 2 — the DISPLAY side is correct; the FUEL path is wrong.**
MVHR genuinely removes ~61 MWh of heating the systems would otherwise deliver, but the fuel-consumption path fails to credit it — i.e. fuel is being computed from raw demand (or some pre-recovery quantity) rather than from post-recovery delivered heat. In that case turning MVHR off SHOULD raise electricity by ~22 MWh and doesn't. The bug is in the fuel path, and **every MVHR building's EUI is wrong** (high severity, systematic).

These have very different fixes, which is why this brief stops at diagnosis.

---

## What to investigate (read-only)

### A. Trace the MVHR recovery offset end to end
In `frontend/src/utils/instantCalc.js` (and `interventionsEngine.js` where relevant):
1. Where is `recovery_offset_mwh` (the MVHR credit) computed? What is it a fraction OF — total heating demand, ventilation heat loss, or something else? (Finding E.2's original suspicion was that it may be scoped against total demand rather than ventilation load — confirm or refute.)
2. Where is `space_heating.demand_mwh` (raw, 90.3) computed, and where is `space_heating.delivered_mwh` (28.9 with MVHR) computed? Trace the exact line where the recovery offset is subtracted to get from one to the other.
3. Trace the FUEL path: where is heating electricity/gas computed? Is it `delivered / SCOP` (post-recovery) or `demand / SCOP` (pre-recovery) or something else? **This is the crux** — if fuel uses delivered, toggling MVHR should move fuel; if it uses demand, it won't.
4. Document the boundary at which EACH quantity lives, per the Brief 44 naming discipline.

### B. The decisive reconciliation
With MVHR ON vs OFF on Bridgewater, compute by hand and from the engine:
- The change in `delivered_mwh` (should be ~61 MWh if display is to be believed).
- The change in heating electricity (`Δdelivered / SCOP` ≈ 22 MWh if fuel tracks delivered).
- The OBSERVED change in total electricity (~0).
- **Whichever of "delivered changes by 61" or "fuel changes by ~22" does NOT hold is the broken side.**

### C. Check against the Brief 44 precedents
Brief 44 found this exact family twice:
- Diagnostic 248%: delivered (post-MVHR) compared against a setpoint recompute returning raw demand.
- Daily-profiles electricity: `heating_demand/SCOP` used where `heating_delivered/SCOP` was canonical — the gap reconciled to MVHR offset / SCOP.
Both were FUEL-side computed at the wrong boundary. That precedent makes **Hypothesis 2 the more likely** — but the brief must prove it, not assume it. Check whether the same `demand`-vs-`delivered` confusion exists in the primary (non-daily) fuel path.

### D. Quantify the recovery plausibility
Independently of the toggle: is a 61 MWh recovery physically plausible for Bridgewater's ventilation?
- What is the ventilation heat loss (the air-stream the MVHR can actually recover from)?
- 61 MWh recovery should be ~70–90% of the VENTILATION loss, NOT ~67% of total heating demand (90.3).
- Cross-check against the Building Heat Balance envelope-only loss breakdown (ventilation vs fabric vs infiltration).
- If 61 MWh exceeds what ventilation could physically supply, the recovery itself is overstated (a third, deeper possibility — recovery scoped against the wrong base).

---

## Deliverable

`docs/audit/49_mvhr_recovery_diagnosis.md` containing:
1. The end-to-end trace of the recovery offset and the fuel path, with boundary names for every quantity.
2. The reconciliation arithmetic (delivered change, expected fuel change, observed fuel change).
3. **A clear verdict: Hypothesis 1, 2, or 3 — which side is wrong, at which boundary, with the evidence.**
4. A plausibility check on the 61 MWh recovery magnitude vs ventilation loss.
5. A recommended fix DIRECTION (not implemented) — what boundary alignment the fix brief would need to make, and which files.
6. Falsifiability target for the future fix brief: after fixing, toggling MVHR on↔off on Bridgewater must change electricity by ≈ recovery_offset / SCOP (and the demand/delivered display must reconcile with that).

---

## HARD STOP

After the diagnosis document is committed and pushed: **STOP. Surface to Chris. Do not fix.** The fix is a separate brief, authorised once Chris has reviewed the verdict. The reason: the fix for Hypothesis 1 (display/boundary) is completely different from the fix for Hypothesis 2 (fuel path) or 3 (recovery magnitude), and committing to a direction before the evidence is in is exactly the "diagnose before fixing" discipline the project runs on.

Escalate mid-diagnosis only if: the trace reveals the recovery offset feeds MORE than just heating (e.g. it's entangled with cooling or DHW), or the Bridgewater numbers don't reproduce the Finding E.2 observation (in which case re-confirm the observation first).

---

## What MUST NOT happen
- No engine fixes. Diagnosis only.
- No defensive patches or "while I'm here" changes.
- No presuming Hypothesis 2 because Brief 44 precedent points that way — prove it.
- No engine-number drift — Bridgewater anchor ~121.9 (read-only investigation shouldn't change it; if it does, something's wrong).
- No skipping the boundary-naming discipline in the trace — every quantity's boundary named explicitly.

## Notes on discipline
- This is the most consequential finding of the session. It earns a careful, evidence-first diagnosis.
- The breakdown panel (Brief 48) + the demand→delivered display + the MVHR toggle are the instruments that surfaced it — use them in the diagnosis.
- Audit-before-fix, then a human decision on direction. That's the whole point of the hard stop.

Standing by for authorisation to begin (BEFORE-DOING-ANYTHING + the read-only trace, deliverable, then HARD STOP).

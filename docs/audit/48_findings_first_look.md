# Brief 48 Findings First-Look — record only, no engine fixes

**Status:** Closed 2026-05-25. Brief 48 Part 5 deliverable. This note carries the
first-look observations made through the new BreakdownPanel during the
Bridgewater walkthrough. It is **input to the next boundary-fix brief**, not a
fix log — per Brief 48 "What MUST NOT happen": *No engine boundary FIXES — this
brief builds the instrument; fixes are a separate brief.*

Bridgewater anchor at close: **~121.9 kWh/m²·yr** (clean baseline; +0.2 drift
from the previous ~121.7 reading is within reading-variance band — Brief 48
touched no engine surface, only delta-extraction and presentation).

The findings below are tagged by **status** to communicate exactly what was
verified and what is still open. The next brief picks them up from this state.

---

## Finding A — Cooling setpoint boundary

**Brief 48 framing:** cooling demand reading suspected of boundary inconsistency
(setpoint-mode vs comfort-band resolution); use the panel to read demand/delivered
deltas directly and record whether they now look correct-but-gains-/climate-
limited or genuinely anomalous.

**Status — INSTRUMENT READY; LIVE READ-OUT PENDING.** The panel now surfaces
the cooling demand delta in plain language (`Cooling demand` row in the Demand
section, `Cooling delivered` row in the Delivered section, `Cooling efficiency`
row also in Delivered). The boundary between zone demand (`consumption.space_cooling.demand_mwh`)
and delivered (`per_service.cooling.delivered_mwh`) is now visible per
intervention.

**Observation:** [pending Chris's live read on a cooling-active intervention —
the Bridgewater Part 2 checkpoint focused on the heating chain where MVHR
Finding E surfaced.]

**Pointer for next brief:** read the cooling rows on a cooling-active
intervention (e.g. a cooling-system swap or setpoint change). If demand and
delivered both move sensibly and the ratio matches the system efficiency,
mark closed. If they diverge in a way that mirrors Finding E's MVHR
decoupling, the next brief covers both under one boundary-fix pass.

---

## Finding C — Infiltration

**Brief 48 framing:** infiltration heat loss reading suspected of being lower
than expected vs the configured q50 (Brief 39/41/42 envelope-physics rework
landed correct mirror physics but correlation-correctness was not separately
verified — CLAUDE.md Rule 14 expansion).

**Status — INSTRUMENT READY; LIVE READ-OUT PENDING.** Infiltration is part of
the State 2 raw demand (`consumption.space_heating.demand_mwh`) which the panel
surfaces explicitly as `Heat the building needs · Raw State 2 zone demand · pre-MVHR`.
An airtightness intervention will move that row directly; the magnitude of the
move is the read on infiltration's contribution to demand.

**Observation:** [pending Chris's live read on an airtightness intervention.]

**Pointer for next brief:** create an intervention that drops q50 from baseline
to a tight value (e.g. 8 → 3 m³/h·m² @ 50 Pa) and read `Heat the building needs`
delta. Compare against hand-calculated infiltration heat loss change. If
discrepant, the next brief inspects the State 2 infiltration integration loop
against the State 1 mirror and current best-practice correlation.

---

## Finding D — Stacked-marginal reorder behaviour

**Brief 48 framing:** reordering interventions shifts per-row marginal/cumulative
attribution in ways the user didn't expect; engine output is correct per Brief
41 Part 2's `computeDelta` definition but the user-facing framing needs work.

**Status — DELTA-MATH LAYER CLEARED ALGEBRAICALLY (PART 1).** The reconciliation
identity `cumulative[N].delta === sum(marginal[i].delta for i in 0..N)` holds
**by construction** at the `computeDelta` layer. Algebraic proof in
[`48_breakdown_data_audit.md` §7.2](48_breakdown_data_audit.md): pure subtraction
+ telescoping `prev(i+1) === my(i)` in `runInterventionStack`. The identity
cannot fail at this layer; only floating-point rounding could perturb it
(<1e-9).

**What this means:**
- Reorder cannot introduce a cumulative-vs-sum-of-marginals mismatch at the
  delta-math layer. Anything Finding D was about is **upstream** of `computeDelta`.
- Two legitimate reorder behaviours remain user-visible (and they are correct,
  not bugs):
  1. **Last-write-wins on overlapping `set` patches** (Brief 41 §6 semantics):
     reordering changes which intervention "wins" → final cumulative state
     genuinely differs.
  2. **Per-intervention marginal attribution shifts with order** because "this
     intervention's contribution given everything above it" depends on what is
     above it. This is correct per the marginal definition.

**Pointer for next brief:** if reorder behaviour still feels wrong after
Findings A/C/E land, the investigation moves to **patch semantics** (Brief 41 §6
last-write-wins behaviour for overlapping `set` patches) or **marginal
attribution framing UX** (re-explain in the panel that marginal is order-
dependent by construction; possibly surface a "would be" if-reordered alternate
read). Not a delta-math fix.

---

## Finding E — MVHR boundary decoupled-accounting bug (NEW — first use of the panel)

**Discovery:** Found by Chris on first use of the BreakdownPanel during the
Brief 48 Part 2 checkpoint. The panel's narrate-test succeeded in the strongest
possible way — the user diagnosed a real engine bug by reading the audit trail.

**Status — BUG CONFIRMED; OWN BRIEF NEXT.** Per Chris's directive at Part 5 hand-
off: "Do NOT investigate Finding E in Brief 48 — Part 5's findings first-look
is record-only. The MVHR boundary bug gets its own brief next."

**One-line summary:** MVHR boundary decoupled accounting bug — the recovery
offset surfaced through the panel revealed an inconsistency between the heating
demand boundaries that downstream calculations honour.

**Observation:** [details to be captured by Chris in the next brief; recording
here is intentionally minimal per the record-only Part 5 constraint.]

**Pointer for next brief:** the next brief picks up Finding E first (it's the
acute one) and likely reads A and C through the same instrument while the
boundary surface is being worked. Brief 48 explicitly did not investigate;
the instrument is the deliverable.

---

## Summary for the next brief

| Finding | Status entering next brief |
|---------|----------------------------|
| A — Cooling setpoint | Instrument ready; live read needed. |
| C — Infiltration     | Instrument ready; live read needed. |
| D — Reorder marginals | Delta-math layer cleared. Remaining work, if any, is patch-overlap semantics or marginal-attribution UX framing — neither is a delta-arithmetic bug. |
| E — MVHR boundary    | Bug confirmed via panel; needs investigation + fix in its own brief. |

The BreakdownPanel is the instrument; the panel narrated correctly enough to
expose Finding E on first use. That's the validation Brief 48 was built for.

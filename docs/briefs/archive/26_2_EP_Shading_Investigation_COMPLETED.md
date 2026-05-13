# Brief 26.2: EnergyPlus shading investigation

BEFORE DOING ANYTHING:
1. Read CLAUDE.md
2. Read STATUS.md
3. Read `docs/state_contracts.md` v2.2
4. Read `docs/state_1_divergences.md` (specifically divergence #8 — current state of EP shading)
5. Read `docs/briefs/archive/Brief_23_*.md` for the three failed hypotheses already tested
6. Read this ENTIRE brief before writing a single line of code

---

## CONTEXT

EnergyPlus is ignoring shading inputs. Live engine respects shading correctly (44% drop in south solar with 2m overhang + 1m fins, exactly matching the 0.56 shading factor). EP shows < 1% jiggle across the same scenarios — pure solver noise, no shading response.

Brief 23 (2026-05-06) attempted to fix this and failed. Three hypotheses tested:
- ShadowCalculation explicit setup
- solar_distribution=FullExterior
- Shading:Building:Detailed with explicit vertices

All three failed. Bug catalogued as divergence #8.

Brief 26 Part 2.5 swapped the 3D viewer's axis convention to align with EP (X=length east-west, Z=building height). This happened **after** Brief 23's investigation. The axis swap might have left shading geometry in the old coordinate system while building geometry got migrated to the new one — meaning EP loads the shading objects but they're positioned in physically nonsense locations relative to the surfaces they should shade.

**Time-box: one focused investigation session.** Test the five hypotheses below. If one cracks the bug, ship the fix. If none crack it, document the new failed hypotheses in divergences #8 with full detail and escalate to a longer dedicated investigation brief.

**This is investigation work, not implementation work.** Don't refactor anything. Don't add features. Just find why EP isn't applying shading.

---

## VERIFICATION RULES

Three test scenarios on Bridgewater, identical to the diagnostic Claude Code ran for the live engine fix:

1. **No shading** — all overhangs and fins set to zero
2. **Current** — 0.5m overhang on all facades (current Bridgewater config)
3. **Extreme** — 2m overhang + 1m fins on south facade specifically

For each scenario, run EP and capture:
- `Surface Outside Face Incident Solar Radiation Rate per Area` (W/m²) for the south windows
- `Surface Window Transmitted Solar Radiation Energy` (J) for the south windows  
- `Surface Window Heat Gain Energy` (J) for the south windows
- Total annual solar gain through south facade glazing

Expected behaviour if EP is working:
- South window incident solar drops substantially from no-shading to extreme
- Transmitted solar drops proportionally
- Heat gain through window drops proportionally
- Total annual south solar drops by ~40% under extreme shading

Current behaviour (the bug):
- All three numbers identical to within 1% across all three scenarios

A successful fix means: at least the incident solar variable responds to shading geometry changes.

---

## HYPOTHESES TO TEST

Test in order. Stop at the first one that cracks the bug.

### Hypothesis 1: Output variable mismatch

Maybe shading IS reducing solar but the variable being read (`Surface Window Transmitted Solar Radiation Energy`) isn't the right one to detect it. The transmitted variable reads post-glazing energy; if EP's window heat balance computes transmitted solar from an internal beam-tracking calculation that bypasses external shading, the bug would manifest exactly as we see it.

**Test:**
- Add `Surface Outside Face Incident Solar Radiation Rate per Area` to the Output:Variable list for the south windows
- Add `Surface Outside Face Beam Solar Radiation Rate per Area` (if available)
- Re-run the three shading scenarios
- Compare these new variables across the three scenarios

**If incident solar responds to shading but transmitted solar doesn't:** the bug is in EP's window-to-incident-solar linkage, not in shading geometry. We'd need to figure out which transmitted-solar variable correctly responds.

**If incident solar also doesn't respond:** the bug is in shading geometry being ignored by EP entirely. Move to hypothesis 2.

### Hypothesis 2: Coordinate system mismatch from Brief 26 Part 2.5

Brief 26 Part 2.5 swapped the 3D viewer's axes (X=width to X=length, building runs east-west, north face is the long face). The fix was in `BuildingViewer3D.jsx` and verified that EP and the live calc had been consistent (long axis on X) all along, with the viewer being the odd one out.

But: did the shading vertex generation also get checked? Shading objects in epJSON have vertices in absolute coordinates. If the shading vertex generator was written assuming the *old* viewer convention (which matched neither EP nor the live calc before the fix), the shading objects might be in nonsense positions — physically loaded by EP but not actually overlapping the windows they're meant to shade.

**Test:**
- Open the generated epJSON for the "extreme shading" scenario
- Find the `Shading:Building:Detailed` (or equivalent) objects
- Plot their vertex coordinates on a 2D top-down view
- Plot the south window vertex coordinates on the same view
- Check: are the shading vertices physically above the south windows, or are they somewhere else (above the north windows, floating in the middle of the building, etc.)?

**If shading vertices are misplaced:** found the bug. Fix is in the shading geometry generator (`geometry.py` or wherever shading vertices are computed) to use the same coordinate convention as the surface vertices.

**If shading vertices are correctly placed:** move to hypothesis 3.

### Hypothesis 3: Solar Distribution setting

EP's `Building` object has a `Solar Distribution` field. Possible values:
- `MinimalShadowing` — only computes shadows from the building's own surfaces on its own surfaces (no shading objects)
- `FullExterior` — shading objects affect exterior solar
- `FullInteriorAndExterior` — full interior solar redistribution + shading objects

If this is set to `MinimalShadowing` (the default), external shading objects won't affect window solar regardless of how they're positioned.

Brief 23 supposedly tried `FullExterior` but it's worth confirming the setting is actually reaching the generated epJSON, not just being added to a builder function that doesn't get called.

**Test:**
- Open the generated epJSON
- Find the `Building` object
- Confirm `solar_distribution` is `FullExterior` or `FullInteriorAndExterior`
- If it's `MinimalShadowing`, fix the assembler to emit the right value
- Re-run the extreme shading scenario
- Check whether solar responds now

**If setting was wrong and fix works:** ship it.

**If setting was right or fix doesn't work:** move to hypothesis 4.

### Hypothesis 4: Shading transparency schedule

Shading objects in EP can have a transparency schedule that controls how much light passes through. If the schedule defaults to "always transparent" (transmittance = 1) or isn't being created at all (which EP may interpret as fully transparent), the shading is geometrically present but optically null.

**Test:**
- Open the generated epJSON
- Find the `Shading:Building:Detailed` or `Shading:Site:Detailed` objects
- Check for a `transmittance_schedule_name` field
- If present, find the referenced schedule and check its values
- If absent, check whether EP defaults to opaque (transmittance = 0) or transparent (= 1) for missing schedules

**If transparency is 1:** the fix is to either omit the transparency schedule (if EP defaults to opaque) or add a schedule with constant 0 transmittance.

**If transparency is 0 or schedule is correct:** move to hypothesis 5.

### Hypothesis 5: Shading Calculation Method / Frequency

EP's `ShadowCalculation` object controls how often and how shading is computed. The fields include:
- `Calculation Method` (e.g., `PolygonClipping`, `PixelCounting`)
- `Shading Calculation Update Frequency Method` (`Periodic` or `Timestep`)
- `Shading Calculation Update Frequency` (days between updates)
- `Maximum Figures in Shadow Overlap Calculations` (a limit that, if too low, can cause shadows to be skipped)

If the maximum figures setting is too low for the number of shading surfaces, EP silently skips computing some shadows. If the calculation method is wrong, or the update frequency is too coarse, shadows might be computed but not applied.

**Test:**
- Open the generated epJSON
- Find the `ShadowCalculation` object
- Check all field values against EP defaults
- Try setting `Maximum Figures in Shadow Overlap Calculations` to its maximum (15000 or whatever the upper limit is)
- Try `Calculation Method` = `PolygonClipping` with explicit `Polygon Clipping Algorithm` = `SutherlandHodgman`
- Try `Shading Calculation Update Frequency` = 1 (recompute daily)
- Re-run extreme shading scenario

**If any setting change makes shading respond:** ship the fix.

**If none of the settings change anything:** the bug is somewhere we haven't found yet.

---

## WHAT TO DO IF ALL FIVE HYPOTHESES FAIL

Document each failed hypothesis in divergence #8 with:
- What was tested specifically
- What the test showed
- What the result was (numbers, screenshots of epJSON sections)
- Why it ruled out this hypothesis

Then escalate to a longer EP shading investigation brief (Brief 26.3 or whatever number is next). At that point, options include:
- Building a minimal isolated EP test case (one zone, one window, one shading object) to bisect the problem
- Reading EP's source code for the shading calculation path
- Posting to EnergyPlus support forums with the minimal test case
- Consulting EP example files that demonstrate working shading

None of those are appropriate to attempt in this brief's time-box.

---

## FILES YOU'LL LIKELY TOUCH

Likely investigation paths:
- `nza_engine/generators/geometry.py` — shading vertex generation
- `nza_engine/generators/epjson_assembler.py` — Solar Distribution, ShadowCalculation, Shading:Building:Detailed assembly
- `nza_engine/parsers/sql_parser.py` — only if hypothesis 1 reveals output variable issues

Test scripts to write:
- `scripts/ep_shading_diagnostic.mjs` (or .py) — runs the three scenarios, prints the diagnostic variables for each, makes the bug visible

---

## OUTPUTS

Whether the fix lands or not, this brief produces:

1. **Updated divergence #8** with whatever hypotheses were tested and what was found
2. **A diagnostic script** that runs the three scenarios and prints whether EP is responding to shading — reusable for any future investigation
3. **If fixed:** an updated `Bridgewater` config that demonstrates EP shading working, with screenshots showing solar dropping under the extreme scenario
4. **If not fixed:** a written escalation note documenting what's been tried and what to try next

---

## VERIFICATION

If fixed:
- Three EP scenarios on Bridgewater show south solar dropping from no-shading to extreme scenario
- Approximate match to the 0.56 shading factor that the live engine computes
- Engine agreement on south solar within 10% (allow for some EP/live divergence due to other simplifications)
- State isolation regression still passes 22/22 + 23/23
- UI disclosure for shading-vs-engine-canonical can be removed or simplified

If not fixed:
- All five hypotheses documented in divergence #8 with test evidence
- Diagnostic script committed and reusable
- Escalation note clearly identifying what to try next
- UI disclosure remains as-is

**Commit message if fixed:** "Brief 26.2: EP shading bug fix — [hypothesis N] was the root cause"

**Commit message if not fixed:** "Brief 26.2: EP shading investigation — five hypotheses ruled out, escalated to dedicated investigation brief"

Push to GitHub. Confirm push succeeded.

Tell Chris what happened either way.

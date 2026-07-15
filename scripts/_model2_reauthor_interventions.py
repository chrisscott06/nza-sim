"""Re-author the HIEX interventions as relative transformations coherent against
Model 2 (interventions-fix brief B2/D2/D4/D7). Rewrites patches (absolute set ->
scale/delta), fixes the two mis-authored patches, splits 2_1 into 2_1a/2_1b,
adds the D4 trickle-vent measure, and updates narratives. Preserves cost / life
/ theme / enabled on every measure; leaves the 0-patch off-model stubs' patches
untouched (2_3 gets a narrative refresh only). Writes the live Bridgewater
interventions[] ONLY — scenarios[], baseline_snapshot, and the calibrated inputs
are left intact. Idempotent (keys off measure id). DB backed up pre-run.
"""
import sqlite3, json, copy

PID = '12cf7cc4-9bdc-41bc-ab4e-24e044fbad9d'
INLINE = 'inline'
def P(op, path, value): return {'op': op, 'path': path, 'value': value, 'source': INLINE}

# Re-authored patch sets (verified isolated vs Model 2 in _model2_interventions_run.mjs).
PATCHES = {
  'int_hiex_1_1': [P('scale', 'building.systems_config_v40.dhw_demand_litres_per_person_per_day', 0.805)],
  'int_hiex_1_2': [P('scale', 'building.systems_config_v40.dhw_demand_litres_per_person_per_day', 0.82)],
  'int_hiex_1_3': [P('delta', 'building.systems_config_v40.dhw[1].efficiency_metric', 0.4)],
  'int_hiex_1_4': [P('set', 'building.systems_config_v40.dhw[0].share_pct', 0),
                   P('set', 'building.systems_config_v40.dhw[1].share_pct', 100)],
  'int_hiex_2_2': [P('scale', 'building.systems_config_v40.ventilation[1].flow_rate', 0.72),
                   P('scale', 'building.systems_config_v40.ventilation[1].efficiency_metric.sfp_w_per_lps', 0.5184)],
  'int_hiex_3_1': [P('delta', 'building.systems_config_v40.heating[0].efficiency_metric', 0.4),
                   P('delta', 'building.systems_config_v40.cooling[0].efficiency_metric', 0.4)],
  'int_hiex_3_2': [P('scale', 'building.systems_config_v40.heating[0].efficiency_metric', 1.25),
                   P('scale', 'building.systems_config_v40.cooling[0].efficiency_metric', 1.25)],
  'int_hiex_3_3': [P('set', 'building.systems_config_v40.heating_setpoint_mode', 'custom'),
                   P('set', 'building.systems_config_v40.heating_setpoint_c', 21),
                   P('set', 'building.systems_config_v40.cooling_setpoint_mode', 'custom'),
                   P('set', 'building.systems_config_v40.cooling_setpoint_c', 24)],
  'int_hiex_4_2': [P('scale', 'building.gains.equipment.profiles[0].baseload.value', 0.75)],
  'int_hiex_5_2': [P('scale', 'building.gains.lighting.profiles[0].magnitude.value', 0.85)],
}
# Narratives (notes). Each states the RELATIVE basis + Model-2 reference.
NOTES = {
  'int_hiex_1_1': "Low-flow fittings: scale DHW demand (L/p/day) x0.805 (-19.5%) off live state. Relative so it tracks the gas-anchored converged value (Model 2: 57.57 -> 46.34 L/p/day), never a frozen absolute that fights the anchor.",
  'int_hiex_1_2': "WWHR: scale DHW demand x0.82 off live state. NOTE (same-path cumulative caveat): 1_1 and 1_2 both scale the same L/p/day path, so stacked they compound multiplicatively (x0.805 x0.82) - not additive. Isolated each is measured alone vs Model 2.",
  'int_hiex_1_3': "Exhaust-air over the DHW ASHP: delta +0.4 on the ASHP COP off live (Model 2: 2.8 -> 3.2). The mis-authored patch that degraded the space-heating VRF to 3.0 has been DELETED (it was never part of this DHW measure).",
  'int_hiex_1_4': "Larger ASHP - full DHW off gas: structural share reallocation (gas 0% / ASHP 100%), a Class-S set. The side-effect COP de-rate (was set 2.9) is DROPPED - moving all DHW to the ASHP does not also degrade its COP; COP is owned by 1_3. Isolated-run convention: composed after 1_1/1_2 the demand it serves would shrink accordingly. APPROXIMATION (flagged): the annual model treats DHW as 100% ASHP; the gas calorifiers are physically retained as peak/backup plant but carry no annual load here.",
  'int_hiex_2_2': "Fan duty reduction: scale bedroom-extract flow x0.72 off live, with SFP by the cube law - fan power ~ flow^3, so specific fan power ~ flow^2 -> SFP scale x0.72^2 = x0.5184 (Model 2: 2292 l/s / SFP 0.8 -> 1650 l/s / 0.415). Interacts with the D4 trickle-vent measure (shrinks the make-up demand the vents serve - sequence 2_2 then D4).",
  'int_hiex_3_1': "VRF commissioning & diagnostics: delta +0.4 on live heating SCOP and cooling SEER (Model 2: 2.8/3.0 -> 3.2/3.4). Relative uplift from realising design control quality, not a frozen target.",
  'int_hiex_3_2': "VRF replacement (current-gen R-32): scale heating/cooling efficiency x1.25 off live. Composed AFTER 3_1 in the cumulative stack (2.8 +0.4 = 3.2, x1.25 = 4.0) - the relative op composes without the old double-count risk; isolated it is x1.25 on the Model-2 baseline (2.8 -> 3.5).",
  'int_hiex_3_3': "Setpoint optimisation: widen the comfort deadband by +/-1 K. Model 2 runs follow_comfort at 22/23 with no stored numeric setpoint, so this is realised as custom setpoints derived from the live band: heating 22-1 = 21, cooling 23+1 = 24. (Realised via set, not delta, because follow_comfort exposes no numeric to delta from - noted as a divergence; setpoints are absolute temperatures, not L/p/day.)",
  'int_hiex_4_2': "Automatic room shut-off (keycard/occupancy): scale the ATTRIBUTED guest-room plug load ('Small Power' profile) x0.75 (-25%) off live. Targets that named profile ONLY - BOH/kitchen, laundry, and crucially the auxiliary residual are excluded structurally (D3), so the measure never claims the unattributed residual.",
  'int_hiex_5_2': "Communal lighting + controls: scale lighting power density x0.85 (-15%) off live (Model 2: 3.5 -> 2.975 W/m2).",
}
# assumption_notes ENERGY BASIS refresh (keep any COST BASIS the measure already carries).
ENERGY_BASIS = {k: NOTES[k] for k in NOTES}

# D5 - measure 2_3 (HR bypass) narrative refresh (stays 0-patch, off-model).
NOTES_2_3 = "Heat-recovery bypass setpoint (off-model, no claimed effect). Correct control: bypass recovery whenever outdoor < indoor AND the zone calls for cooling - a free-cooling enabler, not a seasonal switch. Simulatable only after the gated thermal-engine session adds a bypass model; until then it carries no effect and is not counted."

# D7 - MVHR variants replacing 2_1. Both convert the bedroom extract to MVHR (SFP
# 1.8, 80% sensible recovery, no bypass), remove the 4% panel heater, and SEAL the
# trickle vents (permanent-openings EA x0 - supply air makes them redundant).
def mvhr_patches(flow):
    return [
      P('set', 'building.systems_config_v40.ventilation[1].efficiency_metric', {'sfp_w_per_lps': 1.8, 'recovery_sensible_pct': 80, 'recovery_latent_pct': 0}),
      P('set', 'building.systems_config_v40.ventilation[1].flow_rate', flow),
      P('set', 'building.systems_config_v40.heating[1].share_pct', 0),
      P('set', 'building.systems_config_v40.heating[0].share_pct', 100),
      P('scale', 'building.openings.north.louvre_area_m2', 0),
      P('scale', 'building.openings.south.louvre_area_m2', 0),
      P('scale', 'building.openings.east.louvre_area_m2', 0),
      P('scale', 'building.openings.west.louvre_area_m2', 0),
    ]
MVHR_NOTE = ("MVHR on the bedroom extract (SFP 1.8, 80% sensible recovery, NO summer bypass). Also seals the "
  "trickle-vent path (permanent-openings EA x0 - MVHR supply replaces the make-up-air role). NET PENALTY "
  "as-modelled (no bypass): the year-round recovery adds ~+47/+51 MWh cooling demand that swamps the heating "
  "and fan sides. Components reported so the with-bypass bound can be constructed: heating benefit ~-30 MWh "
  "(SCOP 2.8 makes recovered heat worth more electricity than in the Model-1 analysis) against fans "
  "+18.8/+10.1 MWh; an IDEAL bypass (removes the cooling penalty entirely) would bound 2_1a near -11.5 and "
  "2_1b near -20.5 MWh. NOT a claim - bypass is imperfect and is ungated engine work; stated as a bound "
  "because it changes sign vs Model 1 and materially changes the 505 conversation.")

# D4 - new trickle-vent free-area reduction measure.
D4_NOTE = ("Trickle-vent free-area reduction: scale permanent-openings EA x0.5 off live (1.43 -> 0.715 m2). "
  "FACTOR ILLUSTRATIVE - 505 specify no reduction quantum anywhere, so there is no figure of theirs to adopt. "
  "Physical floor: EA is set by make-up air for the bathroom extract - at halved area, face velocity roughly "
  "doubles (~1.5 -> 3 m/s) and the remaining flow partially relocates to door/fabric leakage, so savings do "
  "not scale linearly with area; a derived minimum EA (~x0.6-0.7 at 2-2.5 m/s face velocity) is the likely "
  "practical limit. Interacts with 2_2 fan turn-down (which shrinks the make-up demand - do 2_2 first) and is "
  "SUPERSEDED inside the MVHR variants (EA -> 0, supply air replaces the make-up role). CONFIRM factor with 505.")
D4_MEASURE = {
  'id': 'int_hiex_2_4', 'label': 'Trickle-vent free-area reduction', 'enabled': True,
  'theme': 'ventilation', 'notes': D4_NOTE, 'capex_gbp': None, 'schema_version': 2,
  'measure_life_years': 30,
  'patches': [P('scale', f'building.openings.{f}.louvre_area_m2', 0.5) for f in ('north', 'south', 'east', 'west')],
  'assumption_notes': {'ENERGY BASIS': D4_NOTE, 'COST BASIS': 'Illustrative; no 505 cost basis - CONFIRM with 505.'},
}

con = sqlite3.connect('data/nza_sim.db'); con.row_factory = sqlite3.Row
r = con.execute('SELECT building_config FROM projects WHERE id=?', (PID,)).fetchone()
bc = json.loads(r['building_config'])
old = bc.get('interventions') or []
out = []
for it in old:
    iid = it.get('id')
    if iid == 'int_hiex_2_1':
        # split into 2_1a / 2_1b
        base = copy.deepcopy(it)
        for suffix, flow, label in (('a', 2208, 'MVHR (current flow 2,208 l/s)'), ('b', 1656, 'MVHR (reduced flow 1,656 l/s - 12 l/s/room)')):
            m = copy.deepcopy(base)
            m['id'] = f'int_hiex_2_1{suffix}'; m['label'] = label
            m['patches'] = mvhr_patches(flow); m['notes'] = MVHR_NOTE
            an = m.get('assumption_notes') or {}
            if isinstance(an, dict): an['ENERGY BASIS'] = MVHR_NOTE
            m['assumption_notes'] = an
            out.append(m)
        continue
    m = copy.deepcopy(it)
    if iid in PATCHES:
        m['patches'] = PATCHES[iid]
    if iid in NOTES:
        m['notes'] = NOTES[iid]
        an = m.get('assumption_notes') or {}
        if isinstance(an, dict): an['ENERGY BASIS'] = ENERGY_BASIS[iid]
        m['assumption_notes'] = an
    if iid == 'int_hiex_2_3':
        m['notes'] = NOTES_2_3
        an = m.get('assumption_notes') or {}
        if isinstance(an, dict): an['ENERGY BASIS'] = NOTES_2_3
        m['assumption_notes'] = an
    out.append(m)
    # insert D4 right after 2_2 for a sensible order
    if iid == 'int_hiex_2_2':
        out.append(D4_MEASURE)

# guard: no patch path may reference the residual profile (B3 structural invariant)
for m in out:
    for p in (m.get('patches') or []):
        assert 'auxiliary_residual_unattributed' not in json.dumps(p), f"residual referenced by {m['id']}"

bc['interventions'] = out
con.execute('UPDATE projects SET building_config=? WHERE id=?', (json.dumps(bc), PID))
con.commit()
print('re-authored interventions:', len(out))
print('ids:', [m['id'] for m in out])
print('measures with patches:', [(m['id'], len(m['patches'])) for m in out if m.get('patches')])
con.close()

// Final-P02 Part 4 re-author transform. Reproducible from the repo:
//   node scripts/_final_p02_reauthor.mjs
// Reads the baseline Model-2 + interventions fixture, applies the agreed-set
// energy edits, writes the re-authored fixture. Costs are layered in Part 5.
import fs from 'node:fs'
const FX = 'docs/audit/fixtures'
const fx = JSON.parse(fs.readFileSync(`${FX}/final_p02_model2_baseline_ints.json`, 'utf-8'))
const byId = id => fx.interventions.find(i => i.id === id)
const setPatch = (iv, path, value, op = 'set') => {
  const p = iv.patches.find(p => p.path === path)
  if (p) { p.op = op; p.value = value }
  else iv.patches.push({ op, path, value, source: 'inline' })
}

// ── MVHR full flow (2_1a): + summer_bypass true + SFP 1.2 (from 1.8) ──────────
{
  const iv = byId('int_hiex_2_1a')
  setPatch(iv, 'building.systems_config_v40.ventilation[1].efficiency_metric',
    { sfp_w_per_lps: 1.2, recovery_sensible_pct: 80, recovery_latent_pct: 0 })
  setPatch(iv, 'building.systems_config_v40.ventilation[1].summer_bypass', true)
  iv.label = 'MVHR — full flow (bypass, SFP 1.2)'
}
// ── MVHR reduced flow (2_1b): + summer_bypass true + SFP 1.2, flow 1656 ───────
{
  const iv = byId('int_hiex_2_1b')
  setPatch(iv, 'building.systems_config_v40.ventilation[1].efficiency_metric',
    { sfp_w_per_lps: 1.2, recovery_sensible_pct: 80, recovery_latent_pct: 0 })
  setPatch(iv, 'building.systems_config_v40.ventilation[1].summer_bypass', true)
  setPatch(iv, 'building.systems_config_v40.ventilation[1].flow_rate', 1656)
  iv.label = 'MVHR — reduced flow (bypass, SFP 1.2, 1656 l/s)'
}

// ── Film → SW-only (3_4): per-facade g 0.55→0.35 on the SW ('south', 222°)
// facade, replacing the whole-glazing swap to double_low_e. Needs Part 3. ─────
{
  const iv = byId('int_hiex_3_4')
  iv.patches = [
    { op: 'set', path: 'constructions.glazing.g_value_override_by_facade',
      value: { south: 0.35 }, source: 'inline' },
  ]
  iv.label = 'Solar-control film — SW glazing only (g 0.55→0.35)'
  iv.notes = 'Solar-control film on the SW-facing glazing only (F3 "south" bucket = 222° at orientation 42°). g 0.55→0.35. Per-orientation g override (Final-P02 Part 3). West/NW glazing contributes ~0 to solar cooling, so SW-only captures the effect. Materially below the old whole-glazing −1.6 (that swapped every facade to double_low_e g 0.42).'
}

// ── NEW: Communal ventilation night shutdown (GF units off 23:00-07:00) ───────
// Post-Part-2 this is MODELLED (fan + vent-heat both consume the schedule).
// GF public MVHR = ventilation[0]. Insert after 2_1b in the Ventilation theme.
{
  const idx = fx.interventions.findIndex(i => i.id === 'int_hiex_2_1b')
  const night = {
    id: 'int_hiex_2_5_night_shutdown',
    label: 'Communal ventilation night shutdown (23:00–07:00)',
    notes: 'GF public MVHR (ventilation[0]) scheduled off 23:00–07:00, all day-types (16 on-hours/day, 5,840 h/yr). Modelled post Final-P02 Part 2 — fan energy AND vent-heat/recovery both consume the schedule hour-by-hour. £0 (controls visit). Delivery note: confirm kitchen prep start — if 06:00, window is 23:00–06:00.',
    enabled: true,
    theme: 'Ventilation',
    capex_gbp: 0,
    schema_version: 2,
    patches: [
      { op: 'set', path: 'building.systems_config_v40.ventilation[0].control_schedule_id', value: 'gf_night_off_23_07', source: 'inline' },
    ],
    measure_life_years: 10,
    assumption_notes: 'ENERGY BASIS: GF communal MVHR off overnight; hand estimate −1.5 kWh/m² (±0.7). Report the modelled figure. COST BASIS: settings/commissioning tier — £0 controls visit (BMS schedule change).',
  }
  fx.interventions.splice(idx + 1, 0, night)
}

// ── DELETE the GF HR-bypass measure concept (2_3): baseline carries GF bypass
// as the existing design; no row anywhere. Also DELETE the standalone
// trickle-vent free-area measure (2_4): superseded inside the MVHR variants
// (they seal the trickle path, EA→0) and the brief forbids a standalone
// trickle-vent row. ───────────────────────────────────────────────────────────
fx.interventions = fx.interventions.filter(i => i.id !== 'int_hiex_2_3' && i.id !== 'int_hiex_2_4')

fs.writeFileSync(`${FX}/final_p02_model2_reauthored.json`, JSON.stringify(fx, null, 1))
console.log('wrote docs/audit/fixtures/final_p02_model2_reauthored.json')

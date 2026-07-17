// Final-P02 Part 5 — all-in cost layer. Reads the re-authored fixture, assigns
// each measure a cost_category + multiplier, computes base + all-in capex, and
// writes the costed fixture. Reproducible from the repo:
//   node scripts/_final_p02_costlayer.mjs
//
// Multipliers (cost-plan category uplift on the BASE line-items):
//   settings/commissioning ×1.00 · supply-and-fit ×1.12 · works packages ×1.32
// Base line-items are the authored cost.groups totals, EXCEPT the three costs
// the brief restates (film, brise, fan duty). all_in = base × multiplier.
import fs from 'node:fs'
const R = 'file:///C:/Users/ChrisScott/Dev/nza-sim/frontend/src'
const { computeLinesTotal } = await import(`${R}/utils/costModel.js`)
const FX = 'docs/audit/fixtures'
const fx = JSON.parse(fs.readFileSync(`${FX}/final_p02_model2_reauthored.json`, 'utf-8'))

const MULT = { settings: 1.00, supply_fit: 1.12, works: 1.32 }
// Category per the brief's assignment (Part 5):
//   works = ASHP, MVHR, VRF replacement, brise soleil, PV, exhaust-air
//   supply-fit = low-flow, film, keycard, lighting, WWHR, metering
//   settings = controls visit, fan duty, night shutdown, setpoints, trickle-vent
const CATEGORY = {
  int_hiex_1_1: 'supply_fit',            // low-flow fittings
  int_hiex_1_2: 'supply_fit',            // WWHR (at-refurb marginal)
  int_hiex_1_3: 'works',                 // exhaust-air ASHP
  int_hiex_1_4: 'works',                 // larger ASHP
  int_hiex_2_1a: 'works',                // MVHR full flow
  int_hiex_2_1b: 'works',                // MVHR reduced flow
  int_hiex_2_5_night_shutdown: 'settings', // night shutdown (controls visit)
  int_hiex_2_2: 'settings',              // fan duty
  int_hiex_2_4: 'settings',              // trickle-vent EA
  int_hiex_3_1: 'settings',              // VRF commissioning
  int_hiex_3_2: 'works',                 // VRF replacement
  int_hiex_3_3: 'settings',              // setpoints
  int_hiex_3_4: 'supply_fit',            // solar-control film
  int_hiex_3_5: 'works',                 // brise soleil
  int_hiex_4_2: 'supply_fit',            // keycard
  int_hiex_5_2: 'supply_fit',            // communal lighting
}
// Brief-restated base costs (override the authored line-items):
const BASE_OVERRIDE = {
  int_hiex_3_4: 4040,    // solar film 101 m² × £40 (SW-only)
  int_hiex_3_5: 31200,   // brise soleil 60 SW windows × £520
  int_hiex_2_2: 2900,    // fan duty
}

for (const iv of fx.interventions) {
  const cat = CATEGORY[iv.id]
  if (!cat) continue                     // enabling / non-energy rows: skip the 4.8 cost layer
  const base = BASE_OVERRIDE[iv.id] ?? computeLinesTotal(iv.cost)
  const mult = MULT[cat]
  iv.cost_category = cat
  iv.cost_multiplier = mult
  iv.base_capex_gbp = Math.round(base)
  iv.all_in_capex_gbp = Math.round(base * mult)
}

// Tariffs stated in the cost plan (Part 5) — carried on the fixture for the generator.
fx.cost_plan = {
  tariffs: { electricity_price_per_kWh: 0.25, gas_price_per_kWh: 0.06 },
  multipliers: MULT,
  basis: 'settings ×1.00 · supply-and-fit ×1.12 · works ×1.32; all-in = base × category multiplier. Tariffs elec £0.25/kWh, gas £0.06/kWh. [CONFIRM house rates & tariffs — Appendix A].',
}

fs.writeFileSync(`${FX}/final_p02_model2_costed.json`, JSON.stringify(fx, null, 1))
console.log('wrote docs/audit/fixtures/final_p02_model2_costed.json')
for (const iv of fx.interventions.filter(i => i.cost_category)) {
  console.log(`${iv.id.padEnd(27)} | ${iv.cost_category.padEnd(10)} ×${iv.cost_multiplier} | base £${iv.base_capex_gbp} → all-in £${iv.all_in_capex_gbp}`)
}

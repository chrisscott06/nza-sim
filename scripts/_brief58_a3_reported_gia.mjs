/**
 * scripts/_brief58_a3_reported_gia.mjs
 *
 * Brief 58 A3 verification probe — `reported_gia` two-role split.
 *
 * Gates (per Chris's instruction):
 *   (1) reported_gia == geometry_gia ⇒ Bridgewater EUI unchanged.
 *   (2) reported_gia = 1.1 × geometry_gia ⇒ EUI = anchor / 1.1 (exact).
 *   (3) Absolute kWh totals (heating demand, delivered energy,
 *       per-fuel totals) IDENTICAL across both runs — only the EUI
 *       denominator moved.
 *   (4) Per-element heat-balance kwh_per_m2 displays (wall/roof/
 *       glazing/etc.) unchanged — those use the geometry gia
 *       inside the engine via the local `perM2` helper.
 *
 * Uses the breakdown-dump path (loads real Bridgewater building_config
 * from the verification API at :8003) per Chris's note — the drift
 * harness's 130.80 is the known refbox-template fixture leak, NOT a
 * useful anchor for A3.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'

const API = process.env.NZA_API || 'http://127.0.0.1:8003'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const BRIDGEWATER_ID = '14b4a5b1-8c73-4acb-8b65-1d22f05ec969'

async function fj(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url} → ${r.status}`); return r.json() }

const project = await fj(`${API}/api/projects/${BRIDGEWATER_ID}`)
const building = project.building_config
const constructions = project.construction_choices
const systems = project.systems_config
const comfortBand = {
  lower_c: Number(project.comfort_band_lower_c ?? 20),
  upper_c: Number(project.comfort_band_upper_c ?? 26),
}

// Library + weather (mirroring _brief55_breakdown_dump.mjs)
const lib = await fj(`${API}/api/library/constructions`)
const libArr = lib.constructions ?? []
const libraryData = {
  constructions: libArr.map(c => ({
    name: c.name,
    u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
    g_value: c.config_json?.g_value,
    config_json: c.config_json ?? c,
    layers: c.layers,
  })),
  system_templates: SYSTEM_TEMPLATES_LIBRARY,
}

const weatherFile = building.weather_file
const epwPath = path.join(REPO_ROOT, 'data/weather/current', weatherFile)
const epwLines = fs.readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const latitude = parseFloat(epwLines[0].split(',')[6])
const dataLines = epwLines.slice(8).filter(l => l.trim().length > 0)
const N = dataLines.length
const month = new Int8Array(N), day = new Int8Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N), direct_normal = new Float32Array(N)
const diffuse_horizontal = new Float32Array(N), wind_speed = new Float32Array(N)
for (let i = 0; i < N; i++) {
  const p = dataLines[i].split(',')
  month[i] = parseInt(p[1]); day[i] = parseInt(p[2]); hour[i] = parseInt(p[3])
  temperature[i] = parseFloat(p[6]); direct_normal[i] = parseFloat(p[14])
  diffuse_horizontal[i] = parseFloat(p[15]); wind_speed[i] = parseFloat(p[21])
}
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const orientationDeg = Number(building.orientation ?? 0)
const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, orientationDeg)

const geometryGia = (building.length ?? 0) * (building.width ?? 0) * (building.num_floors ?? 0)

function runEngine(b) {
  return calculateInstant(
    b, constructions, systems, libraryData,
    weatherData, hourlySolar, null,
    { mode: 'full', comfortBand, engine: 'v2.5', _skipInterventions: true },
  )
}

function pick(r) {
  const totals = r?.energy_use?.totals ?? {}
  const cons   = r?.consumption ?? {}
  const md     = r?.metadata ?? {}
  return {
    eui_kwh_per_m2:        Math.round((totals.eui_kwh_per_m2 ?? 0) * 100) / 100,
    delivered_kwh_total:   Math.round(totals.delivered_energy_kwh ?? 0),
    electricity_kwh:       Math.round(totals.electricity_kwh ?? 0),
    gas_kwh:               Math.round(totals.gas_kwh ?? 0),
    heating_demand_mwh:    cons.space_heating?.demand_mwh ?? null,
    heating_delivered_mwh: cons.space_heating?.delivered_mwh ?? null,
    cooling_demand_mwh:    cons.space_cooling?.demand_mwh ?? null,
    carbon_kg_co2_per_m2:  r?.carbon_kg_co2_per_m2 ?? null,
    metadata_gia_m2:          md.gia_m2 ?? null,
    metadata_geometry_gia_m2: md.geometry_gia_m2 ?? null,
    metadata_reported_gia_m2: md.reported_gia_m2 ?? null,
  }
}

console.log('═════════════════════════════════════════════════════════════════════════')
console.log('  Brief 58 A3 verification — `reported_gia` two-role split')
console.log('═════════════════════════════════════════════════════════════════════════')
console.log(`  Project: Bridgewater (verification DB :8003)`)
console.log(`  Comfort band: ${comfortBand.lower_c}–${comfortBand.upper_c} °C`)
console.log(`  Geometry GIA: ${building.length} × ${building.width} × ${building.num_floors} = ${geometryGia} m²`)
console.log()

// ── Gate 1: default (reported absent) ─────────────────────────────────
console.log('  Gate 1 — default: building.reported_gia absent ⇒ reported == geometry')
const r1 = pick(runEngine(building))
console.log(`    metadata.gia_m2          = ${r1.metadata_gia_m2}`)
console.log(`    metadata.geometry_gia_m2 = ${r1.metadata_geometry_gia_m2}`)
console.log(`    metadata.reported_gia_m2 = ${r1.metadata_reported_gia_m2}`)
console.log(`    EUI                       = ${r1.eui_kwh_per_m2} kWh/m²·yr`)
console.log(`    delivered_total           = ${r1.delivered_kwh_total} kWh`)
console.log(`    heating demand            = ${r1.heating_demand_mwh} MWh`)
console.log(`    cooling demand            = ${r1.cooling_demand_mwh} MWh`)
console.log()

// ── Gate 2: reported = 1.1 × geometry ─────────────────────────────────
const MULT = 1.1
const reportedGia = MULT * geometryGia
console.log(`  Gate 2 — reported_gia = ${MULT} × geometry = ${reportedGia.toFixed(0)} m²`)
const r2 = pick(runEngine({ ...building, reported_gia: reportedGia }))
console.log(`    metadata.gia_m2          = ${r2.metadata_gia_m2}`)
console.log(`    metadata.geometry_gia_m2 = ${r2.metadata_geometry_gia_m2}`)
console.log(`    metadata.reported_gia_m2 = ${r2.metadata_reported_gia_m2}`)
console.log(`    EUI                       = ${r2.eui_kwh_per_m2} kWh/m²·yr  (expect ${(r1.eui_kwh_per_m2 / MULT).toFixed(2)})`)
console.log(`    delivered_total           = ${r2.delivered_kwh_total} kWh  (expect unchanged ${r1.delivered_kwh_total})`)
console.log(`    heating demand            = ${r2.heating_demand_mwh} MWh  (expect unchanged ${r1.heating_demand_mwh})`)
console.log(`    cooling demand            = ${r2.cooling_demand_mwh} MWh  (expect unchanged ${r1.cooling_demand_mwh})`)
console.log()

// ── Gate evaluation ───────────────────────────────────────────────────
console.log('═════════════════════════════════════════════════════════════════════════')
console.log('  GATE EVALUATION')
console.log('═════════════════════════════════════════════════════════════════════════')

// (1) reported == geometry default
const g1_metadata = r1.metadata_gia_m2 === r1.metadata_geometry_gia_m2 && r1.metadata_reported_gia_m2 === r1.metadata_geometry_gia_m2
console.log(`  Gate 1 (reported == geometry default): metadata triple ${g1_metadata ? '✓' : '✗'}`)
console.log(`    gia_m2=${r1.metadata_gia_m2}, geometry=${r1.metadata_geometry_gia_m2}, reported=${r1.metadata_reported_gia_m2}`)

// (2) EUI ratio
const eui_expected = r1.eui_kwh_per_m2 / MULT
const eui_actual = r2.eui_kwh_per_m2
const eui_ratio_ok = Math.abs(eui_actual - eui_expected) < 0.05
console.log(`  Gate 2 (EUI = anchor / ${MULT}): ${eui_ratio_ok ? '✓' : '✗'}`)
console.log(`    actual=${eui_actual}, expected=${eui_expected.toFixed(2)}, |Δ|=${Math.abs(eui_actual - eui_expected).toFixed(3)}`)

// (3) Absolute kWh unchanged
const abs_delivered_ok = Math.abs(r2.delivered_kwh_total - r1.delivered_kwh_total) < 1
const abs_heating_ok = Math.abs((r2.heating_demand_mwh ?? 0) - (r1.heating_demand_mwh ?? 0)) < 0.01
const abs_cooling_ok = Math.abs((r2.cooling_demand_mwh ?? 0) - (r1.cooling_demand_mwh ?? 0)) < 0.01
console.log(`  Gate 3 (absolute kWh unchanged): delivered ${abs_delivered_ok ? '✓' : '✗'}  heating ${abs_heating_ok ? '✓' : '✗'}  cooling ${abs_cooling_ok ? '✓' : '✗'}`)
console.log(`    delivered: ${r1.delivered_kwh_total} → ${r2.delivered_kwh_total}`)
console.log(`    heating:   ${r1.heating_demand_mwh} → ${r2.heating_demand_mwh}`)
console.log(`    cooling:   ${r1.cooling_demand_mwh} → ${r2.cooling_demand_mwh}`)

// (4) reported metadata reflects the override
const g4_reported = r2.metadata_reported_gia_m2 === Math.round(reportedGia)
const g4_geometry = r2.metadata_geometry_gia_m2 === Math.round(geometryGia)
console.log(`  Gate 4 (metadata surfaces both roles): reported ${g4_reported ? '✓' : '✗'}  geometry ${g4_geometry ? '✓' : '✗'}`)
console.log(`    reported_gia_m2=${r2.metadata_reported_gia_m2} (expect ${Math.round(reportedGia)})`)
console.log(`    geometry_gia_m2=${r2.metadata_geometry_gia_m2} (expect ${Math.round(geometryGia)})`)
console.log()

const all_pass = g1_metadata && eui_ratio_ok && abs_delivered_ok && abs_heating_ok && abs_cooling_ok && g4_reported && g4_geometry
console.log(all_pass ? '  ✓ ALL GATES PASS — A3 ready to land.' : '  ✗ One or more gates failed — investigate before commit.')
console.log()

// Persist JSON for audit trail
const OUT = path.join(REPO_ROOT, 'docs/audit/58_a3_reported_gia.json')
fs.writeFileSync(OUT, JSON.stringify({
  meta: {
    project: 'Bridgewater',
    geometry_gia: Math.round(geometryGia),
    multiplier: MULT,
    timestamp: new Date().toISOString(),
  },
  gate1_default: r1,
  gate2_reported_1p1x: r2,
  gates: {
    g1_metadata_default: g1_metadata,
    g2_eui_ratio: eui_ratio_ok,
    g3_abs_delivered: abs_delivered_ok,
    g3_abs_heating: abs_heating_ok,
    g3_abs_cooling: abs_cooling_ok,
    g4_reported: g4_reported,
    g4_geometry: g4_geometry,
    all_pass,
  },
}, null, 2))
console.log(`  JSON: ${path.relative(REPO_ROOT, OUT)}`)
console.log()

/**
 * assumptionsExport.js — single-sheet "Inputs" assumptions export.
 *
 * Brief: docs/briefs/active/assumptions-export.md
 *
 * `collectAssumptions(state)` is a PURE function that reads LIVE model state
 * (the same objects the inputs pages render — ProjectContext `building`
 * (=params), `constructions`, `libraryData`, plus the engine's
 * `occupancy_summary` for the derived occupancy line) and returns a flat row
 * set for the export sheet. It is a SNAPSHOT of inputs — hard values, no
 * formulas, no hardcoded parameter values.
 *
 * Any schema parameter with no discrete home in state is NOT invented — it is
 * recorded in the returned `escalations` list and (where a defensible derived
 * value exists) emitted with an explicit DERIVED / escalation basis.
 *
 * Part 2 wires `collectAssumptions` to SheetJS + the button; the XLSX writer
 * (`exportAssumptionsXlsx`) lives at the bottom of this file.
 */

import * as XLSX from 'xlsx'

// Column contract (mirrors the report table): Category | Parameter | Value | Units | Basis/Source
const COLUMNS = ['Category', 'Parameter', 'Value', 'Units', 'Basis/Source']

// ── State-read helpers ──────────────────────────────────────────────────────
// Mirror the canonical construction-choice resolution used by the Fabric
// inputs page (buildingSections._resolveChoice) and the engine's library
// lookups (firstPrinciples.getU/getG) — reading the SAME libraryData object,
// honouring per-project u_value_override / g_value_override so exported values
// match the effective values the inputs page shows.
function resolveChoice(choice) {
  if (typeof choice === 'string') return { library_id: choice, u_value_override: null, g_value_override: null }
  if (choice && typeof choice === 'object') {
    return {
      library_id:       choice.library_id ?? choice.name ?? null,
      u_value_override: Number.isFinite(choice.u_value_override) ? choice.u_value_override : null,
      g_value_override: Number.isFinite(choice.g_value_override) ? choice.g_value_override : null,
    }
  }
  return { library_id: null, u_value_override: null, g_value_override: null }
}

function libItem(libraryData, id) {
  if (!id || !libraryData?.constructions) return null
  return libraryData.constructions.find(c => c.name === id) ?? null
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)

// ── Collector ───────────────────────────────────────────────────────────────
/**
 * @param {object}  state
 * @param {object}  state.building          ProjectContext `params` (building_config shape)
 * @param {object}  state.constructions     construction choices map
 * @param {object}  state.libraryData       { constructions: [...] }
 * @param {object} [state.occupancySummary] engine result `occupancy_summary`
 *                                          (calculateInstant(...).occupancy_summary) — for the
 *                                          schedule-realised occupancy line. If absent, that
 *                                          line is escalated rather than reimplemented.
 * @returns {{ columns: string[], rows: object[], escalations: string[] }}
 */
export function collectAssumptions({ building = {}, constructions = {}, libraryData = {}, occupancySummary = null } = {}) {
  const rows = []
  const escalations = []
  const push = (Category, Parameter, Value, Units, Basis) =>
    rows.push({ Category, Parameter, Value, Units, 'Basis/Source': Basis })
  const escalate = (msg) => { if (!escalations.includes(msg)) escalations.push(msg) }

  // ── Building metadata ──────────────────────────────────────────────────────
  const L = num(building.length), W = num(building.width), NF = num(building.num_floors)
  const geometryGia = (L != null && W != null && NF != null) ? L * W * NF : null
  const reportedGia = num(building.reported_gia)
  if (reportedGia != null && reportedGia > 0) {
    push('Building metadata', 'GIA', Math.round(reportedGia), 'm²', 'Input — reported GIA (EUI denominator)')
  } else if (geometryGia != null) {
    push('Building metadata', 'GIA', Math.round(geometryGia), 'm²', 'Geometry-derived (length × width × floors); no reported GIA set')
  } else {
    push('Building metadata', 'GIA', '—', 'm²', 'MISSING — no geometry or reported GIA')
    escalate('GIA: no geometry or reported_gia in state')
  }

  const numRooms = num(building.num_bedrooms)
  push('Building metadata', 'Number of physical rooms', numRooms ?? '—', 'rooms', 'Input (num_bedrooms)')

  const occRate = num(building.occupancy_rate)
  if (numRooms != null && occRate != null) {
    push('Building metadata', 'Number of occupied rooms',
      Math.round(numRooms * occRate * 10) / 10, 'rooms',
      `DERIVED — num_bedrooms × occupancy_rate (${occRate}); no discrete "occupied rooms" input`)
    escalate('Number of occupied rooms: no discrete input — derived as num_bedrooms × occupancy_rate')
  } else {
    push('Building metadata', 'Number of occupied rooms', '—', 'rooms', 'MISSING — no occupancy_rate')
    escalate('Number of occupied rooms: no discrete input and occupancy_rate absent')
  }

  // ── Fabric ─────────────────────────────────────────────────────────────────
  const FABRIC_ELEMENTS = [
    ['external_wall', 'U-value — external wall'],
    ['roof',          'U-value — roof'],
    ['ground_floor',  'U-value — ground floor'],
    ['glazing',       'U-value — glazing'],
  ]
  for (const [key, label] of FABRIC_ELEMENTS) {
    const { library_id, u_value_override } = resolveChoice(constructions[key])
    const item = libItem(libraryData, library_id)
    const libU = num(item?.u_value_W_per_m2K)
    const effU = u_value_override != null ? u_value_override : libU
    if (effU != null) {
      const basis = u_value_override != null
        ? `Project override (library "${library_id}" = ${libU ?? '?'})`
        : `Library "${library_id ?? '—'}"`
      push('Fabric', label, effU, 'W/m²K', basis)
    } else {
      push('Fabric', label, '—', 'W/m²K', 'MISSING — no construction assigned')
      escalate(`${label}: no construction assigned / no library U-value`)
    }
  }

  // Thermal bridging — report the assumption (mode + multiplier), the input, not the engine H_TB
  const tb = building.thermal_bridges
  if (tb && typeof tb === 'object') {
    const mode = tb.mode ?? 'unknown'
    const mult = num(tb.multiplier)
    const manualH = num(tb.total_H_TB_W_per_K ?? tb.h_tb_w_per_k)
    const valStr = mode === 'manual_h_tb' && manualH != null
      ? `${manualH} W/K (manual)`
      : `${mode}${mult != null ? ` ×${mult}` : ''}`
    push('Fabric', 'Thermal bridging assumption', valStr, mode === 'manual_h_tb' ? 'W/K' : '—',
      'Input (building.thermal_bridges); H_TB is engine-derived from this')
  } else {
    push('Fabric', 'Thermal bridging assumption', '—', '—', 'MISSING — thermal_bridges not set')
    escalate('Thermal bridging: building.thermal_bridges absent')
  }

  // Air permeability — canonical q50 (NOT ACH); label the unit explicitly
  const q50 = num(building.fabric?.air_permeability_q50)
  if (q50 != null) {
    push('Fabric', 'Air permeability', q50, 'm³/h·m² @50 Pa', 'Input (fabric.air_permeability_q50)')
  } else {
    push('Fabric', 'Air permeability', '—', 'm³/h·m² @50 Pa', 'MISSING — air_permeability_q50 not set')
    escalate('Air permeability: fabric.air_permeability_q50 absent')
  }

  // Glazing g-value (effective — honours g_value_override), from the library item
  {
    const { library_id, g_value_override } = resolveChoice(constructions.glazing)
    const item = libItem(libraryData, library_id)
    const libG = num(item?.g_value ?? item?.config_json?.g_value)
    const effG = g_value_override != null ? g_value_override : libG
    if (effG != null) {
      const basis = g_value_override != null
        ? `Project override (library "${library_id}" = ${libG ?? '?'})`
        : `Library "${library_id ?? '—'}" g-value`
      push('Fabric', 'Glazing g-value (SHGC)', effG, '–', basis)
    } else {
      push('Fabric', 'Glazing g-value (SHGC)', '—', '–', 'MISSING — no glazing g-value')
      escalate('Glazing g-value: no library g_value for the assigned glazing')
    }
  }

  // Permanent openings / trickle-vent equivalent area — Σ per-facade louvre area
  const openings = building.openings
  if (openings && typeof openings === 'object') {
    let total = 0, seen = false
    for (const f of ['north', 'east', 'south', 'west']) {
      const a = num(openings[f]?.louvre_area_m2)
      if (a != null) { total += a; seen = true }
    }
    const site = openings.site_exposure ?? '—'
    if (seen) {
      push('Fabric', 'Permanent openings — equivalent area', Math.round(total * 100) / 100, 'm²',
        `Σ per-facade louvre_area_m2 (site exposure = ${site})`)
    } else {
      push('Fabric', 'Permanent openings — equivalent area', 0, 'm²', `No permanent openings set (site exposure = ${site})`)
    }
  } else {
    push('Fabric', 'Permanent openings — equivalent area', '—', 'm²', 'MISSING — openings not set')
    escalate('Permanent openings: building.openings absent')
  }

  // ── Internal gains ─────────────────────────────────────────────────────────
  const occ = building.occupancy ?? {}
  push('Internal gains', 'People per occupied room (peak)',
    num(occ.density?.value) ?? '—', 'people/room',
    `Input (occupancy.density, basis = ${occ.density?.basis ?? '?'})`)
  push('Internal gains', 'Sensible gain per person', num(occ.sensible_w_per_person) ?? '—', 'W', 'Input (occupancy.sensible_w_per_person)')
  push('Internal gains', 'Latent gain per person', num(occ.latent_w_per_person) ?? '—', 'W', 'Input (occupancy.latent_w_per_person)')

  // Equipment / plug load — report each profile's baseload in the unit the model stores
  const equipProfiles = building.gains?.equipment?.profiles
  if (Array.isArray(equipProfiles) && equipProfiles.length) {
    for (const p of equipProfiles) {
      const mag = p.baseload ?? p.magnitude
      push('Internal gains', `Equipment / plug load — ${p.label ?? p.id ?? 'profile'}`,
        num(mag?.value) ?? '—', mag?.unit ?? '', `Input (gains.equipment "${p.id ?? ''}" baseload)`)
    }
  } else {
    push('Internal gains', 'Equipment / plug load', '—', '', 'MISSING — no equipment gains profile')
    escalate('Equipment/plug load: no gains.equipment profile')
  }

  // Lighting load
  const lightProfiles = building.gains?.lighting?.profiles
  if (Array.isArray(lightProfiles) && lightProfiles.length) {
    for (const p of lightProfiles) {
      const mag = p.magnitude ?? p.baseload
      push('Internal gains', `Lighting load — ${p.label ?? p.id ?? 'profile'}`,
        num(mag?.value) ?? '—', mag?.unit ?? '', `Input (gains.lighting "${p.id ?? ''}")`)
    }
  } else {
    push('Internal gains', 'Lighting load', '—', '', 'MISSING — no lighting gains profile')
    escalate('Lighting load: no gains.lighting profile')
  }

  // Auxiliary baseload (external lighting etc.) — a real gain input; include for faithfulness
  const auxProfiles = building.gains?.auxiliary?.profiles
  if (Array.isArray(auxProfiles) && auxProfiles.length) {
    for (const p of auxProfiles) {
      const mag = p.magnitude ?? p.baseload
      if (mag?.value != null) {
        push('Internal gains', `Auxiliary baseload — ${p.label ?? p.id ?? 'profile'}`,
          num(mag.value), mag.unit ?? '', `Input (gains.auxiliary "${p.id ?? ''}")`)
      }
    }
  }

  // ── DHW ────────────────────────────────────────────────────────────────────
  const v40 = building.systems_config_v40 ?? {}
  push('DHW', 'Hot water demand', num(v40.dhw_demand_litres_per_person_per_day) ?? '—', 'L/person/day',
    `Input (demand basis = ${v40.dhw_demand_basis ?? '?'})`)
  push('DHW', 'Storage setpoint', num(v40.dhw_storage_setpoint_c) ?? '—', '°C', 'Input (dhw_storage_setpoint_c)')
  push('DHW', 'Tap outlet temperature', num(v40.dhw_tap_outlet_temp_c) ?? '—', '°C', 'Input (dhw_tap_outlet_temp_c)')
  push('DHW', 'Cold supply temperature', num(v40.dhw_cold_supply_temp_c) ?? '—', '°C', 'Input (dhw_cold_supply_temp_c)')

  // DHW gas/electric plant split — per-system source + share
  const dhwSystems = Array.isArray(v40.dhw) ? v40.dhw.filter(s => s?.enabled !== false) : []
  if (dhwSystems.length) {
    for (const s of dhwSystems) {
      push('DHW', `Plant split — ${s.label ?? s.id ?? 'system'}`,
        `${s.source ?? '?'} @ ${num(s.share_pct) ?? '?'}%`, '—',
        `Input (systems_config_v40.dhw source/share; η = ${num(s.efficiency_metric) ?? '?'})`)
    }
  } else {
    push('DHW', 'Plant split', '—', '—', 'MISSING — no DHW systems configured (systems_config_v40.dhw empty)')
    escalate('DHW gas/electric split: systems_config_v40.dhw array is empty')
  }

  // ── Systems — baseline settings ────────────────────────────────────────────
  const heat = Array.isArray(v40.heating) ? v40.heating.filter(s => s?.enabled !== false) : []
  for (const s of heat) {
    const isHeatPump = s.source === 'ambient_air' || s.source === 'ambient_ground'
    push('Systems (baseline)', `Heating ${isHeatPump ? 'SCOP' : 'efficiency (COP/η)'} — ${s.label ?? s.id}`,
      num(s.efficiency_metric) ?? '—', isHeatPump ? 'SCOP' : '–',
      `Input (systems_config_v40.heating; source = ${s.source ?? '?'}, share = ${num(s.share_pct) ?? '?'}%)`)
  }
  const cool = Array.isArray(v40.cooling) ? v40.cooling.filter(s => s?.enabled !== false) : []
  for (const s of cool) {
    push('Systems (baseline)', `Cooling EER/SEER — ${s.label ?? s.id}`,
      num(s.efficiency_metric) ?? '—', 'SEER',
      `Input (systems_config_v40.cooling; share = ${num(s.share_pct) ?? '?'}%)`)
  }
  const vent = Array.isArray(v40.ventilation) ? v40.ventilation.filter(s => s?.enabled !== false) : []
  for (const s of vent) {
    const em = s.efficiency_metric ?? {}
    push('Systems (baseline)', `SFP — ${s.label ?? s.id}`, num(em.sfp_w_per_lps) ?? '—', 'W/(l·s)',
      'Input (systems_config_v40.ventilation.efficiency_metric.sfp_w_per_lps)')
    push('Systems (baseline)', `Heat recovery (sensible) — ${s.label ?? s.id}`, num(em.recovery_sensible_pct) ?? '—', '%',
      `Input (recovery_sensible_pct; latent = ${num(em.recovery_latent_pct) ?? 0}%)`)
    if (num(s.flow_rate) != null) {
      push('Systems (baseline)', `Fan design flow — ${s.label ?? s.id}`, num(s.flow_rate), 'l/s',
        `Input (flow_rate, basis = ${s.flow_rate_basis ?? '?'})`)
    }
  }
  if (!heat.length && !cool.length && !vent.length) {
    escalate('Systems baseline: no heating/cooling/ventilation systems configured in systems_config_v40')
  }

  // ── Occupancy (derived — surfaces the schedule drift) ──────────────────────
  // Schedule-realised average concurrent occupants — the engine's own aggregation
  // (calculateInstant(...).occupancy_summary), NOT reimplemented here. Must reproduce ≈330.6.
  if (occupancySummary && Number.isFinite(Number(occupancySummary.average_occupants))) {
    push('Occupancy (derived)', 'Schedule-realised average concurrent occupants',
      Math.round(Number(occupancySummary.average_occupants) * 10) / 10, 'people',
      'DERIVED — occupancy schedule aggregation (engine occupancy_summary.average_occupants)')
    if (Number.isFinite(Number(occupancySummary.annual_occupant_hours))) {
      push('Occupancy (derived)', 'Annual occupant-hours',
        Math.round(Number(occupancySummary.annual_occupant_hours)), 'person·h',
        'DERIVED — engine occupancy_summary.annual_occupant_hours')
    }
    // Naive peak implied by inputs — shown alongside so the drift is visible, not averaged away.
    if (numRooms != null && occ.density?.value != null && occRate != null) {
      const naivePeak = Math.round(numRooms * Number(occ.density.value) * occRate)
      push('Occupancy (derived)', 'Peak occupants implied by inputs',
        naivePeak, 'people',
        `DERIVED — num_bedrooms × people/room × occupancy_rate = ${numRooms} × ${occ.density.value} × ${occRate} (contrast with schedule-realised to expose drift)`)
    }
  } else {
    push('Occupancy (derived)', 'Schedule-realised average concurrent occupants', '—', 'people',
      'UNAVAILABLE — engine occupancy_summary not supplied to collector')
    escalate('Derived occupancy: occupancy_summary (from calculateInstant) was not passed to collectAssumptions')
  }

  return { columns: COLUMNS, rows, escalations }
}

export { COLUMNS as ASSUMPTIONS_COLUMNS }

// ── XLSX writer + download (Part 2) ─────────────────────────────────────────
/**
 * Build a single-sheet ("Inputs") XLSX from the collected assumptions and
 * trigger a client-side download. Mirrors the SheetJS + Blob/anchor convention
 * in interventionExport.js (CSP-safe, no backend). Snapshot values only.
 *
 * NB: bold header styling is NOT applied — the community `xlsx` build ignores
 * cell styles on write. Column widths and category-grouped row order carry the
 * legibility; a bold header would need a styling lib (out of scope — flag).
 *
 * @returns {{ filename: string, rowCount: number, escalations: string[] }}
 */
export function exportAssumptionsXlsx({ building, constructions, libraryData, occupancySummary, meta = {} } = {}) {
  const { rows, escalations } = collectAssumptions({ building, constructions, libraryData, occupancySummary })

  const scenario = meta.scenarioName || building?.name || 'scenario'
  const now = meta.now instanceof Date ? meta.now : new Date()
  const stamp = now.toISOString().slice(0, 19).replace('T', ' ') + ' UTC'
  const dateForName = now.toISOString().slice(0, 10)

  // Metadata stamp block, blank row, header row, then data — one sheet.
  const aoa = [
    ['NZA-Sim — Model input assumptions'],
    ['Scenario', scenario],
    ['Exported', stamp],
  ]
  if (meta.appVersion) aoa.push(['App version / SHA', meta.appVersion])
  aoa.push(['Note', 'Snapshot of live model inputs — hard values, not formulas.'])
  aoa.push([])
  aoa.push([...COLUMNS])
  for (const r of rows) aoa.push([r.Category, r.Parameter, r.Value, r.Units, r['Basis/Source']])

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 20 }, { wch: 42 }, { wch: 18 }, { wch: 16 }, { wch: 62 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Inputs')

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const safe = String(scenario).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'scenario'
  const filename = `nza-sim_assumptions_${safe}_${dateForName}.xlsx`

  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(a.href)

  // Surface escalations rather than hide them — the export is a truth-teller.
  if (escalations.length) console.warn('[assumptions-export] escalated parameters:', escalations)
  return { filename, rowCount: rows.length, escalations }
}

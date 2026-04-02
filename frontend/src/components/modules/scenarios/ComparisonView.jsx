/**
 * ComparisonView.jsx
 *
 * Side-by-side comparison of all scenarios with simulation results.
 *
 * Sections:
 * 1. Input differences table — parameters that differ across scenarios
 * 2. Grouped bar chart — EUI, Heating, Cooling, Lighting per scenario
 * 3. EUI ranking horizontal bars with % change from baseline
 * 4. Delta summary DataCards per non-baseline scenario
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  Cell, ReferenceLine, ResponsiveContainer
} from 'recharts'
import { TrendingDown } from 'lucide-react'
import ChartContainer from '../../ui/ChartContainer.jsx'
import DataCard from '../../ui/DataCard.jsx'
import { SCENARIO_COLORS } from '../../../data/chartTokens.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiFetch(url) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function paramLabel(param) {
  return param.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function categoryLabel(cat) {
  if (cat === 'construction') return 'Fabric'
  if (cat === 'systems')      return 'Systems'
  return cat
}

function pctChange(from, to) {
  if (from == null || from === 0) return null
  return ((to - from) / from) * 100
}

// ── Input differences table ───────────────────────────────────────────────────

function DifferencesTable({ scenarios }) {
  // Collect all parameters that differ across any scenario vs the baseline
  const baseline = scenarios.find(s => s.is_baseline)
  if (!baseline) return null

  // Gather all differing params from all non-baseline scenarios
  const paramSet = new Set()
  const diffMap = {} // { paramKey: { [scenarioId]: change } }

  for (const s of scenarios) {
    for (const change of (s.changes_from_baseline ?? [])) {
      const key = `${change.category}::${change.parameter}`
      paramSet.add(key)
      if (!diffMap[key]) {
        diffMap[key] = {
          category:       change.category,
          parameter:      change.parameter,
          baselineDisplay: change.baseline_display,
          scenarios:      {},
        }
      }
      diffMap[key].scenarios[s.id] = {
        value:   change.scenario_value,
        display: change.scenario_display,
      }
    }
  }

  const params = Array.from(paramSet).map(k => diffMap[k])
  if (params.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-light-grey p-4">
        <p className="text-caption font-semibold text-navy mb-2">Input Differences</p>
        <p className="text-xxs text-mid-grey">All scenarios have identical inputs — no differences to display.</p>
      </div>
    )
  }

  const nonBaseline = scenarios.filter(s => !s.is_baseline)

  return (
    <div className="bg-white rounded-xl border border-light-grey overflow-hidden">
      <div className="px-4 py-3 border-b border-light-grey">
        <p className="text-caption font-semibold text-navy">Input Differences</p>
        <p className="text-xxs text-mid-grey mt-0.5">Parameters that differ from baseline across any scenario</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xxs">
          <thead>
            <tr className="border-b border-light-grey bg-off-white">
              <th className="text-left px-4 py-2 text-mid-grey font-medium uppercase tracking-wider w-20">Category</th>
              <th className="text-left px-4 py-2 text-mid-grey font-medium uppercase tracking-wider w-32">Parameter</th>
              <th className="text-left px-4 py-2 text-navy font-medium">Baseline</th>
              {nonBaseline.map((s, i) => (
                <th key={s.id} className="text-left px-4 py-2 font-medium" style={{ color: SCENARIO_COLORS[i + 1] }}>
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {params.map((p, idx) => (
              <tr key={idx} className="border-b border-light-grey last:border-0 hover:bg-off-white/50">
                <td className="px-4 py-2 text-mid-grey">{categoryLabel(p.category)}</td>
                <td className="px-4 py-2 font-medium text-dark-grey">{paramLabel(p.parameter)}</td>
                <td className="px-4 py-2 text-dark-grey">{p.baselineDisplay}</td>
                {nonBaseline.map((s, i) => {
                  const cell = p.scenarios[s.id]
                  return (
                    <td key={s.id} className="px-4 py-2">
                      {cell ? (
                        <span
                          className="font-semibold"
                          style={{ color: SCENARIO_COLORS[i + 1] }}
                        >
                          ✦ {cell.display}
                        </span>
                      ) : (
                        <span className="text-mid-grey">—</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Grouped bar chart ─────────────────────────────────────────────────────────

function GroupedMetricsChart({ scenarios, results }) {
  const metrics = ['EUI (kWh/m²)', 'Heating (MWh)', 'Cooling (MWh)']

  // Build data: one row per metric, one bar per scenario
  const data = metrics.map(metric => {
    const row = { metric }
    for (const s of scenarios) {
      const r = results[s.id]
      if (!r) continue
      const sum = r.results_summary ?? {}
      const ae  = r.annual_energy ?? {}
      if (metric === 'EUI (kWh/m²)')    row[s.name] = sum.eui_kWh_per_m2 != null ? Number(sum.eui_kWh_per_m2.toFixed(1)) : null
      if (metric === 'Heating (MWh)')   row[s.name] = ae.heating_kWh != null ? Math.round(ae.heating_kWh / 1000) : null
      if (metric === 'Cooling (MWh)')   row[s.name] = ae.cooling_kWh != null ? Math.round(ae.cooling_kWh / 1000) : null
    }
    return row
  })

  return (
    <ChartContainer title="Metric comparison — all scenarios" height={240}>
      <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
        <XAxis dataKey="metric" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        {scenarios.map((s, i) => (
          <Bar key={s.id} dataKey={s.name} fill={SCENARIO_COLORS[i]} radius={[2, 2, 0, 0]} />
        ))}
      </BarChart>
    </ChartContainer>
  )
}

// ── EUI ranking horizontal bars ───────────────────────────────────────────────

function EuiRankingChart({ scenarios, results }) {
  const withResults = scenarios
    .map(s => {
      const r = results[s.id]
      const eui = r?.results_summary?.eui_kWh_per_m2
      return { ...s, eui: eui != null ? Number(eui) : null }
    })
    .filter(s => s.eui != null)
    .sort((a, b) => a.eui - b.eui)

  if (withResults.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-light-grey p-4 text-center">
        <p className="text-xxs text-mid-grey">No results yet — run simulations to see the EUI ranking.</p>
      </div>
    )
  }

  const baseline = scenarios.find(s => s.is_baseline)
  const baselineEui = baseline && results[baseline.id]?.results_summary?.eui_kWh_per_m2
  const maxEui = Math.max(...withResults.map(s => s.eui))

  return (
    <div className="bg-white rounded-xl border border-light-grey overflow-hidden">
      <div className="px-4 py-3 border-b border-light-grey">
        <p className="text-caption font-semibold text-navy">EUI Ranking</p>
        <p className="text-xxs text-mid-grey mt-0.5">Lower is better — sorted by energy use intensity</p>
      </div>
      <div className="p-4 space-y-3">
        {withResults.map((s, i) => {
          const pct = pctChange(baselineEui, s.eui)
          const barWidth = (s.eui / maxEui) * 100
          const scenIdx = scenarios.findIndex(x => x.id === s.id)
          const color = SCENARIO_COLORS[scenIdx] ?? SCENARIO_COLORS[0]
          return (
            <div key={s.id} className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xxs font-medium text-dark-grey">{i + 1}.</span>
                  <span className="text-xxs font-semibold" style={{ color }}>{s.name}</span>
                  {s.is_baseline && (
                    <span className="text-xxs text-mid-grey">(Baseline)</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {pct != null && !s.is_baseline && (
                    <span className={`text-xxs font-medium ${pct < 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {pct > 0 ? '+' : ''}{pct.toFixed(1)}%
                    </span>
                  )}
                  <span className="text-xxs font-bold text-navy">
                    {s.eui.toFixed(1)} kWh/m²
                  </span>
                </div>
              </div>
              <div className="w-full bg-off-white rounded-full h-4 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${barWidth}%`, backgroundColor: color }}
                />
              </div>
            </div>
          )
        })}
        {/* Baseline reference */}
        {baselineEui != null && (
          <p className="text-xxs text-mid-grey text-right mt-1">
            Baseline: {Number(baselineEui).toFixed(1)} kWh/m²
          </p>
        )}
      </div>
    </div>
  )
}

// ── Delta DataCards ───────────────────────────────────────────────────────────

function DeltaCards({ scenarios, results }) {
  const baseline = scenarios.find(s => s.is_baseline)
  const baselineResult = baseline && results[baseline.id]
  const nonBaseline = scenarios.filter(s => !s.is_baseline && results[s.id])

  if (!baselineResult || nonBaseline.length === 0) return null

  const bEui   = baselineResult.results_summary?.eui_kWh_per_m2
  const bTotal = baselineResult.results_summary?.total_energy_kWh

  return (
    <div className="space-y-4">
      {nonBaseline.map((s, i) => {
        const r = results[s.id]
        const sEui   = r.results_summary?.eui_kWh_per_m2
        const sTotal = r.results_summary?.total_energy_kWh

        const euiDelta   = bEui   != null && sEui   != null ? sEui - bEui : null
        const totalDelta = bTotal != null && sTotal != null ? sTotal - bTotal : null
        const euiPct     = pctChange(bEui, sEui)

        const better = totalDelta != null && totalDelta < 0
        const verdict = totalDelta == null ? null : totalDelta < -1000 ? 'Better' : totalDelta > 1000 ? 'Worse' : 'Similar'
        const verdictColor = verdict === 'Better' ? '#16A34A' : verdict === 'Worse' ? '#DC2626' : '#F59E0B'

        return (
          <div key={s.id} className="bg-white rounded-xl border border-light-grey p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: SCENARIO_COLORS[i + 1] }} />
              <p className="text-caption font-semibold text-navy">{s.name} vs Baseline</p>
              {verdict && (
                <span
                  className="px-2 py-0.5 rounded-full text-xxs font-semibold text-white"
                  style={{ backgroundColor: verdictColor }}
                >
                  {verdict}
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <DataCard
                label="EUI Change"
                value={euiDelta != null ? `${euiDelta > 0 ? '+' : ''}${euiDelta.toFixed(1)}` : null}
                unit="kWh/m²"
                accent={euiDelta != null && euiDelta < 0 ? 'green' : 'red'}
              />
              <DataCard
                label="EUI % Change"
                value={euiPct != null ? `${euiPct > 0 ? '+' : ''}${euiPct.toFixed(1)}` : null}
                unit="%"
                accent={euiPct != null && euiPct < 0 ? 'green' : 'red'}
              />
              <DataCard
                label="Energy Change"
                value={totalDelta != null ? `${totalDelta > 0 ? '+' : ''}${Math.round(totalDelta / 1000)}` : null}
                unit="MWh/yr"
                accent={totalDelta != null && totalDelta < 0 ? 'green' : 'red'}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── ComparisonView ────────────────────────────────────────────────────────────

export default function ComparisonView({ scenarios, projectId }) {
  const [results, setResults]   = useState({}) // { [scenarioId]: simRunData }
  const [loading, setLoading]   = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    async function loadResults() {
      setLoading(true)
      const map = {}
      for (const s of scenarios) {
        if (!s.latest_run_id) continue
        try {
          const data = await apiFetch(`/api/projects/${projectId}/simulations/${s.latest_run_id}`)
          map[s.id] = data
        } catch {}
      }
      setResults(map)
      setLoading(false)
    }
    loadResults()
  }, [scenarios, projectId])

  const hasAnyResults = Object.keys(results).length > 0

  if (loading) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        {[1,2,3].map(i => <div key={i} className="h-40 bg-light-grey rounded-xl" />)}
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-heading font-semibold text-navy">Scenario Comparison</h1>
          <p className="text-caption text-mid-grey mt-0.5">
            {scenarios.length} scenario{scenarios.length !== 1 ? 's' : ''} ·{' '}
            {Object.keys(results).length} with results
          </p>
        </div>
        {hasAnyResults && (
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-light-grey text-xxs font-medium text-dark-grey hover:border-navy hover:text-navy transition-colors"
            onClick={() => navigate('/results')}
          >
            <TrendingDown size={11} />
            CRREM & Carbon →
          </button>
        )}
      </div>

      {/* Input differences */}
      <DifferencesTable scenarios={scenarios} />

      {/* Charts — only if results exist */}
      {hasAnyResults && (
        <>
          <GroupedMetricsChart scenarios={scenarios} results={results} />
          <EuiRankingChart scenarios={scenarios} results={results} />
          <DeltaCards scenarios={scenarios} results={results} />
        </>
      )}

      {!hasAnyResults && (
        <div className="bg-white rounded-xl border border-light-grey p-8 text-center">
          <p className="text-caption font-medium text-dark-grey">No simulation results yet</p>
          <p className="text-xxs text-mid-grey mt-1">Run simulations for one or more scenarios to see the comparison.</p>
        </div>
      )}
    </div>
  )
}

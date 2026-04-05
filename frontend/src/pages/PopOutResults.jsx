/**
 * PopOutResults.jsx
 *
 * A standalone full-screen pop-out results dashboard.
 * Opens via window.open('/popout', ...) from the TopBar.
 *
 * - No sidebar or top bar — clean full-screen dashboard
 * - Subscribes to BroadcastChannel for live state from the main window
 * - Runs its own instantCalc from the received state
 * - 2×2 grid of configurable panels
 * - Panel layout persists in localStorage
 *
 * Panel types:
 *   systems-sankey  — d3-sankey systems energy flow
 *   fabric-sankey   — d3-sankey fabric thermal balance (reuses FabricSankey)
 *   monthly         — monthly heating / cooling bar chart
 *   crrem           — CRREM decarbonisation trajectory
 *   eui-gauge       — large EUI horizontal gauge
 *   performance-gap — text summary cards
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { sankey, sankeyLeft, sankeyLinkHorizontal } from 'd3-sankey'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ComposedChart, Line, ReferenceLine, Legend,
} from 'recharts'
import { Settings } from 'lucide-react'
import { subscribeToState, requestInitialState } from '../utils/broadcastChannel.js'
import { calculateInstant } from '../utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../utils/solarCalc.js'
import FabricSankey from '../components/modules/building/FabricSankey.jsx'

// ── Panel registry ─────────────────────────────────────────────────────────────

const PANEL_OPTIONS = [
  { id: 'systems-sankey',   label: 'Systems Energy Flow' },
  { id: 'fabric-sankey',    label: 'Fabric Energy Flow' },
  { id: 'monthly',          label: 'Monthly Heating & Cooling' },
  { id: 'crrem',            label: 'CRREM Trajectory' },
  { id: 'eui-gauge',        label: 'EUI Gauge' },
  { id: 'performance-gap',  label: 'Performance Gap' },
]

const DEFAULT_LAYOUT = ['systems-sankey', 'fabric-sankey', 'monthly', 'crrem']

function loadLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem('nza-popout-layout'))
    if (Array.isArray(saved) && saved.length === 4) return saved
  } catch {}
  return DEFAULT_LAYOUT
}

function saveLayout(layout) {
  localStorage.setItem('nza-popout-layout', JSON.stringify(layout))
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtMWh(kWh) {
  if (!kWh || kWh < 0) return '0 kWh'
  if (kWh >= 1000) return `${(kWh / 1000).toFixed(1)} MWh`
  return `${Math.round(kWh)} kWh`
}

function interpolateCRREM(data, year) {
  if (!data?.length) return null
  const sorted = [...data].sort((a, b) => a.year - b.year)
  const before = sorted.filter(d => d.year <= year)
  const after  = sorted.filter(d => d.year >= year)
  if (!before.length) return after[0]?.eui ?? null
  if (!after.length)  return before[before.length - 1]?.eui ?? null
  const a = before[before.length - 1], b = after[0]
  if (a.year === b.year) return a.eui
  const t = (year - a.year) / (b.year - a.year)
  return a.eui + t * (b.eui - a.eui)
}

// ── Panel: placeholder ─────────────────────────────────────────────────────────

function PanelPlaceholder({ label }) {
  return (
    <div className="w-full h-full flex items-center justify-center text-mid-grey text-xs">
      {label}
    </div>
  )
}

// ── Panel: Systems Sankey ──────────────────────────────────────────────────────

const LINK_COLORS = {
  electricity: '#ECB01F',
  gas:         '#E74C3C',
  heating:     '#DC2626',
  cooling:     '#3B82F6',
  dhw:         '#F97316',
  air:         '#06B6D4',
  waste:       '#D4D4D4',
  recovered:   '#16A34A',
  default:     '#CCCCCC',
}

function buildSankeyGraph(systemsFlow) {
  const { nodes, links } = systemsFlow ?? {}
  if (!nodes?.length || !links?.length) return null
  const nodeIds = new Set(nodes.map(n => n.id))
  const sNodes = nodes.map(n => ({ ...n }))
  const sLinks = links
    .filter(l => l.value_kWh > 0 && nodeIds.has(l.source) && nodeIds.has(l.target))
    .map(l => ({ source: l.source, target: l.target, value: l.value_kWh, style: l.style }))
  if (!sLinks.length) return null
  return { nodes: sNodes, links: sLinks }
}

function SystemsSankeyPanel({ instantResult }) {
  const containerRef = useRef(null)
  const [dims, setDims] = useState({ width: 500, height: 340 })
  const [tooltip, setTooltip] = useState(null)

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setDims({ width: Math.floor(width), height: Math.floor(height) })
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  const graph = useMemo(() => {
    if (!instantResult?.systems_flow) return null
    const raw = buildSankeyGraph(instantResult.systems_flow)
    if (!raw) return null
    try {
      const layout = sankey()
        .nodeId(n => n.id)
        .nodeWidth(16)
        .nodePadding(10)
        .extent([[24, 16], [dims.width - 60, dims.height - 16]])
        .nodeAlign(sankeyLeft)
      return layout({
        nodes: raw.nodes.map(n => ({ ...n })),
        links: raw.links.map(l => ({ ...l })),
      })
    } catch { return null }
  }, [instantResult?.systems_flow, dims])

  const linkPath = sankeyLinkHorizontal()

  if (!instantResult) return <PanelPlaceholder label="Waiting for data…" />
  if (!graph) return <PanelPlaceholder label="No systems data" />

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden">
      <svg width={dims.width} height={dims.height}>
        {graph.links.map((link, i) => {
          const color = LINK_COLORS[link.style] ?? LINK_COLORS.default
          const isDashed = link.style === 'recovered' || link.style === 'waste'
          return (
            <path
              key={i}
              d={linkPath(link)}
              fill="none"
              stroke={color}
              strokeWidth={Math.max(1, link.width ?? 1)}
              strokeOpacity={0.5}
              strokeDasharray={isDashed ? '6,3' : undefined}
            />
          )
        })}
        {graph.nodes.map((node, i) => {
          const nodeH = Math.max(4, (node.y1 ?? 0) - (node.y0 ?? 0))
          const midY  = ((node.y0 ?? 0) + (node.y1 ?? 0)) / 2
          return (
            <g
              key={i}
              onMouseEnter={e => setTooltip({ x: e.clientX, y: e.clientY, label: node.label ?? node.id, value: node.value })}
              onMouseLeave={() => setTooltip(null)}
            >
              <rect
                x={node.x0} y={node.y0}
                width={(node.x1 ?? 0) - (node.x0 ?? 0)}
                height={nodeH}
                fill="#00AEEF"
                fillOpacity={0.7}
                rx={2}
              />
              <text
                x={(node.x1 ?? 0) + 5}
                y={midY}
                dy="0.35em"
                fontSize={9}
                fill="#1E3A5F"
              >
                {node.label ?? node.id}
              </text>
            </g>
          )
        })}
      </svg>
      {tooltip && (
        <div
          className="fixed z-50 bg-navy text-white text-xxs px-2 py-1 rounded pointer-events-none"
          style={{ left: tooltip.x + 10, top: tooltip.y - 20 }}
        >
          {tooltip.label}: {fmtMWh(tooltip.value ?? 0)}
        </div>
      )}
    </div>
  )
}

// ── Panel: Monthly heating & cooling ──────────────────────────────────────────

function MonthlyPanel({ instantResult }) {
  if (!instantResult?.monthly) return <PanelPlaceholder label="No monthly data" />

  const data = MONTH_ABBR.map((m, i) => ({
    month: m,
    heating: Math.round((instantResult.monthly.heating_kWh?.[i] ?? 0) / 1000),
    cooling: Math.round((instantResult.monthly.cooling_kWh?.[i] ?? 0) / 1000),
  }))

  return (
    <div className="w-full h-full flex flex-col gap-1">
      <div className="flex gap-4 text-xxs text-mid-grey flex-shrink-0">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-2 rounded-sm bg-red-500" />
          Heating (MWh)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-2 rounded-sm bg-blue-500" />
          Cooling (MWh)
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
            <XAxis dataKey="month" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 9 }} />
            <Tooltip
              contentStyle={{ fontSize: 10, padding: '4px 8px' }}
              formatter={(v, n) => [`${v} MWh`, n === 'heating' ? 'Heating' : 'Cooling']}
            />
            <Bar dataKey="heating" fill="#DC2626" radius={[2, 2, 0, 0]} maxBarSize={18} />
            <Bar dataKey="cooling" fill="#3B82F6" radius={[2, 2, 0, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── Panel: CRREM trajectory ────────────────────────────────────────────────────

function CRREMPanel({ instantResult, crremData }) {
  const currentYear = new Date().getFullYear()
  const modelledEUI = instantResult?.eui_kWh_m2 ?? null

  if (!crremData?.length) return <PanelPlaceholder label="Loading CRREM data…" />

  const pathway = crremData
    .filter(d => d.year >= 2020 && d.year <= 2050)
    .map(d => ({ year: String(d.year), target: Math.round(d.eui) }))

  return (
    <div className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={pathway} margin={{ top: 8, right: 40, left: -10, bottom: 0 }}>
          <XAxis
            dataKey="year"
            tick={{ fontSize: 9 }}
            interval={4}
          />
          <YAxis tick={{ fontSize: 9 }} unit=" kWh" />
          <Tooltip
            contentStyle={{ fontSize: 10, padding: '4px 8px' }}
            formatter={(v, n) => [`${v} kWh/m²`, n]}
          />
          <Line
            type="monotone"
            dataKey="target"
            stroke="#1E3A5F"
            strokeDasharray="5 3"
            dot={false}
            strokeWidth={1.5}
            name="CRREM target"
          />
          {modelledEUI != null && (
            <ReferenceLine
              y={Math.round(modelledEUI)}
              stroke="#00AEEF"
              strokeWidth={2}
              label={{
                value: `${Math.round(modelledEUI)} kWh/m²`,
                fontSize: 9,
                fill: '#00AEEF',
                position: 'right',
              }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Panel: EUI gauge ───────────────────────────────────────────────────────────

function EUIGaugePanel({ instantResult }) {
  const eui = instantResult?.eui_kWh_m2 ?? null
  const pct = eui != null ? Math.min(100, (eui / 400) * 100) : 0
  const color = eui == null ? '#9CA3AF' : eui > 250 ? '#DC2626' : eui > 120 ? '#F59E0B' : '#16A34A'
  const label = eui == null ? '—' : eui > 250 ? 'High' : eui > 120 ? 'Moderate' : 'Low'

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-4 p-4">
      <div className="text-center">
        <div className="text-5xl font-bold tabular-nums" style={{ color }}>
          {eui != null ? Math.round(eui) : '—'}
        </div>
        <div className="text-xs text-mid-grey mt-1">kWh/m²/yr — Modelled EUI</div>
        <div className="text-sm font-medium mt-1" style={{ color }}>{label}</div>
      </div>
      <div className="w-full max-w-xs">
        <div className="h-3 bg-light-grey rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: color }}
          />
        </div>
        <div className="flex justify-between text-xxs text-mid-grey mt-1">
          <span>0</span>
          <span>100</span>
          <span>200</span>
          <span>300</span>
          <span>400+</span>
        </div>
      </div>
    </div>
  )
}

// ── Panel: Performance gap ─────────────────────────────────────────────────────

function PerformanceGapPanel({ instantResult, crremTarget }) {
  const modelled = instantResult?.eui_kWh_m2 ?? null
  const target   = crremTarget

  const gap = modelled != null && target != null ? modelled - target : null
  const pct = gap != null && target != null ? Math.round((gap / target) * 100) : null
  const gapColor = gap == null ? '#6B7280' : gap > 100 ? '#DC2626' : gap > 0 ? '#F59E0B' : '#16A34A'
  const status = gap == null ? '—' : gap > 100 ? 'Non-compliant' : gap > 0 ? 'At risk' : 'Compliant'
  const statusColor = gap == null ? '#6B7280' : gap > 100 ? '#DC2626' : gap > 0 ? '#F59E0B' : '#16A34A'

  const rows = [
    { label: 'Modelled EUI', value: modelled != null ? `${Math.round(modelled)} kWh/m²` : '—', color: '#1E3A5F' },
    { label: 'CRREM Target', value: target != null ? `${Math.round(target)} kWh/m²` : '—', color: '#16A34A' },
    { label: 'Performance Gap', value: gap != null ? `${gap > 0 ? '+' : ''}${Math.round(gap)} kWh/m² (${pct}%)` : '—', color: gapColor },
    { label: 'Status', value: status, color: statusColor },
  ]

  return (
    <div className="w-full h-full flex flex-col justify-center p-4 gap-3">
      {rows.map(row => (
        <div key={row.label} className="flex items-center justify-between py-2 border-b border-light-grey">
          <span className="text-xs text-dark-grey">{row.label}</span>
          <span className="text-sm font-semibold" style={{ color: row.color }}>{row.value}</span>
        </div>
      ))}
    </div>
  )
}

// ── Panel wrapper ──────────────────────────────────────────────────────────────

function Panel({ panelId, state, instantResult, crremData, crremTarget, onSwap }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const orientationDeg = Number(state?.building?.orientation ?? 0)

  function renderContent() {
    switch (panelId) {
      case 'systems-sankey':
        return <SystemsSankeyPanel instantResult={instantResult} />
      case 'fabric-sankey':
        return <FabricSankey result={instantResult} orientation={orientationDeg} />
      case 'monthly':
        return <MonthlyPanel instantResult={instantResult} />
      case 'crrem':
        return <CRREMPanel instantResult={instantResult} crremData={crremData} />
      case 'eui-gauge':
        return <EUIGaugePanel instantResult={instantResult} />
      case 'performance-gap':
        return <PerformanceGapPanel instantResult={instantResult} crremTarget={crremTarget} />
      default:
        return <PanelPlaceholder label={`Unknown panel: ${panelId}`} />
    }
  }

  const panelLabel = PANEL_OPTIONS.find(p => p.id === panelId)?.label ?? panelId

  return (
    <div className="flex flex-col bg-white rounded-lg border border-light-grey overflow-hidden min-h-0">
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-light-grey bg-panel text-xs text-dark-grey font-medium flex-shrink-0">
        <span>{panelLabel}</span>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(v => !v)}
            className="p-0.5 hover:text-navy transition-colors"
            title="Change panel type"
          >
            <Settings size={12} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-light-grey rounded shadow-lg z-20 min-w-[190px]">
              {PANEL_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => { onSwap(opt.id); setMenuOpen(false) }}
                  className={`
                    w-full text-left px-3 py-1.5 text-xs hover:bg-teal/10 hover:text-teal transition-colors
                    ${opt.id === panelId ? 'text-teal font-medium bg-teal/5' : 'text-dark-grey'}
                  `}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Panel content */}
      <div className="flex-1 p-2 min-h-0 overflow-hidden">
        {renderContent()}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function PopOutResults() {
  const [state, setState]           = useState(null)
  const [isConnected, setIsConnected] = useState(false)
  const [layout, setLayout]         = useState(loadLayout)
  const [crremData, setCrremData]   = useState([])
  const [weatherData, setWeatherData] = useState(null)
  const staleTimerRef = useRef(null)
  const prevWeatherFile = useRef(null)

  // ── Subscribe to BroadcastChannel ────────────────────────────────────────────
  useEffect(() => {
    const unsub = subscribeToState((payload) => {
      setState(payload)
      setIsConnected(true)
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current)
      staleTimerRef.current = setTimeout(() => setIsConnected(false), 8000)
    })

    // Ask main window for an immediate state dump
    requestInitialState()

    return () => {
      unsub()
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current)
    }
  }, [])

  // ── Fetch CRREM benchmark data ────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/library/benchmarks')
      .then(r => r.json())
      .then(data => {
        const hotel = Array.isArray(data) ? data.find(b => b.id === 'crrem_hotel_uk_15') : null
        const targets = hotel?.config_json?.eui_targets
        if (targets) {
          const sorted = Object.entries(targets)
            .map(([y, eui]) => ({ year: Number(y), eui: Number(eui) }))
            .sort((a, b) => a.year - b.year)
          setCrremData(sorted)
        }
      })
      .catch(() => {})
  }, [])

  // ── Fetch weather data when building changes weather file ─────────────────────
  useEffect(() => {
    const weatherFile = state?.building?.weather_file ?? 'default'
    if (weatherFile === prevWeatherFile.current) return
    prevWeatherFile.current = weatherFile

    fetch(`/api/weather/${encodeURIComponent(weatherFile)}/hourly`)
      .then(r => r.ok ? r.json() : null)
      .then(data => setWeatherData(data))
      .catch(() => setWeatherData(null))
  }, [state?.building?.weather_file])

  // ── Compute hourly solar (when orientation or weather changes) ────────────────
  const hourlySolar = useMemo(() => {
    if (!weatherData) return null
    const lat = state?.building?.location?.latitude ?? 51.5
    const orientDeg = Number(state?.building?.orientation ?? 0)
    try {
      return computeHourlySolarByFacade(weatherData, lat, orientDeg)
    } catch { return null }
  }, [weatherData, state?.building?.location?.latitude, state?.building?.orientation])

  // ── Run instant calc ──────────────────────────────────────────────────────────
  const instantResult = useMemo(() => {
    if (!state?.building) return null
    try {
      return calculateInstant(
        state.building,
        state.constructions ?? {},
        state.systems ?? {},
        state.libraryData ?? {},
        weatherData,
        hourlySolar,
        state.schedules ?? null,
      )
    } catch (e) {
      console.warn('[PopOut] instantCalc failed:', e)
      return null
    }
  }, [state, weatherData, hourlySolar])

  // ── CRREM target for current year ─────────────────────────────────────────────
  const currentYear = new Date().getFullYear()
  const crremTarget = useMemo(() => interpolateCRREM(crremData, currentYear), [crremData, currentYear])

  // ── Panel layout management ───────────────────────────────────────────────────
  function handleSwap(slotIdx, newPanelId) {
    setLayout(prev => {
      const next = [...prev]
      next[slotIdx] = newPanelId
      saveLayout(next)
      return next
    })
  }

  const projectName = state?.building?.name ?? '—'

  return (
    <div className="h-screen flex flex-col bg-panel font-sans overflow-hidden">
      {/* Thin header */}
      <header className="flex items-center justify-between px-4 py-2 bg-navy text-white text-xs flex-shrink-0">
        <span className="font-semibold tracking-wide">NZA Simulate — Live Results</span>
        <span className="text-white/60 truncate max-w-xs">{projectName}</span>
        <span className="flex items-center gap-1.5 flex-shrink-0">
          <span className={`w-2 h-2 rounded-full transition-colors ${isConnected ? 'bg-green-400' : 'bg-white/25'}`} />
          <span className="text-white/80">{isConnected ? 'Connected' : 'Waiting…'}</span>
        </span>
      </header>

      {/* 2×2 panel grid */}
      <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-2 p-2 min-h-0">
        {layout.map((panelId, idx) => (
          <Panel
            key={idx}
            panelId={panelId}
            state={state}
            instantResult={instantResult}
            crremData={crremData}
            crremTarget={crremTarget}
            onSwap={(newId) => handleSwap(idx, newId)}
          />
        ))}
      </div>
    </div>
  )
}

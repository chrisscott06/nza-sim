/**
 * LoadShapeView.jsx — Internal Gains module "Conditions" tab.
 *
 * Brief 28a Part 3c (2026-05-14): interim consolidation with sub-view
 *                                  toggle (Temperature / Hourly / Breakdown).
 * Brief 28a Part 3d (2026-05-14): user-facing tab label "Load shape" →
 *                                  "Conditions".
 * Brief 28a Part 5 (2026-05-14): rewritten to use the Pablo composition
 *                                pattern (ZoomNav + chart + DataCards
 *                                stacked right + MonthJumpButtons), with
 *                                a lens selector for Temperature vs Gain
 *                                profile. Layout discipline inherited
 *                                from /chart-test per ui_principles.md
 *                                §6 (density) + chart-paired-with-stat-
 *                                panel pattern.
 * Brief 28a Part 5 walkthrough Finding 2 (2026-05-14): share rows in the
 *                                Gain profile lens are clickable toggles.
 *                                Click People / Lighting / Equipment to
 *                                isolate or hide that gain. Peak + Mean
 *                                update with the visible subset; shares
 *                                hold full-window so % readings stay
 *                                interpretable. Persisted to localStorage
 *                                so toggle state survives reloads. Guard
 *                                refuses to disable the last enabled gain
 *                                (empty chart is more confusing than
 *                                helpful).
 *
 * Lens decision (Chris's UX question):
 *   Option (a) chosen — lens selector toggle inside the Conditions card,
 *   above the chart. Rejected:
 *     (b) all-stacked: three full-height charts violate bounded-chart-
 *         height principle and would page-scroll.
 *     (c) multi-select overlay: temperature is °C, gain is kW, breakdown
 *         is kWh by category — incompatible y-axes; dual-y-axis charts
 *         violate readability.
 *
 * Lenses (TWO, not three):
 *   - Temperature — hourly free-running zone T (State 1 grey + State 2
 *                   orange overlay; comfort band reference lines)
 *   - Gain profile — hourly internal gain breakdown (People + Lighting
 *                   + Equipment stacked area, kW)
 *
 *   Annual breakdown lens DROPPED from Conditions tab — it's not a time-
 *   varying signal (so doesn't fit the ZoomNav/MonthJump pattern); the
 *   per-gain attribution it provided already lives in the Summary tab's
 *   "What gains contribute" section. Filed as a walkthrough flag in case
 *   Chris disagrees: revisit in Part 7 close-out review.
 */

import { useState, useMemo, useContext, useEffect } from 'react'
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, Legend,
} from 'recharts'
import { Thermometer, Activity } from 'lucide-react'
import { useStateComparison } from './useStateComparison.js'
import { ProjectContext } from '../../../../context/ProjectContext.jsx'
import { WeatherContext } from '../../../../context/WeatherContext.jsx'
import { computeHourlyGains } from '../../../../utils/instantCalc.js'
import { GAIN_COLOURS } from '../gainColours.js'
import EngineBadge from './EngineBadge.jsx'
import ChartContainer  from '../../../chart/ChartContainer.jsx'
import DataCard        from '../../../chart/DataCard.jsx'
import ZoomNav         from '../../../chart/ZoomNav.jsx'
import MonthJumpButtons, { dayOffsetForMonth } from '../../../chart/MonthJumpButtons.jsx'
import { TICK_STYLE, TOOLTIP_STYLE, GRID_STYLE, AXIS_PROPS } from '../../../../data/chartTokens.js'

const TOTAL_HOURS = 8760
const TOTAL_DAYS = 365
const START_DATE = new Date(2026, 0, 1)
const LENS_STORAGE_KEY = 'nza-conditions-lens'
const ZOOM_STORAGE_KEY = 'nza-conditions-zoom'
const ENABLED_GAINS_KEY = 'nza-conditions-enabled-gains'

const ZOOM_OPTIONS = [
  { label: '1d',  days: 1 },
  { label: '7d',  days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
  { label: 'Yr', days: 365 },
]

const LENSES = [
  { key: 'temperature', label: 'Temperature', icon: Thermometer },
  { key: 'gains',       label: 'Gain profile', icon: Activity   },
]

// ── Date / hour helpers ──────────────────────────────────────────────────
function dayToDate(day) {
  return new Date(START_DATE.getTime() + day * 86400000)
}
function fmtShort(date) {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
function hourToLabel(hourOfYear, zoomDays) {
  const day = Math.floor(hourOfYear / 24)
  const hod = hourOfYear % 24
  const d = dayToDate(day)
  if (zoomDays === 1)  return `${String(hod).padStart(2, '0')}:00`
  if (zoomDays <= 14)  return `${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}${hod === 0 ? '' : ''}`
  return d.toLocaleDateString('en-GB', { month: 'short' }) // year zoom: month labels
}

// ── Main ─────────────────────────────────────────────────────────────────
export default function LoadShapeView() {
  const { state1, state2, ready, libraryLoading } = useStateComparison()
  const { params, comfortBand } = useContext(ProjectContext)
  const { weatherData } = useContext(WeatherContext)

  // ── Persisted UI state ────────────────────────────────────────────────
  const [lens, setLens] = useState(() => {
    try {
      const saved = localStorage.getItem(LENS_STORAGE_KEY)
      if (saved && LENSES.find(l => l.key === saved)) return saved
    } catch {}
    return 'temperature'
  })
  const [zoomDays, setZoomDays] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(ZOOM_STORAGE_KEY))
      if (saved?.zoomDays) return saved.zoomDays
    } catch {}
    return 7
  })
  const [startDay, setStartDay] = useState(0)
  const [selectedMonth, setSelectedMonth] = useState(null)

  // Per-gain visibility toggles for the Gain profile lens (Brief 28a Part 5
  // walkthrough Finding 2). Clicking a People / Lighting / Equipment share
  // DataCard toggles that gain off the stacked area chart so users can
  // isolate one gain at a time. At least one gain must remain enabled —
  // see toggleGain() guard below.
  const [enabledGains, setEnabledGains] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(ENABLED_GAINS_KEY))
      if (saved && typeof saved === 'object') {
        return {
          people:    saved.people    !== false,
          lighting:  saved.lighting  !== false,
          equipment: saved.equipment !== false,
        }
      }
    } catch {}
    return { people: true, lighting: true, equipment: true }
  })

  useEffect(() => {
    try { localStorage.setItem(LENS_STORAGE_KEY, lens) } catch {}
  }, [lens])
  useEffect(() => {
    try { localStorage.setItem(ZOOM_STORAGE_KEY, JSON.stringify({ zoomDays })) } catch {}
  }, [zoomDays])
  useEffect(() => {
    try { localStorage.setItem(ENABLED_GAINS_KEY, JSON.stringify(enabledGains)) } catch {}
  }, [enabledGains])

  const toggleGain = (key) => {
    setEnabledGains(prev => {
      const next = { ...prev, [key]: !prev[key] }
      // Guard: refuse to disable the last enabled gain — leaving the chart
      // empty would be more confusing than helpful.
      if (!next.people && !next.lighting && !next.equipment) return prev
      return next
    })
  }

  // ── Annual hourly arrays — memoised on params + weather ───────────────
  const annualTemperature = useMemo(() => {
    if (!state1?.free_running?.hourly_temperature_c || !state2?.free_running?.hourly_temperature_c) return null
    const s1 = state1.free_running.hourly_temperature_c
    const s2 = state2.free_running.hourly_temperature_c
    const out = new Array(s1.length)
    for (let h = 0; h < s1.length; h++) {
      out[h] = { hour: h, state1: s1[h], state2: s2[h] }
    }
    return out
  }, [state1, state2])

  const gia = (Number(params?.length || 0)) * (Number(params?.width || 0)) * (Number(params?.num_floors || 0))

  const annualGains = useMemo(() => {
    if (!params || !weatherData?.temperature?.length || gia <= 0) return null
    const n = weatherData.temperature.length
    const out = new Array(n)
    for (let h = 0; h < n; h++) {
      const g = computeHourlyGains(params, h, weatherData, gia)
      out[h] = {
        hour: h,
        // kW per gain category (computeHourlyGains returns W)
        people:    (g.people    ?? 0) / 1000,
        lighting:  (g.lighting  ?? 0) / 1000,
        equipment: (g.equipment ?? 0) / 1000,
      }
    }
    return out
  }, [params, weatherData, gia])

  // ── Window slice + stats ──────────────────────────────────────────────
  const startHour = startDay * 24
  const endHour   = Math.min((startDay + zoomDays) * 24, TOTAL_HOURS)
  const startDateLabel = fmtShort(dayToDate(startDay))
  const endDateLabel   = fmtShort(dayToDate(Math.min(startDay + zoomDays - 1, TOTAL_DAYS - 1)))
  const dateRangeLabel = `${startDateLabel} – ${endDateLabel}`

  const tempWindow  = annualTemperature?.slice(startHour, endHour)
  const gainsWindow = annualGains?.slice(startHour, endHour)

  // Downsample yearly view so Recharts isn't asked to render 8,760 points
  // (visually indistinguishable beyond a few hundred for a single trace).
  const downsample = (arr, maxPoints = 720) => {
    if (!arr || arr.length <= maxPoints) return arr
    const step = Math.ceil(arr.length / maxPoints)
    const out = []
    for (let i = 0; i < arr.length; i += step) out.push(arr[i])
    return out
  }
  const tempPlot  = downsample(tempWindow)
  const gainsPlot = downsample(gainsWindow)

  const bandLo = comfortBand?.lower_c ?? 21
  const bandHi = comfortBand?.upper_c ?? 25

  const tempStats = useMemo(() => {
    if (!tempWindow?.length) return null
    let min = Infinity, max = -Infinity, sum = 0, inBand = 0
    for (const row of tempWindow) {
      const v = row.state2
      if (v < min) min = v
      if (v > max) max = v
      sum += v
      if (v >= bandLo && v <= bandHi) inBand++
    }
    return {
      peak:   max.toFixed(1),
      trough: min.toFixed(1),
      mean:   (sum / tempWindow.length).toFixed(1),
      inBand,
      total:  tempWindow.length,
    }
  }, [tempWindow, bandLo, bandHi])

  const gainStats = useMemo(() => {
    if (!gainsWindow?.length) return null
    // Peak/Mean reflect the currently-PLOTTED subset so users see the
    // numbers move as they toggle gains on/off. Shares stay full-window
    // (constant denominator) so they read as "fraction of total gain"
    // regardless of toggle state — a People share of 26% means People is
    // 26% of the whole pie, not 26% of whatever's enabled right now.
    let peakVisible = 0
    let sumPeople = 0, sumLighting = 0, sumEquip = 0
    let sumVisible = 0
    for (const row of gainsWindow) {
      const visPeople    = enabledGains.people    ? row.people    : 0
      const visLighting  = enabledGains.lighting  ? row.lighting  : 0
      const visEquip     = enabledGains.equipment ? row.equipment : 0
      const visTotal     = visPeople + visLighting + visEquip
      if (visTotal > peakVisible) peakVisible = visTotal
      sumVisible   += visTotal
      sumPeople    += row.people
      sumLighting  += row.lighting
      sumEquip     += row.equipment
    }
    const totalKWh = sumPeople + sumLighting + sumEquip
    return {
      peakKW:        peakVisible.toFixed(1),
      meanKW:        (sumVisible / gainsWindow.length).toFixed(2),
      windowTotalKWh: totalKWh.toFixed(0),
      sharePeople:   totalKWh > 0 ? Math.round((sumPeople    / totalKWh) * 100) : 0,
      shareLighting: totalKWh > 0 ? Math.round((sumLighting  / totalKWh) * 100) : 0,
      shareEquip:    totalKWh > 0 ? Math.round((sumEquip     / totalKWh) * 100) : 0,
    }
  }, [gainsWindow, enabledGains])

  // ── Month jump handler ────────────────────────────────────────────────
  const onSelectMonth = (m) => {
    setSelectedMonth(m)
    if (m == null) {
      setStartDay(0)
    } else {
      setStartDay(dayOffsetForMonth(START_DATE, m))
    }
  }

  // Disabled months in the Month picker (for yearly zoom, all months are
  // "available" since the full year is shown; for shorter zooms, none are
  // disabled either — leave the prop empty by default).
  const disabledMonths = null

  // ── Loading / not-ready ───────────────────────────────────────────────
  if (!ready) {
    return (
      <div className="px-5 py-6">
        <p className="text-xxs text-mid-grey">
          {libraryLoading ? 'Loading constructions library…' : 'Waiting for engine output…'}
        </p>
      </div>
    )
  }

  // ── Lens-specific chart + stats ───────────────────────────────────────
  const isTemperature = lens === 'temperature'
  const chartTitle = isTemperature
    ? `Free-running zone temperature${zoomDays >= 365 ? ' — annual' : ` — ${dateRangeLabel}`}`
    : `Internal gain profile${zoomDays >= 365 ? ' — annual' : ` — ${dateRangeLabel}`}`

  return (
    <div className="px-5 py-4 space-y-3 max-w-[1100px] mx-auto">

      {/* ── Header: title + EngineBadge + lens selector ─────────────── */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-section font-semibold text-navy">Conditions</h2>
            <EngineBadge />
          </div>
          <p className="text-xxs text-mid-grey mt-0.5">
            Hourly time-varying signals. Use the lens selector to switch between
            free-running zone T and the internal gain profile. Zoom to a window,
            or jump to a calendar month.
          </p>
        </div>
        {/* Lens selector */}
        <div className="flex bg-off-white rounded border border-light-grey p-0.5 gap-0.5">
          {LENSES.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setLens(key)}
              className={`flex items-center gap-1.5 px-2 py-0.5 text-xxs rounded transition-colors ${
                lens === key ? 'bg-white text-navy font-medium shadow-sm' : 'text-mid-grey hover:text-navy'
              }`}
            >
              <Icon size={11} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Canonical chart-with-stat-panel card ────────────────────── */}
      <div className="bg-white border border-light-grey rounded-lg p-3 space-y-2">

        {/* Zoom row, full width */}
        <ZoomNav
          zoomDays={zoomDays}
          setZoomDays={setZoomDays}
          startDay={startDay}
          setStartDay={setStartDay}
          totalDays={TOTAL_DAYS}
          dateRangeLabel={dateRangeLabel}
          options={ZOOM_OPTIONS}
          rightContent={
            <span className="text-xxs text-mid-grey tabular-nums">
              {zoomDays === 365 ? 'full year' : `${zoomDays}d window`}
            </span>
          }
        />

        {/* Body: chart left (~2/3), DataCards stacked right (180px) */}
        <div className="flex gap-3 mt-2">
          <div className="flex-1 min-w-0">
            <ChartContainer title={chartTitle} height={300}>
              {isTemperature ? (
                <LineChart data={tempPlot ?? []} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid {...GRID_STYLE} />
                  <XAxis
                    dataKey="hour"
                    {...AXIS_PROPS}
                    tickFormatter={h => hourToLabel(h, zoomDays)}
                    interval={Math.max(0, Math.floor((tempPlot?.length ?? 0) / 8))}
                  />
                  <YAxis {...AXIS_PROPS} unit="°C" width={40} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    labelFormatter={h => hourToLabel(h, zoomDays === 1 ? 1 : 2)}
                    formatter={(v) => `${Number(v).toFixed(1)}°C`}
                  />
                  <ReferenceLine y={bandLo} stroke="#94A3B8" strokeDasharray="3 3" label={{ value: `${bandLo}°C`, position: 'insideTopLeft', style: TICK_STYLE }} />
                  <ReferenceLine y={bandHi} stroke="#94A3B8" strokeDasharray="3 3" label={{ value: `${bandHi}°C`, position: 'insideTopLeft', style: TICK_STYLE }} />
                  <Line type="monotone" dataKey="state1" stroke="#94A3B8" strokeWidth={1} dot={false} name="State 1 (envelope)" />
                  <Line type="monotone" dataKey="state2" stroke="#EA580C" strokeWidth={1.4} dot={false} name="State 2 (with gains)" />
                </LineChart>
              ) : (
                <AreaChart data={gainsPlot ?? []} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid {...GRID_STYLE} />
                  <XAxis
                    dataKey="hour"
                    {...AXIS_PROPS}
                    tickFormatter={h => hourToLabel(h, zoomDays)}
                    interval={Math.max(0, Math.floor((gainsPlot?.length ?? 0) / 8))}
                  />
                  <YAxis {...AXIS_PROPS} unit=" kW" width={48} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    labelFormatter={h => hourToLabel(h, zoomDays === 1 ? 1 : 2)}
                    formatter={(v, name) => [`${Number(v).toFixed(2)} kW`, name]}
                  />
                  {enabledGains.people && (
                    <Area type="monotone" dataKey="people"    stackId="g" stroke={GAIN_COLOURS.occupancy} fill={GAIN_COLOURS.occupancy} fillOpacity={0.55} name="People" />
                  )}
                  {enabledGains.lighting && (
                    <Area type="monotone" dataKey="lighting"  stackId="g" stroke={GAIN_COLOURS.lighting}  fill={GAIN_COLOURS.lighting}  fillOpacity={0.55} name="Lighting" />
                  )}
                  {enabledGains.equipment && (
                    <Area type="monotone" dataKey="equipment" stackId="g" stroke={GAIN_COLOURS.equipment} fill={GAIN_COLOURS.equipment} fillOpacity={0.55} name="Equipment" />
                  )}
                </AreaChart>
              )}
            </ChartContainer>
          </div>

          {/* Stats column */}
          <div className="w-[180px] flex-shrink-0 space-y-2">
            {isTemperature && tempStats && (
              <>
                <DataCard label="Peak"     value={tempStats.peak}   unit="°C" accent="heating-red"  icon={Thermometer} />
                <DataCard label="Trough"   value={tempStats.trough} unit="°C" accent="cooling-blue" icon={Thermometer} />
                <DataCard label="Mean"     value={tempStats.mean}   unit="°C" accent="navy" />
                <DataCard label="In band"  value={`${tempStats.inBand}/${tempStats.total}`} unit="hrs" accent="green" />
              </>
            )}
            {!isTemperature && gainStats && (
              <>
                <DataCard label="Peak"     value={gainStats.peakKW}        unit="kW"    accent="navy"  />
                <DataCard label="Mean"     value={gainStats.meanKW}        unit="kW"    accent="slate" />
                {/* Share rows act as visibility toggles — click to isolate
                    a single gain or any combination. Brief 28a Part 5
                    walkthrough Finding 2. */}
                <DataCard
                  label="People"
                  value={`${gainStats.sharePeople}%`}
                  accent="purple"
                  icon={Activity}
                  onClick={() => toggleGain('people')}
                  dimmed={!enabledGains.people}
                />
                <DataCard
                  label="Lighting"
                  value={`${gainStats.shareLighting}%`}
                  accent="gold"
                  onClick={() => toggleGain('lighting')}
                  dimmed={!enabledGains.lighting}
                />
                <DataCard
                  label="Equipment"
                  value={`${gainStats.shareEquip}%`}
                  accent="amber"
                  onClick={() => toggleGain('equipment')}
                  dimmed={!enabledGains.equipment}
                />
                <p className="text-xxs text-mid-grey/70 leading-tight pt-1">
                  Click a share row to toggle that gain off the chart.
                  Peak and Mean update; share % stays full-window.
                </p>
              </>
            )}
          </div>
        </div>

        {/* MonthJumpButtons row, full width below chart */}
        <div className="pt-2 border-t border-light-grey/60">
          <MonthJumpButtons
            selectedMonth={selectedMonth}
            onSelect={onSelectMonth}
            disabledMonths={disabledMonths}
          />
        </div>

      </div>

      {/* ── Footnote ────────────────────────────────────────────────── */}
      <p className="text-xxs text-mid-grey/70 italic">
        Static engine numbers. Static summer max sits ~8.8°C above Dynamic on
        Bridgewater — lumped two-node mass model (Brief 28b Part 3 lands the
        multi-layer CTF fix). The Annual breakdown lens that lived in the
        interim 3-sub-view toggle (Brief 28a Part 3c) is dropped here — per-gain
        attribution is already in the Summary tab; "Conditions" is the time-
        varying-signals tab. Walkthrough flag: revisit if you want that view
        back as a third lens or a separate tab.
      </p>
    </div>
  )
}

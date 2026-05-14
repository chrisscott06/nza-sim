/**
 * ChartComponentsTestPage.jsx — /chart-test
 *
 * Dev-only test harness for the Pablo chart components ported in
 * Brief 28a Part 4 (2026-05-14). Refined 2026-05-14 after walkthrough
 * feedback exposed sprawl: chart filled viewport height, DataCards
 * stacked above/below at full width, density too low.
 *
 * Refined layout matches `docs/ui_principles.md` §6 (density baseline)
 * + the "chart paired with a stat panel" pattern:
 *   - Section 1: canonical composition (Part 5 preview) — chart left,
 *     DataCards stacked right, ZoomNav above, MonthJumpButtons below.
 *   - Section 2: DataCard accent variants — compact grid.
 *
 * Mirrors the BalanceTestPage convention (also a dev route at
 * /balance-test).
 */

import { useState, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts'
import { Thermometer, Activity, Zap, AlertTriangle } from 'lucide-react'
import ChartContainer  from '../components/chart/ChartContainer.jsx'
import DataCard        from '../components/chart/DataCard.jsx'
import ZoomNav         from '../components/chart/ZoomNav.jsx'
import MonthJumpButtons, { dayOffsetForMonth } from '../components/chart/MonthJumpButtons.jsx'
import {
  TICK_STYLE, TOOLTIP_STYLE, GRID_STYLE, AXIS_PROPS,
} from '../data/chartTokens.js'

const TOTAL_DAYS = 365
const START_DATE = new Date(2026, 0, 1) // Jan 1, 2026

// Synthetic daily temperature trace — sine wave + small noise. Stands in for
// the kind of data Conditions tab will show in Part 5 (free-running zone T,
// hourly profile aggregated to daily, etc.).
function synthesiseDailyTrace() {
  const arr = new Array(TOTAL_DAYS)
  for (let d = 0; d < TOTAL_DAYS; d++) {
    const phase = (d / TOTAL_DAYS) * 2 * Math.PI
    const seasonal = 14 + 10 * Math.sin(phase - Math.PI / 2)   // 4°C in winter, 24°C in summer
    const noise = (Math.sin(d * 0.91) + Math.cos(d * 1.37)) * 1.3
    arr[d] = seasonal + noise
  }
  return arr
}

const DAILY_TRACE = synthesiseDailyTrace()

function formatDay(dayIndex) {
  const date = new Date(START_DATE.getTime() + dayIndex * 86400000)
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export default function ChartComponentsTestPage() {
  // ZoomNav state
  const [zoomDays, setZoomDays] = useState(30)
  const [startDay, setStartDay] = useState(0)
  const [selectedMonth, setSelectedMonth] = useState(null)

  const endDay = Math.min(startDay + zoomDays - 1, TOTAL_DAYS - 1)
  const dateRangeLabel = `${formatDay(startDay)} – ${formatDay(endDay)}`

  // Wire MonthJumpButtons → ZoomNav: jumping to a month sets startDay
  const onSelectMonth = (m) => {
    setSelectedMonth(m)
    if (m == null) {
      setStartDay(0)
    } else {
      setStartDay(dayOffsetForMonth(START_DATE, m))
    }
  }

  // Chart data + summary stats for the active window
  const { chartData, stats } = useMemo(() => {
    const data = []
    let sum = 0, min = Infinity, max = -Infinity
    for (let d = startDay; d <= endDay; d++) {
      const v = DAILY_TRACE[d]
      data.push({ day: formatDay(d), value: Math.round(v * 10) / 10 })
      sum += v
      if (v < min) min = v
      if (v > max) max = v
    }
    const n = endDay - startDay + 1
    return {
      chartData: data,
      stats: {
        peak:     max.toFixed(1),
        trough:   min.toFixed(1),
        mean:     (sum / n).toFixed(1),
        days:     n,
      },
    }
  }, [startDay, endDay])

  // Demo: pretend Aug + Sep have no data (greyed out)
  const disabledMonths = [7, 8]

  return (
    <div className="h-full overflow-y-auto bg-off-white">
      <div className="max-w-4xl mx-auto px-5 py-5 space-y-5">

        <header>
          <h1 className="text-section font-semibold text-navy">Chart components — test harness</h1>
          <p className="text-xxs text-mid-grey mt-0.5">
            Dev-only page. Exercises the Pablo components ported in Brief 28a
            Part 4. Refined 2026-05-14 per <code>docs/ui_principles.md</code> §6
            (density baseline) and the chart-with-stat-panel pattern.
          </p>
        </header>

        {/* ── 1. Canonical composition (Part 5 preview) ──────────────── */}
        <section>
          <div className="text-xxs uppercase tracking-wider text-mid-grey mb-2">
            Canonical composition — Part 5 will produce this on the Conditions tab
          </div>

          <div className="bg-white border border-light-grey rounded-lg p-3 space-y-2">

            {/* Header: ZoomNav above the chart, full width */}
            <ZoomNav
              zoomDays={zoomDays}
              setZoomDays={setZoomDays}
              startDay={startDay}
              setStartDay={setStartDay}
              totalDays={TOTAL_DAYS}
              dateRangeLabel={dateRangeLabel}
              rightContent={
                <span className="text-xxs text-mid-grey tabular-nums">
                  {stats.days}d window
                </span>
              }
            />

            {/* Body: chart left (~2/3), DataCards stacked right (~1/3) */}
            <div className="flex gap-3 mt-3">
              {/* Chart column */}
              <div className="flex-1 min-w-0">
                <ChartContainer title="Synthetic daily trace (sample data)" height={300}>
                  <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid {...GRID_STYLE} />
                    <XAxis
                      dataKey="day"
                      {...AXIS_PROPS}
                      interval={Math.max(0, Math.floor(chartData.length / 8))}
                    />
                    <YAxis
                      {...AXIS_PROPS}
                      unit="°C"
                      width={36}
                    />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <ReferenceLine y={21} stroke="#94A3B8" strokeDasharray="3 3" />
                    <ReferenceLine y={25} stroke="#94A3B8" strokeDasharray="3 3" />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#EA580C"
                      strokeWidth={1.5}
                      dot={false}
                    />
                  </LineChart>
                </ChartContainer>
              </div>

              {/* Stats column — narrower, DataCards stacked vertically */}
              <div className="w-[180px] flex-shrink-0 space-y-2">
                <DataCard label="Peak"     value={stats.peak}   unit="°C" accent="heating-red"  icon={Thermometer} />
                <DataCard label="Trough"   value={stats.trough} unit="°C" accent="cooling-blue" icon={Thermometer} />
                <DataCard label="Mean"     value={stats.mean}   unit="°C" accent="navy"         icon={Activity} />
                <DataCard label="Window"   value={stats.days}   unit="d"  accent="slate" />
              </div>
            </div>

            {/* Footer: MonthJumpButtons below, spanning full width */}
            <div className="pt-2 border-t border-light-grey/60">
              <MonthJumpButtons
                selectedMonth={selectedMonth}
                onSelect={onSelectMonth}
                disabledMonths={disabledMonths}
              />
            </div>

          </div>

          <p className="text-xxs text-mid-grey/70 mt-1.5 italic">
            ZoomNav drives the chart's window via <code>zoomDays</code> /
            <code>startDay</code>. MonthJumpButtons jumps the window to a
            calendar month via <code>dayOffsetForMonth</code>. Aug + Sep
            disabled to demonstrate the <code>disabledMonths</code> prop.
            Stats panel reads at-a-glance against the visible window —
            updates live as the user zooms or jumps. The 21°C / 25°C
            dashed lines are placeholder comfort band markers.
          </p>
        </section>

        {/* ── 2. DataCard accent variants ───────────────────────────── */}
        <section>
          <div className="text-xxs uppercase tracking-wider text-mid-grey mb-2">
            DataCard — 8 accent variants
          </div>
          <div className="grid grid-cols-4 gap-2">
            <DataCard label="Annual EUI"  value="142.3" unit="kWh/m²" accent="navy" />
            <DataCard label="Heating"     value="89.1"  unit="MWh"    accent="heating-red"  icon={Thermometer} />
            <DataCard label="Cooling"     value="12.7"  unit="MWh"    accent="cooling-blue" icon={Activity} />
            <DataCard label="Solar"       value="34.8"  unit="MWh"    accent="amber"        icon={Zap} />
            <DataCard label="Comfort"     value="6,234" unit="hrs"    accent="green" />
            <DataCard label="Overheat"    value="234"   unit="hrs"    accent="red"          icon={AlertTriangle} />
            <DataCard label="Equipment"   value="18.5"  unit="MWh"    accent="purple" />
            <DataCard label="Lighting"    value="11.2"  unit="MWh"    accent="gold" />
          </div>
          <p className="text-xxs text-mid-grey/70 mt-1.5 italic">
            Inline-style <code>borderLeft</code> with free-form CSS colour from
            ACCENT_COLORS map. Each card sized to content, not stretched —
            the natural-width principle (§1) keeps the grid scannable.
          </p>
        </section>

        <footer className="text-xxs text-mid-grey/70 italic pt-3 border-t border-light-grey">
          Test harness for Brief 28a Part 4 (refined 2026-05-14). Not linked
          from sidebar (dev-only). Reach by URL: <code>/chart-test</code>.
          Will be removed at Brief 28a Part 7 close-out unless useful to keep.
        </footer>

      </div>
    </div>
  )
}

/**
 * ChartComponentsTestPage.jsx — /chart-test
 *
 * Dev-only test harness for the Pablo chart components ported in
 * Brief 28a Part 4 (2026-05-14). Exercises each component in
 * isolation with sample state + sample chart data so visual
 * regressions are catchable before Part 5 wires them into the live
 * Conditions tab.
 *
 * Mirrors the BalanceTestPage convention (also a dev route).
 *
 * Components exercised:
 *   - ChartContainer  — wraps a small Recharts BarChart
 *   - DataCard        — 8 accent variants + sub label
 *   - ZoomNav         — state-driven (zoomDays / startDay / totalDays)
 *   - MonthJumpButtons — state-driven (selectedMonth + disabledMonths demo)
 */

import { useState } from 'react'
import { BarChart3, Activity, Thermometer, Zap, AlertTriangle } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import ChartContainer  from '../components/chart/ChartContainer.jsx'
import DataCard        from '../components/chart/DataCard.jsx'
import ZoomNav         from '../components/chart/ZoomNav.jsx'
import MonthJumpButtons, { dayOffsetForMonth } from '../components/chart/MonthJumpButtons.jsx'
import {
  TICK_STYLE, TOOLTIP_STYLE, GRID_STYLE, AXIS_PROPS,
  CHART_SERIES_COLORS,
} from '../data/chartTokens.js'

// Sample chart data — 12 months
const SAMPLE_BAR_DATA = [
  { month: 'Jan', value: 18 }, { month: 'Feb', value: 16 },
  { month: 'Mar', value: 12 }, { month: 'Apr', value:  8 },
  { month: 'May', value:  5 }, { month: 'Jun', value:  3 },
  { month: 'Jul', value:  2 }, { month: 'Aug', value:  3 },
  { month: 'Sep', value:  5 }, { month: 'Oct', value:  9 },
  { month: 'Nov', value: 14 }, { month: 'Dec', value: 17 },
]

export default function ChartComponentsTestPage() {
  // ZoomNav state
  const [zoomDays, setZoomDays] = useState(7)
  const [startDay, setStartDay] = useState(0)
  const TOTAL_DAYS = 365
  const START_DATE = new Date(2026, 0, 1) // Jan 1, 2026
  const endDay = Math.min(startDay + zoomDays - 1, TOTAL_DAYS - 1)
  const startDate = new Date(START_DATE.getTime() + startDay * 86400000)
  const endDate   = new Date(START_DATE.getTime() + endDay   * 86400000)
  const dateRangeLabel = `${startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${endDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`

  // MonthJumpButtons state
  const [selectedMonth, setSelectedMonth] = useState(null)
  // Demo: pretend Aug + Sep have no data
  const disabledMonths = [7, 8]

  // Wire MonthJumpButtons → ZoomNav: jumping to a month sets startDay
  const onSelectMonth = (m) => {
    setSelectedMonth(m)
    if (m == null) {
      setStartDay(0)
    } else {
      setStartDay(dayOffsetForMonth(START_DATE, m))
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-off-white">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">

        <header>
          <h1 className="text-h2 font-semibold text-navy mb-1">Chart components — test harness</h1>
          <p className="text-caption text-mid-grey">
            Dev-only page. Exercises the Pablo chart components ported in
            Brief 28a Part 4 (commit <code>c54ee6f</code>) in isolation,
            before they get wired into the live Conditions tab in Part 5.
            Each section below renders one component with sample state
            and data.
          </p>
        </header>

        {/* ── DataCard variants ────────────────────────────────────── */}
        <section>
          <h2 className="text-section font-semibold text-navy mb-2">DataCard — 8 accent variants</h2>
          <p className="text-xxs text-mid-grey mb-3">
            Inline-style <code>borderLeft</code> with free-form CSS colour from the
            ACCENT_COLORS map; this is the refactored form (no Tailwind class lookup).
          </p>
          <div className="grid grid-cols-4 gap-3">
            <DataCard label="Annual EUI" value="142.3" unit="kWh/m²" accent="navy"         large />
            <DataCard label="Heating"    value="89.1"  unit="MWh"    accent="heating-red"  icon={Thermometer} />
            <DataCard label="Cooling"    value="12.7"  unit="MWh"    accent="cooling-blue" icon={Activity} />
            <DataCard label="Solar"      value="34.8"  unit="MWh"    accent="amber"        icon={Zap} />
            <DataCard label="Comfort"    value="6,234" unit="hrs"    accent="green" />
            <DataCard label="Overheat"   value="234"   unit="hrs"    accent="red"   icon={AlertTriangle} />
            <DataCard label="Equipment"  value="18.5"  unit="MWh"    accent="purple" />
            <DataCard label="Lighting"   value="11.2"  unit="MWh"    accent="gold" />
          </div>
        </section>

        {/* ── ChartContainer wrapping a Recharts BarChart ──────────── */}
        <section>
          <h2 className="text-section font-semibold text-navy mb-2">ChartContainer — wrapping a Recharts BarChart</h2>
          <p className="text-xxs text-mid-grey mb-3">
            Compact uppercase title; light-grey border; ResponsiveContainer
            handles the height. No print/export functionality (intentional
            strip — Pablo's version uses html2canvas + jspdf; NZA's
            equivalent was already stripped). Brief 28a Part 7 close-out
            may decide whether to add an export feature flag.
          </p>
          <ChartContainer title="Sample monthly bar chart (placeholder data)" height={200}>
            <BarChart data={SAMPLE_BAR_DATA} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID_STYLE} vertical={false} />
              <XAxis dataKey="month" {...AXIS_PROPS} />
              <YAxis {...AXIS_PROPS} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="value" fill={CHART_SERIES_COLORS[0]} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </section>

        {/* ── ZoomNav ──────────────────────────────────────────────── */}
        <section>
          <h2 className="text-section font-semibold text-navy mb-2">ZoomNav — zoom + prev/next + date range</h2>
          <p className="text-xxs text-mid-grey mb-3">
            Pablo's standard zoom control. Pick a zoom level (1d / 7d /
            14d / 30d), step forward/back, see the active date range.
            Active button is teal; chevrons disable at boundaries.
          </p>
          <div className="bg-white border border-light-grey rounded-lg p-3">
            <ZoomNav
              zoomDays={zoomDays}
              setZoomDays={setZoomDays}
              startDay={startDay}
              setStartDay={setStartDay}
              totalDays={TOTAL_DAYS}
              dateRangeLabel={dateRangeLabel}
              rightContent={
                <span className="text-xxs text-mid-grey tabular-nums">
                  Day {startDay + 1}–{endDay + 1} of {TOTAL_DAYS}
                </span>
              }
            />
          </div>
        </section>

        {/* ── MonthJumpButtons ─────────────────────────────────────── */}
        <section>
          <h2 className="text-section font-semibold text-navy mb-2">MonthJumpButtons — season-coloured month strip</h2>
          <p className="text-xxs text-mid-grey mb-3">
            Pick a month to jump the time-series window. Active button
            uses the season colour (Winter teal / Spring green / Summer
            gold / Autumn coral). "All" returns to no-filter. Aug + Sep
            shown disabled to demonstrate the <code>disabledMonths</code>
            prop. Clicking a month also drives the ZoomNav above (via
            <code>dayOffsetForMonth</code> helper).
          </p>
          <div className="bg-white border border-light-grey rounded-lg p-3 space-y-2">
            <div className="text-xxs uppercase tracking-wider text-mid-grey">Size: sm (default)</div>
            <MonthJumpButtons
              selectedMonth={selectedMonth}
              onSelect={onSelectMonth}
              disabledMonths={disabledMonths}
            />
            <div className="text-xxs uppercase tracking-wider text-mid-grey mt-3">Size: md</div>
            <MonthJumpButtons
              selectedMonth={selectedMonth}
              onSelect={onSelectMonth}
              disabledMonths={disabledMonths}
              size="md"
            />
            <div className="text-xxs text-mid-grey mt-2">
              Currently selected: <strong>{selectedMonth == null ? 'All' : ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][selectedMonth]}</strong>
              {' · '}
              <code>dayOffsetForMonth = {selectedMonth == null ? 'n/a' : dayOffsetForMonth(START_DATE, selectedMonth)}</code>
            </div>
          </div>
        </section>

        <footer className="text-xxs text-mid-grey/70 italic pt-4 border-t border-light-grey">
          Test harness for Brief 28a Part 4. Not linked from the sidebar
          (dev-only). Reach by URL: <code>/chart-test</code>. Will be
          removed at Brief 28a Part 7 close-out alongside other
          deprecated dev files, unless it proves useful to keep around.
        </footer>

      </div>
    </div>
  )
}

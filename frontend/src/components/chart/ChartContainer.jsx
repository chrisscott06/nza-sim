import { ResponsiveContainer } from 'recharts'

/**
 * ChartContainer — white card wrapper for Recharts charts.
 * Matches Pablo's pattern: compact uppercase title, light-grey border.
 *
 * Brief 28a Part 5 walkthrough Finding 2 (2026-05-14): added `fluid`
 * prop. When true, the card and chart body both stretch to fill their
 * parent (the parent must be a height-bounded flex container). When
 * false (default), the chart body uses fixed `height` pixels — the
 * original Pablo-port behaviour.
 *
 * Use `fluid` when the parent is a height-bounded canvas (e.g. the
 * Profiles tab on a fixed-viewport layout). Use fixed `height` for
 * dashboard panels where the chart should occupy a known slot.
 */
export default function ChartContainer({
  title,
  height = 220,
  fluid = false,
  children,
  className = '',
}) {
  return (
    <div
      className={[
        'bg-white border border-light-grey rounded-lg overflow-hidden',
        fluid ? 'flex flex-col h-full min-h-0' : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      {title && (
        <div className="px-3 pt-2 pb-0 flex-shrink-0">
          <span className="text-xxs uppercase tracking-wider text-mid-grey font-medium">
            {title}
          </span>
        </div>
      )}
      <div
        className={['px-3 pb-2 pt-1', fluid ? 'flex-1 min-h-0' : ''].filter(Boolean).join(' ')}
        style={fluid ? undefined : { height }}
      >
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

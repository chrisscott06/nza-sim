import { ResponsiveContainer } from 'recharts'

/**
 * ChartContainer — white card wrapper for Recharts charts.
 * Matches Pablo's pattern: compact uppercase title, light-grey border.
 */
export default function ChartContainer({
  title,
  height = 220,
  children,
  className = '',
}) {
  return (
    <div className={`bg-white border border-light-grey rounded-lg overflow-hidden ${className}`}>
      {title && (
        <div className="px-3 pt-2 pb-0">
          <span className="text-xxs uppercase tracking-wider text-mid-grey font-medium">
            {title}
          </span>
        </div>
      )}
      <div className="px-3 pb-2 pt-1" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

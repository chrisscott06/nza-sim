/**
 * DataCard — KPI metric tile with coloured left border.
 * Matches Pablo's DataCard pattern exactly.
 */

const ACCENT_COLORS = {
  teal:           '#00AEEF',
  magenta:        '#E84393',
  gold:           '#ECB01F',
  green:          '#16A34A',
  red:            '#DC2626',
  purple:         '#8B5CF6',
  coral:          '#F48379',
  navy:           '#2B2A4C',
  'heating-red':  '#DC2626',
  'cooling-blue': '#3B82F6',
  amber:          '#F59E0B',
  slate:          '#64748B',
}

export default function DataCard({
  label,
  value,
  unit,
  accent = 'teal',
  icon: Icon,
  large = false,
  className = '',
}) {
  const borderColor = ACCENT_COLORS[accent] ?? ACCENT_COLORS.teal

  return (
    <div
      className={`bg-white rounded-lg shadow-sm relative overflow-hidden ${className}`}
      style={{ borderLeft: `3px solid ${borderColor}` }}
    >
      <div className="px-3 py-2.5">
        {Icon && (
          <div className="mb-1 opacity-40" style={{ color: borderColor }}>
            <Icon size={12} />
          </div>
        )}
        <div className="flex items-baseline gap-1">
          <span
            className={`font-medium text-navy leading-none ${large ? 'text-metric-lg' : 'text-metric'}`}
          >
            {value ?? '—'}
          </span>
          {unit && (
            <span className="text-xxs text-mid-grey">{unit}</span>
          )}
        </div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mt-1">{label}</p>
      </div>
    </div>
  )
}

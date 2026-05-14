/**
 * DataCard — KPI metric tile with coloured left border.
 * Matches Pablo's DataCard pattern exactly.
 *
 * Brief 28a Part 5 walkthrough Finding 2 (2026-05-14): added optional
 * `onClick` + `dimmed` props so a DataCard can act as a toggle. When
 * `onClick` is provided the card becomes keyboard-focusable and shows
 * a pointer cursor + hover shadow. When `dimmed` is true the card
 * renders at ~45% opacity with a neutral grey left border, signalling
 * "off". Existing non-interactive call sites are unaffected (both props
 * are optional and default to non-interactive).
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

const DIMMED_BORDER = '#D1D5DB'  // light-grey, neutral

export default function DataCard({
  label,
  value,
  unit,
  accent = 'teal',
  icon: Icon,
  large = false,
  className = '',
  onClick,
  dimmed = false,
}) {
  const interactive = typeof onClick === 'function'
  const borderColor = dimmed
    ? DIMMED_BORDER
    : (ACCENT_COLORS[accent] ?? ACCENT_COLORS.teal)

  const handleKeyDown = interactive
    ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick(e)
        }
      }
    : undefined

  return (
    <div
      className={[
        'bg-white rounded-lg shadow-sm relative overflow-hidden transition-all duration-150',
        interactive ? 'cursor-pointer hover:shadow-md select-none' : '',
        dimmed ? 'opacity-45' : 'opacity-100',
        className,
      ].filter(Boolean).join(' ')}
      style={{ borderLeft: `3px solid ${borderColor}` }}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? !dimmed : undefined}
      onKeyDown={handleKeyDown}
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

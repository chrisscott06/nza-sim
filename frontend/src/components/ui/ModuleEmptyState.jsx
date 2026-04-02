import { BarChart3 } from 'lucide-react'

/**
 * ModuleEmptyState — centred empty state for modules without data.
 */
export default function ModuleEmptyState({
  icon: Icon = BarChart3,
  title = 'No data yet',
  description = 'Run a simulation to see results here.',
  className = '',
}) {
  return (
    <div className={`flex flex-col items-center justify-center h-full gap-3 text-mid-grey select-none ${className}`}>
      <Icon size={36} strokeWidth={1} className="opacity-30" />
      <div className="text-center">
        <p className="text-body font-medium text-dark-grey">{title}</p>
        {description && (
          <p className="text-caption mt-0.5 max-w-xs text-center">{description}</p>
        )}
      </div>
    </div>
  )
}

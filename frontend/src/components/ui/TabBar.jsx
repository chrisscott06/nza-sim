/**
 * TabBar — horizontal tab navigation with bottom-border active indicator.
 * Matches Pablo's TabBar pattern.
 */
export default function TabBar({
  tabs,
  active,
  onChange,
  accentColor = '#00AEEF',   // teal by default
  className = '',
}) {
  return (
    <div className={`flex border-b border-light-grey ${className}`}>
      {tabs.map(tab => {
        const isActive = tab.id === active
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`
              relative px-4 py-2.5 text-caption transition-colors duration-150
              whitespace-nowrap select-none
              ${isActive
                ? 'text-navy font-medium'
                : 'text-mid-grey hover:text-dark-grey'
              }
            `}
          >
            {tab.label}
            {isActive && (
              <span
                className="absolute bottom-0 left-0 right-0 h-[2px]"
                style={{ backgroundColor: accentColor }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}

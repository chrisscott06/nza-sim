/**
 * ExplorerLayout — sidebar + main area layout for modules.
 * Left sidebar: scrollable controls. Main area: scrollable content.
 * Height fills viewport minus topbar (48px = h-12).
 */
export default function ExplorerLayout({
  sidebar,
  children,
  sidebarWidth = 'w-72',
  className = '',
}) {
  return (
    <div className={`flex h-[calc(100vh-3rem)] ${className}`}>
      {/* Left sidebar */}
      <aside
        className={`
          ${sidebarWidth} flex-shrink-0
          bg-white border-r border-light-grey
          overflow-y-auto overflow-x-hidden
        `}
      >
        {sidebar}
      </aside>

      {/* Main content area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden bg-off-white">
        {children}
      </div>
    </div>
  )
}

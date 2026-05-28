/**
 * ChartContainer — wrap a chart with a hover-revealed export icon.
 *
 * Adapted from PABLO 2.0's CHART_EXPORT_HANDOFF.md (Chris's sibling tool).
 * Source: /c/Users/ChrisScott/Dev/pablo-2/CHART_EXPORT_HANDOFF.md
 *
 * Usage:
 *   <ChartContainer title="Heat balance" height="h-72">
 *     <YourChart ... />
 *   </ChartContainer>
 *
 * The print icon fades in on card hover (top-right corner). Click → opens
 * ChartPrintModal with Copy / PNG / SVG / PDF / Print. The same children
 * are re-rendered inside the modal so the export captures the same
 * chart at a user-resizable size.
 *
 * Props:
 *   - title:   string or JSX, shown as the card header. Used as the
 *              default filename for exports (spaces → underscores).
 *   - actions: optional JSX rendered to the right of the title (e.g. view
 *              toggles, unit pickers).
 *   - children: the chart itself (Recharts, D3, raw SVG — anything).
 *   - height:  Tailwind height class for the chart area inside the card.
 *              Default 'h-72'. Pass 'h-auto' or 'h-full' for flexible.
 *   - className: extra classes applied to the outer card.
 *   - noChrome: if true, render NO card chrome (no border, no padding, no
 *               title) — only the hover-revealed print icon over the bare
 *               chart. Use for charts whose host module already provides
 *               the card wrapper (Sankey panels inside a tabbed view).
 *   - showHeader: if false, the title is exported but not displayed in
 *               the card header (chart-only card with title-as-filename).
 */
import { useState } from 'react'
import { Printer } from 'lucide-react'
import ChartPrintModal from './ChartPrintModal.jsx'

export default function ChartContainer({
  title,
  actions,
  children,
  className = '',
  height = 'h-72',
  noChrome = false,
  showHeader = true,
}) {
  const [showPrint, setShowPrint] = useState(false)

  if (noChrome) {
    return (
      <>
        <div className={`relative group ${className}`}>
          <button
            onClick={() => setShowPrint(true)}
            className="absolute top-2 right-2 z-10 p-1.5 rounded text-mid-grey opacity-0 group-hover:opacity-100 hover:text-navy hover:bg-off-white transition-all"
            title="Export chart"
          >
            <Printer size={14} />
          </button>
          {children}
        </div>
        <ChartPrintModal isOpen={showPrint} onClose={() => setShowPrint(false)} title={title}>
          {children}
        </ChartPrintModal>
      </>
    )
  }

  return (
    <>
      <div className={`bg-white rounded-lg border border-light-grey relative group ${className}`}>
        {showHeader && (title || actions) && (
          <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
            {title && (
              <h3 className="text-xxs font-medium text-navy uppercase tracking-wide">
                {title}
              </h3>
            )}
            {actions && <div className="flex items-center gap-2">{actions}</div>}
          </div>
        )}

        {/* Print icon — fades in on card hover */}
        <button
          onClick={() => setShowPrint(true)}
          className="absolute top-2.5 right-3 p-1.5 rounded text-mid-grey opacity-0 group-hover:opacity-100 hover:text-navy hover:bg-off-white transition-all"
          title="Export chart"
        >
          <Printer size={14} />
        </button>

        <div className={`${height} px-2 pb-2`}>
          {children}
        </div>
      </div>

      <ChartPrintModal isOpen={showPrint} onClose={() => setShowPrint(false)} title={title}>
        {children}
      </ChartPrintModal>
    </>
  )
}

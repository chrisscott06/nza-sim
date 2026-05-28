import { useState } from 'react'
import { ResponsiveContainer } from 'recharts'
import { Printer } from 'lucide-react'
import ChartPrintModal from '../shared/ChartPrintModal.jsx'

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
 * Plan Part C (2026-05-28): added a hover-revealed print icon (top-
 * right). Click opens ChartPrintModal with Copy / PNG / SVG / PDF /
 * Print. The Recharts children are re-rendered inside the modal at a
 * user-resizable size. Pass `noExport` to suppress the icon (e.g. for
 * tiny inline sparklines where export adds no value).
 *
 * Use `fluid` when the parent is a height-bounded canvas (e.g. the
 * Profiles tab on a fixed-viewport layout). Use fixed `height` for
 * dashboard panels where the chart should occupy a known slot.
 */
export default function ChartContainer({
  title,
  height = 220,
  fluid = false,
  noExport = false,
  children,
  className = '',
}) {
  const [showPrint, setShowPrint] = useState(false)
  return (
    <>
      <div
        className={[
          'bg-white border border-light-grey rounded-lg overflow-hidden relative group',
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
        {!noExport && (
          <button
            onClick={() => setShowPrint(true)}
            className="absolute top-1.5 right-2 z-10 p-1 rounded text-mid-grey opacity-0 group-hover:opacity-100 hover:text-navy hover:bg-off-white transition-all"
            title="Export chart"
          >
            <Printer size={12} />
          </button>
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
      {!noExport && (
        <ChartPrintModal
          isOpen={showPrint}
          onClose={() => setShowPrint(false)}
          title={title}
        >
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        </ChartPrintModal>
      )}
    </>
  )
}

/**
 * ChartPrintModal — fullscreen export modal with Copy / PNG / SVG / PDF / Print.
 *
 * Adapted from PABLO 2.0's CHART_EXPORT_HANDOFF.md. Five fixes baked in
 * (see comments inline + the handoff doc §5):
 *   5.1  strip inline width/height styles, set explicit pixel attrs, add viewBox
 *   5.2  pick LARGEST svg by visible area (skip icons / decorative svgs)
 *   5.3  inline computed styles onto every visual element pre-serialise
 *   5.4  dynamic-import html2canvas + jsPDF (keep main bundle slim)
 *   5.5  backdrop-click closes only if mousedown AND mouseup on backdrop
 */
import { useEffect, useRef, useState } from 'react'
import { X, Printer, Download, FileImage, FileText, Copy, Check } from 'lucide-react'

export default function ChartPrintModal({ isOpen, onClose, title, children }) {
  const containerRef = useRef(null)
  const backdropMouseDown = useRef(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  // title may be JSX — extract plain string for filenames
  const titleText = typeof title === 'string'
    ? title
    : (title?.props?.children
        ? (Array.isArray(title.props.children)
            ? title.props.children.filter(c => typeof c === 'string').join(' ')
            : (typeof title.props.children === 'string' ? title.props.children : 'chart'))
        : 'chart')
  const safeName = (titleText || 'chart').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '')

  // ── 5.4: dynamic import — keeps main bundle small
  async function containerToCanvas(scale = 2) {
    const container = containerRef.current
    if (!container) return null
    const { default: html2canvas } = await import('html2canvas')
    return html2canvas(container, { scale, backgroundColor: '#ffffff', logging: false, useCORS: true })
  }

  // ── 5.1 + 5.2 + 5.3: clone the LARGEST svg, normalise sizing, inline styles
  function getClonedSvg() {
    const container = containerRef.current
    if (!container) return null

    const allSvgs = Array.from(container.querySelectorAll('svg'))
    if (allSvgs.length === 0) return null
    // 5.2 — pick the largest svg by area (skip Lucide icons + legend swatches)
    const svgEl = allSvgs.reduce((biggest, s) => {
      const r = s.getBoundingClientRect()
      const area = r.width * r.height
      if (!biggest || area > biggest._area) return Object.assign(s, { _area: area })
      return biggest
    }, null)
    if (!svgEl) return null
    const rect = svgEl.getBoundingClientRect()
    if (rect.width < 50 || rect.height < 50) return null

    const clone = svgEl.cloneNode(true)
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')

    // 5.1 — strip inline 100%, set pixel dimensions + viewBox
    clone.style.removeProperty('width')
    clone.style.removeProperty('height')
    clone.setAttribute('width', Math.round(rect.width))
    clone.setAttribute('height', Math.round(rect.height))
    if (!clone.getAttribute('viewBox')) {
      clone.setAttribute('viewBox', `0 0 ${Math.round(rect.width)} ${Math.round(rect.height)}`)
    }

    // 5.3 — inline computed styles so the standalone file renders correctly
    const SELECTOR = 'g, text, tspan, line, path, rect, circle, ellipse, polygon, polyline, stop, linearGradient, radialGradient, clipPath, defs, use'
    const origEls = svgEl.querySelectorAll(SELECTOR)
    const cloneEls = clone.querySelectorAll(SELECTOR)
    const STYLE_PROPS = [
      'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity',
      'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin',
      'font-size', 'font-family', 'font-weight', 'opacity',
      'text-anchor', 'dominant-baseline',
      'stop-color', 'stop-opacity',
    ]
    origEls.forEach((origEl, i) => {
      if (!cloneEls[i]) return
      const cs = window.getComputedStyle(origEl)
      STYLE_PROPS.forEach(prop => {
        const val = cs.getPropertyValue(prop)
        if (val && val !== 'none' && val !== 'normal' && val !== '0px' && val !== 'auto') {
          cloneEls[i].setAttribute(prop, val)
        }
      })
    })

    return { clone, width: rect.width, height: rect.height }
  }

  const handleCopyToClipboard = async () => {
    try {
      const canvas = await containerToCanvas(2)
      if (!canvas) return
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Copy to clipboard failed:', err)
    }
  }

  const handleDownloadPng = async () => {
    const canvas = await containerToCanvas(2)
    if (!canvas) return
    canvas.toBlob((blob) => {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${safeName}.png`
      a.click()
      URL.revokeObjectURL(a.href)
    }, 'image/png')
  }

  const handleDownloadSvg = () => {
    const svg = getClonedSvg()
    if (!svg) return
    const svgData = new XMLSerializer().serializeToString(svg.clone)
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${safeName}.svg`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const handleDownloadPdf = async () => {
    const canvas = await containerToCanvas(2)
    if (!canvas) return
    const imgData = canvas.toDataURL('image/jpeg', 0.95)
    const { jsPDF } = await import('jspdf')
    const pdf = new jsPDF({
      orientation: canvas.width >= canvas.height ? 'landscape' : 'portrait',
      unit: 'px',
      format: [canvas.width / 2, canvas.height / 2],
      hotfixes: ['px_scaling'],
    })
    pdf.addImage(imgData, 'JPEG', 0, 0, canvas.width / 2, canvas.height / 2)
    pdf.save(`${safeName}.pdf`)
  }

  const handlePrint = () => window.print()

  // 5.5 — only close if both mousedown AND mouseup happen on the backdrop
  const handleBackdropMouseDown = (e) => {
    backdropMouseDown.current = e.target === e.currentTarget
  }
  const handleBackdropMouseUp = (e) => {
    if (backdropMouseDown.current && e.target === e.currentTarget) onClose()
    backdropMouseDown.current = false
  }

  const dlBtn = 'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors border'
  const dlStyle = 'bg-off-white border-light-grey text-navy hover:bg-light-grey/40'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={handleBackdropMouseDown}
      onMouseUp={handleBackdropMouseUp}
    >
      <div className="bg-white rounded-lg shadow-xl max-w-[95vw] max-h-[95vh] flex flex-col">
        {/* Header — action buttons + close */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-light-grey">
          <h3 className="text-sm font-medium text-navy">{title || 'Chart preview'}</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyToClipboard}
              className={`${dlBtn} ${copied
                ? 'bg-green-50 border-green-300 text-green-700'
                : 'bg-green-50/50 border-green-200 text-green-700 hover:bg-green-100'}`}
              title="Copy PNG to clipboard — paste straight into PowerPoint, Word, email"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button onClick={handleDownloadPng} className={`${dlBtn} ${dlStyle}`} title="Download as PNG (2× scale, includes legend + title)">
              <Download size={12} /> PNG
            </button>
            <button
              onClick={handleDownloadSvg}
              className={`${dlBtn} ${dlStyle}`}
              title="Download chart vectors as SVG — HTML legends not included (use PNG for a complete image)"
            >
              <FileImage size={12} /> SVG (chart only)
            </button>
            <button onClick={handleDownloadPdf} className={`${dlBtn} ${dlStyle}`} title="Download as A4-fit PDF (landscape if wider than tall)">
              <FileText size={12} /> PDF
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-navy text-white rounded hover:bg-navy/80 transition-colors"
              title="Open the browser print dialog showing only this chart"
            >
              <Printer size={12} /> Print
            </button>
            <button onClick={onClose} className="text-mid-grey hover:text-dark-grey transition-colors" title="Close (Esc)">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Resizable chart container — drag the bottom-right corner */}
        <div className="p-4 overflow-auto">
          <div
            ref={containerRef}
            className="print-target bg-white border border-light-grey rounded-lg p-4"
            style={{
              resize: 'both', overflow: 'auto',
              minWidth: 400, minHeight: 250,
              width: 800, height: 450,
              maxWidth: '90vw', maxHeight: '80vh',
            }}
          >
            {title && (
              <div className="text-xxs text-mid-grey uppercase mb-3 print-title">{title}</div>
            )}
            <div style={{ width: '100%', height: 'calc(100% - 24px)' }}>
              {children}
            </div>
          </div>
          <p className="text-xxs text-mid-grey mt-2 text-center">
            Drag the bottom-right corner to resize the chart before exporting
          </p>
        </div>
      </div>
    </div>
  )
}

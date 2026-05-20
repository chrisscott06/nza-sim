/**
 * PatchList.jsx — Brief 41 Part 4
 *
 * Renders an intervention's captured patches in plain English. Each
 * row shows:
 *   [verb chip]  [label]  [before → after]  [pct]  [remove]
 *
 * Click ✕ on a row to remove that patch. Click anywhere else on the
 * row to (placeholder for Part 4 stretch goal — patch editing
 * in-place; for now a no-op highlight on hover).
 *
 * Tone colouring on the before → after pair: green when the patch
 * direction matches a "saving" (lower value of a heating-relevant
 * input; that's a heuristic — for boolean / string patches tone is
 * neutral). When uncertain, neutral.
 */

import { X } from 'lucide-react'
import { summarizePatch } from './patchCapture.js'

const VERB_CHIPS = {
  set:     { text: 'set',     bg: '#E5E7EB', fg: '#374151' },
  add:     { text: 'add',     bg: '#DCFCE7', fg: '#166534' },
  remove:  { text: 'remove',  bg: '#FEE2E2', fg: '#991B1B' },
  replace: { text: 'replace', bg: '#FEF3C7', fg: '#92400E' },
}

function ToneArrow({ tone }) {
  const cls = tone === 'good'    ? 'text-green-600'
            : tone === 'bad'     ? 'text-red-600'
            : 'text-mid-grey'
  return <span className={`text-xxs ${cls}`}>→</span>
}

function PctBadge({ pct, tone }) {
  if (!pct) return null
  const cls = tone === 'good' ? 'text-green-600'
            : tone === 'bad'  ? 'text-red-600'
            : 'text-mid-grey'
  return <span className={`text-xxs ${cls} tabular-nums`}>{pct}</span>
}

function PatchRow({ patch, baselineConfig, libraryData, onRemove }) {
  const sum = summarizePatch(patch, baselineConfig, libraryData)
  if (!sum) return null
  const chip = VERB_CHIPS[sum.verb] ?? VERB_CHIPS.set
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-off-white/80 group">
      <span
        className="flex-shrink-0 px-1.5 py-0.5 rounded text-xxs font-medium uppercase tracking-wider"
        style={{ backgroundColor: chip.bg, color: chip.fg }}
      >
        {chip.text}
      </span>
      <span className="flex-shrink-0 text-xxs font-medium text-navy">
        {sum.label}
      </span>
      <div className="flex-1 min-w-0 flex items-center gap-1.5 truncate">
        <span className="text-xxs text-mid-grey/80 tabular-nums truncate" title={String(sum.before)}>
          {sum.before}
        </span>
        <ToneArrow tone={sum.tone} />
        <span className={`text-xxs tabular-nums truncate ${sum.tone === 'good' ? 'text-green-700 font-medium' : sum.tone === 'bad' ? 'text-red-700 font-medium' : 'text-navy'}`} title={String(sum.after)}>
          {sum.after}
        </span>
        <PctBadge pct={sum.pct} tone={sum.tone} />
      </div>
      <button
        onClick={() => onRemove?.(patch.id)}
        className="flex-shrink-0 p-0.5 rounded text-mid-grey/50 hover:text-red-600 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
        title="Remove this patch"
      >
        <X size={11} />
      </button>
    </div>
  )
}

export default function PatchList({ patches = [], baselineConfig, libraryData, onRemove }) {
  if (!Array.isArray(patches) || patches.length === 0) {
    return (
      <div className="text-xxs text-mid-grey italic px-2 py-1">
        No patches yet — make changes in the editor above and they'll appear here.
      </div>
    )
  }
  return (
    <div className="space-y-0.5">
      {patches.map(p => (
        <PatchRow
          key={p.id}
          patch={p}
          baselineConfig={baselineConfig}
          libraryData={libraryData}
          onRemove={onRemove}
        />
      ))}
    </div>
  )
}

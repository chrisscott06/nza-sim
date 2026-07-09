/**
 * CostEditorPopout.jsx — Brief 97 P5 (Interventions Studio).
 *
 * The RICS/NRM2 cost plan editor, rehomed from inline (Brief 91b) into a
 * draggable pop-out window — the SAME SchedulePopout pattern the intervention
 * and system editors use. Opened from the Library isolated view's Cost tab
 * ("Edit cost plan →", Brief 97 P3).
 *
 * Edit-then-commit (Apply-gated, mirrors the intervention editor / Brief 94 P5):
 * the pop-out owns a LOCAL draft of the cost plan; the hierarchical CostPlanEditor
 * edits the draft with live line→group→plan totals; nothing persists until Save.
 * Cancel / Esc / close discards (SchedulePopout unmounts children on close, so the
 * draft re-seeds from the saved cost on reopen). This keeps cost edits from
 * churning the global engine mid-typing — cost drives only the £/tonne + payback
 * cards, recomputed once on Save.
 */
import { useEffect, useMemo, useState } from 'react'
import SchedulePopout from '../../../shared/SchedulePopout.jsx'
import CostPlanEditor from './CostPlanEditor.jsx'
import { emptyCost, computeCostPlanTotal, instantiateTemplate } from '../../../../utils/costModel.js'
import { saveTemplate } from '../../../../utils/costReads.js'

const ACCENT = '#E84393'
const gbp0 = n => `£${Math.round(Number(n) || 0).toLocaleString('en-GB')}`

export default function CostEditorPopout({ isOpen, intervention, projectDefaults, templates = [], onTemplatesChange, onSave, onClose }) {
  const [draft, setDraft] = useState(() => intervention?.cost ?? emptyCost())

  // Re-seed when the editor switches to a different intervention while open.
  // (Close-then-reopen of the same intervention re-seeds via unmount + the
  // useState initialiser above.)
  useEffect(() => {
    setDraft(intervention?.cost ?? emptyCost())
  }, [intervention?.id])

  const total = useMemo(() => computeCostPlanTotal(draft, projectDefaults), [draft, projectDefaults])

  const handleSave = () => {
    if (intervention) onSave?.(intervention.id, draft)
    onClose?.()
  }

  // Brief 97 P7 — template apply/save (data helpers from costReads/costModel).
  const applyTemplate = (templateId) => {
    if (!templateId) return
    const tpl = templates.find(t => t.id === templateId)
    if (!tpl) return
    const hasContent = (draft.groups ?? []).some(g => (g.lines ?? []).length > 0)
    if (hasContent && !window.confirm(`Replace the current plan with template “${tpl.name}”?`)) return
    setDraft(instantiateTemplate(tpl))
  }
  const saveAsTemplate = () => {
    const name = window.prompt('Save this cost plan as a template. Name:')
    if (!name || !name.trim()) return
    const { library } = saveTemplate(name.trim(), draft, { cost_template_library: templates })
    onTemplatesChange?.(library)
  }

  return (
    <SchedulePopout
      isOpen={isOpen}
      onClose={onClose}
      title={`Cost plan: ${intervention?.label || '(untitled)'}`}
      accent={ACCENT}
      persistKey="nza-cost-editor-popout-position"
      defaultPosition="right"
    >
      <div className="flex flex-col" style={{ height: 'calc(100vh - 7rem)', maxHeight: 'calc(100vh - 7rem)' }}>
        {/* Template bar */}
        <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-light-grey/60 bg-off-white/40">
          <span className="text-[10px] uppercase tracking-wider text-mid-grey/60 font-semibold">Templates</span>
          <select
            value=""
            onChange={e => { applyTemplate(e.target.value); e.target.value = '' }}
            className="text-xs border border-light-grey rounded px-1.5 py-1 bg-white text-navy focus:outline-none focus:border-mid-grey max-w-[16rem]"
            title={templates.length ? 'Apply a saved template (replaces the current plan)' : 'No templates saved yet'}
          >
            <option value="">{templates.length ? 'Apply template…' : 'No templates yet'}</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>{t.name} · {t.group_count ?? (t.groups?.length ?? 0)}g · {t.line_count ?? 0}L</option>
            ))}
          </select>
          <button type="button" onClick={saveAsTemplate}
            className="text-xs font-medium text-navy/70 hover:text-navy underline decoration-dotted">
            Save as template…
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-3">
          <CostPlanEditor cost={draft} projectDefaults={projectDefaults} onChange={setDraft} />
        </div>
        {/* Footer: live plan total + commit / discard */}
        <div className="flex-shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-t border-light-grey bg-white">
          <div className="flex items-baseline gap-2">
            <span className="text-xxs uppercase tracking-wider text-mid-grey/60 font-semibold">Plan total</span>
            <span className="text-lg font-semibold tabular-nums text-navy">{gbp0(total)}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-mid-grey hover:text-navy hover:bg-off-white border border-light-grey"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white"
              style={{ backgroundColor: ACCENT }}
            >
              Save cost plan
            </button>
          </div>
        </div>
      </div>
    </SchedulePopout>
  )
}

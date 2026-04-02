/**
 * CreateScenarioModal.jsx
 *
 * Modal for creating a new scenario. Accepts name, optional description,
 * and source (baseline project config or copy from an existing scenario).
 */

import { useState } from 'react'
import { X } from 'lucide-react'

export default function CreateScenarioModal({ scenarios, onClose, onCreate }) {
  const [name, setName]           = useState('')
  const [description, setDesc]    = useState('')
  const [source, setSource]       = useState('baseline')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]          = useState(null)

  async function handleCreate() {
    if (!name.trim()) { setError('Name is required'); return }
    setSubmitting(true)
    setError(null)
    try {
      await onCreate({ name: name.trim(), description: description.trim() || undefined, source })
      onClose()
    } catch (err) {
      setError(err.message ?? 'Failed to create scenario')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-navy">New Scenario</h2>
          <button
            className="p-1 rounded hover:bg-light-grey text-mid-grey transition-colors"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>

        {/* Name */}
        <div className="mb-3">
          <label className="block text-xxs font-medium text-dark-grey uppercase tracking-wider mb-1">
            Name *
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Enhanced Fabric"
            className="w-full px-3 py-2 rounded-lg border border-light-grey text-caption text-navy placeholder:text-light-grey focus:outline-none focus:border-navy"
            autoFocus
          />
        </div>

        {/* Description */}
        <div className="mb-3">
          <label className="block text-xxs font-medium text-dark-grey uppercase tracking-wider mb-1">
            Description (optional)
          </label>
          <textarea
            value={description}
            onChange={e => setDesc(e.target.value)}
            placeholder="What does this scenario test?"
            rows={2}
            className="w-full px-3 py-2 rounded-lg border border-light-grey text-caption text-navy placeholder:text-light-grey focus:outline-none focus:border-navy resize-none"
          />
        </div>

        {/* Source */}
        <div className="mb-4">
          <label className="block text-xxs font-medium text-dark-grey uppercase tracking-wider mb-1">
            Copy from
          </label>
          <select
            value={source}
            onChange={e => setSource(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-light-grey text-caption text-navy focus:outline-none focus:border-navy bg-white"
          >
            <option value="baseline">Project defaults (current settings)</option>
            {scenarios.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}{s.is_baseline ? ' (Baseline)' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Error */}
        {error && (
          <p className="text-xxs text-red-500 mb-3">{error}</p>
        )}

        {/* Actions */}
        <div className="flex gap-2 justify-end">
          <button
            className="px-3 py-1.5 rounded border border-light-grey text-xxs text-dark-grey hover:bg-light-grey transition-colors"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            className="px-3 py-1.5 rounded bg-navy text-white text-xxs font-medium hover:bg-navy/80 transition-colors disabled:opacity-50"
            onClick={handleCreate}
            disabled={submitting || !name.trim()}
          >
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

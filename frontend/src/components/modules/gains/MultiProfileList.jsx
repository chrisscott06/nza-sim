/**
 * MultiProfileList.jsx — left-panel profile management for Lighting +
 * Equipment sections.
 *
 * Brief 27 Revised Part 10. Lists the v2.4 profiles[], lets the user
 * pick the active one (drives the centre-canvas Schedule tab), rename,
 * duplicate, delete, and add new profiles from the building-type-aware
 * load-type library.
 *
 * Same component shape for both Lighting + Equipment; differences are
 * injected via props:
 *   - `category` — 'lighting' | 'equipment'
 *   - `templates` — array from lightingTemplatesFor() / equipmentTemplatesFor()
 *   - `renderDetail(profile)` — caller-provided render of the per-profile
 *     detail line (magnitude × area for lighting; baseload + active × area
 *     for equipment).
 *
 * Profile editing for individual fields (magnitude, area_share,
 * relationship) is done inline via the [⋯] menu's "Edit" affordance,
 * which expands the row into a small edit panel below the header.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown, MoreHorizontal, Plus, Trash2, Copy, Edit3 } from 'lucide-react'
import { profileFromTemplate } from '../../../data/loadTypeLibrary.js'
import { SCHEDULE_PRESETS } from '../../../data/schedulePresets.js'
import MiniProfile from './MiniProfile.jsx'

// ── Click-outside hook ──────────────────────────────────────────────────────
function useClickOutside(ref, onOutside) {
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onOutside()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ref, onOutside])
}

// ── + Add profile dropdown ──────────────────────────────────────────────────
function AddProfileDropdown({ templates, onAdd, accent, disabled }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  useClickOutside(wrapRef, () => setOpen(false))

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        className="w-full flex items-center justify-center gap-1 px-2 py-1 text-xxs border border-dashed rounded transition-colors disabled:opacity-50"
        style={{ color: accent, borderColor: accent + '80' }}
      >
        <Plus size={11} /> Add profile <ChevronDown size={11} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 left-0 right-0 bg-white border border-light-grey rounded shadow-md py-1 max-h-64 overflow-y-auto">
          {templates.map(t => (
            <button
              key={t.id}
              onClick={() => { onAdd(t); setOpen(false) }}
              className="w-full text-left px-2 py-1 text-xxs hover:bg-off-white transition-colors"
            >
              <div className="text-caption text-navy">{t.label}</div>
              <div className="text-xxs text-mid-grey/70">
                {t.magnitude
                  ? `${t.magnitude.value} W/m²`
                  : `${t.baseload?.value ?? 0} + ${t.active?.value ?? 0} W/m²`}
                {' · '}
                {Math.round((t.area_share ?? 0) * 100)}% area · {(t.relationship_to_occupancy ?? '').replace(/_/g, ' ')}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Per-profile [⋯] action menu ─────────────────────────────────────────────
function ProfileActionsMenu({ onEdit, onDuplicate, onDelete, disabled }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  useClickOutside(wrapRef, () => setOpen(false))

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        disabled={disabled}
        className="p-0.5 text-mid-grey hover:text-navy transition-colors disabled:opacity-50"
        title="Profile actions"
      >
        <MoreHorizontal size={12} />
      </button>
      {open && (
        <div className="absolute z-20 right-0 mt-1 w-32 bg-white border border-light-grey rounded shadow-md py-1">
          {onEdit && (
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); setOpen(false) }}
              className="w-full flex items-center gap-1.5 px-2 py-1 text-xxs text-mid-grey hover:bg-off-white hover:text-navy transition-colors text-left"
            >
              <Edit3 size={10} /> Edit
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDuplicate(); setOpen(false) }}
            className="w-full flex items-center gap-1.5 px-2 py-1 text-xxs text-mid-grey hover:bg-off-white hover:text-navy transition-colors text-left"
          >
            <Copy size={10} /> Duplicate
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); setOpen(false) }}
            className="w-full flex items-center gap-1.5 px-2 py-1 text-xxs text-mid-grey hover:bg-red-50 hover:text-red-600 transition-colors text-left"
          >
            <Trash2 size={10} /> Delete
          </button>
        </div>
      )}
    </div>
  )
}

// ── Inline edit panel (expand-on-click within the profile row) ──────────────
function ProfileEditPanel({ profile, category, onChange, onClose }) {
  const isLighting = category === 'lighting'
  const isEquipment = category === 'equipment'

  return (
    <div className="mt-1.5 p-2 bg-off-white/60 border border-light-grey rounded space-y-1.5 text-xxs">
      <div className="flex items-center justify-between mb-0.5">
        <span className="uppercase tracking-wider text-mid-grey">Edit profile</span>
        <button onClick={onClose} className="text-mid-grey hover:text-navy text-xxs">Done</button>
      </div>
      <Field label="Label">
        <input
          type="text"
          value={profile.label ?? ''}
          onChange={e => onChange({ ...profile, label: e.target.value })}
          className="w-full px-1.5 py-0.5 border border-light-grey rounded focus:outline-none focus:border-mid-grey text-caption text-navy"
        />
      </Field>

      {isLighting && (
        <Field label="LPD">
          <NumberWithUnit
            value={profile.magnitude?.value}
            unit={profile.magnitude?.unit ?? 'w_per_m2'}
            onChange={(v, u) => onChange({ ...profile, magnitude: { value: v, unit: u } })}
          />
        </Field>
      )}

      {isEquipment && (
        <>
          <Field label="Baseload">
            <NumberWithUnit
              value={profile.baseload?.value}
              unit={profile.baseload?.unit ?? 'w_per_m2'}
              onChange={(v, u) => onChange({ ...profile, baseload: { value: v, unit: u } })}
            />
          </Field>
          <Field label="Active">
            <NumberWithUnit
              value={profile.active?.value}
              unit={profile.active?.unit ?? 'w_per_m2'}
              onChange={(v, u) => onChange({ ...profile, active: { value: v, unit: u } })}
            />
          </Field>
          <Field label="Standby">
            <PercentInput
              value={profile.standby_factor ?? 0.10}
              onChange={v => onChange({ ...profile, standby_factor: v })}
            />
          </Field>
        </>
      )}

      <Field label="Area share">
        <PercentInput
          value={profile.area_share ?? 0}
          onChange={v => onChange({ ...profile, area_share: v })}
        />
      </Field>

      <Field label="Relationship">
        <select
          value={profile.relationship_to_occupancy ?? ''}
          onChange={e => onChange({ ...profile, relationship_to_occupancy: e.target.value })}
          className="w-full px-1.5 py-0.5 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-mid-grey"
        >
          {isLighting && <option value="proportional_with_spill">proportional + spill</option>}
          <option value="proportional">proportional</option>
          <option value="independent">independent</option>
          <option value="always_on">always on</option>
        </select>
      </Field>

      {isLighting && profile.relationship_to_occupancy === 'proportional_with_spill' && (
        <Field label="Daylight factor">
          <PercentInput
            value={profile.daylight_factor ?? 0.6}
            onChange={v => onChange({ ...profile, daylight_factor: v })}
          />
        </Field>
      )}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xxs text-mid-grey w-20 flex-shrink-0">{label}</label>
      <div className="flex-1">{children}</div>
    </div>
  )
}

function NumberWithUnit({ value, unit, onChange }) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        value={value ?? 0}
        step={0.1}
        min={0}
        onChange={e => onChange(Number(e.target.value), unit)}
        className="w-16 px-1 py-0.5 text-xxs text-navy text-right tabular-nums border border-light-grey rounded focus:outline-none focus:border-mid-grey"
      />
      <select
        value={unit}
        onChange={e => onChange(value ?? 0, e.target.value)}
        className="flex-1 px-1 py-0.5 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-mid-grey"
      >
        <option value="w_per_m2">W/m²</option>
        <option value="w_per_room">W/room</option>
        <option value="total_w">W total</option>
      </select>
    </div>
  )
}

function PercentInput({ value, onChange }) {
  const pct = Math.round(((value ?? 0)) * 100)
  return (
    <div className="flex items-center gap-1">
      <input
        type="range" min={0} max={100} step={1}
        value={pct}
        onChange={e => onChange(Number(e.target.value) / 100)}
        className="flex-1 h-[3px] accent-navy"
      />
      <span className="w-9 text-xxs text-navy text-right tabular-nums">{pct}%</span>
    </div>
  )
}

// ── Main list ────────────────────────────────────────────────────────────────
export default function MultiProfileList({
  profiles,
  onProfilesChange,
  activeProfileId,
  onSelectProfile,
  onEditSchedule,
  category,             // 'lighting' | 'equipment'
  templates,            // array from lightingTemplatesFor() / equipmentTemplatesFor()
  accent,
  renderDetail,         // (profile) => ReactNode for the per-profile detail line
  annualPerProfile = [],  // annual[].kwh per profile id (from useAnnualGains)
}) {
  const [editingProfileId, setEditingProfileId] = useState(null)

  const profilesList = profiles ?? []

  const handleAdd = useCallback((template) => {
    const newProfile = profileFromTemplate(template, category, SCHEDULE_PRESETS)
    onProfilesChange([...profilesList, newProfile])
    onSelectProfile?.(newProfile.id)
  }, [profilesList, category, onProfilesChange, onSelectProfile])

  const updateProfile = useCallback((id, patch) => {
    onProfilesChange(profilesList.map(p => p.id === id ? { ...p, ...patch } : p))
  }, [profilesList, onProfilesChange])

  const handleDuplicate = useCallback((profile) => {
    const copy = {
      ...JSON.parse(JSON.stringify(profile)),
      id: `${profile.id}_copy_${Date.now().toString(36)}`,
      label: `${profile.label} (copy)`,
    }
    const idx = profilesList.findIndex(p => p.id === profile.id)
    const next = profilesList.slice()
    next.splice(idx + 1, 0, copy)
    onProfilesChange(next)
  }, [profilesList, onProfilesChange])

  const handleDelete = useCallback((id) => {
    onProfilesChange(profilesList.filter(p => p.id !== id))
    if (activeProfileId === id) {
      // Reselect first remaining profile
      const remaining = profilesList.filter(p => p.id !== id)
      onSelectProfile?.(remaining[0]?.id ?? null)
    }
    if (editingProfileId === id) setEditingProfileId(null)
  }, [profilesList, activeProfileId, editingProfileId, onProfilesChange, onSelectProfile])

  return (
    <div className="space-y-2">
      <div className="text-xxs uppercase tracking-wider text-mid-grey">
        Profiles {profilesList.length > 0 && <span className="ml-1 text-mid-grey/60">({profilesList.length})</span>}
      </div>

      <div className="space-y-1.5">
        {profilesList.map((profile) => {
          const isActive = profile.id === activeProfileId
          const isEditing = profile.id === editingProfileId
          const ann = annualPerProfile.find(a => a.id === profile.id)
          return (
            <div
              key={profile.id}
              onClick={() => onSelectProfile?.(profile.id)}
              className={`rounded border cursor-pointer transition-colors px-2 py-1.5 ${
                isActive
                  ? 'bg-white shadow-sm'
                  : 'bg-off-white/40 hover:bg-off-white border-light-grey'
              }`}
              style={{
                borderColor: isActive ? accent : undefined,
                borderLeftWidth: isActive ? '3px' : '1px',
                paddingLeft: isActive ? '7px' : '9px',
              }}
            >
              {/* Header row */}
              <div className="flex items-center gap-1">
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: accent, opacity: isActive ? 1 : 0.5 }}
                />
                <input
                  type="text"
                  value={profile.label ?? ''}
                  onChange={e => updateProfile(profile.id, { label: e.target.value })}
                  onClick={e => e.stopPropagation()}
                  className={`flex-1 min-w-0 bg-transparent text-caption font-medium focus:outline-none ${
                    isActive ? 'text-navy' : 'text-mid-grey'
                  }`}
                />
                <ProfileActionsMenu
                  onEdit={() => setEditingProfileId(isEditing ? null : profile.id)}
                  onDuplicate={() => handleDuplicate(profile)}
                  onDelete={() => handleDelete(profile.id)}
                />
              </div>

              {/* Detail line — magnitude × area × relationship */}
              <div className="text-xxs text-mid-grey/80 ml-2.5 mt-0.5 tabular-nums">
                {renderDetail(profile)}
              </div>

              {/* Annual readout per profile */}
              {ann && (
                <div className="text-xxs text-mid-grey/70 ml-2.5 mt-0.5">
                  {(ann.kwh / 1000).toFixed(1)} MWh · {ann.peak_kw.toFixed(1)} kW peak
                </div>
              )}

              {/* Mini-profile thumbnail (only for active or editing — keeps the list compact) */}
              {(isActive || isEditing) && (
                <div className="ml-2.5 mt-1">
                  <MiniProfile
                    schedule={profile.schedule}
                    accent={accent}
                    onEdit={(e) => { e?.stopPropagation?.(); onEditSchedule?.() }}
                    label="Weekday"
                  />
                </div>
              )}

              {/* Inline edit panel */}
              {isEditing && (
                <div onClick={e => e.stopPropagation()}>
                  <ProfileEditPanel
                    profile={profile}
                    category={category}
                    onChange={(next) => updateProfile(profile.id, next)}
                    onClose={() => setEditingProfileId(null)}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <AddProfileDropdown
        templates={templates}
        onAdd={handleAdd}
        accent={accent}
      />
    </div>
  )
}

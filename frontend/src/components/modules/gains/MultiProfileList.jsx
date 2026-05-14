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
import { ChevronDown, MoreHorizontal, Plus, Trash2, Copy } from 'lucide-react'
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

// ── Per-profile [⋯] action menu (Duplicate / Delete only) ──────────────────
//
// Brief 27 close-out: the "Edit" entry was removed. The active profile's
// edit fields are now visible inline by default (see ProfileEditPanel),
// matching how "schedule preset → starting point → edit in place" works
// elsewhere in the module. Library profiles + Custom profiles are
// editable the same way; provenance doesn't gate the controls.
function ProfileActionsMenu({ onDuplicate, onDelete, disabled }) {
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

// ── Inline edit panel — visible by default for the active profile ───────────
//
// Brief 27 close-out Bug 1 fix: the panel was previously gated behind a
// [⋯] → Edit click. Library profiles + Custom both arrive needing
// inspection, and the gate made library profiles read as "uneditable".
// Now the active profile renders its full editable field set inline.
// The [⋯] menu retains Duplicate / Delete only.
//
// All field rendering is unconditional on profile provenance — built-in
// templates and Custom profiles share the same controls. Relationship-
// dependent fields (spill_minutes, daylight_factor) appear when the
// chosen relationship reads them, hidden otherwise.
function ProfileEditPanel({ profile, category, onChange, accent }) {
  const isLighting  = category === 'lighting'
  const isEquipment = category === 'equipment'
  const rel         = profile.relationship_to_occupancy

  return (
    <div className="mt-2 p-2 bg-white border border-light-grey rounded space-y-1.5 text-xxs"
         style={{ borderLeftWidth: '2px', borderLeftColor: accent + '60' }}>
      {/* Magnitude — first because it's the headline parameter */}
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
        </>
      )}

      {/* Area share — independently editable per profile. Sum across
          profiles is INFORMATIONAL only; never auto-balanced. Per the
          v2.4 contract the canvas Area-coverage indicator surfaces over/
          under-coverage as a hint. */}
      <Field label="Area share">
        <PercentInput
          value={profile.area_share ?? 0}
          onChange={v => onChange({ ...profile, area_share: v })}
          allowOverflow
        />
      </Field>

      <Field label="Relationship">
        <select
          value={rel ?? ''}
          onChange={e => onChange({ ...profile, relationship_to_occupancy: e.target.value })}
          className="w-full px-1.5 py-0.5 text-xxs text-navy border border-light-grey rounded bg-white focus:outline-none focus:border-mid-grey"
        >
          {isLighting && <option value="proportional_with_spill">proportional + spill</option>}
          <option value="proportional">proportional</option>
          <option value="independent">independent</option>
          <option value="always_on">always on</option>
        </select>
      </Field>

      {/* Lighting relationship-dependent fields */}
      {isLighting && rel === 'proportional_with_spill' && (
        <>
          <Field label="Spill (min)">
            <input
              type="number" min={0} max={120} step={5}
              value={profile.spill_minutes ?? 15}
              onChange={e => onChange({ ...profile, spill_minutes: Number(e.target.value) })}
              className="w-16 px-1.5 py-0.5 text-xxs text-navy text-right tabular-nums border border-light-grey rounded focus:outline-none focus:border-mid-grey"
            />
          </Field>
          <Field label="Daylight factor">
            <PercentInput
              value={profile.daylight_factor ?? 0.6}
              onChange={v => onChange({ ...profile, daylight_factor: v })}
            />
          </Field>
        </>
      )}

      {/* Equipment-specific: standby floor */}
      {isEquipment && rel === 'proportional' && (
        <Field label="Standby">
          <PercentInput
            value={profile.standby_factor ?? 0.10}
            onChange={v => onChange({ ...profile, standby_factor: v })}
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

// Percent input. `allowOverflow` lets the user push past 100% — used for
// area_share where over-coverage is permitted (the canvas Area-coverage
// indicator flags it). Slider max is 100; the typed input box accepts any
// integer 0..200 so the user can deliberately over-allocate.
function PercentInput({ value, onChange, allowOverflow = false }) {
  const pct = Math.round(((value ?? 0)) * 100)
  const sliderMax = allowOverflow ? 100 : 100
  const inputMax  = allowOverflow ? 200 : 100
  return (
    <div className="flex items-center gap-1">
      <input
        type="range" min={0} max={sliderMax} step={1}
        value={Math.min(pct, sliderMax)}
        onChange={e => onChange(Number(e.target.value) / 100)}
        className="flex-1 h-[3px] accent-navy"
      />
      <input
        type="number" min={0} max={inputMax} step={1}
        value={pct}
        onChange={e => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onChange(Math.max(0, Math.min(inputMax, n)) / 100)
        }}
        className="w-12 px-1 py-0.5 text-xxs text-navy text-right tabular-nums border border-light-grey rounded focus:outline-none focus:border-mid-grey"
      />
      <span className="text-xxs text-mid-grey">%</span>
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
  giaM2,                  // building GIA in m^2 (for kWh/m^2.yr per-profile readout)
}) {
  const profilesList = profiles ?? []

  const handleAdd = useCallback((template) => {
    const newProfile = profileFromTemplate(template, category, SCHEDULE_PRESETS)
    onProfilesChange([...profilesList, newProfile])
    onSelectProfile?.(newProfile.id)
  }, [profilesList, category, onProfilesChange, onSelectProfile])

  // Per-profile update — surgical. Only mutates the targeted profile;
  // other profiles' fields (including area_share) are NEVER touched.
  // The v2.4 contract treats Σ area_share as informational, never
  // auto-balanced — see the Area-coverage indicator on the canvas.
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
      const remaining = profilesList.filter(p => p.id !== id)
      onSelectProfile?.(remaining[0]?.id ?? null)
    }
  }, [profilesList, activeProfileId, onProfilesChange, onSelectProfile])

  return (
    <div className="space-y-2">
      <div className="text-xxs uppercase tracking-wider text-mid-grey">
        Profiles {profilesList.length > 0 && <span className="ml-1 text-mid-grey/60">({profilesList.length})</span>}
      </div>

      <div className="space-y-1.5">
        {profilesList.map((profile) => {
          const isActive = profile.id === activeProfileId
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
              {/* Header row — label is inline-editable; [⋯] menu offers
                  Duplicate + Delete. Editing of magnitude / area share /
                  relationship etc. happens in the inline panel below
                  when this is the active profile. */}
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
                  onDuplicate={() => handleDuplicate(profile)}
                  onDelete={() => handleDelete(profile.id)}
                />
              </div>

              {/* Detail line — only shown for inactive profiles so the
                  active one's edit panel doesn't carry a redundant
                  summary above it. */}
              {!isActive && (
                <div className="text-xxs text-mid-grey/80 ml-2.5 mt-0.5 tabular-nums">
                  {renderDetail(profile)}
                </div>
              )}

              {/* Annual readout per profile */}
              {ann && (
                <div className="text-xxs text-mid-grey/70 ml-2.5 mt-0.5">
                  {(ann.kwh / 1000).toFixed(1)} MWh
                  {giaM2 ? ` · ${(ann.kwh / giaM2).toFixed(1)} kWh/m²·yr` : ''}
                  {' · '}{ann.peak_kw.toFixed(1)} kW peak
                </div>
              )}

              {/* Inline edit panel + mini-profile — visible for the ACTIVE
                  profile only (one panel open at a time keeps the left
                  panel from getting hostile when many profiles exist).
                  This is the Brief 27 close-out Bug 1 fix: previously the
                  panel was hidden behind [⋯] → Edit. */}
              {isActive && (
                <div onClick={e => e.stopPropagation()}>
                  <div className="ml-2.5 mt-1">
                    <MiniProfile
                      schedule={profile.schedule}
                      accent={accent}
                      onEdit={(e) => { e?.stopPropagation?.(); onEditSchedule?.() }}
                      label="Weekday"
                    />
                  </div>
                  <ProfileEditPanel
                    profile={profile}
                    category={category}
                    accent={accent}
                    onChange={(next) => updateProfile(profile.id, next)}
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

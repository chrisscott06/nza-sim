/**
 * ThreeDView.jsx — 3D zone model with gain heatmaps painted onto surfaces.
 *
 * Brief 27 Revised Part 11. Placeholder pending multi-zone modelling
 * (currently single-zone, so a 3D gain heatmap doesn't add information
 * over the Annual breakdown + Hourly profile tabs).
 *
 * Once multi-zone lands, this view will show per-zone gain intensity
 * via colour-painted surfaces, with profile.area_share mapping to
 * zone assignment.
 */

import { Box } from 'lucide-react'
import { useContext } from 'react'
import { ProjectContext } from '../../../../context/ProjectContext.jsx'

export default function ThreeDView() {
  const { params } = useContext(ProjectContext)
  const lProfiles = params?.gains?.lighting?.profiles  ?? []
  const eProfiles = params?.gains?.equipment?.profiles ?? []

  return (
    <div className="w-full px-6 py-8 max-w-[1100px] mx-auto">
      <div className="pb-3 border-b border-light-grey mb-4">
        <h2 className="text-base font-semibold text-navy">3D model</h2>
        <p className="text-xxs text-mid-grey mt-0.5">
          Multi-zone gain heatmap. Placeholder pending multi-zone modelling —
          the current single-zone model has uniform gain distribution across
          the envelope, so a 3D paint adds no signal.
        </p>
      </div>

      <div className="bg-white border border-light-grey rounded p-8 text-center">
        <Box size={48} strokeWidth={1.2} className="mx-auto text-mid-grey/40 mb-3" />
        <div className="text-caption text-navy font-medium mb-1">
          Single-zone model — 3D paint deferred
        </div>
        <div className="text-xxs text-mid-grey/80 leading-relaxed max-w-md mx-auto">
          {lProfiles.length + eProfiles.length} profiles configured, all
          contributing at building-wide average via <code>area_share</code>
          weighting. When multi-zone lands, profiles' <code>area_share</code>
          will assign each profile to one or more zones, and this view will
          render the resulting per-surface gain intensity.
        </div>
      </div>

      {/* Sanity check: list profiles with area shares — useful for verifying
          coverage before multi-zone is wired. */}
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="bg-white border border-light-grey rounded p-3">
          <div className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Lighting profiles</div>
          {lProfiles.length === 0 ? (
            <p className="text-xxs italic text-mid-grey/70">No profiles configured.</p>
          ) : (
            <div className="space-y-1 text-caption">
              {lProfiles.map(p => (
                <div key={p.id} className="flex justify-between">
                  <span className="text-navy truncate">{p.label}</span>
                  <span className="text-mid-grey tabular-nums">{Math.round((p.area_share ?? 0) * 100)}% area</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-light-grey pt-1 mt-1 text-xxs">
                <span className="text-mid-grey">Sum</span>
                <span className="tabular-nums text-navy font-medium">
                  {Math.round(lProfiles.reduce((s, p) => s + Number(p.area_share ?? 0), 0) * 100)}%
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="bg-white border border-light-grey rounded p-3">
          <div className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Equipment profiles</div>
          {eProfiles.length === 0 ? (
            <p className="text-xxs italic text-mid-grey/70">No profiles configured.</p>
          ) : (
            <div className="space-y-1 text-caption">
              {eProfiles.map(p => (
                <div key={p.id} className="flex justify-between">
                  <span className="text-navy truncate">{p.label}</span>
                  <span className="text-mid-grey tabular-nums">{Math.round((p.area_share ?? 0) * 100)}% area</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-light-grey pt-1 mt-1 text-xxs">
                <span className="text-mid-grey">Sum</span>
                <span className="tabular-nums text-navy font-medium">
                  {Math.round(eProfiles.reduce((s, p) => s + Number(p.area_share ?? 0), 0) * 100)}%
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

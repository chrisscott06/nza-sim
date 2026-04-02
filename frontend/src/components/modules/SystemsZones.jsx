import { useState, useContext } from 'react'
import ExplorerLayout from '../ui/ExplorerLayout.jsx'
import TabBar from '../ui/TabBar.jsx'
import HVACTab from './systems/HVACTab.jsx'
import VentilationTab from './systems/VentilationTab.jsx'
import DHWTab from './systems/DHWTab.jsx'
import LightingTab from './systems/LightingTab.jsx'
import { ProjectContext } from '../../context/ProjectContext.jsx'

const TABS = [
  { id: 'hvac',        label: 'HVAC'        },
  { id: 'ventilation', label: 'Ventilation'  },
  { id: 'dhw',         label: 'DHW'         },
  { id: 'lighting',    label: 'Lighting'     },
]

// Summary panel shown in the main area
function SystemsSummary({ systems, params }) {
  const gia = params.length * params.width * params.num_floors

  const cards = [
    {
      label: 'Simulation mode',
      value: systems.mode === 'ideal' ? 'Ideal Loads' : 'Detailed',
      sub:   systems.mode === 'ideal' ? '100% efficient — fabric only' : 'Real system efficiencies',
      color: 'text-teal',
    },
    {
      label: 'HVAC system',
      value: systems.hvac_type?.replace(/_/g, ' ') ?? '—',
      sub:   systems.mode === 'detailed' && systems.hvac_cop_override
        ? `COP override: ${systems.hvac_cop_override}`
        : null,
      color: 'text-navy',
    },
    {
      label: 'Ventilation',
      value: systems.ventilation_type?.replace(/_/g, ' ') ?? '—',
      sub:   systems.natural_ventilation
        ? `+ openable windows (≥ ${systems.natural_vent_threshold}°C)`
        : 'No natural ventilation',
      color: 'text-navy',
    },
    {
      label: 'DHW primary',
      value: systems.dhw_primary?.replace(/_/g, ' ') ?? '—',
      sub:   systems.dhw_preheat && systems.dhw_preheat !== 'none'
        ? `Preheat: ${systems.dhw_preheat.replace(/_/g, ' ')}`
        : 'No preheat',
      color: 'text-navy',
    },
    {
      label: 'Lighting',
      value: `${systems.lighting_power_density ?? 8} W/m²`,
      sub:   systems.lighting_control?.replace(/_/g, ' ') ?? '—',
      color: 'text-navy',
    },
    {
      label: 'GIA',
      value: `${gia.toLocaleString()} m²`,
      sub:   `${params.num_floors} floors × ${params.length}m × ${params.width}m`,
      color: 'text-mid-grey',
    },
  ]

  return (
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-body font-medium text-navy">Systems Configuration</h2>
        <p className="text-caption text-mid-grey mt-0.5">
          Current system selections — edit in the sidebar tabs
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {cards.map(c => (
          <div key={c.label} className="bg-white rounded-lg border border-light-grey p-4">
            <p className="text-xxs uppercase tracking-wider text-mid-grey mb-1">{c.label}</p>
            <p className={`text-caption font-medium capitalize ${c.color}`}>{c.value}</p>
            {c.sub && <p className="text-xxs text-mid-grey mt-0.5 capitalize">{c.sub}</p>}
          </div>
        ))}
      </div>

      {/* Mode explanation */}
      <div className={`rounded-lg border p-4 ${
        systems.mode === 'ideal'
          ? 'bg-teal/5 border-teal/20'
          : 'bg-gold/5 border-gold/20'
      }`}>
        <p className={`text-caption font-medium ${systems.mode === 'ideal' ? 'text-teal' : 'text-gold'}`}>
          {systems.mode === 'ideal' ? 'Ideal Loads mode' : 'Detailed Systems mode'}
        </p>
        <p className="text-xxs text-mid-grey mt-1 leading-relaxed">
          {systems.mode === 'ideal'
            ? 'EnergyPlus will use ideal (100% efficient) heating and cooling. The simulation shows pure building demand — useful for comparing fabric options without system efficiency masking the results. Switch to Detailed Systems to apply real COP and EER values.'
            : 'EnergyPlus will apply real system efficiencies. Heating energy is divided by COP, cooling by EER. The EUI will be higher than in Ideal mode. This is the correct mode for final energy reporting and ESOS/TM54 compliance.'}
        </p>
      </div>

      {/* Natural ventilation warning */}
      {systems.natural_ventilation && (
        <div className="bg-gold/10 border border-gold/30 rounded-lg p-4">
          <p className="text-caption font-medium text-navy">Natural ventilation active</p>
          <p className="text-xxs text-mid-grey mt-1 leading-relaxed">
            Openable windows are modelled in all bedroom zones. Windows open when indoor temperature
            exceeds {systems.natural_vent_threshold}°C during occupied hours. In summer this interacts
            with VRF cooling — EnergyPlus will balance both simultaneously. Run a comparison simulation
            with windows disabled to quantify the effect.
          </p>
        </div>
      )}
    </div>
  )
}

function SystemsSidebar({ activeTab, onTabChange }) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-1 border-b border-light-grey">
        <p className="text-caption font-medium text-navy">Systems & Zones</p>
        <p className="text-xxs text-mid-grey mt-0.5">HVAC, ventilation, DHW and lighting</p>
      </div>

      <TabBar
        tabs={TABS}
        active={activeTab}
        onChange={onTabChange}
        accentColor="#2B2A4C"
        className="px-0"
      />

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {activeTab === 'hvac'        && <HVACTab />}
        {activeTab === 'ventilation' && <VentilationTab />}
        {activeTab === 'dhw'         && <DHWTab />}
        {activeTab === 'lighting'    && <LightingTab />}
      </div>
    </div>
  )
}

export default function SystemsZones() {
  const [activeTab, setActiveTab] = useState('hvac')
  const { systems, params } = useContext(ProjectContext)

  return (
    <ExplorerLayout
      sidebarWidth="w-80"
      sidebar={
        <SystemsSidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      }
    >
      <SystemsSummary systems={systems} params={params} />
    </ExplorerLayout>
  )
}

import { useState } from 'react'
import ExplorerLayout from '../../ui/ExplorerLayout.jsx'
import TabBar from '../../ui/TabBar.jsx'
import GeometryTab from './GeometryTab.jsx'
import FabricTab from './FabricTab.jsx'
import SummaryTab from './SummaryTab.jsx'

const TABS = [
  { id: 'geometry', label: 'Geometry' },
  { id: 'fabric',   label: 'Fabric'   },
  { id: 'summary',  label: 'Summary'  },
]

function BuildingSidebar({ activeTab, onTabChange }) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-1 border-b border-light-grey">
        <p className="text-caption font-medium text-navy">Building Definition</p>
        <p className="text-xxs text-mid-grey mt-0.5">Parametric geometry and fabric</p>
      </div>

      <TabBar
        tabs={TABS}
        active={activeTab}
        onChange={onTabChange}
        accentColor="#2B2A4C"
        className="px-0"
      />

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {activeTab === 'geometry' && <GeometryTab />}
        {activeTab === 'fabric'   && <FabricTab />}
        {activeTab === 'summary'  && <SummaryTab />}
      </div>
    </div>
  )
}

export default function BuildingDefinition() {
  const [activeTab, setActiveTab] = useState('geometry')

  return (
    <ExplorerLayout
      sidebarWidth="w-80"
      sidebar={
        <BuildingSidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      }
    >
      {/* Main area — 3D viewer will go here in Part 5 */}
      <div className="flex items-center justify-center h-full text-mid-grey select-none">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 mx-auto rounded-xl bg-white border border-light-grey flex items-center justify-center opacity-40">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>
          <p className="text-body font-medium text-dark-grey">3D Viewer</p>
          <p className="text-caption text-mid-grey max-w-xs">
            Interactive building model coming in Part 5.
          </p>
        </div>
      </div>
    </ExplorerLayout>
  )
}

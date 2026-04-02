import { useContext } from 'react'
import { BuildingContext } from '../../../context/BuildingContext.jsx'
import DataCard from '../../ui/DataCard.jsx'

function Row({ label, value, unit }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-light-grey last:border-0">
      <span className="text-caption text-mid-grey">{label}</span>
      <span className="text-caption text-navy font-medium">
        {value}{unit ? <span className="text-xxs text-mid-grey ml-1">{unit}</span> : null}
      </span>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">{title}</p>
      <div className="bg-white rounded-lg border border-light-grey px-3">
        {children}
      </div>
    </div>
  )
}

export default function SummaryTab() {
  const { params, constructions } = useContext(BuildingContext)
  const {
    name, length, width, num_floors, floor_height, orientation, wwr,
  } = params

  const gia    = length * width * num_floors
  const vol    = gia * floor_height
  const wall   = 2 * (length + width) * floor_height * num_floors
  const avgWWR = ((wwr.north + wwr.south + wwr.east + wwr.west) / 4 * 100).toFixed(0)
  const glaz   = wall * (wwr.north + wwr.south + wwr.east + wwr.west) / 4
  const compactness = (vol > 0) ? (wall / vol).toFixed(3) : '—'

  const wwrLabel = dir =>
    `${(wwr[dir] * 100).toFixed(0)}%`

  const constructionNames = {
    external_wall: constructions?.external_wall ?? '—',
    roof:          constructions?.roof          ?? '—',
    ground_floor:  constructions?.ground_floor  ?? '—',
    glazing:       constructions?.glazing        ?? '—',
  }

  return (
    <div className="p-3 space-y-4">
      {/* Identity */}
      <Section title="Identity">
        <Row label="Building name" value={name || '(unnamed)'} />
      </Section>

      {/* Geometry */}
      <Section title="Geometry">
        <Row label="Length"         value={length}       unit="m"  />
        <Row label="Width"          value={width}        unit="m"  />
        <Row label="Floors"         value={num_floors}             />
        <Row label="Floor height"   value={floor_height} unit="m"  />
        <Row label="Orientation"    value={`${orientation}°`}      />
      </Section>

      {/* WWR */}
      <Section title="Window-to-wall ratio">
        <Row label="North" value={wwrLabel('north')} />
        <Row label="South" value={wwrLabel('south')} />
        <Row label="East"  value={wwrLabel('east')}  />
        <Row label="West"  value={wwrLabel('west')}  />
        <Row label="Average" value={`${avgWWR}%`}    />
      </Section>

      {/* Constructions */}
      <Section title="Fabric selections">
        <Row label="External wall"  value={constructionNames.external_wall} />
        <Row label="Roof"           value={constructionNames.roof}          />
        <Row label="Ground floor"   value={constructionNames.ground_floor}  />
        <Row label="Glazing"        value={constructionNames.glazing}       />
      </Section>

      {/* Derived metrics */}
      <div>
        <p className="text-xxs uppercase tracking-wider text-mid-grey mb-2">Derived metrics</p>
        <div className="grid grid-cols-2 gap-2">
          <DataCard label="GIA"          value={Math.round(gia).toLocaleString()}  unit="m²" accent="navy"         />
          <DataCard label="Volume"       value={Math.round(vol).toLocaleString()}  unit="m³" accent="teal"         />
          <DataCard label="Envelope"     value={Math.round(wall).toLocaleString()} unit="m²" accent="gold"         />
          <DataCard label="Glazing"      value={Math.round(glaz).toLocaleString()} unit="m²" accent="cooling-blue" />
          <DataCard label="Avg WWR"      value={`${avgWWR}%`}                                accent="coral"        />
          <DataCard label="Compactness"  value={compactness}                        unit="m⁻¹" accent="slate"      />
        </div>
      </div>
    </div>
  )
}

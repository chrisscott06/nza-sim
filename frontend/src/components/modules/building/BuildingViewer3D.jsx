import { useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Grid, Environment } from '@react-three/drei'
import * as THREE from 'three'

/* ── Colour palette matching Pablo design system ──────────────────────────── */
const COLORS = {
  wall:    '#2B2A4C',   // navy
  roof:    '#4A496A',   // navy lighter
  floor:   '#E6E6E6',   // light-grey
  glazing: '#00AEEF44', // teal translucent
  glazingEdge: '#00AEEF',
}

/* ── Building geometry from params ────────────────────────────────────────── */
function Building({ params }) {
  const { length, width, num_floors, floor_height, wwr } = params

  const totalHeight = num_floors * floor_height

  // Derived
  const hw = length / 2
  const hd = width / 2

  // Window height as proportion of floor height (leaving sill + head clearance)
  const winHeightFraction = 0.6
  const winSill = floor_height * 0.2

  // Glass panels per facade
  const GlassFace = useMemo(() => {
    return function GlassFaceInner({ axis, sign, wwr: wwrFace, faceW, faceD }) {
      if (!wwrFace || wwrFace < 0.01) return null

      const winW  = faceW * wwrFace * 0.95   // slight inset
      const winH  = floor_height * winHeightFraction
      const winY0 = winSill
      const panels = []

      for (let f = 0; f < num_floors; f++) {
        const cy = f * floor_height + winY0 + winH / 2

        // position offset per axis
        const px = axis === 'x' ? sign * (hd + 0.005) : 0
        const pz = axis === 'z' ? sign * (hw + 0.005) : 0

        panels.push(
          <mesh key={f} position={[
            axis === 'z' ? 0 : px,
            cy,
            axis === 'x' ? 0 : pz,
          ]} rotation={axis === 'z' ? [0, 0, 0] : [0, Math.PI / 2, 0]}>
            <planeGeometry args={[winW, winH]} />
            <meshStandardMaterial
              color={COLORS.glazing.slice(0, 7)}
              transparent
              opacity={0.35}
              side={THREE.DoubleSide}
            />
          </mesh>
        )
      }
      return <>{panels}</>
    }
  }, [num_floors, floor_height, winHeightFraction, winSill, hd, hw])

  // Floor-line edges for depth
  const floorLines = useMemo(() => {
    const lines = []
    for (let f = 1; f < num_floors; f++) {
      const y = f * floor_height
      const pts = [
        new THREE.Vector3(-hd, y, -hw),
        new THREE.Vector3( hd, y, -hw),
        new THREE.Vector3( hd, y,  hw),
        new THREE.Vector3(-hd, y,  hw),
        new THREE.Vector3(-hd, y, -hw),
      ]
      const geom = new THREE.BufferGeometry().setFromPoints(pts)
      lines.push(<line key={f} geometry={geom}>
        <lineBasicMaterial color="#ffffff" opacity={0.15} transparent />
      </line>)
    }
    return lines
  }, [num_floors, floor_height, hd, hw])

  return (
    <group position={[0, 0, 0]}>
      {/* Main building box */}
      <mesh position={[0, totalHeight / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, totalHeight, length]} />
        <meshStandardMaterial color={COLORS.wall} roughness={0.7} metalness={0.1} />
      </mesh>

      {/* Roof cap — slightly wider for overhang effect */}
      <mesh position={[0, totalHeight + 0.05, 0]}>
        <boxGeometry args={[width + 0.3, 0.1, length + 0.3]} />
        <meshStandardMaterial color={COLORS.roof} roughness={0.8} />
      </mesh>

      {/* Ground plane under building */}
      <mesh position={[0, -0.02, 0]} receiveShadow>
        <boxGeometry args={[width, 0.04, length]} />
        <meshStandardMaterial color={COLORS.floor} roughness={1} />
      </mesh>

      {/* Floor lines */}
      {floorLines}

      {/* Glazing — North face (positive Z) */}
      <GlassFace axis="z" sign={1} wwr={wwr.north} faceW={width} faceD={length} />
      {/* Glazing — South face (negative Z) */}
      <GlassFace axis="z" sign={-1} wwr={wwr.south} faceW={width} faceD={length} />
      {/* Glazing — East face (positive X) */}
      <GlassFace axis="x" sign={1} wwr={wwr.east} faceW={length} faceD={width} />
      {/* Glazing — West face (negative X) */}
      <GlassFace axis="x" sign={-1} wwr={wwr.west} faceW={length} faceD={width} />
    </group>
  )
}

/* ── Orientation indicator — thin compass needle on ground ─────────────────── */
function OrientationIndicator({ orientation }) {
  const rad = (orientation * Math.PI) / 180
  const len = 8
  const nx = Math.sin(rad) * len
  const nz = -Math.cos(rad) * len

  const pts = [new THREE.Vector3(0, 0.05, 0), new THREE.Vector3(nx, 0.05, nz)]
  const geom = useMemo(() => new THREE.BufferGeometry().setFromPoints(pts), [nx, nz])

  return (
    <group>
      <line geometry={geom}>
        <lineBasicMaterial color="#00AEEF" />
      </line>
      {/* N label sphere */}
      <mesh position={[nx, 0.3, nz]}>
        <sphereGeometry args={[0.25, 8, 8]} />
        <meshStandardMaterial color="#00AEEF" />
      </mesh>
    </group>
  )
}

/* ── Camera auto-fit based on building size ────────────────────────────────── */
function CameraRig({ params }) {
  const { length, width, num_floors, floor_height } = params
  const maxDim = Math.max(length, width, num_floors * floor_height)
  // Camera starts at a nice 3/4 angle
  const dist = maxDim * 2.2

  return (
    <OrbitControls
      makeDefault
      target={[0, (num_floors * floor_height) / 2, 0]}
      minDistance={5}
      maxDistance={dist * 3}
      enablePan={true}
      enableDamping={true}
      dampingFactor={0.08}
    />
  )
}

/* ── Main viewer component ─────────────────────────────────────────────────── */
export default function BuildingViewer3D({ params }) {
  const { length, width, num_floors, floor_height, orientation } = params
  const maxDim  = Math.max(length, width, num_floors * floor_height)
  const camDist = maxDim * 2.2
  const midH    = (num_floors * floor_height) / 2

  return (
    <div className="w-full h-full" style={{ background: '#F5F5F7' }}>
      <Canvas
        shadows
        camera={{
          position: [camDist * 0.6, camDist * 0.5, camDist * 0.8],
          fov: 45,
          near: 0.1,
          far: 2000,
        }}
        gl={{ antialias: true }}
      >
        {/* Lighting */}
        <ambientLight intensity={0.6} />
        <directionalLight
          position={[50, 80, 30]}
          intensity={1.2}
          castShadow
          shadow-mapSize={[2048, 2048]}
        />
        <directionalLight position={[-30, 40, -20]} intensity={0.4} />

        {/* Rotate building group by orientation */}
        <group rotation={[0, (-orientation * Math.PI) / 180, 0]}>
          <Building params={params} />
          <OrientationIndicator orientation={0} />
        </group>

        {/* Ground grid */}
        <Grid
          args={[200, 200]}
          cellSize={5}
          cellThickness={0.5}
          cellColor="#C8C8C8"
          sectionSize={25}
          sectionThickness={1}
          sectionColor="#AAAAAA"
          fadeDistance={150}
          fadeStrength={1}
          position={[0, -0.01, 0]}
        />

        <CameraRig params={params} />
      </Canvas>

      {/* Overlay — building metrics */}
      <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm rounded-lg border border-light-grey px-3 py-2 space-y-0.5 pointer-events-none">
        <p className="text-xxs uppercase tracking-wider text-mid-grey">Model</p>
        <p className="text-caption text-navy font-medium">
          {length}m × {width}m × {num_floors} fl
        </p>
        <p className="text-xxs text-mid-grey">
          {(length * width * num_floors).toLocaleString()} m² GIA
        </p>
      </div>

      {/* Orbit hint */}
      <div className="absolute bottom-3 left-3 text-xxs text-mid-grey/60 pointer-events-none select-none">
        Drag to orbit · Scroll to zoom · Right-drag to pan
      </div>
    </div>
  )
}

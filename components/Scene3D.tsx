import React, { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Text, Line, Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { LayoutNode, PickingTask, WarehouseLayout, Unit } from '../types';

interface SceneProps {
  visualLayout: WarehouseLayout | null;
  layoutCoords: Map<string, LayoutNode>;
  tasks: PickingTask[];
  searchResults: LayoutNode[];
  focusedTaskIndex: number | null;
}

const RackUnit: React.FC<{ unit: Unit; colors: Record<string, string> }> = ({ unit, colors }) => {
  const { levels, bays, size } = unit.params;
  const levelConfig = unit.params.levelConfig || [];

  // Determine dimensions
  let maxBays = bays;
  let maxBins = unit.params.bins;
  
  if (levelConfig.length > 0) {
    maxBays = Math.max(...levelConfig.map(l => l.bays));
    maxBins = Math.max(...levelConfig.map(l => l.bins));
  }

  const rackWidth = maxBays * size;
  const rackHeight = levels * size;
  const rackDepth = maxBins * size;

  const typeColor = colors[unit.typeId] || '#999';

  // Generate shelf plates (Solid)
  const shelves = [];
  for (let l = 0; l <= levels; l++) {
    shelves.push(
      <mesh key={`shelf-${l}`} position={[0, l * size, 0]}>
        <boxGeometry args={[rackWidth, 0.05, rackDepth]} />
        <meshLambertMaterial color="#546e7a" />
      </mesh>
    );
  }

  // Generate uprights (Pillars)
  const halfW = rackWidth / 2;
  const halfD = rackDepth / 2;
  const halfH = rackHeight / 2;
  
  const uprightPositions = [
    [-halfW, halfH, -halfD],
    [halfW, halfH, -halfD],
    [-halfW, halfH, halfD],
    [halfW, halfH, halfD]
  ];

  const uprights = uprightPositions.map((pos, idx) => (
    <mesh key={`u${idx}`} position={[pos[0], pos[1], pos[2]]}>
      <boxGeometry args={[0.1, rackHeight, 0.1]} />
      <meshLambertMaterial color="#37474f" />
    </mesh>
  ));

  // Contents (Bins/Slots) - Using Wireframe for performance and stability
  const contents = [];
  for (let l = 0; l < levels; l++) {
     const currentLevelConfig = levelConfig[l] || { bays: bays, bins: unit.params.bins };
     const levelBays = currentLevelConfig.bays;
     const levelBins = currentLevelConfig.bins;
     
     const bayWidth = rackWidth / levelBays;
     const binDepth = rackDepth / levelBins;

     for (let b = 0; b < levelBays; b++) {
        for (let d = 0; d < levelBins; d++) {
           const x = -halfW + (b * bayWidth) + (bayWidth/2);
           const y = (l * size) + (size/2);
           const z = -halfD + (d * binDepth) + (binDepth/2);

           contents.push(
              <group key={`item-${l}-${b}-${d}`} position={[x, y, z]}>
                 {/* Semi-transparent fill */}
                 <mesh>
                    <boxGeometry args={[bayWidth * 0.9, size * 0.8, binDepth * 0.9]} />
                    <meshBasicMaterial color={typeColor} transparent opacity={0.15} depthWrite={false} />
                 </mesh>
                 {/* Wireframe outline - extremely stable */}
                 <mesh>
                     <boxGeometry args={[bayWidth * 0.9, size * 0.8, binDepth * 0.9]} />
                     <meshBasicMaterial color={typeColor} wireframe transparent opacity={0.3} />
                 </mesh>
              </group>
           );
        }
     }
  }

  return (
    <group position={[unit.posX, 0, unit.posZ]} rotation={[0, -unit.rotY, 0]}>
       {shelves}
       {uprights}
       {contents}
    </group>
  );
};

const WarehouseContent: React.FC<SceneProps> = ({ visualLayout, layoutCoords, tasks, searchResults, focusedTaskIndex }) => {
  
  const typeColors: Record<string, string> = useMemo(() => {
     const map: Record<string, string> = {};
     visualLayout?.storageTypes.forEach(t => {
        map[t.id] = t.color;
     });
     return map;
  }, [visualLayout]);

  // Dynamic Floor Generation
  const floorMeshes = useMemo(() => {
    if (!visualLayout) return [];

    return visualLayout.floors.map(floor => {
        const floorUnits = visualLayout.units.filter(u => u.floorIndex === floor.id);
        
        if (floorUnits.length === 0) return null;

        // Calculate bounds
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        
        floorUnits.forEach(u => {
            minX = Math.min(minX, u.posX);
            maxX = Math.max(maxX, u.posX);
            minZ = Math.min(minZ, u.posZ);
            maxZ = Math.max(maxZ, u.posZ);
        });

        // Add padding
        const padding = 10;
        const width = (maxX - minX) + padding * 2;
        const depth = (maxZ - minZ) + padding * 2;
        const centerX = (minX + maxX) / 2;
        const centerZ = (minZ + maxZ) / 2;

        const finalWidth = Math.max(width, 40);
        const finalDepth = Math.max(depth, 40);
        const gridSize = Math.max(finalWidth, finalDepth);

        return (
            <group key={floor.id}>
                {/* Floor Plane */}
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[centerX, -0.1, centerZ]}>
                    <planeGeometry args={[finalWidth, finalDepth]} />
                    <meshStandardMaterial color="#1a2332" roughness={0.8} />
                </mesh>
                
                {/* Grid Helper - RESTORED */}
                <gridHelper 
                    args={[gridSize, Math.round(gridSize / 2), 0x2d3a4b, 0x2d3a4b]} 
                    position={[centerX, 0.01, centerZ]} 
                />
                
                {/* Floor Label */}
                <Text 
                    position={[centerX, 0.2, minZ - 5]} 
                    rotation={[-Math.PI / 2, 0, 0]} 
                    fontSize={3} 
                    color="#4fc3f7"
                    fillOpacity={0.5}
                >
                    {floor.name.toUpperCase()}
                </Text>
            </group>
        );
    });
  }, [visualLayout]);

  const pathPoints = useMemo(() => {
    if (tasks.length === 0) return [];
    const points: THREE.Vector3[] = [];
    const startX = tasks[0].coordinates.x;
    const startZ = tasks[0].coordinates.z + 5; 
    points.push(new THREE.Vector3(startX, 1.5, startZ)); 
    
    tasks.forEach(t => {
      points.push(new THREE.Vector3(t.coordinates.x, t.coordinates.y, t.coordinates.z));
    });
    return points;
  }, [tasks]);

  return (
    <>
      <OrbitControls makeDefault dampingFactor={0.1} />
      <ambientLight intensity={0.7} />
      <pointLight position={[0, 50, 0]} intensity={0.5} />
      <directionalLight position={[100, 100, 50]} intensity={0.8} castShadow />

      {floorMeshes}

      {visualLayout?.units.map((unit) => (
         <RackUnit key={unit.id} unit={unit} colors={typeColors} />
      ))}

      {/* Picking Tasks Highlights */}
      {tasks.map((task, idx) => {
        const isFocused = focusedTaskIndex === idx;
        const color = isFocused ? "#00e676" : "#ff9800"; 
        const scale = isFocused ? 1.8 : 1.2;
        
        return (
          <group key={`task-${idx}`} position={[task.coordinates.x, task.coordinates.y, task.coordinates.z]}>
             <mesh position={[0, 0, 0]} scale={[scale, scale, scale]}>
              <boxGeometry args={[0.5, 0.5, 0.5]} />
              <meshStandardMaterial 
                 color={color} 
                 emissive={color} 
                 emissiveIntensity={isFocused ? 2 : 0.5}
              />
            </mesh>
            
            {isFocused && (
               <Billboard position={[0, 2.5, 0]}>
                  <Text fontSize={1.2} color="#ffeb3b" outlineWidth={0.1} outlineColor="#000000" fontWeight="bold">
                     {`RECOLHER: ${task.qtyToPick}x`}
                  </Text>
                  <Text position={[0, -0.8, 0]} fontSize={0.8} color="#00e676" outlineWidth={0.05} outlineColor="#000000">
                     {task.bin}
                  </Text>
               </Billboard>
            )}
          </group>
        );
      })}

      {searchResults.map((node, idx) => (
         <group key={`search-${idx}`} position={[node.x, node.y, node.z]}>
            <mesh scale={[1.5, 1.5, 1.5]}>
               <sphereGeometry args={[0.4, 16, 16]} />
               <meshStandardMaterial color="#29b6f6" emissive="#29b6f6" emissiveIntensity={1} />
            </mesh>
            <Billboard position={[0, 1.2, 0]}>
               <Text fontSize={0.8} color="#29b6f6" outlineWidth={0.05} outlineColor="#000000">
                  {node.bin}
               </Text>
            </Billboard>
         </group>
      ))}

      {pathPoints.length > 1 && (
        <Line
          points={pathPoints}
          color="#ffff00"
          lineWidth={4}
          opacity={0.7}
          transparent
          dashed={false}
        />
      )}
    </>
  );
};

export const Scene3D: React.FC<SceneProps> = (props) => {
  return (
    <div className="w-full h-full bg-[#0f131a]">
      <Canvas camera={{ position: [0, 60, 80], fov: 45 }}>
        <WarehouseContent {...props} />
      </Canvas>
    </div>
  );
};
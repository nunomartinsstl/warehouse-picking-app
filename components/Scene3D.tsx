import React, { useMemo, useEffect, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Text, Line, Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { LayoutNode, PickingTask, WarehouseLayout, Unit } from '../types';
import { FLOORS } from '../utils/optimizer';

interface SceneProps {
  visualLayout: WarehouseLayout | null;
  layoutCoords: Map<string, LayoutNode>;
  tasks: PickingTask[];
  searchResults: LayoutNode[];
  focusedTaskIndex: number | null;
  activePathStart?: { x: number; y: number; z: number }; 
  visibleFloor: number | null; // New prop to control floor visibility
}

const DoorMarker: React.FC<{ position: { x: number, y: number, z: number }, rotation: number, label: string }> = ({ position, rotation, label }) => {
    return (
        <group position={[position.x, position.y, position.z]} rotation={[0, rotation, 0]}>
            {/* Door Frame */}
            <mesh position={[0, 2, 0]}>
                <boxGeometry args={[4, 4, 0.5]} />
                <meshStandardMaterial color="#00bcd4" emissive="#00bcd4" emissiveIntensity={0.5} transparent opacity={0.2} />
                <lineSegments>
                    <edgesGeometry args={[new THREE.BoxGeometry(4, 4, 0.5)]} />
                    <lineBasicMaterial color="#00bcd4" />
                </lineSegments>
            </mesh>
            {/* Label */}
            <Billboard position={[0, 5, 0]}>
                <Text fontSize={1.5} color="#00bcd4" outlineWidth={0.1} outlineColor="#000000" fontWeight="bold">
                    {label}
                </Text>
            </Billboard>
        </group>
    );
};

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

  // Contents (Bins/Slots)
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
                 <mesh>
                    <boxGeometry args={[bayWidth * 0.9, size * 0.8, binDepth * 0.9]} />
                    <meshBasicMaterial color={typeColor} transparent opacity={0.15} depthWrite={false} />
                 </mesh>
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

const WarehouseContent: React.FC<SceneProps> = ({ visualLayout, layoutCoords, tasks, searchResults, focusedTaskIndex, activePathStart, visibleFloor }) => {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);
  
  const typeColors: Record<string, string> = useMemo(() => {
     const map: Record<string, string> = {};
     visualLayout?.storageTypes.forEach(t => {
        map[t.id] = t.color;
     });
     return map;
  }, [visualLayout]);

  // Handle Camera Movement when floor changes
  useEffect(() => {
    if (!visualLayout) return;

    let target = new THREE.Vector3(60, 0, 0);
    let pos = new THREE.Vector3(60, 100, 100);

    if (visibleFloor !== null) {
        // Calculate center of the visible floor units
        const units = visualLayout.units.filter(u => u.floorIndex === visibleFloor);
        if (units.length > 0) {
             const xs = units.map(u => u.posX);
             const zs = units.map(u => u.posZ);
             const minX = Math.min(...xs);
             const maxX = Math.max(...xs);
             const minZ = Math.min(...zs);
             const maxZ = Math.max(...zs);
             
             target.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
             
             // Dynamic zoom based on floor size - Significantly increased multipliers
             const sizeX = maxX - minX;
             const sizeZ = maxZ - minZ;
             const maxDim = Math.max(sizeX, sizeZ);
             
             // Set camera position to frame the floor - Higher and further back
             pos.set(target.x, maxDim * 2.0 + 80, target.z + maxDim * 1.8 + 80);
        } else {
             // Fallback using FLOORS definition if empty
             const f = FLOORS.find(fl => fl.id === visibleFloor);
             if(f) {
                 target.set(f.start.x, 0, f.start.z);
                 pos.set(f.start.x, 150, f.start.z + 150);
             }
        }
    } else {
        // Center on whole warehouse (Default view)
        target.set(60, 0, -10);
        pos.set(60, 200, 200);
    }

    if (controlsRef.current) {
        controlsRef.current.target.copy(target);
        controlsRef.current.update();
    }
    
    // Snap camera to new position
    camera.position.copy(pos);
    camera.lookAt(target);

  }, [visibleFloor, visualLayout, camera]);

  // Dynamic Floor Generation
  const floorMeshes = useMemo(() => {
    if (!visualLayout) return [];

    return visualLayout.floors
        .filter(f => visibleFloor === null || f.id === visibleFloor)
        .map(floor => {
            const floorUnits = visualLayout.units.filter(u => u.floorIndex === floor.id);
            const floorDef = FLOORS.find(fl => fl.id === floor.id);

            // Calculate bounding box including units AND the door
            let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
            
            if (floorUnits.length > 0) {
                floorUnits.forEach(u => {
                    minX = Math.min(minX, u.posX);
                    maxX = Math.max(maxX, u.posX);
                    minZ = Math.min(minZ, u.posZ);
                    maxZ = Math.max(maxZ, u.posZ);
                });
            } else {
                minX = 0; maxX = 50; minZ = 0; maxZ = 50;
            }

            // Include Door in Bounding Box
            if (floorDef) {
                minX = Math.min(minX, floorDef.start.x);
                maxX = Math.max(maxX, floorDef.start.x);
                minZ = Math.min(minZ, floorDef.start.z);
                maxZ = Math.max(maxZ, floorDef.start.z);
            }

            // Add padding
            const padding = 15; // Increased padding
            const width = (maxX - minX) + padding * 2;
            const depth = (maxZ - minZ) + padding * 2;
            const centerX = (minX + maxX) / 2;
            const centerZ = (minZ + maxZ) / 2;

            const finalWidth = Math.max(width, 60);
            const finalDepth = Math.max(depth, 60);

            return (
                <group key={floor.id}>
                    {/* Floor Plane - Solid Black */}
                    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[centerX, -0.1, centerZ]}>
                        <planeGeometry args={[finalWidth, finalDepth]} />
                        <meshBasicMaterial color="#000000" />
                    </mesh>
                    
                    {/* Floor Label */}
                    <Text 
                        position={[centerX, 0.2, minZ - 10]} 
                        rotation={[-Math.PI / 2, 0, 0]} 
                        fontSize={4} 
                        color="#4fc3f7"
                        fillOpacity={0.5}
                    >
                        {floor.name.toUpperCase()}
                    </Text>
                </group>
            );
    });
  }, [visualLayout, visibleFloor]);

  // Filter Units based on visible floor
  const visibleUnits = useMemo(() => {
      if (!visualLayout) return [];
      return visualLayout.units.filter(u => visibleFloor === null || u.floorIndex === visibleFloor);
  }, [visualLayout, visibleFloor]);

  // Path Calculation
  const { activePath, futurePaths } = useMemo(() => {
    const active: THREE.Vector3[] = [];
    const future: THREE.Vector3[][] = [];

    if (tasks.length === 0 || focusedTaskIndex === null) {
        return { activePath: [], futurePaths: [] };
    }

    const currentTask = tasks[focusedTaskIndex];
    if (!currentTask) return { activePath: [], futurePaths: [] };

    // Only render active path if it belongs to the visible floor (or all floors visible)
    const isCurrentOnVisible = visibleFloor === null || currentTask.floorId === visibleFloor;

    if (isCurrentOnVisible) {
        if (activePathStart) {
            active.push(new THREE.Vector3(activePathStart.x, activePathStart.y, activePathStart.z));
            active.push(new THREE.Vector3(currentTask.coordinates.x, currentTask.coordinates.y, currentTask.coordinates.z));
        }
    }

    // Future Paths
    let currentSegment: THREE.Vector3[] = [];
    
    // Start loop
    if (visibleFloor === null || currentTask.floorId === visibleFloor) {
        currentSegment.push(new THREE.Vector3(currentTask.coordinates.x, currentTask.coordinates.y, currentTask.coordinates.z));
    }

    for (let i = focusedTaskIndex + 1; i < tasks.length; i++) {
        const t = tasks[i];
        const isVisible = visibleFloor === null || t.floorId === visibleFloor;
        
        if (t.startNewSection) {
            // End previous segment
            if (currentSegment.length > 1) future.push(currentSegment);
            currentSegment = [];

            if (isVisible) {
                // Start a new segment from the door
                const floor = FLOORS.find(f => f.id === t.floorId) || FLOORS[0];
                const doorPos = new THREE.Vector3(floor.start.x, floor.start.y, floor.start.z);
                const taskPos = new THREE.Vector3(t.coordinates.x, t.coordinates.y, t.coordinates.z);
                
                // Door -> Task line
                future.push([doorPos, taskPos]);
                // Start segment for next items
                currentSegment = [taskPos];
            }
        } else {
            // Continuation of same section
            if (isVisible) {
                if (currentSegment.length > 0) {
                    currentSegment.push(new THREE.Vector3(t.coordinates.x, t.coordinates.y, t.coordinates.z));
                } else {
                    currentSegment.push(new THREE.Vector3(t.coordinates.x, t.coordinates.y, t.coordinates.z));
                }
            } else {
                if (currentSegment.length > 1) future.push(currentSegment);
                currentSegment = [];
            }
        }
    }
    if (currentSegment.length > 1) future.push(currentSegment);

    return { activePath: active, futurePaths: future };
  }, [tasks, focusedTaskIndex, activePathStart, visibleFloor]);

  return (
    <>
      <OrbitControls ref={controlsRef} makeDefault dampingFactor={0.1} />
      <ambientLight intensity={0.7} />
      <pointLight position={[0, 50, 0]} intensity={0.5} />
      <directionalLight position={[100, 100, 50]} intensity={0.8} castShadow />

      {floorMeshes}

      {/* Render Doors (Filtered) */}
      {FLOORS.filter(f => visibleFloor === null || f.id === visibleFloor).map(floor => (
          <DoorMarker 
            key={`door-${floor.id}`} 
            position={floor.start} 
            rotation={floor.rotation}
            label={floor.id === 0 ? "ENTRADA" : `ENTRADA P${floor.id}`} 
          />
      ))}

      {visibleUnits.map((unit) => (
         <RackUnit key={unit.id} unit={unit} colors={typeColors} />
      ))}

      {/* Picking Tasks Highlights (Filtered) */}
      {tasks.map((task, idx) => {
        if (visibleFloor !== null && task.floorId !== visibleFloor) return null;

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

      {searchResults.map((node, idx) => {
         return (
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
         )
      })}

      {/* Render Active Path (Glowing Green) */}
      {activePath.length > 1 && (
          <Line
            points={activePath}
            color="#00e676" // Green
            lineWidth={6}
            transparent
            opacity={0.8}
            toneMapped={false} 
          />
      )}

      {/* Render Future Paths (Yellow, dimmed) */}
      {futurePaths.map((points, i) => (
         points.length > 1 && (
            <Line
              key={`line-${i}`}
              points={points}
              color="#ffff00"
              lineWidth={3}
              opacity={0.4}
              transparent
              dashed={false}
            />
         )
      ))}
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
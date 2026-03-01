import React, { useMemo, useEffect, useRef } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Line, Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { LayoutNode, PickingTask, WarehouseLayout, Unit } from '../types';
import { FLOORS } from '../utils/optimizer';

// Add missing type definitions for React Three Fiber elements
declare global {
  namespace JSX {
    interface IntrinsicElements {
      ambientLight: any;
      pointLight: any;
      directionalLight: any;
      group: any;
      mesh: any;
      boxGeometry: any;
      meshStandardMaterial: any;
      lineSegments: any;
      edgesGeometry: any;
      lineBasicMaterial: any;
      planeGeometry: any;
      meshBasicMaterial: any;
      sphereGeometry: any;
      gridHelper: any;
    }
  }
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      ambientLight: any;
      pointLight: any;
      directionalLight: any;
      group: any;
      mesh: any;
      boxGeometry: any;
      meshStandardMaterial: any;
      lineSegments: any;
      edgesGeometry: any;
      lineBasicMaterial: any;
      planeGeometry: any;
      meshBasicMaterial: any;
      sphereGeometry: any;
      gridHelper: any;
    }
  }
}

interface SceneProps {
  visualLayout: WarehouseLayout | null;
  layoutCoords: Map<string, LayoutNode>;
  tasks: PickingTask[];
  searchResults: LayoutNode[];
  focusedTaskIndex: number | null;
  activePathStart?: { x: number; y: number; z: number }; 
  visibleFloor: number | null; // New prop to control floor visibility
  isHighlightActive?: boolean; // Controls transparency mode
  isZoomedIn?: boolean; // Controls camera zoom
}

// --- A* PATHFINDING UTILS ---

interface Point { x: number, z: number }
interface Obstacle { minX: number, maxX: number, minZ: number, maxZ: number }
interface FloorData { obstacles: Obstacle[], bounds: Obstacle }

const getGridKey = (p: Point) => `${Math.round(p.x)},${Math.round(p.z)}`;

const isBlocked = (p: Point, obstacles: Obstacle[]): boolean => {
    // Check if point is inside any obstacle
    // We assume point is integer grid, obstacle bounds are floats
    // We consider a node blocked if it falls strictly inside the obstacle padding
    const padding = 0.5;
    for (const obs of obstacles) {
        if (p.x >= obs.minX - padding && p.x <= obs.maxX + padding && 
            p.z >= obs.minZ - padding && p.z <= obs.maxZ + padding) {
            return true;
        }
    }
    return false;
};

// BFS to find the nearest non-blocked node if start/end are inside an obstacle
const findNearestWalkable = (p: Point, obstacles: Obstacle[], bounds: Obstacle): Point => {
    if (!isBlocked(p, obstacles)) return p;
    
    const queue: Point[] = [p];
    const visited = new Set<string>([getGridKey(p)]);
    
    // Limit search to avoid hanging if map is broken
    let iterations = 0;
    const MAX_SEARCH = 500;

    while (queue.length > 0 && iterations < MAX_SEARCH) {
        iterations++;
        const curr = queue.shift()!;
        
        const moves = [
            { x: 1, z: 0 }, { x: -1, z: 0 }, 
            { x: 0, z: 1 }, { x: 0, z: -1 }
        ];

        for (const m of moves) {
            const next = { x: curr.x + m.x, z: curr.z + m.z };
            
            // Bounds Check
            if (next.x < bounds.minX || next.x > bounds.maxX || 
                next.z < bounds.minZ || next.z > bounds.maxZ) {
                continue;
            }

            const key = getGridKey(next);
            if (visited.has(key)) continue;
            visited.add(key);

            if (!isBlocked(next, obstacles)) {
                return next;
            }
            queue.push(next);
        }
    }
    return p; // Fallback
};

const findPathAStar = (
    start: THREE.Vector3, 
    end: THREE.Vector3, 
    floorData: FloorData | undefined
): THREE.Vector3[] => {
    // If no obstacle data, fallback to direct L-shape
    if (!floorData) {
        return [start, new THREE.Vector3(start.x, 0.5, end.z), end];
    }

    const { obstacles, bounds } = floorData;
    
    // 1. Resolve Start and End to nearest Walkable Nodes
    // Because picking locations are often "inside" the rack volume, we must find the adjacent aisle.
    const rawStart = { x: Math.round(start.x), z: Math.round(start.z) };
    const rawEnd = { x: Math.round(end.x), z: Math.round(end.z) };

    const gridStart = findNearestWalkable(rawStart, obstacles, bounds);
    const gridEnd = findNearestWalkable(rawEnd, obstacles, bounds);

    const startKey = getGridKey(gridStart);
    const endKey = getGridKey(gridEnd);

    // Standard A*
    const openSet: Point[] = [gridStart];
    const cameFrom = new Map<string, Point>();
    const gScore = new Map<string, number>();
    const fScore = new Map<string, number>();

    gScore.set(startKey, 0);
    fScore.set(startKey, Math.abs(gridStart.x - gridEnd.x) + Math.abs(gridStart.z - gridEnd.z));

    const openSetHash = new Set<string>([startKey]);
    
    let iterations = 0;
    const MAX_ITERATIONS = 5000; 

    while (openSet.length > 0) {
        iterations++;
        if (iterations > MAX_ITERATIONS) break;

        // Sort by F-score
        openSet.sort((a, b) => (fScore.get(getGridKey(a)) || Infinity) - (fScore.get(getGridKey(b)) || Infinity));
        
        const current = openSet.shift()!;
        const currentKey = getGridKey(current);
        openSetHash.delete(currentKey);

        if (current.x === gridEnd.x && current.z === gridEnd.z) {
            return reconstructPath(cameFrom, current, start, end);
        }

        const neighbors = [
            { x: current.x + 1, z: current.z },
            { x: current.x - 1, z: current.z },
            { x: current.x, z: current.z + 1 },
            { x: current.x, z: current.z - 1 }
        ];

        for (const neighbor of neighbors) {
            if (neighbor.x < bounds.minX || neighbor.x > bounds.maxX || 
                neighbor.z < bounds.minZ || neighbor.z > bounds.maxZ) {
                continue;
            }

            if (isBlocked(neighbor, obstacles)) {
                continue;
            }

            const neighborKey = getGridKey(neighbor);
            const tentativeG = (gScore.get(currentKey) || Infinity) + 1;

            if (tentativeG < (gScore.get(neighborKey) || Infinity)) {
                cameFrom.set(neighborKey, current);
                gScore.set(neighborKey, tentativeG);
                fScore.set(neighborKey, tentativeG + (Math.abs(neighbor.x - gridEnd.x) + Math.abs(neighbor.z - gridEnd.z)));
                
                if (!openSetHash.has(neighborKey)) {
                    openSet.push(neighbor);
                    openSetHash.add(neighborKey);
                }
            }
        }
    }

    // Fallback if no path found (e.g., disjoint areas)
    return [start, new THREE.Vector3(start.x, 0.5, end.z), end];
};

const reconstructPath = (cameFrom: Map<string, Point>, current: Point, realStart: THREE.Vector3, realEnd: THREE.Vector3) => {
    const path: THREE.Vector3[] = [];
    
    // Backtrack from Grid End to Grid Start
    let curr = current;
    while (cameFrom.has(getGridKey(curr))) {
        path.unshift(new THREE.Vector3(curr.x, 0.5, curr.z));
        curr = cameFrom.get(getGridKey(curr))!;
    }
    // Add grid start
    path.unshift(new THREE.Vector3(curr.x, 0.5, curr.z));

    // Simplify Path (Remove collinear points)
    const simplified: THREE.Vector3[] = [];
    if (path.length > 0) {
        simplified.push(path[0]);
        let lastDirX = 0;
        let lastDirZ = 0;
        
        if (path.length > 1) {
            lastDirX = Math.sign(path[1].x - path[0].x);
            lastDirZ = Math.sign(path[1].z - path[0].z);
        }

        for (let i = 1; i < path.length - 1; i++) {
            const nextDirX = Math.sign(path[i+1].x - path[i].x);
            const nextDirZ = Math.sign(path[i+1].z - path[i].z);
            
            if (nextDirX !== lastDirX || nextDirZ !== lastDirZ) {
                simplified.push(path[i]);
                lastDirX = nextDirX;
                lastDirZ = nextDirZ;
            }
        }
        simplified.push(path[path.length - 1]);
    } else {
        // Should not happen if start/end are handled, but safe fallback
        simplified.push(new THREE.Vector3(realStart.x, 0.5, realStart.z));
    }

    // Prepend Real Start and Append Real End to connect the visual path to the rack location
    // Only if they are significantly different from grid points (usually yes)
    if (realStart.distanceTo(simplified[0]) > 0.1) {
        simplified.unshift(realStart);
    }
    if (realEnd.distanceTo(simplified[simplified.length - 1]) > 0.1) {
        simplified.push(realEnd);
    }

    return simplified;
};

// --- COMPONENT ---

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

const RackUnit: React.FC<{ unit: Unit; colors: Record<string, string>; dimmed?: boolean; highlightedBin?: string }> = ({ unit, colors, dimmed, highlightedBin }) => {
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

  // Structural parts are always visible but can be dimmed
  const structuralMatProps = dimmed 
    ? { transparent: true, opacity: 0.1, depthWrite: false } 
    : { transparent: false, opacity: 1, depthWrite: true };
    
  // Default content material (transparent gray)
  const defaultContentMatProps = { 
      transparent: true, 
      opacity: 0.15, 
      depthWrite: false, 
      color: "#cccccc" 
  };

  const shelves = [];
  for (let l = 0; l <= levels; l++) {
    shelves.push(
      <mesh key={`shelf-${l}`} position={[0, l * size, 0]}>
        <boxGeometry args={[rackWidth, 0.08, rackDepth]} />
        <meshStandardMaterial color="#90a4ae" roughness={0.3} metalness={0.6} {...structuralMatProps} />
      </mesh>
    );
  }

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
      <boxGeometry args={[0.15, rackHeight, 0.15]} />
      <meshStandardMaterial color="#546e7a" roughness={0.5} {...structuralMatProps} />
    </mesh>
  ));

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
           // FLIPPED Z: Depth 1 (d=0) is at +Z (Front), Depth Max is at -Z (Back)
           const z = halfD - (d * binDepth) - (binDepth/2);

           // Construct bin code: unitId-level-column-depth
           // Note: levels are 0-based in loop, but usually 1-based in display? 
           // Based on ScrollingPicker, levels seem to be 0-based now.
           // Columns (b) are 0-based in loop, but 1-based in display usually.
           // Depths (d) are 0-based in loop, but 1-based in display usually.
           const binCode = `${unit.id}-${l}-${b+1}-${d+1}`;
           const isHighlighted = highlightedBin === binCode;

           const matProps = isHighlighted 
                ? { color: "#00e676", emissive: "#00e676", emissiveIntensity: 2, transparent: false, opacity: 1, depthWrite: true }
                : defaultContentMatProps;

           contents.push(
              <mesh key={`item-${l}-${b}-${d}`} position={[x, y, z]}>
                 <boxGeometry args={[bayWidth * 0.9, size * 0.85, binDepth * 0.9]} />
                 <meshStandardMaterial {...matProps} />
              </mesh>
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

const WarehouseContent: React.FC<SceneProps> = ({ visualLayout, layoutCoords, tasks, searchResults, focusedTaskIndex, activePathStart, visibleFloor, isHighlightActive, isZoomedIn }) => {
  const { camera, gl } = useThree();
  const controlsRef = useRef<any>(null);
  const isTransitioning = useRef(false);
  
  const typeColors: Record<string, string> = useMemo(() => {
     const map: Record<string, string> = {};
     visualLayout?.storageTypes.forEach(t => {
        map[t.id] = t.color;
     });
     return map;
  }, [visualLayout]);

  // Handle Double Click to Reset View
  useEffect(() => {
      const handleDbClick = () => {
          isTransitioning.current = true;
      };
      
      gl.domElement.addEventListener('dblclick', handleDbClick);
      return () => {
          gl.domElement.removeEventListener('dblclick', handleDbClick);
      };
  }, [gl]);

  // Pre-calculate Obstacles and Floor Bounds for A*
  const floorPathingData = useMemo(() => {
      if (!visualLayout) return new Map<number, FloorData>();
      const map = new Map<number, FloorData>();

      visualLayout.floors.forEach(floor => {
          const units = visualLayout.units.filter(u => u.floorIndex === floor.id);
          if (units.length === 0) return;

          // 1. Calculate individual unit bounding boxes
          const unitBoxes = units.map(u => {
              // Calculate width/depth based on rotation
              // Approx: 0 = Z is depth, 90 = X is depth
              let maxBays = u.params.bays;
              let maxBins = u.params.bins;
              if (u.params.levelConfig) {
                  maxBays = Math.max(...u.params.levelConfig.map(l => l.bays));
                  maxBins = Math.max(...u.params.levelConfig.map(l => l.bins));
              }
              const w = maxBays * u.params.size;
              const d = maxBins * u.params.size;
              
              // Simple rotation check (assuming increments of 90 deg)
              const rot = Math.abs(u.rotY);
              const isRotated = (Math.abs(rot - Math.PI/2) < 0.1 || Math.abs(rot - 3*Math.PI/2) < 0.1);
              
              const finalW = isRotated ? d : w;
              const finalD = isRotated ? w : d;

              return {
                  minX: u.posX - finalW/2,
                  maxX: u.posX + finalW/2,
                  minZ: u.posZ - finalD/2,
                  maxZ: u.posZ + finalD/2
              };
          });

          // 2. Determine Overall Floor Bounds
          let fMinX = Infinity, fMaxX = -Infinity, fMinZ = Infinity, fMaxZ = -Infinity;
          unitBoxes.forEach(b => {
              fMinX = Math.min(fMinX, b.minX);
              fMaxX = Math.max(fMaxX, b.maxX);
              fMinZ = Math.min(fMinZ, b.minZ);
              fMaxZ = Math.max(fMaxZ, b.maxZ);
          });

          // 3. Extend "Wall" units
          // If a unit is within this threshold of the total bounds, treat the gap as filled (wall).
          const WALL_THRESHOLD = 3.0; // 3 meters
          const EXTENSION = 20.0; // Push obstacle out significantly to form a boundary

          const obstacles = unitBoxes.map(b => {
              let { minX, maxX, minZ, maxZ } = b;
              if (Math.abs(minX - fMinX) < WALL_THRESHOLD) minX -= EXTENSION;
              if (Math.abs(maxX - fMaxX) < WALL_THRESHOLD) maxX += EXTENSION;
              if (Math.abs(minZ - fMinZ) < WALL_THRESHOLD) minZ -= EXTENSION;
              if (Math.abs(maxZ - fMaxZ) < WALL_THRESHOLD) maxZ += EXTENSION;
              return { minX, maxX, minZ, maxZ };
          });

          map.set(floor.id, {
              obstacles,
              // Pathfinding bounds: add some margin around the floor area
              bounds: { 
                  minX: fMinX - 30, 
                  maxX: fMaxX + 30, 
                  minZ: fMinZ - 30, 
                  maxZ: fMaxZ + 30 
              }
          });
      });
      return map;
  }, [visualLayout]);

  // Target state for smooth animation
  const targetRef = useRef(new THREE.Vector3(60, 0, 0));
  const posRef = useRef(new THREE.Vector3(60, 100, 100));

  // Update targets based on props
  useEffect(() => {
    if (!visualLayout) return;

    let target = new THREE.Vector3(60, 0, 0);
    let pos = new THREE.Vector3(60, 100, 100);

    // Prioritize search results (used for transfers/manual selection)
    if (searchResults.length > 0) {
        const node = searchResults[0];
        if (isFinite(node.x) && isFinite(node.y) && isFinite(node.z)) {
            target.set(node.x, node.y, node.z);
            
            // Check if "Extra Zoom" is active (we'll reuse isZoomedIn prop for this for now, or add a new one)
            // The user asked for "Zoom out slightly" by default, and a button to "Zoom in even more".
            // Let's assume isZoomedIn prop now controls this "Extra Zoom" state.
            
            if (isZoomedIn) {
                 // Extra Close Zoom
                 pos.set(node.x + 3, node.y + 2, node.z + 3);
            } else {
                 // Default "Slightly Zoomed Out" View
                 // Enough to see context but focused on the unit
                 pos.set(node.x + 15, node.y + 15, node.z + 15);
            }
        }
    } else if (isZoomedIn && focusedTaskIndex !== null && tasks[focusedTaskIndex]) {
        const task = tasks[focusedTaskIndex];
        if (task && task.coordinates && isFinite(task.coordinates.x) && isFinite(task.coordinates.y) && isFinite(task.coordinates.z)) {
            const taskPos = new THREE.Vector3(task.coordinates.x, task.coordinates.y, task.coordinates.z);
            target.copy(taskPos);
            pos.set(taskPos.x + 10, taskPos.y + 10, taskPos.z + 10);
        }
    } else if (visibleFloor !== null) {
        // ... (existing floor logic)
        const units = visualLayout.units.filter(u => u.floorIndex === visibleFloor);
        if (units.length > 0) {
             const xs = units.map(u => u.posX).filter(isFinite);
             const zs = units.map(u => u.posZ).filter(isFinite);
             
             if (xs.length > 0 && zs.length > 0) {
                 const minX = Math.min(...xs);
                 const maxX = Math.max(...xs);
                 const minZ = Math.min(...zs);
                 const maxZ = Math.max(...zs);
                 
                 target.set((minX + maxX) / 2, -20, (minZ + maxZ) / 2);
                 
                 const sizeX = maxX - minX;
                 const sizeZ = maxZ - minZ;
                 const maxDim = Math.max(sizeX, sizeZ);
                 
                 pos.set(target.x, maxDim * 2.0 + 80, target.z + maxDim * 1.8 + 80);
             }
        } else {
             const f = FLOORS.find(fl => fl.id === visibleFloor);
             if(f && isFinite(f.start.x) && isFinite(f.start.z)) {
                 target.set(f.start.x, -20, f.start.z);
                 pos.set(f.start.x, 150, f.start.z + 150);
             }
        }
    } else {
        target.set(60, -20, -10);
        pos.set(60, 200, 200);
    }

    if (isFinite(target.x) && isFinite(target.y) && isFinite(target.z) &&
        isFinite(pos.x) && isFinite(pos.y) && isFinite(pos.z)) {
        targetRef.current.copy(target);
        posRef.current.copy(pos);
        isTransitioning.current = true;
    }

  }, [visibleFloor, visualLayout, isZoomedIn, focusedTaskIndex, tasks, searchResults]);

  // Animation Loop
  useFrame((state, delta) => {
      if (!controlsRef.current) return;

      const step = Math.min(1, delta * 2.5); // Adjust speed here

      // Smoothly interpolate controls target
      controlsRef.current.target.lerp(targetRef.current, step);
      controlsRef.current.update();

      // Only move camera if we are transitioning
      if (isTransitioning.current) {
          state.camera.position.lerp(posRef.current, step * 0.5);
          
          if (state.camera.position.distanceTo(posRef.current) < 0.5) {
              isTransitioning.current = false;
          }
      }
  });

  const floorMeshes = useMemo(() => {
    if (!visualLayout) return [];

    return visualLayout.floors
        .filter(f => visibleFloor === null || f.id === visibleFloor)
        .map(floor => {
            const floorUnits = visualLayout.units.filter(u => u.floorIndex === floor.id);
            const floorDef = FLOORS.find(fl => fl.id === floor.id);

            let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
            
            if (floorUnits.length > 0) {
                floorUnits.forEach(u => {
                    let maxBays = u.params.bays;
                    let maxBins = u.params.bins;
                    if (u.params.levelConfig) {
                        maxBays = Math.max(...u.params.levelConfig.map(l => l.bays));
                        maxBins = Math.max(...u.params.levelConfig.map(l => l.bins));
                    }
                    const w = maxBays * u.params.size;
                    const d = maxBins * u.params.size;
                    
                    const rot = Math.abs(u.rotY);
                    const isRotated = (Math.abs(rot - Math.PI/2) < 0.1 || Math.abs(rot - 3*Math.PI/2) < 0.1);
                    
                    const finalW = isRotated ? d : w;
                    const finalD = isRotated ? w : d;

                    minX = Math.min(minX, u.posX - finalW/2);
                    maxX = Math.max(maxX, u.posX + finalW/2);
                    minZ = Math.min(minZ, u.posZ - finalD/2);
                    maxZ = Math.max(maxZ, u.posZ + finalD/2);
                });
            } else {
                minX = 0; maxX = 50; minZ = 0; maxZ = 50;
            }

            if (floorDef) {
                minX = Math.min(minX, floorDef.start.x);
                maxX = Math.max(maxX, floorDef.start.x);
                minZ = Math.min(minZ, floorDef.start.z);
                maxZ = Math.max(maxZ, floorDef.start.z);
            }

            const padding = 5;
            const width = (maxX - minX) + padding * 2;
            const depth = (maxZ - minZ) + padding * 2;
            const centerX = (minX + maxX) / 2;
            const centerZ = (minZ + maxZ) / 2;

            return (
                <group key={floor.id}>
                    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[centerX, -0.1, centerZ]}>
                        <planeGeometry args={[width, depth]} />
                        <meshBasicMaterial color="#1a1a1a" />
                    </mesh>
                    <Text 
                        position={[centerX, 0.2, minZ - 2]} 
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

  const visibleUnits = useMemo(() => {
      if (!visualLayout) return [];
      return visualLayout.units.filter(u => visibleFloor === null || u.floorIndex === visibleFloor);
  }, [visualLayout, visibleFloor]);

  // Path Calculation using A*
  const { activePath, futurePaths } = useMemo(() => {
    const active: THREE.Vector3[] = [];
    const future: THREE.Vector3[][] = [];

    if (tasks.length === 0 || focusedTaskIndex === null) {
        return { activePath: [], futurePaths: [] };
    }

    const currentTask = tasks[focusedTaskIndex];
    if (!currentTask) return { activePath: [], futurePaths: [] };

    const isCurrentOnVisible = visibleFloor === null || currentTask.floorId === visibleFloor;

    // Helper to run A*
    const generatePathSegment = (start: THREE.Vector3, end: THREE.Vector3, floorId: number) => {
        return findPathAStar(start, end, floorPathingData.get(floorId));
    };

    // ACTIVE PATH
    if (isCurrentOnVisible && activePathStart) {
        const start = new THREE.Vector3(activePathStart.x, activePathStart.y, activePathStart.z);
        const end = new THREE.Vector3(currentTask.coordinates.x, currentTask.coordinates.y, currentTask.coordinates.z);
        // Use A* 
        const segmentPoints = generatePathSegment(start, end, currentTask.floorId);
        active.push(...segmentPoints);
    }

    // FUTURE PATHS
    let currentSegmentStart: THREE.Vector3 | null = null;
    
    // Initialize start
    if (visibleFloor === null || currentTask.floorId === visibleFloor) {
        currentSegmentStart = new THREE.Vector3(currentTask.coordinates.x, currentTask.coordinates.y, currentTask.coordinates.z);
    }

    // Limit A* calculations for future paths to prevent main thread freezing
    const MAX_ASTAR_FUTURE_PATHS = 2;
    let astarCount = 0;

    for (let i = focusedTaskIndex + 1; i < tasks.length; i++) {
        const prevTask = tasks[i-1];
        const t = tasks[i];
        const isVisible = visibleFloor === null || t.floorId === visibleFloor;
        
        if (t.startNewSection) {
            // End previous segment
            currentSegmentStart = null; 

            if (isVisible) {
                // New segment from Door to Task
                const floor = FLOORS.find(f => f.id === t.floorId) || FLOORS[0];
                const doorPos = new THREE.Vector3(floor.start.x, floor.start.y, floor.start.z);
                const taskPos = new THREE.Vector3(t.coordinates.x, t.coordinates.y, t.coordinates.z);
                
                if (astarCount < MAX_ASTAR_FUTURE_PATHS) {
                    const segment = generatePathSegment(doorPos, taskPos, t.floorId);
                    future.push(segment);
                    astarCount++;
                } else {
                    // Fallback to direct line for performance
                    future.push([doorPos, new THREE.Vector3(doorPos.x, 0.5, taskPos.z), taskPos]);
                }
                
                currentSegmentStart = taskPos;
            }
        } else {
            if (isVisible) {
                const startPos = currentSegmentStart || new THREE.Vector3(prevTask.coordinates.x, prevTask.coordinates.y, prevTask.coordinates.z);
                const endPos = new THREE.Vector3(t.coordinates.x, t.coordinates.y, t.coordinates.z);
                
                if (astarCount < MAX_ASTAR_FUTURE_PATHS) {
                    const intermediate = generatePathSegment(startPos, endPos, t.floorId);
                    future.push(intermediate);
                    astarCount++;
                } else {
                    // Fallback to direct line for performance
                    future.push([startPos, new THREE.Vector3(startPos.x, 0.5, endPos.z), endPos]);
                }
                
                currentSegmentStart = endPos;
            } else {
                currentSegmentStart = null;
            }
        }
    }

    return { activePath: active, futurePaths: future };
  }, [tasks, focusedTaskIndex, activePathStart, visibleFloor, floorPathingData]);

  return (
    <>
      <OrbitControls 
        ref={controlsRef} 
        makeDefault 
        dampingFactor={0.1} 
        enablePan={false} 
        maxPolarAngle={Math.PI / 2} 
      />
      <ambientLight intensity={0.9} />
      <pointLight position={[0, 50, 0]} intensity={0.6} />
      <directionalLight position={[100, 100, 50]} intensity={1} castShadow />

      {floorMeshes}

      {/* Render Doors */}
      {FLOORS.filter(f => visibleFloor === null || f.id === visibleFloor).map(floor => (
          <DoorMarker 
            key={`door-${floor.id}`} 
            position={floor.start} 
            rotation={floor.rotation}
            label={floor.id === 0 ? "ENTRADA" : `ENTRADA P${floor.id}`} 
          />
      ))}

      {visibleUnits.map((unit) => {
         // Check if this unit contains the highlighted bin (search result)
         const isHighlightedUnit = searchResults.length > 0 && searchResults[0].bin.startsWith(`${unit.id}-`);
         
         // If we have a search result (transfer mode), dim everything else
         const shouldDim = searchResults.length > 0 ? !isHighlightedUnit : isHighlightActive;
         
         // Pass the exact bin code to highlight
         const highlightedBin = searchResults.length > 0 ? searchResults[0].bin : undefined;

         return (
            <RackUnit 
                key={unit.id} 
                unit={unit} 
                colors={typeColors} 
                dimmed={shouldDim} 
                highlightedBin={highlightedBin}
            />
         );
      })}

      {/* Tasks */}
      {tasks.map((task, idx) => {
        if (visibleFloor !== null && task.floorId !== visibleFloor) return null;
        if (!task.coordinates || !isFinite(task.coordinates.x) || !isFinite(task.coordinates.y) || !isFinite(task.coordinates.z)) return null;

        const isFocused = focusedTaskIndex === idx;
        const color = isFocused ? "#00e676" : "#ff9800"; 
        const scale = isFocused ? 1.8 : 1.2;
        
        return (
          <group key={`task-${idx}`} position={[task.coordinates.x, task.coordinates.y, task.coordinates.z]}>
             {isFocused && isHighlightActive && (
                 <group>
                     <pointLight distance={15} intensity={5} color="#00e676" decay={2} />
                     <mesh>
                         <sphereGeometry args={[2.5, 32, 32]} />
                         <meshBasicMaterial color="#00e676" transparent opacity={0.15} depthWrite={false} />
                     </mesh>
                 </group>
             )}

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
                <Billboard position={[0, 1.2, 0]}>
                <Text fontSize={0.8} color="#29b6f6" outlineWidth={0.05} outlineColor="#000000">
                    {node.bin}
                </Text>
                </Billboard>
            </group>
         )
      })}

      {/* Render Active Path */}
      {activePath.length > 1 && (
          <Line
            points={activePath}
            color="#00e676"
            lineWidth={3}
            transparent
            opacity={0.6}
            toneMapped={false} 
          />
      )}

      {/* Render Future Paths */}
      {futurePaths.map((points, i) => (
         points.length > 1 && (
            <Line
              key={`line-${i}`}
              points={points}
              color="#ffff00"
              lineWidth={1} 
              opacity={0.2}
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
    <div className="w-full h-full bg-gray-200 dark:bg-[#0f131a] transition-colors duration-500">
      <Canvas camera={{ position: [0, 60, 80], fov: 45 }}>
        <WarehouseContent {...props} />
      </Canvas>
    </div>
  );
};
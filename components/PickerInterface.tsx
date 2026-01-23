import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Scene3D } from './Scene3D';
import { LayoutNode, OrderItem, PickingTask, StockItem, CloudOrder, WarehouseLayout } from '../types';
import { generatePickingList, reorderRemainingTasks, FLOORS } from '../utils/optimizer';
import { fetchStockFromCloud, fetchOpenOrdersFromCloud, markOrderComplete, updateOrderStatus } from '../utils/firebase';
import { DEFAULT_LAYOUT_COORDS, DEFAULT_VISUAL_LAYOUT } from '../utils/defaults';
import { Home, CheckCircle, Navigation, Package, ArrowRight, ArrowLeft, Clock, QrCode, List, X, RefreshCw, History, AlertTriangle, Box, MapPin, Play, Trash2, Upload, EyeOff, Save, AlignJustify, Layers, Loader2, Zap, ZoomIn, ZoomOut, CheckCheck, Calendar, Search } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';

export const PickerInterface: React.FC<{ onSwitchToManager: () => void }> = ({ onSwitchToManager }) => {
  // State
  const [layoutCoords, setLayoutCoords] = useState<Map<string, LayoutNode>>(new Map());
  const [visualLayout, setVisualLayout] = useState<WarehouseLayout | null>(null);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [cloudOrders, setCloudOrders] = useState<CloudOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  
  const [pickingTasks, setPickingTasks] = useState<PickingTask[]>([]);
  const [skippedItems, setSkippedItems] = useState<OrderItem[]>([]); // Items with no location
  const [completedTasks, setCompletedTasks] = useState<PickingTask[]>([]);
  const [focusedTaskIndex, setFocusedTaskIndex] = useState<number | null>(null);
  const [visibleFloor, setVisibleFloor] = useState<number | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [isSetupOpen, setIsSetupOpen] = useState<boolean>(true);
  const [stockLoadDate, setStockLoadDate] = useState<string>('');

  // New UI States
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scanMode, setScanMode] = useState<'recommended' | 'free'>('recommended');
  const [showTaskList, setShowTaskList] = useState(false);
  const [listViewMode, setListViewMode] = useState<'summary' | 'detailed'>('detailed'); // Default to Detailed
  const [showHistory, setShowHistory] = useState(false);
  const [showFinishModal, setShowFinishModal] = useState(false); // New explicit modal for finishing
  const [completedSessions, setCompletedSessions] = useState<{name: string, date: string, items: number}[]>([]);
  const [isProcessing, setIsProcessing] = useState(false); // Track async operations for buttons
  const [isRefreshing, setIsRefreshing] = useState(false); // For orders refresh
  const [isHighlightActive, setIsHighlightActive] = useState(false); // Highlight Mode State
  const [isZoomedIn, setIsZoomedIn] = useState(false); // Camera Zoom State
  
  // Search State
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<LayoutNode[]>([]);

  // Custom Confirm Modal State
  const [confirmModal, setConfirmModal] = useState<{
      isOpen: boolean;
      title: string;
      message: string;
      onConfirm: () => void;
      type: 'danger' | 'success' | 'warning';
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {}, type: 'warning' });

  // Qty Modal State
  const [showQtyModal, setShowQtyModal] = useState(false);
  const [qtyInput, setQtyInput] = useState<number>(0);
  const [qtyMessage, setQtyMessage] = useState<string>('');
  const [qtyMessageType, setQtyMessageType] = useState<'info' | 'warning' | 'error' | 'success'>('info');
  const [qtyMax, setQtyMax] = useState<number>(9999); // Track max allowable

  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const tempTaskRef = useRef<PickingTask | null>(null);

  // Initialize Defaults & Restore Session
  useEffect(() => {
    // Load Defaults
    const map = new Map<string, LayoutNode>();
    DEFAULT_LAYOUT_COORDS.forEach(n => map.set(n.bin, n));
    setLayoutCoords(map);
    setVisualLayout(DEFAULT_VISUAL_LAYOUT);

    // Load Cloud Data
    loadCloudData();

    // Restore History
    const history = localStorage.getItem('picker_history');
    if (history) {
        setCompletedSessions(JSON.parse(history));
    }

    // Check for saved session
    const savedSession = localStorage.getItem('picker_current_session');
    if (savedSession) {
        try {
            const session = JSON.parse(savedSession);
            if (session.pickingTasks && session.pickingTasks.length > 0) {
                // Auto-restore active session state
                setPickingTasks(session.pickingTasks);
                setSkippedItems(session.skippedItems || []);
                setCompletedTasks(session.completedTasks || []);
                setFocusedTaskIndex(session.focusedTaskIndex);
                setVisibleFloor(session.visibleFloor);
                setCurrentSessionId(session.currentSessionId);
                setSelectedOrderId(session.selectedOrderId);
                setIsSetupOpen(false); 
            }
        } catch (e) {
            console.error("Erro ao restaurar sessão", e);
            localStorage.removeItem('picker_current_session');
        }
    }
  }, []);

  // When cloud orders load, ensure 'orders' state matches selected session if any
  useEffect(() => {
      if (selectedOrderId && cloudOrders.length > 0 && orders.length === 0) {
          const order = cloudOrders.find(o => o.id === selectedOrderId);
          if (order) setOrders(order.items);
      }
  }, [cloudOrders, selectedOrderId, orders.length]);

  // Save Session to LocalStorage
  useEffect(() => {
      if (!isSetupOpen && pickingTasks.length > 0 && selectedOrderId) {
          const order = cloudOrders.find(o => o.id === selectedOrderId);
          const session = {
              pickingTasks,
              skippedItems,
              completedTasks,
              focusedTaskIndex,
              visibleFloor,
              currentSessionId,
              selectedOrderId,
              orderName: order?.name || "Desconhecido",
              timestamp: Date.now()
          };
          localStorage.setItem('picker_current_session', JSON.stringify(session));
      }
  }, [pickingTasks, skippedItems, completedTasks, focusedTaskIndex, visibleFloor, currentSessionId, selectedOrderId, isSetupOpen, cloudOrders]);

  // Search Logic
  useEffect(() => {
      if (!searchQuery) {
          setSearchResults([]);
          return;
      }
      
      const q = searchQuery.toLowerCase();
      const results: LayoutNode[] = [];
      const seenBins = new Set<string>();

      // 1. Search Stock (Material or Description)
      stock.forEach(item => {
          if ((item.material.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)) && item.bin) {
              const node = layoutCoords.get(item.bin);
              if (node && !seenBins.has(item.bin)) {
                  results.push(node);
                  seenBins.add(item.bin);
              }
          }
      });

      // 2. Search Bin Codes directly
      layoutCoords.forEach((node, bin) => {
          if (bin.toLowerCase().includes(q) && !seenBins.has(bin)) {
              results.push(node);
              seenBins.add(bin);
          }
      });

      setSearchResults(results);
  }, [searchQuery, stock, layoutCoords]);

  // QR Code Scanner Effect (Using Core Html5Qrcode for custom UI)
  useEffect(() => {
    if (isScannerOpen) {
        // Init scanner
        const initScanner = async () => {
            try {
                // Short delay to ensure DOM is ready
                await new Promise(r => setTimeout(r, 100));
                
                if (html5QrCodeRef.current) {
                    await html5QrCodeRef.current.stop().catch(() => {});
                    html5QrCodeRef.current.clear();
                }

                const html5QrCode = new Html5Qrcode("qr-reader");
                html5QrCodeRef.current = html5QrCode;

                await html5QrCode.start(
                    { facingMode: "environment" },
                    { fps: 10, qrbox: { width: 250, height: 250 } },
                    onScanSuccess,
                    (errorMessage) => {
                        // Ignore standard scanning errors
                    }
                );
            } catch (err) {
                console.error("Error starting scanner", err);
                alert("Erro ao iniciar câmara. Verifique as permissões.");
                setIsScannerOpen(false);
            }
        };

        initScanner();

        return () => {
            if (html5QrCodeRef.current) {
                html5QrCodeRef.current.stop().catch(console.error).finally(() => {
                    html5QrCodeRef.current?.clear();
                    html5QrCodeRef.current = null;
                });
            }
        };
    }
  }, [isScannerOpen]);

  const onScanSuccess = (decodedText: string) => {
      if (focusedTaskIndex === null) return;
      const currentTask = pickingTasks[focusedTaskIndex];
      const scan = decodedText.trim().toUpperCase();

      if (scanMode === 'recommended') {
          // Strict check
          const expectedBin = currentTask.bin.trim().toUpperCase();
          if (scan === expectedBin) {
              handleScanMatch(currentTask);
          } else {
              // Be careful with alerts in loop, maybe better to show a toast or overlay
              // For now, stopping the scanner temporarily could be good, but with Html5Qrcode we pause manually if needed.
              // alert(`Posição incorreta!\nLido: ${decodedText}\nEsperado: ${currentTask.bin}`);
          }
      } else {
          // Free Scan: Check if scan is a bin that contains the material
          // We need to look up the bin in the STOCK list
          const relevantStock = stock.filter(s => s.material === currentTask.material);
          const matchingStockItem = relevantStock.find(s => s.bin.toUpperCase() === scan);

          if (matchingStockItem) {
               // Found the material in a different bin (or the same one)
               // Does this bin exist in layout?
               if (!layoutCoords.has(matchingStockItem.bin)) {
                   alert("Lote válido, mas sem posição no layout 3D. Picking manual necessário.");
                   return;
               }
               handleScanMatch({
                   ...currentTask,
                   bin: matchingStockItem.bin, // Update bin
                   // Update coordinates for rerouting logic later
                   coordinates: { ...layoutCoords.get(matchingStockItem.bin)! }
               });
          }
      }
  };

  const handleScanMatch = (taskWithCorrectLocation: PickingTask) => {
      if (html5QrCodeRef.current) {
          html5QrCodeRef.current.pause(true);
      }
      setIsScannerOpen(false);

      // 1. Get Physical Limit (Local Stock at Scanned Bin)
      const localStock = stock.find(s => s.material === taskWithCorrectLocation.material && s.bin === taskWithCorrectLocation.bin)?.qtyAvailable || 0;
      setQtyMax(localStock);

      // 2. Get Logical Limit (What is needed for this task/order)
      const targetQty = taskWithCorrectLocation.qtyToPick;

      // 3. Determine Default Input (Cannot exceed what is physically there)
      const initialQty = Math.min(targetQty, localStock);
      setQtyInput(initialQty);

      // 4. Messages Logic
      let message = "";
      let type: 'info' | 'warning' | 'error' | 'success' = 'info';

      if (localStock < targetQty) {
          message = `Atenção: A posição lida tem apenas ${localStock} unidades. Picking parcial necessário.`;
          type = 'warning';
      } else if (localStock === 0) {
          message = "Erro: Posição sem stock deste material.";
          type = 'error';
      } else {
          message = "Quantidade disponível. Confirme a recolha.";
          type = 'success';
      }

      // Check global shortage context if needed, but local context is priority for the modal
      const orderTotalNeeded = orders.find(o => o.material === taskWithCorrectLocation.material)?.qty || 0;
      const totalStock = stock.filter(s => s.material === taskWithCorrectLocation.material)
                              .reduce((acc, s) => acc + s.qtyAvailable, 0);
      
      if (totalStock < orderTotalNeeded && type !== 'error') {
          // Append global warning
          message += " (Nota: Stock total global insuficiente para o pedido)";
          if(type !== 'warning') type = 'warning';
      }

      setQtyMessage(message);
      setQtyMessageType(type);
      
      tempTaskRef.current = taskWithCorrectLocation;
      setShowQtyModal(true);
  };

  const onQtyConfirm = () => {
      if (focusedTaskIndex === null || !tempTaskRef.current) return;
      
      const confirmedQty = qtyInput;
      const modifiedTask = { 
          ...tempTaskRef.current, 
          pickedQty: confirmedQty, 
          status: 'picked' as const 
      }; 
      
      const material = modifiedTask.material;
      const orderTotal = orders.find(o => o.material === material)?.qty || 0;

      // DYNAMIC RE-ROUTING LOGIC
      // 1. Separate "Already Picked" (Historical)
      const currentList = [...pickingTasks];
      const alreadyPicked = currentList.filter(t => t.status === 'picked' && t !== currentList[focusedTaskIndex]);
      
      // Calculate how much we have picked so far for this material (Prior to this action)
      const previouslyPickedQty = alreadyPicked
          .filter(t => t.material === material)
          .reduce((acc, t) => acc + (t.pickedQty || 0), 0);
          
      // Total including current action
      const totalPickedWithCurrent = previouslyPickedQty + confirmedQty;
      let remainingNeeded = orderTotal - totalPickedWithCurrent;
      
      // 2. Process Pending Tasks
      // We start with all tasks that were conceptually "next"
      let rawPending = currentList.filter(t => t.status !== 'picked' && t !== currentList[focusedTaskIndex]);
      let updatedPending: PickingTask[] = [];

      // Filter and Update existing pending tasks based on new reality
      for (const t of rawPending) {
          if (t.material === material) {
              // If this pending task target matches the bin we JUST picked from (via Free Scan),
              // we assume we exhausted our intent for this bin in this action. remove it.
              if (t.bin === modifiedTask.bin) {
                  continue;
              }

              if (remainingNeeded <= 0) {
                  // Order satisfied, remove future tasks
                  continue; 
              }
              
              // Reduce task quantity if we only need a small remainder
              const newQty = Math.min(t.qtyToPick, remainingNeeded);
              updatedPending.push({ ...t, qtyToPick: newQty });
              remainingNeeded -= newQty;
          } else {
              updatedPending.push(t);
          }
      }

      // 3. GENERATE NEW TASKS IF NEEDED
      // If we still have remaining needs after exhausting the plan, find new locations.
      if (remainingNeeded > 0) {
          // Find candidates
          const busyBins = new Set<string>();
          busyBins.add(modifiedTask.bin); // Don't pick from where we just picked (unless we want to double dip, but usually redundant here)
          updatedPending.filter(t => t.material === material).forEach(t => busyBins.add(t.bin));
          alreadyPicked.filter(t => t.material === material).forEach(t => busyBins.add(t.bin));

          const candidates = stock.filter(s => 
              s.material === material && 
              !busyBins.has(s.bin) && 
              s.qtyAvailable > 0
          );

          // Simple greedy allocation
          let tempRemaining = remainingNeeded;
          
          // Sort by distance to current user position (modifiedTask)
          // Simple Manhattan distance
          const userPos = modifiedTask.coordinates;
          
          candidates.sort((a, b) => {
              const nodeA = layoutCoords.get(a.bin);
              const nodeB = layoutCoords.get(b.bin);
              if (!nodeA) return 1;
              if (!nodeB) return -1;
              
              const distA = Math.abs(nodeA.x - userPos.x) + Math.abs(nodeA.z - userPos.z);
              const distB = Math.abs(nodeB.x - userPos.x) + Math.abs(nodeB.z - userPos.z);
              return distA - distB;
          });

          for (const cand of candidates) {
              if (tempRemaining <= 0) break;
              
              const node = layoutCoords.get(cand.bin);
              if (!node) continue;

              // Floor logic (simplified import from optimizer or duplicated)
              const getFloorId = (x: number) => {
                  if (x < 35) return 0;
                  if (x < 100) return 1;
                  return 2;
              };

              const qtyToTake = Math.min(cand.qtyAvailable, tempRemaining);
              
              updatedPending.push({
                  sequence: 999, // Will be renumbered
                  material: material,
                  bin: cand.bin,
                  qtyToPick: qtyToTake,
                  coordinates: { x: node.x, y: node.y, z: node.z },
                  distanceFromLast: 0, // Recalculated later
                  floorId: getFloorId(node.x),
                  startNewSection: false // Recalculated later
              });
              
              tempRemaining -= qtyToTake;
          }
          
          if (tempRemaining > 0) {
              // Warn if still can't fulfill?
              console.warn("Still cannot fulfill order even with new tasks. Stock shortage?");
          }
      }

      // 4. Re-optimize the route for pending tasks starting from *this* modifiedTask location
      // This is crucial to slot the new tasks in efficiently
      if (updatedPending.length > 0) {
          const optimizedPath = reorderRemainingTasks(modifiedTask, updatedPending);
          // Remove the first item (modifiedTask) as it goes to history
          updatedPending = optimizedPath.slice(1);
          
          // Re-assign sequence numbers
          let seq = alreadyPicked.length + 2; 
          updatedPending = updatedPending.map(t => ({
              ...t,
              sequence: seq++
          }));
      }

      // 5. Construct final list
      const newList = [...alreadyPicked, { ...modifiedTask, sequence: alreadyPicked.length + 1 }, ...updatedPending];
      
      setPickingTasks(newList);
      setShowQtyModal(false);
      
      // 6. Update Focus
      const nextIndex = alreadyPicked.length + 1;
      
      if (nextIndex < newList.length) {
          setFocusedTaskIndex(nextIndex);
          setVisibleFloor(newList[nextIndex].floorId);
      } else {
          setFocusedTaskIndex(null);
          setShowFinishModal(true);
      }
  };

  const loadCloudData = async () => {
      setIsRefreshing(true);
      try {
          const s = await fetchStockFromCloud();
          setStock(s);
          setStockLoadDate(new Date().toLocaleString()); // Set timestamp
          const o = await fetchOpenOrdersFromCloud();
          setCloudOrders(o);
      } catch (e) {
          console.error("Error loading cloud data", e);
      } finally {
          setIsRefreshing(false);
      }
  };

  const calculateShortages = (orders: OrderItem[], stock: StockItem[]) => {
      const shortages = [];
      for(const o of orders) {
          const avail = stock.filter(s => s.material === o.material).reduce((acc, s) => acc + s.qtyAvailable, 0);
          if(avail < o.qty) shortages.push({ material: o.material, needed: o.qty, has: avail });
      }
      if(shortages.length > 0) {
          alert(`Aviso: Stock insuficiente para ${shortages.length} itens. Verifique a consola.`);
          console.warn("Shortages:", shortages);
      }
  };

  // Sort orders: In Process first, then Open (by Date)
  const sortedOrders = useMemo(() => {
      return [...cloudOrders].sort((a, b) => {
          if (a.status === 'IN PROCESS' && b.status !== 'IN PROCESS') return -1;
          if (a.status !== 'IN PROCESS' && b.status === 'IN PROCESS') return 1;
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
  }, [cloudOrders]);

  // Toggle order selection (Accordion behavior)
  const handleOrderSelect = (orderId: string) => {
      if (selectedOrderId === orderId) {
          // Collapse if clicked again
          setSelectedOrderId('');
          setOrders([]);
      } else {
          // Select and expand
          setSelectedOrderId(orderId);
          const order = cloudOrders.find(o => o.id === orderId);
          if (order) {
              setOrders(order.items);
          }
      }
  };

  const generateRoute = async () => {
    // Check if we are resuming an existing session from local storage for this order
    if (selectedOrderId === currentSessionId && pickingTasks.length > 0) {
        setIsSetupOpen(false);
        return;
    }

    if (layoutCoords.size === 0 || stock.length === 0 || orders.length === 0) {
      alert("Aguarde o carregamento do stock ou selecione uma encomenda.");
      return;
    }

    // Split orders into Valid (Have stock & layout) and Skipped (No stock or no layout)
    const validOrders: OrderItem[] = [];
    const skipped: OrderItem[] = [];

    for (const item of orders) {
        const matchingStock = stock.filter(s => s.material === item.material);
        if (matchingStock.length === 0) {
             skipped.push(item);
             continue;
        }
        // Check if ANY stock unit for this material has a valid position in layout
        const hasValidBin = matchingStock.some(s => s.bin && layoutCoords.has(s.bin));
        if (!hasValidBin) {
            skipped.push(item);
        } else {
            validOrders.push(item);
        }
    }

    if (skipped.length > 0) {
        alert(`Aviso: ${skipped.length} materiais não têm localização 3D definida ou stock. Serão listados como "Sem Localização" e excluídos da rota de picking.`);
    }

    if (validOrders.length === 0) {
        alert("Erro: Nenhum dos materiais da encomenda tem localização válida no layout.");
        return;
    }

    calculateShortages(validOrders, stock);
    const tasks = generatePickingList(validOrders, stock, layoutCoords);
    
    if (tasks.length === 0) {
        alert("Erro: A lista de picking gerada está vazia.");
        return;
    }
    
    // Set status to IN PROCESS in the backend
    if (selectedOrderId) {
        try {
            await updateOrderStatus(selectedOrderId, 'IN PROCESS');
        } catch (error) {
            console.error("Failed to update status to IN PROCESS:", error);
        }
    }

    setPickingTasks(tasks);
    setSkippedItems(skipped); // Save the skipped items to state
    setCompletedTasks([]);
    setFocusedTaskIndex(0);
    setVisibleFloor(tasks[0].floorId);
    setCurrentSessionId(selectedOrderId); 
    setIsSetupOpen(false);
    // Reload cloud data to reflect status change in list immediately
    loadCloudData();
  };

  // Explicitly accepts ID to avoid closure staleness issues in callbacks
  const finishOrder = async (finalTasks: PickingTask[], targetOrderId?: string) => {
      const idToFinish = targetOrderId || selectedOrderId;
      
      if (idToFinish) {
          setIsProcessing(true);
          const order = cloudOrders.find(o => o.id === idToFinish);
          const orderName = order?.name || "Desconhecido";
          
          try {
            // Only send picked items. Skipped items are implicitly excluded.
            await markOrderComplete(idToFinish, finalTasks);
            
            // Add to local history
            const newHistory = [...completedSessions, {
                name: orderName,
                date: new Date().toLocaleTimeString(),
                items: finalTasks.length
            }];
            setCompletedSessions(newHistory);
            localStorage.setItem('picker_history', JSON.stringify(newHistory));
            
            alert("Encomenda finalizada e enviada para a Cloud!");
            
            // Clear session
            localStorage.removeItem('picker_current_session');
            setPickingTasks([]);
            setSkippedItems([]);
            setFocusedTaskIndex(null);
            setShowFinishModal(false);
            setIsSetupOpen(true);
            setCurrentSessionId('');
            await loadCloudData();
          } catch (e) {
              alert("Erro ao finalizar encomenda. Tente novamente.");
              console.error(e);
          } finally {
              setIsProcessing(false);
          }
      } else {
          alert("Erro: ID da encomenda não encontrado.");
      }
  };

  // Revert an In Process order to OPEN
  const handleRevertOrder = (orderId: string) => {
      setConfirmModal({
          isOpen: true,
          title: 'Cancelar / Reverter',
          message: 'Tem a certeza? O estado voltará a "OPEN" e o progresso atual será perdido.',
          type: 'danger',
          onConfirm: async () => {
              setConfirmModal(prev => ({ ...prev, isOpen: false }));
              setIsProcessing(true);
              try {
                  await updateOrderStatus(orderId, 'OPEN');
                  // If this was the current session, clear it
                  if (currentSessionId === orderId || selectedOrderId === orderId) {
                      localStorage.removeItem('picker_current_session');
                      setPickingTasks([]);
                      setSkippedItems([]);
                      setCurrentSessionId('');
                  }
                  await loadCloudData();
                  alert("Pedido revertido para OPEN.");
              } catch (e) {
                  console.error(e);
                  alert("Erro ao reverter pedido.");
              } finally {
                  setIsProcessing(false);
              }
          }
      });
  };

  // Force finish an In Process order from the menu (using current local data if available)
  const handleForceFinish = (orderId: string) => {
      // Allow finishing if it matches current active session OR just force empty finish if stuck
      // Check both ID match AND that we actually have tasks in memory for this session
      if (orderId === currentSessionId && pickingTasks.length > 0) {
          setConfirmModal({
              isOpen: true,
              title: 'Finalizar Encomenda',
              message: 'Deseja finalizar usando os dados da sessão atual?',
              type: 'success',
              onConfirm: () => {
                  setConfirmModal(prev => ({ ...prev, isOpen: false }));
                  finishOrder(pickingTasks, orderId);
              }
          });
      } else {
          // If we don't have the data locally but want to force close it
          setConfirmModal({
              isOpen: true,
              title: 'Forçar Finalização',
              message: 'Não tem dados desta sessão neste dispositivo. Deseja forçar a finalização como "COMPLETED" (sem itens)? Recomenda-se "Cancelar" em vez disso.',
              type: 'danger',
              onConfirm: async () => {
                   setConfirmModal(prev => ({ ...prev, isOpen: false }));
                   setIsProcessing(true);
                   try {
                       await markOrderComplete(orderId, []);
                       await loadCloudData();
                       alert("Pedido forçado a concluído.");
                   } catch(e) {
                       alert("Erro ao forçar finalização.");
                       console.error(e);
                   } finally {
                       setIsProcessing(false);
                   }
              }
          });
      }
  };

  // Handle "Keep Locally" action in Finish Modal
  const handleKeepLocally = () => {
      setShowFinishModal(false);
      // We open the setup menu so they can choose another order or resume this one later
      setIsSetupOpen(true);
  };

  // Calculate the starting position for the visual path
  const getActivePathStart = (): {x: number, y: number, z: number} | undefined => {
      if (focusedTaskIndex === null) return undefined;
      const currentTask = pickingTasks[focusedTaskIndex];
      
      // If it's the first task or starts a new section, use the Floor Entry
      if (focusedTaskIndex === 0 || currentTask.startNewSection) {
          const floorDef = FLOORS.find(f => f.id === currentTask.floorId);
          return floorDef ? floorDef.start : undefined;
      }
      
      // Otherwise, start from the previous task
      return pickingTasks[focusedTaskIndex - 1].coordinates;
  };

  const currentTask = focusedTaskIndex !== null ? pickingTasks[focusedTaskIndex] : null;
  const currentOrderName = selectedOrderId ? cloudOrders.find(o => o.id === selectedOrderId)?.name : "";
  const hasPickedItems = pickingTasks.some(t => t.status === 'picked');

  return (
    <div className="relative w-full h-screen bg-gray-900 text-white overflow-hidden font-sans">
        {/* 3D Scene Background */}
        <div className="absolute inset-0 z-0">
             <Scene3D 
                visualLayout={visualLayout}
                layoutCoords={layoutCoords}
                tasks={pickingTasks}
                searchResults={searchResults}
                focusedTaskIndex={focusedTaskIndex}
                visibleFloor={visibleFloor}
                isHighlightActive={isHighlightActive}
                activePathStart={getActivePathStart()}
                isZoomedIn={isZoomedIn}
             />
        </div>

        {/* HUD - Header */}
        <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-start z-10 pointer-events-none">
             <div className="pointer-events-auto flex gap-2">
                 <button onClick={() => setIsSetupOpen(true)} className="bg-gray-800 p-2 rounded-lg border border-gray-600 hover:bg-gray-700 shadow-lg text-[#4fc3f7]">
                     <Home size={24} />
                 </button>
                 {!isSetupOpen && (
                     <>
                        <button onClick={loadCloudData} className="bg-gray-800 p-2 rounded-lg border border-gray-600 hover:bg-gray-700 shadow-lg text-white">
                            <RefreshCw size={24} className={isRefreshing ? "animate-spin" : ""} />
                        </button>
                        <button onClick={() => setShowHistory(true)} className="bg-gray-800 p-2 rounded-lg border border-gray-600 hover:bg-gray-700 shadow-lg flex items-center gap-2 px-3">
                            <History size={24} /> <span className="hidden sm:inline font-bold">Histórico</span>
                        </button>
                     </>
                 )}
             </div>
             
             {/* Order Name Display */}
             {!isSetupOpen && (
                <div className="bg-black/60 backdrop-blur px-4 py-2 rounded border border-white/10 shadow-lg pointer-events-auto max-w-xs truncate">
                    <div className="text-xs text-gray-400 uppercase font-bold text-center">Pedido Atual</div>
                    <h2 className="font-bold text-lg text-center text-[#ffeb3b]">{currentOrderName || "..."}</h2>
                </div>
             )}
        </div>

        {/* HUD - Task Info & Controls */}
        {currentTask && !isSetupOpen && !showFinishModal && (
            <div className="absolute bottom-0 left-0 right-0 p-6 z-10 pointer-events-none flex justify-center">
                 <div className="bg-gray-900/95 backdrop-blur-md border border-gray-700 rounded-2xl p-6 max-w-2xl w-full pointer-events-auto shadow-2xl relative">
                      
                      {/* Floating Buttons Group (Above QR) */}
                      <div className="absolute -top-16 right-0 flex gap-2 pointer-events-auto">
                          {/* Finalize Button */}
                          <button
                              onClick={() => setShowFinishModal(true)}
                              disabled={!hasPickedItems}
                              className={`p-3 rounded-full shadow-lg border flex items-center justify-center transition-all w-12 h-12 ${
                                hasPickedItems 
                                    ? 'bg-[#00e676]/20 border-[#00e676] hover:bg-[#00e676]/30 text-[#00e676]' 
                                    : 'bg-gray-800 border-gray-700 opacity-50 cursor-not-allowed text-gray-500'
                              }`}
                              title="Finalizar"
                          >
                              <CheckCheck size={20} />
                          </button>

                          {/* Zoom Button */}
                          <button
                              onClick={() => setIsZoomedIn(!isZoomedIn)}
                              className={`p-3 rounded-full shadow-lg border flex items-center justify-center transition-all w-12 h-12 ${isZoomedIn ? 'bg-[#4fc3f7]/20 border-[#4fc3f7] ring-2 ring-[#4fc3f7]/30' : 'bg-gray-800 hover:bg-gray-700 border-gray-600'}`}
                              title="Zoom"
                          >
                              {isZoomedIn ? (
                                  <ZoomOut size={20} className="text-[#4fc3f7]" />
                              ) : (
                                  <ZoomIn size={20} className="text-gray-300" />
                              )}
                          </button>

                          {/* Highlight Button */}
                          <button
                              onClick={() => setIsHighlightActive(!isHighlightActive)}
                              className={`p-3 rounded-full shadow-lg border flex items-center justify-center transition-all w-12 h-12 ${isHighlightActive ? 'bg-yellow-500/20 border-yellow-400 ring-2 ring-yellow-400/50' : 'bg-gray-800 hover:bg-gray-700 border-gray-600'}`}
                              title="Destacar"
                          >
                              <Zap size={20} className={isHighlightActive ? "text-yellow-400 fill-yellow-400" : "text-gray-400"} />
                          </button>

                          {/* Search Button */}
                          <button
                              onClick={() => setShowSearchModal(true)}
                              className="bg-gray-800 hover:bg-gray-700 p-3 rounded-full shadow-lg border border-gray-600 flex items-center justify-center w-12 h-12"
                              title="Pesquisar"
                          >
                              <Search size={20} className="text-[#4fc3f7]" />
                          </button>

                          {/* List Button */}
                          <button 
                              onClick={() => { setShowTaskList(true); setListViewMode('detailed'); }}
                              className="bg-gray-800 hover:bg-gray-700 p-3 rounded-full shadow-lg border border-gray-600 flex items-center justify-center w-12 h-12"
                              title="Lista"
                          >
                              <List size={20} className="text-[#4fc3f7]" />
                          </button>
                      </div>

                      <div className="flex justify-between items-center mb-6">
                          <div>
                              <div className="text-gray-400 text-sm uppercase font-bold tracking-wider">Passo {currentTask.sequence} de {pickingTasks.length}</div>
                              <h1 className="text-3xl font-bold text-white">{currentTask.material}</h1>
                              <div className="text-[#4fc3f7] font-mono text-xl flex items-center gap-2">
                                  <MapPin size={18}/> {currentTask.bin}
                              </div>
                          </div>
                          <div className="text-right">
                              <div className="text-gray-400 text-sm uppercase">Recolher</div>
                              <div className="text-5xl font-bold text-[#00e676]">{currentTask.qtyToPick}</div>
                          </div>
                      </div>
                      
                      {/* Stacked Scan Buttons */}
                      <div className="flex flex-col gap-3">
                          <button 
                             onClick={() => { setScanMode('recommended'); setIsScannerOpen(true); }}
                             className="w-full bg-[#0277bd] hover:bg-[#0288d1] py-4 rounded-xl font-bold flex justify-center items-center gap-2 shadow-lg shadow-blue-900/50 transition-colors text-lg"
                          >
                              <QrCode /> Scan Posição Recomendada
                          </button>
                          
                          <button 
                             onClick={() => { setScanMode('free'); setIsScannerOpen(true); }}
                             className="w-full bg-gray-700 hover:bg-gray-600 border border-gray-600 py-3 rounded-xl font-bold flex justify-center items-center gap-2 transition-colors text-gray-300"
                          >
                              <Box size={20} /> Scan Livre (Outra Posição)
                          </button>
                      </div>
                 </div>
            </div>
        )}

        {/* SEARCH MODAL */}
        {showSearchModal && (
            <div className="absolute inset-0 z-50 bg-black/90 flex flex-col items-center justify-start p-4 pt-10">
                <div className="w-full max-w-md bg-[#141923] border border-[#37474f] rounded-2xl flex flex-col shadow-2xl h-[70vh]">
                    <div className="p-4 border-b border-[#37474f] flex justify-between items-center bg-[#1e2736] rounded-t-2xl">
                        <h2 className="font-bold flex items-center gap-2"><Search className="text-[#4fc3f7]" /> Pesquisar</h2>
                        <button onClick={() => { setShowSearchModal(false); setSearchQuery(''); setSearchResults([]); }} className="text-gray-400 hover:text-white">
                            <X size={24} />
                        </button>
                    </div>
                    
                    <div className="p-4 border-b border-[#37474f]">
                        <input 
                            type="text" 
                            placeholder="Material, Descrição ou Lote..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-[#0f131a] border border-[#37474f] p-3 rounded-lg text-white focus:border-[#4fc3f7] focus:outline-none"
                            autoFocus
                        />
                    </div>

                    <div className="flex-1 overflow-y-auto p-2">
                        {searchResults.length === 0 && searchQuery && (
                            <div className="text-center text-gray-500 mt-4">Sem resultados.</div>
                        )}
                        {searchResults.map((result, idx) => {
                            const materialInfo = stock.find(s => s.bin === result.bin);
                            return (
                                <div 
                                    key={idx} 
                                    onClick={() => {
                                        // Move camera to this floor logic (simplified by just setting floor)
                                        const floor = FLOORS.find(f => result.x < f.maxX)?.id ?? 0;
                                        setVisibleFloor(floor);
                                        setShowSearchModal(false);
                                    }}
                                    className="p-3 border-b border-[#37474f] hover:bg-[#1e2736] cursor-pointer last:border-0"
                                >
                                    <div className="font-bold text-[#4fc3f7] flex items-center gap-2">
                                        <MapPin size={14} /> {result.bin}
                                    </div>
                                    {materialInfo ? (
                                        <div className="ml-5">
                                            <div className="text-white font-bold text-sm">{materialInfo.material}</div>
                                            <div className="text-gray-400 text-xs truncate">{materialInfo.description}</div>
                                            <div className="text-xs text-[#00e676] mt-1">Qtd: {materialInfo.qtyAvailable}</div>
                                        </div>
                                    ) : (
                                        <div className="ml-5 text-gray-500 text-xs italic">Posição Vazia</div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        )}

        {/* QR Scanner Modal (Custom) */}
        {isScannerOpen && (
            <div className="absolute inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4">
                <div className="w-full max-w-md bg-black rounded-xl overflow-hidden relative border border-gray-700 shadow-2xl">
                    <button 
                        onClick={() => setIsScannerOpen(false)} 
                        className="absolute top-4 right-4 z-20 bg-gray-800/80 text-white p-2 rounded-full backdrop-blur-sm"
                    >
                        <X size={24} />
                    </button>
                    
                    {/* Camera Container */}
                    <div id="qr-reader" className="w-full aspect-square bg-black overflow-hidden relative">
                        {/* Overlay elements if needed */}
                        <div className="absolute inset-0 border-2 border-[#4fc3f7]/30 pointer-events-none z-10 flex items-center justify-center">
                            <div className="w-64 h-64 border-2 border-[#4fc3f7] rounded-lg opacity-50"></div>
                        </div>
                    </div>

                    <div className="p-4 bg-gray-900 text-center text-sm text-gray-400 border-t border-gray-800">
                        {scanMode === 'recommended' 
                           ? `Lote: ${currentTask?.bin}` 
                           : `Material: ${currentTask?.material}`
                        }
                    </div>
                </div>
            </div>
        )}

        {/* Custom Confirmation Modal */}
        {confirmModal.isOpen && (
            <div className="absolute inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                 <div className={`bg-[#141923] border-2 rounded-2xl w-full max-w-sm p-6 shadow-2xl ${
                     confirmModal.type === 'danger' ? 'border-red-500/50' : 
                     confirmModal.type === 'success' ? 'border-[#00e676]/50' : 'border-[#4fc3f7]/50'
                 }`}>
                     <h3 className="text-xl font-bold mb-3 flex items-center gap-2 text-white">
                         {confirmModal.type === 'danger' ? <AlertTriangle className="text-red-500" /> : 
                          confirmModal.type === 'success' ? <CheckCircle className="text-[#00e676]" /> : 
                          <AlertTriangle className="text-[#4fc3f7]" />}
                         {confirmModal.title}
                     </h3>
                     <p className="text-gray-300 mb-6 text-sm">{confirmModal.message}</p>
                     <div className="flex gap-3">
                         <button 
                            onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))} 
                            className="flex-1 bg-gray-700 py-3 rounded-lg font-bold hover:bg-gray-600"
                         >
                             Não
                         </button>
                         <button 
                            onClick={confirmModal.onConfirm} 
                            className={`flex-1 py-3 rounded-lg font-bold text-black ${
                                confirmModal.type === 'danger' ? 'bg-red-500 hover:bg-red-400 text-white' : 
                                confirmModal.type === 'success' ? 'bg-[#00e676] hover:bg-[#00c853]' : 
                                'bg-[#4fc3f7] hover:bg-[#29b6f6]'
                            }`}
                         >
                             Sim
                         </button>
                     </div>
                 </div>
            </div>
        )}

        {/* Qty Confirmation Modal */}
        {showQtyModal && (
            <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                 <div className="bg-[#141923] border border-[#37474f] rounded-2xl w-full max-w-sm p-6 shadow-2xl">
                     <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                         <CheckCircle className="text-[#00e676]" /> Confirmar Qtd
                     </h3>
                     
                     {qtyMessage && (
                         <div className={`mb-4 p-3 rounded text-sm flex items-start gap-2 ${
                             qtyMessageType === 'error' ? 'bg-red-500/20 text-red-400 border border-red-500/50' :
                             qtyMessageType === 'warning' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50' :
                             qtyMessageType === 'success' ? 'bg-green-500/20 text-green-400 border border-green-500/50' :
                             'bg-blue-500/20 text-blue-400 border border-blue-500/50'
                         }`}>
                             {qtyMessageType === 'success' ? <CheckCircle size={16} className="mt-0.5 flex-shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />}
                             {qtyMessage}
                         </div>
                     )}

                     <div className="mb-4">
                         <label className="block text-gray-400 text-xs uppercase font-bold mb-2">Quantidade a Recolher</label>
                         <input 
                            type="number" 
                            value={qtyInput}
                            onChange={(e) => {
                                const val = Number(e.target.value);
                                if (val <= qtyMax) {
                                    setQtyInput(val);
                                } else {
                                    setQtyInput(qtyMax); // Clamp to max
                                }
                            }}
                            max={qtyMax}
                            className="w-full bg-[#0f131a] border border-[#37474f] rounded-lg p-4 text-3xl font-bold text-center text-white focus:border-[#00e676] focus:outline-none mb-2"
                         />
                         
                         {/* Stats Text */}
                         {tempTaskRef.current && (
                             <div className="flex justify-between text-xs text-gray-400 px-2 font-mono">
                                 <span>
                                     Qtd. Pedida: <span className="text-white font-bold">
                                         {orders.find(o => o.material === tempTaskRef.current?.material)?.qty || 0}
                                     </span>
                                 </span>
                                 <span>
                                     Disp. Local: <span className="text-white font-bold">
                                         {qtyMax}
                                     </span>
                                 </span>
                             </div>
                         )}
                     </div>

                     <div className="flex gap-3">
                         <button onClick={() => setShowQtyModal(false)} className="flex-1 bg-gray-700 py-3 rounded-lg font-bold">Cancelar</button>
                         <button onClick={onQtyConfirm} className="flex-1 bg-[#00e676] text-black py-3 rounded-lg font-bold hover:bg-[#00c853]">Confirmar</button>
                     </div>
                 </div>
            </div>
        )}

        {/* CUSTOM FINISH MODAL */}
        {showFinishModal && (
            <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4">
                 <div className="bg-[#141923] border border-[#00e676] rounded-2xl w-full max-w-sm p-8 shadow-2xl flex flex-col items-center text-center">
                     <div className="bg-[#00e676]/20 p-4 rounded-full mb-4">
                         <CheckCircle size={48} className="text-[#00e676]" />
                     </div>
                     <h2 className="text-2xl font-bold text-white mb-2">Picking Concluído</h2>
                     <p className="text-gray-400 mb-8">Todos os itens foram recolhidos com sucesso.</p>
                     
                     <div className="w-full space-y-3">
                         <button 
                            onClick={() => finishOrder(pickingTasks)}
                            disabled={isProcessing}
                            className="w-full bg-[#00e676] hover:bg-[#00c853] text-black font-bold py-4 rounded-xl flex justify-center items-center gap-2 disabled:opacity-50"
                         >
                             {isProcessing ? <Loader2 className="animate-spin" size={20} /> : <Upload size={20} />} 
                             Finalizar Encomenda
                         </button>
                         
                         <button 
                            onClick={handleKeepLocally}
                            disabled={isProcessing}
                            className="w-full bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-300 font-bold py-4 rounded-xl flex justify-center items-center gap-2 disabled:opacity-50"
                         >
                             <Save size={20} /> Manter Localmente & Sair
                         </button>
                     </div>
                 </div>
            </div>
        )}

        {/* Task List Modal */}
        {showTaskList && (
            <div className="absolute inset-0 z-40 bg-black/80 backdrop-blur-sm flex justify-end">
                <div className="w-full max-w-md bg-[#141923] h-full border-l border-[#37474f] flex flex-col shadow-2xl slide-in-right">
                    <div className="p-6 border-b border-[#37474f] bg-[#1e2736]">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold flex items-center gap-2"><List className="text-[#4fc3f7]" /> Lista de Picking</h2>
                            <button onClick={() => setShowTaskList(false)} className="text-gray-400 hover:text-white p-2">
                                <X size={24} />
                            </button>
                        </div>
                        
                        {/* Toggle */}
                        <div className="flex bg-[#141923] p-1 rounded-lg border border-[#37474f]">
                            <button 
                                onClick={() => setListViewMode('detailed')}
                                className={`flex-1 py-2 text-sm font-bold rounded-md transition-colors flex justify-center items-center gap-2 ${listViewMode === 'detailed' ? 'bg-[#0277bd] text-white shadow' : 'text-gray-400 hover:text-white'}`}
                            >
                                <Layers size={16} /> Detalhe (Lotes)
                            </button>
                            <button 
                                onClick={() => setListViewMode('summary')}
                                className={`flex-1 py-2 text-sm font-bold rounded-md transition-colors flex justify-center items-center gap-2 ${listViewMode === 'summary' ? 'bg-[#0277bd] text-white shadow' : 'text-gray-400 hover:text-white'}`}
                            >
                                <AlignJustify size={16} /> Resumo
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-2">
                        {listViewMode === 'summary' ? (
                            // Summary View Logic: Table of Material | Qtd Ordered | Qtd Picked
                            <div className="bg-[#1e2736] rounded-lg border border-[#37474f] overflow-hidden">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-[#263238] text-gray-400 font-bold text-xs uppercase">
                                        <tr>
                                            <th className="px-4 py-3">Material</th>
                                            <th className="px-4 py-3 text-center">Qtd Pedida</th>
                                            <th className="px-4 py-3 text-center">Qtd Recolhida</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#37474f]">
                                        {orders.map((orderItem, idx) => {
                                            // Calculate total picked for this material
                                            const picked = pickingTasks
                                                .filter(t => t.material === orderItem.material && t.status === 'picked')
                                                .reduce((acc, t) => acc + (t.pickedQty || 0), 0);
                                            
                                            const total = orderItem.qty;
                                            const isComplete = picked >= total && total > 0;
                                            const isZero = picked === 0;

                                            return (
                                                <tr key={idx} className="hover:bg-[#263238] transition-colors">
                                                    <td className="px-4 py-3 font-mono font-bold text-white break-all">
                                                        {orderItem.material}
                                                    </td>
                                                    <td className="px-4 py-3 text-center text-gray-300">
                                                        {total}
                                                    </td>
                                                    <td className={`px-4 py-3 text-center font-bold ${
                                                        isComplete ? 'text-[#00e676]' : 
                                                        isZero ? 'text-gray-500' : 'text-[#ffeb3b]'
                                                    }`}>
                                                        {picked}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            // Detailed View Logic
                            <>
                                {pickingTasks.map((task, idx) => {
                                    const isCompleted = task.status === 'picked';
                                    const isCurrent = focusedTaskIndex === idx;
                                    return (
                                        <div 
                                            key={idx} 
                                            onClick={() => {
                                                setFocusedTaskIndex(idx);
                                                setVisibleFloor(task.floorId);
                                                setShowTaskList(false);
                                            }}
                                            className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                                                isCurrent ? 'bg-[#0277bd]/20 border-[#0277bd] ring-1 ring-[#0277bd]' : 
                                                isCompleted ? 'bg-[#00e676]/5 border-[#00e676]/30 opacity-60' : 
                                                'bg-[#1e2736] border-[#37474f] hover:bg-[#263238]'
                                            }`}
                                        >
                                            <div className="flex justify-between items-center mb-1">
                                                <span className={`font-bold ${isCurrent ? 'text-white' : 'text-gray-300'}`}>
                                                    {idx + 1}. {task.material}
                                                </span>
                                                {isCompleted && <CheckCircle size={16} className="text-[#00e676]" />}
                                                {isCurrent && <span className="text-xs bg-[#0277bd] px-2 py-0.5 rounded font-bold">ATUAL</span>}
                                            </div>
                                            <div className="flex justify-between text-sm text-gray-400 font-mono">
                                                <span>{task.bin}</span>
                                                <span>Qtd: {task.qtyToPick}</span>
                                            </div>
                                        </div>
                                    );
                                })}

                                {/* Skipped Items Section */}
                                {skippedItems.length > 0 && (
                                    <div className="mt-6 pt-4 border-t border-[#37474f]">
                                        <h3 className="text-red-400 font-bold text-sm mb-3 flex items-center gap-2">
                                            <EyeOff size={16} /> ITENS SEM LOCALIZAÇÃO ({skippedItems.length})
                                        </h3>
                                        {skippedItems.map((item, idx) => (
                                            <div key={`skipped-${idx}`} className="p-3 bg-red-900/10 border border-red-900/30 rounded-lg mb-2 opacity-75">
                                                <div className="font-bold text-gray-300">{item.material}</div>
                                                <div className="text-xs text-gray-500">Qtd Requerida: {item.qty}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        )}

        {/* Main Menu / Setup Modal */}
        {isSetupOpen && (
            <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                 <div className="bg-[#141923] border border-[#37474f] rounded-2xl w-full max-w-md p-6 shadow-2xl flex flex-col max-h-[90vh] relative">
                     {/* Close Button if session active */}
                     {pickingTasks.length > 0 && (
                         <button 
                            onClick={() => setIsSetupOpen(false)}
                            className="absolute top-4 right-4 text-gray-400 hover:text-white p-2 bg-[#263238] rounded-full"
                         >
                             <X size={24} />
                         </button>
                     )}

                     <div className="flex-shrink-0 mb-4 flex justify-between items-end">
                         <div className="text-xs text-gray-500 uppercase font-bold tracking-wider">Pedidos</div>
                         <button 
                            onClick={loadCloudData} 
                            disabled={isRefreshing}
                            className="p-1.5 bg-[#1e2736] hover:bg-[#263238] border border-[#37474f] rounded-md text-[#4fc3f7] transition-colors disabled:opacity-50"
                            title="Atualizar Pedidos"
                         >
                             <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} />
                         </button>
                     </div>
                     
                     <div className="space-y-4 flex-1 overflow-y-auto min-h-0">
                         <div className="bg-[#1e2736] border border-[#37474f] rounded-lg overflow-hidden flex flex-col h-full max-h-[400px]">
                            <div className="overflow-y-auto flex-1 p-2 space-y-2 custom-scrollbar">
                                {sortedOrders.map(order => {
                                    const isActive = order.status === 'IN PROCESS';
                                    const isSelected = selectedOrderId === order.id;
                                    
                                    return (
                                        <div
                                            key={order.id}
                                            onClick={() => handleOrderSelect(order.id)}
                                            className={`p-3 rounded-lg cursor-pointer transition-all border 
                                                ${isSelected ? 'bg-[#0277bd]/10 border-[#0277bd] ring-1 ring-[#0277bd]' : 
                                                  isActive ? 'bg-yellow-500/5 border-yellow-500/30' : 
                                                  'bg-[#141923] border-[#37474f] hover:bg-[#263238]'}
                                            `}
                                        >
                                            <div className="flex justify-between items-center mb-1">
                                                <span className={`font-bold ${isSelected ? 'text-white' : isActive ? 'text-yellow-400' : 'text-gray-300'}`}>
                                                    {order.name}
                                                </span>
                                                {isActive && <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded border border-yellow-500/30 font-bold">EM PROCESSO</span>}
                                            </div>
                                            <div className="flex justify-between items-center text-xs">
                                                <div className="flex items-center gap-1 text-gray-500">
                                                    <Clock size={12} />
                                                    <span>{new Date(order.createdAt).toLocaleDateString()}</span>
                                                </div>
                                                <span className="bg-[#37474f] px-2 py-0.5 rounded text-gray-300">{order.items.length} itens</span>
                                            </div>

                                            {/* Expanded Detail View */}
                                            {isSelected && (
                                                <div className="mt-3 pt-3 border-t border-[#37474f] animate-fadeIn">
                                                    <div className="flex justify-between text-xs text-gray-400 mb-2">
                                                        <span className="flex items-center gap-1"><Calendar size={12}/> Data: {new Date(order.createdAt).toLocaleDateString()}</span>
                                                    </div>
                                                    
                                                    <div className="bg-[#0f131a] rounded p-2 max-h-32 overflow-y-auto custom-scrollbar border border-[#37474f]">
                                                        <table className="w-full text-xs text-left">
                                                            <thead className="text-gray-500 sticky top-0 bg-[#0f131a]">
                                                                <tr>
                                                                    <th className="pb-1 font-bold">Material</th>
                                                                    <th className="pb-1 text-right font-bold">Qtd</th>
                                                                    <th className="pb-1 text-right font-bold">Recolhido</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="text-gray-300">
                                                                {order.items.map((item, idx) => {
                                                                    // Calculate picked qty dynamically if this is the current active session
                                                                    let currentPicked = 0;
                                                                    let isFinished = false;
                                                                    
                                                                    if (selectedOrderId === currentSessionId) {
                                                                        const tasksForMaterial = pickingTasks.filter(t => t.material === item.material && t.status === 'picked');
                                                                        currentPicked = tasksForMaterial.reduce((acc, t) => acc + (t.pickedQty || 0), 0);
                                                                        isFinished = currentPicked >= item.qty;
                                                                    }

                                                                    return (
                                                                        <tr key={idx} className="border-b border-gray-800 last:border-0">
                                                                            <td className="py-1 truncate max-w-[120px]">{item.material}</td>
                                                                            <td className="py-1 text-right font-mono text-gray-400">{item.qty}</td>
                                                                            <td className={`py-1 text-right font-mono font-bold ${isFinished ? 'text-[#00e676]' : currentPicked > 0 ? 'text-yellow-400' : 'text-gray-600'}`}>
                                                                                {selectedOrderId === currentSessionId ? currentPicked : '-'}
                                                                            </td>
                                                                        </tr>
                                                                    );
                                                                })}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                {sortedOrders.length === 0 && <div className="text-center text-gray-500 py-10">Sem encomendas.</div>}
                            </div>
                         </div>
                         
                         {stockLoadDate && (
                             <p className="text-center text-xs text-gray-500">
                                 Stock atualizado a {stockLoadDate}
                             </p>
                         )}
                     </div>

                     <div className="flex-shrink-0 pt-4">
                         {selectedOrderId && (
                             <>
                                {cloudOrders.find(o => o.id === selectedOrderId)?.status === 'IN PROCESS' ? (
                                    <div className="flex flex-col gap-2">
                                        <button 
                                            onClick={generateRoute}
                                            disabled={isProcessing}
                                            className="w-full bg-[#0277bd] hover:bg-[#0288d1] text-white font-bold py-3 rounded-xl flex justify-center items-center gap-2 disabled:opacity-50"
                                        >
                                            <Play size={20} /> Retomar Picking
                                        </button>
                                        <div className="flex gap-2">
                                            <button 
                                                onClick={() => handleRevertOrder(selectedOrderId)}
                                                disabled={isProcessing}
                                                className="flex-1 bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-900/50 font-bold py-3 rounded-xl flex justify-center items-center gap-2 disabled:opacity-50"
                                            >
                                                {isProcessing ? <Loader2 className="animate-spin" size={18} /> : <Trash2 size={18} />} Cancelar
                                            </button>
                                            <button 
                                                onClick={() => handleForceFinish(selectedOrderId)}
                                                disabled={isProcessing}
                                                className="flex-1 bg-green-900/30 hover:bg-green-900/50 text-green-400 border border-green-900/50 font-bold py-3 rounded-xl flex justify-center items-center gap-2 disabled:opacity-50"
                                            >
                                                {isProcessing ? <Loader2 className="animate-spin" size={18} /> : <Upload size={18} />} Finalizar
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <button 
                                        onClick={generateRoute}
                                        disabled={stock.length === 0}
                                        className="w-full bg-[#00e676] hover:bg-[#00c853] disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold py-4 rounded-xl flex justify-center items-center gap-2 transition-all shadow-lg hover:shadow-green-500/20"
                                    >
                                        <Navigation /> Iniciar Picking
                                    </button>
                                )}
                             </>
                         )}
                         
                         <div className="border-t border-[#37474f] mt-4 pt-4">
                             <button 
                                onClick={onSwitchToManager} 
                                className="w-full bg-[#0277bd]/10 hover:bg-[#0277bd]/20 text-[#4fc3f7] border border-[#0277bd]/30 py-3 rounded-lg font-bold flex justify-center items-center gap-2 transition-colors text-sm"
                             >
                                 <History size={18} /> Histórico de Pedidos
                             </button>
                         </div>
                     </div>
                 </div>
            </div>
        )}
    </div>
  );
};

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Scene3D } from './Scene3D';
import { LayoutNode, OrderItem, PickingTask, StockItem, CloudOrder, WarehouseLayout } from '../types';
import { generatePickingList, reorderRemainingTasks, FLOORS } from '../utils/optimizer';
import { fetchStockFromCloud, fetchOpenOrdersFromCloud, markOrderComplete, updateOrderStatus } from '../utils/firebase';
import { DEFAULT_LAYOUT_COORDS, DEFAULT_VISUAL_LAYOUT } from '../utils/defaults';
import { Home, CheckCircle, Navigation, Package, ArrowRight, ArrowLeft, Clock, QrCode, List, X, RefreshCw, History, AlertTriangle, Box, MapPin, Play, Trash2, Upload, EyeOff, Save, AlignJustify, Layers, Loader2, Zap, ZoomIn, ZoomOut, Calendar, Search } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';

export const PickerInterface: React.FC<{ onSwitchToManager: () => void; companyLogo?: string }> = ({ onSwitchToManager, companyLogo }) => {
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

    // Load Cloud Data (Default)
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

  // QR Code Scanner Effect
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
              // Be careful with alerts in loop
          }
      } else {
          // Free Scan: Check if scan is a bin that contains the material
          const relevantStock = stock.filter(s => s.material === currentTask.material);
          const matchingStockItem = relevantStock.find(s => s.bin.toUpperCase() === scan);

          if (matchingStockItem) {
               if (!layoutCoords.has(matchingStockItem.bin)) {
                   alert("Lote válido, mas sem posição no layout 3D. Picking manual necessário.");
                   return;
               }
               handleScanMatch({
                   ...currentTask,
                   bin: matchingStockItem.bin,
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

      const localStock = stock.find(s => s.material === taskWithCorrectLocation.material && s.bin === taskWithCorrectLocation.bin)?.qtyAvailable || 0;
      setQtyMax(localStock);

      const targetQty = taskWithCorrectLocation.qtyToPick;
      const initialQty = Math.min(targetQty, localStock);
      setQtyInput(initialQty);

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
      const currentList = [...pickingTasks];
      const alreadyPicked = currentList.filter(t => t.status === 'picked' && t !== currentList[focusedTaskIndex]);
      
      const previouslyPickedQty = alreadyPicked
          .filter(t => t.material === material)
          .reduce((acc, t) => acc + (t.pickedQty || 0), 0);
          
      const totalPickedWithCurrent = previouslyPickedQty + confirmedQty;
      let remainingNeeded = orderTotal - totalPickedWithCurrent;
      
      let rawPending = currentList.filter(t => t.status !== 'picked' && t !== currentList[focusedTaskIndex]);
      let updatedPending: PickingTask[] = [];

      for (const t of rawPending) {
          if (t.material === material) {
              if (t.bin === modifiedTask.bin) continue;

              if (remainingNeeded <= 0) continue; 
              
              const newQty = Math.min(t.qtyToPick, remainingNeeded);
              updatedPending.push({ ...t, qtyToPick: newQty });
              remainingNeeded -= newQty;
          } else {
              updatedPending.push(t);
          }
      }

      if (remainingNeeded > 0) {
          const busyBins = new Set<string>();
          busyBins.add(modifiedTask.bin);
          updatedPending.filter(t => t.material === material).forEach(t => busyBins.add(t.bin));
          alreadyPicked.filter(t => t.material === material).forEach(t => busyBins.add(t.bin));

          const candidates = stock.filter(s => 
              s.material === material && 
              !busyBins.has(s.bin) && 
              s.qtyAvailable > 0
          );

          let tempRemaining = remainingNeeded;
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

              const getFloorId = (x: number) => {
                  if (x < 35) return 0;
                  if (x < 100) return 1;
                  return 2;
              };

              const qtyToTake = Math.min(cand.qtyAvailable, tempRemaining);
              
              updatedPending.push({
                  sequence: 999,
                  material: material,
                  bin: cand.bin,
                  qtyToPick: qtyToTake,
                  coordinates: { x: node.x, y: node.y, z: node.z },
                  distanceFromLast: 0,
                  floorId: getFloorId(node.x),
                  startNewSection: false
              });
              
              tempRemaining -= qtyToTake;
          }
      }

      if (updatedPending.length > 0) {
          const optimizedPath = reorderRemainingTasks(modifiedTask, updatedPending);
          updatedPending = optimizedPath.slice(1);
          
          let seq = alreadyPicked.length + 2; 
          updatedPending = updatedPending.map(t => ({
              ...t,
              sequence: seq++
          }));
      }

      const newList = [...alreadyPicked, { ...modifiedTask, sequence: alreadyPicked.length + 1 }, ...updatedPending];
      
      setPickingTasks(newList);
      setShowQtyModal(false);
      
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
          setStockLoadDate(new Date().toLocaleString());
          const o = await fetchOpenOrdersFromCloud();
          setCloudOrders(o);
      } catch (e) {
          console.error("Error loading cloud data", e);
      } finally {
          setIsRefreshing(false);
      }
  };

  const sortedOrders = useMemo(() => {
      return [...cloudOrders].sort((a, b) => {
          if (a.status === 'IN PROCESS' && b.status !== 'IN PROCESS') return -1;
          if (a.status !== 'IN PROCESS' && b.status === 'IN PROCESS') return 1;
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
  }, [cloudOrders]);

  const handleOrderSelect = (orderId: string) => {
      if (selectedOrderId === orderId) {
          setSelectedOrderId('');
          setOrders([]);
      } else {
          setSelectedOrderId(orderId);
          const order = cloudOrders.find(o => o.id === orderId);
          if (order) {
              setOrders(order.items);
          }
      }
  };

  const generateRoute = async () => {
    if (selectedOrderId === currentSessionId && pickingTasks.length > 0) {
        setIsSetupOpen(false);
        return;
    }

    if (layoutCoords.size === 0 || stock.length === 0 || orders.length === 0) {
      alert("Aguarde o carregamento do stock ou selecione uma encomenda.");
      return;
    }

    const validOrders: OrderItem[] = [];
    const skipped: OrderItem[] = [];

    for (const item of orders) {
        const matchingStock = stock.filter(s => s.material === item.material);
        if (matchingStock.length === 0) {
             skipped.push(item);
             continue;
        }
        const hasValidBin = matchingStock.some(s => s.bin && layoutCoords.has(s.bin));
        if (!hasValidBin) {
            skipped.push(item);
        } else {
            validOrders.push(item);
        }
    }

    if (skipped.length > 0) {
        alert(`Aviso: ${skipped.length} materiais não têm localização 3D definida ou stock.`);
    }

    if (validOrders.length === 0) {
        alert("Erro: Nenhum dos materiais da encomenda tem localização válida no layout.");
        return;
    }

    const tasks = generatePickingList(validOrders, stock, layoutCoords);
    
    if (tasks.length === 0) {
        alert("Erro: A lista de picking gerada está vazia.");
        return;
    }
    
    if (selectedOrderId) {
        try {
            await updateOrderStatus(selectedOrderId, 'IN PROCESS');
        } catch (error) {
            console.error("Failed to update status to IN PROCESS:", error);
        }
    }

    setPickingTasks(tasks);
    setSkippedItems(skipped);
    setCompletedTasks([]);
    setFocusedTaskIndex(0);
    setVisibleFloor(tasks[0].floorId);
    setCurrentSessionId(selectedOrderId); 
    setIsSetupOpen(false);
    
    loadCloudData();
  };

  const finishOrder = async (finalTasks: PickingTask[]) => {
      if (selectedOrderId) {
          setIsProcessing(true);
          const order = cloudOrders.find(o => o.id === selectedOrderId);
          const orderName = order?.name || "Desconhecido";
          
          try {
            await markOrderComplete(selectedOrderId, finalTasks);
            
            const newHistory = [...completedSessions, {
                name: orderName,
                date: new Date().toLocaleTimeString(),
                items: finalTasks.length
            }];
            setCompletedSessions(newHistory);
            localStorage.setItem('picker_history', JSON.stringify(newHistory));
            
            alert("Encomenda finalizada e enviada para a Cloud!");
            
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
      }
  };

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

  const handleForceFinish = (orderId: string) => {
      if (orderId === currentSessionId && pickingTasks.length > 0) {
          setConfirmModal({
              isOpen: true,
              title: 'Finalizar Encomenda',
              message: 'Deseja finalizar usando os dados da sessão atual?',
              type: 'success',
              onConfirm: () => {
                  setConfirmModal(prev => ({ ...prev, isOpen: false }));
                  finishOrder(pickingTasks);
              }
          });
      } else {
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

  const handleKeepLocally = () => {
      setShowFinishModal(false);
      setIsSetupOpen(true);
  };

  const getActivePathStart = (): {x: number, y: number, z: number} | undefined => {
      if (focusedTaskIndex === null) return undefined;
      const currentTask = pickingTasks[focusedTaskIndex];
      
      if (focusedTaskIndex === 0 || currentTask.startNewSection) {
          const floorDef = FLOORS.find(f => f.id === currentTask.floorId);
          return floorDef ? floorDef.start : undefined;
      }
      return pickingTasks[focusedTaskIndex - 1].coordinates;
  };

  const currentTask = focusedTaskIndex !== null ? pickingTasks[focusedTaskIndex] : null;
  const currentOrderName = selectedOrderId ? cloudOrders.find(o => o.id === selectedOrderId)?.name : "";
  const hasPickedItems = pickingTasks.some(t => t.status === 'picked');

  return (
    <div className="relative w-full h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-white overflow-hidden font-sans transition-colors duration-500">
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

        <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-start z-10 pointer-events-none">
             <div className="pointer-events-auto flex flex-col gap-3">
                 {companyLogo && (
                     <div className="bg-white/90 p-2 rounded-lg shadow-lg border border-gray-200 backdrop-blur-sm self-start">
                        <img src={companyLogo} alt="Logo" className="h-8 w-auto object-contain" />
                     </div>
                 )}

                 <div className="flex gap-2">
                    <button onClick={() => setIsSetupOpen(true)} className="bg-white dark:bg-gray-800 p-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 shadow-lg text-[#4fc3f7] transition-colors">
                        <Home size={24} />
                    </button>
                    {!isSetupOpen && (
                        <>
                            <button onClick={loadCloudData} className="bg-white dark:bg-gray-800 p-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 shadow-lg text-gray-700 dark:text-white transition-colors">
                                <RefreshCw size={24} className={isRefreshing ? "animate-spin" : ""} />
                            </button>
                            <button onClick={() => setShowHistory(true)} className="bg-white dark:bg-gray-800 p-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 shadow-lg flex items-center gap-2 px-3 text-gray-700 dark:text-white transition-colors">
                                <History size={24} /> <span className="hidden sm:inline font-bold">Histórico</span>
                            </button>
                        </>
                    )}
                 </div>
             </div>
             
             {!isSetupOpen && (
                <div className="bg-white/80 dark:bg-black/60 backdrop-blur px-4 py-2 rounded border border-gray-200 dark:border-white/10 shadow-lg pointer-events-auto max-w-xs truncate transition-colors">
                    <div className="text-xs text-gray-500 dark:text-gray-400 uppercase font-bold text-center">Pedido Atual</div>
                    <h2 className="font-bold text-lg text-center text-[#ffeb3b]">{currentOrderName || "..."}</h2>
                </div>
             )}
        </div>

        {currentTask && !isSetupOpen && !showFinishModal && (
            <div className="absolute bottom-0 left-0 right-0 p-6 z-10 pointer-events-none flex justify-center">
                 <div className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-md border border-gray-200 dark:border-gray-700 rounded-2xl p-6 max-w-2xl w-full pointer-events-auto shadow-2xl relative transition-colors duration-300">
                      
                      <div className="absolute -top-16 right-0 flex gap-2 pointer-events-auto">
                          <button
                              onClick={() => {
                                  setConfirmModal({
                                      isOpen: true,
                                      title: 'Finalizar Picking',
                                      message: 'Tem a certeza que deseja concluir o picking desta encomenda?',
                                      type: 'warning',
                                      onConfirm: () => {
                                          setConfirmModal(prev => ({ ...prev, isOpen: false }));
                                          setShowFinishModal(true);
                                      }
                                  });
                              }}
                              disabled={!hasPickedItems}
                              className={`p-3 rounded-full shadow-lg border flex items-center justify-center transition-all w-12 h-12 ${
                                hasPickedItems 
                                    ? 'bg-[#00e676]/20 border-[#00e676] hover:bg-[#00e676]/30 text-[#00e676]' 
                                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 opacity-50 cursor-not-allowed text-gray-400 dark:text-gray-500'
                              }`}
                              title="Finalizar"
                          >
                              <CheckCircle size={20} />
                          </button>

                          <button
                              onClick={() => setIsZoomedIn(!isZoomedIn)}
                              className={`p-3 rounded-full shadow-lg border flex items-center justify-center transition-all w-12 h-12 ${isZoomedIn ? 'bg-[#4fc3f7]/20 border-[#4fc3f7] ring-2 ring-[#4fc3f7]/30' : 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border-gray-200 dark:border-gray-600'}`}
                              title="Zoom"
                          >
                              {isZoomedIn ? (
                                  <ZoomOut size={20} className="text-[#4fc3f7]" />
                              ) : (
                                  <ZoomIn size={20} className="text-gray-500 dark:text-gray-300" />
                              )}
                          </button>

                          <button
                              onClick={() => setIsHighlightActive(!isHighlightActive)}
                              className={`p-3 rounded-full shadow-lg border flex items-center justify-center transition-all w-12 h-12 ${isHighlightActive ? 'bg-yellow-500/20 border-yellow-400 ring-2 ring-yellow-400/50' : 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border-gray-200 dark:border-gray-600'}`}
                              title="Destacar"
                          >
                              <Zap size={20} className={isHighlightActive ? "text-yellow-400 fill-yellow-400" : "text-gray-400"} />
                          </button>

                          <button
                              onClick={() => setShowSearchModal(true)}
                              className="bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 p-3 rounded-full shadow-lg border border-gray-200 dark:border-gray-600 flex items-center justify-center w-12 h-12 transition-colors"
                              title="Pesquisar"
                          >
                              <Search size={20} className="text-[#4fc3f7]" />
                          </button>

                          <button 
                              onClick={() => { setShowTaskList(true); setListViewMode('detailed'); }}
                              className="bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 p-3 rounded-full shadow-lg border border-gray-200 dark:border-gray-600 flex items-center justify-center w-12 h-12 transition-colors"
                              title="Lista"
                          >
                              <List size={20} className="text-[#4fc3f7]" />
                          </button>
                      </div>

                      <div className="flex justify-between items-center mb-6">
                          <div>
                              <div className="text-gray-500 dark:text-gray-400 text-sm uppercase font-bold tracking-wider flex items-center gap-2">
                                  Passo {currentTask.sequence} de {pickingTasks.length}
                                  {currentTask.isPartial && <span className="bg-orange-100 text-orange-600 px-2 py-0.5 rounded text-[10px] border border-orange-200">PARCIAL</span>}
                                  {currentTask.isSplit && <span className="bg-purple-100 text-purple-600 px-2 py-0.5 rounded text-[10px] border border-purple-200">MULTIPLOS LOCAIS</span>}
                              </div>
                              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{currentTask.material}</h1>
                              <div className="text-[#4fc3f7] font-mono text-xl flex items-center gap-2">
                                  <MapPin size={18}/> {currentTask.bin}
                              </div>
                          </div>
                          <div className="text-right">
                              <div className="text-gray-500 dark:text-gray-400 text-sm uppercase">Recolher</div>
                              <div className="text-5xl font-bold text-[#00e676]">{currentTask.qtyToPick}</div>
                          </div>
                      </div>
                      
                      <div className="flex flex-col gap-3">
                          <button 
                             onClick={() => { setScanMode('recommended'); setIsScannerOpen(true); }}
                             className="w-full bg-[#0277bd] hover:bg-[#0288d1] py-4 rounded-xl font-bold flex justify-center items-center gap-2 shadow-lg shadow-blue-900/20 dark:shadow-blue-900/50 transition-colors text-lg text-white"
                          >
                              <QrCode /> Scan Posição Recomendada
                          </button>
                          
                          <button 
                             onClick={() => { setScanMode('free'); setIsScannerOpen(true); }}
                             className="w-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 border border-gray-300 dark:border-gray-600 py-3 rounded-xl font-bold flex justify-center items-center gap-2 transition-colors text-gray-700 dark:text-gray-300"
                          >
                              <Box size={20} /> Scan Livre (Outra Posição)
                          </button>
                      </div>
                 </div>
            </div>
        )}

        {/* SETUP MODAL (Main Menu) */}
        {isSetupOpen && (
            <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                 <div className="bg-white dark:bg-[#141923] border border-gray-200 dark:border-[#37474f] rounded-2xl w-full max-w-md p-6 shadow-2xl flex flex-col max-h-[90vh] relative transition-colors">
                     {pickingTasks.length > 0 && (
                         <button 
                            onClick={() => setIsSetupOpen(false)}
                            className="absolute top-4 right-4 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white p-2 bg-gray-100 dark:bg-[#263238] rounded-full transition-colors z-10"
                         >
                             <X size={24} />
                         </button>
                     )}

                     {/* CLOUD MODE VIEW */}
                     <>
                         <div className="flex-shrink-0 mb-4 flex justify-between items-end">
                             <div className="text-xs text-gray-500 uppercase font-bold tracking-wider">Pedidos Cloud</div>
                             <button 
                                onClick={loadCloudData} 
                                disabled={isRefreshing}
                                className="p-1.5 bg-gray-100 dark:bg-[#1e2736] hover:bg-gray-200 dark:hover:bg-[#263238] border border-gray-200 dark:border-[#37474f] rounded-md text-[#4fc3f7] transition-colors disabled:opacity-50"
                                title="Atualizar Pedidos"
                             >
                                 <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} />
                             </button>
                         </div>
                         
                         <div className="space-y-4 flex-1 overflow-y-auto min-h-0">
                             <div className="bg-gray-50 dark:bg-[#1e2736] border border-gray-200 dark:border-[#37474f] rounded-lg overflow-hidden flex flex-col h-full max-h-[350px]">
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
                                                      isActive ? 'bg-yellow-500/10 dark:bg-yellow-500/5 border-yellow-500/30' : 
                                                      'bg-white dark:bg-[#141923] border-gray-200 dark:border-[#37474f] hover:bg-gray-100 dark:hover:bg-[#263238]'}
                                                `}
                                            >
                                                <div className="flex justify-between items-center mb-1">
                                                    <span className={`font-bold ${isSelected ? 'text-blue-600 dark:text-white' : isActive ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-700 dark:text-gray-300'}`}>
                                                        {order.name}
                                                    </span>
                                                    {isActive && <span className="text-[10px] bg-yellow-100 dark:bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 px-2 py-0.5 rounded border border-yellow-200 dark:border-yellow-500/30 font-bold">EM PROCESSO</span>}
                                                </div>
                                                <div className="flex justify-between items-center text-xs">
                                                    <div className="flex items-center gap-1 text-gray-500">
                                                        <Clock size={12} />
                                                        <span>{new Date(order.createdAt).toLocaleDateString()}</span>
                                                    </div>
                                                    <span className="bg-gray-100 dark:bg-[#37474f] px-2 py-0.5 rounded text-gray-600 dark:text-gray-300">{order.items.length} itens</span>
                                                </div>

                                                {isSelected && (
                                                    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-[#37474f] animate-fadeIn">
                                                        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-2">
                                                            <span className="flex items-center gap-1"><Calendar size={12}/> Data: {new Date(order.createdAt).toLocaleDateString()}</span>
                                                        </div>
                                                        
                                                        <div className="bg-gray-100 dark:bg-[#0f131a] rounded p-2 max-h-32 overflow-y-auto custom-scrollbar border border-gray-200 dark:border-[#37474f]">
                                                            <table className="w-full text-xs text-left">
                                                                <thead className="text-gray-500 sticky top-0 bg-gray-100 dark:bg-[#0f131a]">
                                                                    <tr>
                                                                        <th className="pb-1 font-bold">Material</th>
                                                                        <th className="pb-1 text-right font-bold">Qtd</th>
                                                                        <th className="pb-1 text-right font-bold">Stock Total</th>
                                                                        <th className="pb-1 text-right font-bold">Recolhido</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody className="text-gray-700 dark:text-gray-300">
                                                                    {order.items.map((item, idx) => {
                                                                        let currentPicked = 0;
                                                                        let isFinished = false;
                                                                        
                                                                        // Calculate total available stock for this material
                                                                        const totalStock = stock
                                                                            .filter(s => s.material === item.material)
                                                                            .reduce((acc, s) => acc + s.qtyAvailable, 0);

                                                                        if (selectedOrderId === currentSessionId) {
                                                                            const tasksForMaterial = pickingTasks.filter(t => t.material === item.material && t.status === 'picked');
                                                                            currentPicked = tasksForMaterial.reduce((acc, t) => acc + (t.pickedQty || 0), 0);
                                                                            isFinished = currentPicked >= item.qty;
                                                                        }

                                                                        return (
                                                                            <tr key={idx} className="border-b border-gray-200 dark:border-gray-800 last:border-0">
                                                                                <td className="py-1 truncate max-w-[120px]">{item.material}</td>
                                                                                <td className="py-1 text-right font-mono text-gray-500 dark:text-gray-400">{item.qty}</td>
                                                                                <td className={`py-1 text-right font-mono font-bold ${totalStock < item.qty ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'}`}>
                                                                                    {totalStock}
                                                                                </td>
                                                                                <td className={`py-1 text-right font-mono font-bold ${isFinished ? 'text-[#00e676]' : currentPicked > 0 ? 'text-yellow-500 dark:text-yellow-400' : 'text-gray-400 dark:text-gray-600'}`}>
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
                                                onClick={() => generateRoute()}
                                                disabled={isProcessing}
                                                className="w-full bg-[#0277bd] hover:bg-[#0288d1] text-white font-bold py-3 rounded-xl flex justify-center items-center gap-2 disabled:opacity-50"
                                            >
                                                <Play size={20} /> Retomar Picking
                                            </button>
                                            <div className="flex gap-2">
                                                <button 
                                                    onClick={() => handleRevertOrder(selectedOrderId)}
                                                    disabled={isProcessing}
                                                    className="flex-1 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/50 font-bold py-3 rounded-xl flex justify-center items-center gap-2 disabled:opacity-50 transition-colors"
                                                >
                                                    {isProcessing ? <Loader2 className="animate-spin" size={18} /> : <Trash2 size={18} />} Cancelar
                                                </button>
                                                <button 
                                                    onClick={() => handleForceFinish(selectedOrderId)}
                                                    disabled={isProcessing}
                                                    className="flex-1 bg-green-100 dark:bg-green-900/30 hover:bg-green-200 dark:hover:bg-green-900/50 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-900/50 font-bold py-3 rounded-xl flex justify-center items-center gap-2 disabled:opacity-50 transition-colors"
                                                >
                                                    {isProcessing ? <Loader2 className="animate-spin" size={18} /> : <Upload size={18} />} Finalizar
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <button 
                                            onClick={() => generateRoute()}
                                            disabled={stock.length === 0}
                                            className="w-full bg-[#00e676] hover:bg-[#00c853] disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold py-4 rounded-xl flex justify-center items-center gap-2 transition-all shadow-lg hover:shadow-green-500/20"
                                        >
                                            <Navigation /> Iniciar Picking
                                        </button>
                                    )}
                                 </>
                             )}
                         </div>
                     </>
                     
                     <div className="border-t border-gray-200 dark:border-[#37474f] mt-4 pt-4 flex flex-col gap-2">
                         <button 
                            onClick={() => setShowSearchModal(true)} 
                            className="w-full bg-gray-100 dark:bg-[#1e2736] hover:bg-gray-200 dark:hover:bg-[#263238] text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-[#37474f] py-3 rounded-lg font-bold flex justify-center items-center gap-2 transition-colors text-sm"
                         >
                             <Search size={18} /> Pesquisar Stock
                         </button>

                         <button 
                            onClick={onSwitchToManager} 
                            className="w-full bg-[#0277bd]/10 hover:bg-[#0277bd]/20 text-[#4fc3f7] border border-[#0277bd]/30 py-3 rounded-lg font-bold flex justify-center items-center gap-2 transition-colors text-sm"
                         >
                             <History size={18} /> Histórico de Pedidos
                         </button>
                     </div>
                 </div>
            </div>
        )}

        {showSearchModal && (
            <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-start p-4 pt-10">
                <div className="w-full max-w-md bg-white dark:bg-[#141923] border border-gray-200 dark:border-[#37474f] rounded-2xl flex flex-col shadow-2xl h-[70vh] transition-colors">
                    <div className="p-4 border-b border-gray-200 dark:border-[#37474f] flex justify-between items-center bg-gray-50 dark:bg-[#1e2736] rounded-t-2xl">
                        <h2 className="font-bold flex items-center gap-2 text-gray-900 dark:text-white"><Search className="text-[#4fc3f7]" /> Pesquisar</h2>
                        <button onClick={() => { setShowSearchModal(false); setSearchQuery(''); setSearchResults([]); }} className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
                            <X size={24} />
                        </button>
                    </div>
                    
                    <div className="p-4 border-b border-gray-200 dark:border-[#37474f]">
                        <input 
                            type="text" 
                            placeholder="Material, Descrição ou Lote..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-gray-100 dark:bg-[#0f131a] border border-gray-300 dark:border-[#37474f] p-3 rounded-lg text-gray-900 dark:text-white focus:border-[#4fc3f7] focus:outline-none transition-colors"
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
                                        const floor = FLOORS.find(f => result.x < f.maxX)?.id ?? 0;
                                        setVisibleFloor(floor);
                                        setShowSearchModal(false);
                                    }}
                                    className="p-3 border-b border-gray-200 dark:border-[#37474f] hover:bg-gray-100 dark:hover:bg-[#1e2736] cursor-pointer last:border-0 transition-colors"
                                >
                                    <div className="font-bold text-[#4fc3f7] flex items-center gap-2">
                                        <MapPin size={14} /> {result.bin}
                                    </div>
                                    {materialInfo ? (
                                        <div className="ml-5">
                                            <div className="text-gray-900 dark:text-white font-bold text-sm">{materialInfo.material}</div>
                                            <div className="text-gray-500 dark:text-gray-400 text-xs truncate">{materialInfo.description}</div>
                                            <div className="text-xs text-[#00e676] mt-1">Qtd: {materialInfo.qtyAvailable}</div>
                                        </div>
                                    ) : (
                                        <div className="ml-5 text-gray-400 dark:text-gray-500 text-xs italic">Posição Vazia</div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        )}

        {/* HISTORY MODAL (Now Added) */}
        {showHistory && (
            <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-white dark:bg-[#141923] border border-gray-200 dark:border-[#37474f] rounded-2xl w-full max-w-md p-6 shadow-2xl flex flex-col max-h-[80vh] transition-colors">
                    <div className="flex justify-between items-center mb-4 border-b border-gray-200 dark:border-[#37474f] pb-4">
                        <h2 className="text-xl font-bold flex items-center gap-2 text-gray-900 dark:text-white">
                            <History className="text-[#4fc3f7]" /> Histórico Local
                        </h2>
                        <button onClick={() => setShowHistory(false)} className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
                            <X size={24} />
                        </button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar">
                        {completedSessions.length === 0 ? (
                            <div className="text-center text-gray-500 py-8">Sem histórico recente neste dispositivo.</div>
                        ) : (
                            completedSessions.slice().reverse().map((session, idx) => (
                                <div key={idx} className="bg-gray-50 dark:bg-[#1e2736] border border-gray-200 dark:border-[#37474f] p-4 rounded-xl flex justify-between items-center">
                                    <div className="overflow-hidden">
                                        <div className="font-bold text-gray-900 dark:text-white truncate">{session.name}</div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                                            <Calendar size={10} /> {session.date}
                                        </div>
                                    </div>
                                    <div className="flex-shrink-0 bg-[#00e676]/20 text-[#00e676] px-3 py-1 rounded-full text-xs font-bold border border-[#00e676]/30">
                                        {session.items} itens
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-[#37474f]">
                        <button 
                            onClick={() => {
                                if(confirm("Limpar histórico local?")) {
                                    setCompletedSessions([]);
                                    localStorage.removeItem('picker_history');
                                }
                            }}
                            className="w-full text-red-500 text-sm hover:text-red-700 dark:hover:text-red-400 flex justify-center items-center gap-2"
                        >
                            <Trash2 size={16} /> Limpar Histórico
                        </button>
                    </div>
                </div>
            </div>
        )}

        {isScannerOpen && (
            <div className="absolute inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4">
                <div className="w-full max-w-md bg-black rounded-xl overflow-hidden relative border border-gray-700 shadow-2xl">
                    <button 
                        onClick={() => setIsScannerOpen(false)} 
                        className="absolute top-4 right-4 z-20 bg-gray-800/80 text-white p-2 rounded-full backdrop-blur-sm"
                    >
                        <X size={24} />
                    </button>
                    
                    <div id="qr-reader" className="w-full aspect-square bg-black overflow-hidden relative">
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

        {confirmModal.isOpen && (
            <div className="absolute inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                 <div className={`bg-white dark:bg-[#141923] border-2 rounded-2xl w-full max-w-sm p-6 shadow-2xl transition-colors ${
                     confirmModal.type === 'danger' ? 'border-red-500/50' : 
                     confirmModal.type === 'success' ? 'border-[#00e676]/50' : 'border-[#4fc3f7]/50'
                 }`}>
                     <h3 className="text-xl font-bold mb-3 flex items-center gap-2 text-gray-900 dark:text-white">
                         {confirmModal.type === 'danger' ? <AlertTriangle className="text-red-500" /> : 
                          confirmModal.type === 'success' ? <CheckCircle className="text-[#00e676]" /> : 
                          <AlertTriangle className="text-[#4fc3f7]" />}
                         {confirmModal.title}
                     </h3>
                     <p className="text-gray-600 dark:text-gray-300 mb-6 text-sm">{confirmModal.message}</p>
                     <div className="flex gap-3">
                         <button 
                            onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))} 
                            className="flex-1 bg-gray-200 dark:bg-gray-700 py-3 rounded-lg font-bold hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-white transition-colors"
                         >
                             Não
                         </button>
                         <button 
                            onClick={confirmModal.onConfirm} 
                            className={`flex-1 py-3 rounded-lg font-bold text-white dark:text-black ${
                                confirmModal.type === 'danger' ? 'bg-red-500 hover:bg-red-400' : 
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

        {showQtyModal && (
            <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                 <div className="bg-white dark:bg-[#141923] border border-gray-200 dark:border-[#37474f] rounded-2xl w-full max-w-sm p-6 shadow-2xl transition-colors">
                     <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-gray-900 dark:text-white">
                         <CheckCircle className="text-[#00e676]" /> Confirmar Qtd
                     </h3>
                     
                     {qtyMessage && (
                         <div className={`mb-4 p-3 rounded text-sm flex items-start gap-2 ${
                             qtyMessageType === 'error' ? 'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/50' :
                             qtyMessageType === 'warning' ? 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-500/50' :
                             qtyMessageType === 'success' ? 'bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-500/50' :
                             'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-500/50'
                         }`}>
                             {qtyMessageType === 'success' ? <CheckCircle size={16} className="mt-0.5 flex-shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />}
                             {qtyMessage}
                         </div>
                     )}

                     <div className="mb-4">
                         <label className="block text-gray-500 dark:text-gray-400 text-xs uppercase font-bold mb-2">Quantidade a Recolher</label>
                         <input 
                            type="number" 
                            value={qtyInput}
                            onChange={(e) => {
                                const val = Number(e.target.value);
                                if (val <= qtyMax) {
                                    setQtyInput(val);
                                } else {
                                    setQtyInput(qtyMax); 
                                }
                            }}
                            max={qtyMax}
                            className="w-full bg-gray-100 dark:bg-[#0f131a] border border-gray-300 dark:border-[#37474f] rounded-lg p-4 text-3xl font-bold text-center text-gray-900 dark:text-white focus:border-[#00e676] focus:outline-none mb-2 transition-colors"
                         />
                         
                         {tempTaskRef.current && (
                             <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 px-2 font-mono">
                                 <span>
                                     Qtd. Pedida: <span className="text-gray-900 dark:text-white font-bold">
                                         {orders.find(o => o.material === tempTaskRef.current?.material)?.qty || 0}
                                     </span>
                                 </span>
                                 <span>
                                     Disp. Local: <span className="text-gray-900 dark:text-white font-bold">
                                         {qtyMax}
                                     </span>
                                 </span>
                             </div>
                         )}
                     </div>

                     <div className="flex gap-3">
                         <button onClick={() => setShowQtyModal(false)} className="flex-1 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white py-3 rounded-lg font-bold hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">Cancelar</button>
                         <button onClick={onQtyConfirm} className="flex-1 bg-[#00e676] text-black py-3 rounded-lg font-bold hover:bg-[#00c853]">Confirmar</button>
                     </div>
                 </div>
            </div>
        )}

        {showFinishModal && (
            <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4">
                 <div className="bg-white dark:bg-[#141923] border border-[#00e676] rounded-2xl w-full max-w-sm p-8 shadow-2xl flex flex-col items-center text-center transition-colors">
                     <div className="bg-[#00e676]/20 p-4 rounded-full mb-4">
                         <CheckCircle size={48} className="text-[#00e676]" />
                     </div>
                     <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Picking Concluído</h2>
                     <p className="text-gray-500 dark:text-gray-400 mb-8">Todos os itens foram recolhidos com sucesso.</p>
                     
                     <div className="w-full space-y-3">
                         <button 
                            onClick={() => {
                                setConfirmModal({
                                    isOpen: true,
                                    title: 'Concluir Encomenda',
                                    message: 'Tem a certeza que deseja finalizar a encomenda e enviar para a Cloud?',
                                    type: 'success',
                                    onConfirm: () => {
                                        setConfirmModal(prev => ({ ...prev, isOpen: false }));
                                        finishOrder(pickingTasks);
                                    }
                                });
                            }}
                            disabled={isProcessing}
                            className="w-full bg-[#00e676] hover:bg-[#00c853] text-black font-bold py-4 rounded-xl flex justify-center items-center gap-2 disabled:opacity-50"
                         >
                             {isProcessing ? <Loader2 className="animate-spin" size={20} /> : <Upload size={20} />} 
                             {selectedOrderId === 'LOCAL_SESSION' ? 'Terminar (Local)' : 'Finalizar Encomenda'}
                         </button>
                         
                         <button 
                            onClick={handleKeepLocally}
                            disabled={isProcessing}
                            className="w-full bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-bold py-4 rounded-xl flex justify-center items-center gap-2 disabled:opacity-50 transition-colors"
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
                <div className="w-full max-w-md bg-white dark:bg-[#141923] h-full border-l border-gray-200 dark:border-[#37474f] flex flex-col shadow-2xl slide-in-right transition-colors">
                    <div className="p-6 border-b border-gray-200 dark:border-[#37474f] bg-gray-50 dark:bg-[#1e2736]">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold flex items-center gap-2 text-gray-900 dark:text-white"><List className="text-[#4fc3f7]" /> Lista de Picking</h2>
                            <button onClick={() => setShowTaskList(false)} className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white p-2">
                                <X size={24} />
                            </button>
                        </div>
                        
                        <div className="flex bg-gray-200 dark:bg-[#141923] p-1 rounded-lg border border-gray-300 dark:border-[#37474f]">
                            <button 
                                onClick={() => setListViewMode('detailed')}
                                className={`flex-1 py-2 text-sm font-bold rounded-md transition-colors flex justify-center items-center gap-2 ${listViewMode === 'detailed' ? 'bg-[#0277bd] text-white shadow' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}
                            >
                                <Layers size={16} /> Detalhe (Lotes)
                            </button>
                            <button 
                                onClick={() => setListViewMode('summary')}
                                className={`flex-1 py-2 text-sm font-bold rounded-md transition-colors flex justify-center items-center gap-2 ${listViewMode === 'summary' ? 'bg-[#0277bd] text-white shadow' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}
                            >
                                <AlignJustify size={16} /> Resumo
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-2">
                        {listViewMode === 'summary' ? (
                            <div className="bg-gray-50 dark:bg-[#1e2736] rounded-lg border border-gray-200 dark:border-[#37474f] overflow-hidden">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-gray-100 dark:bg-[#263238] text-gray-500 dark:text-gray-400 font-bold text-xs uppercase">
                                        <tr>
                                            <th className="px-4 py-3">Material</th>
                                            <th className="px-4 py-3 text-center">Qtd Pedida</th>
                                            <th className="px-4 py-3 text-center">Qtd Recolhida</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200 dark:divide-[#37474f]">
                                        {orders.map((orderItem, idx) => {
                                            const picked = pickingTasks
                                                .filter(t => t.material === orderItem.material && t.status === 'picked')
                                                .reduce((acc, t) => acc + (t.pickedQty || 0), 0);
                                            
                                            const total = orderItem.qty;
                                            const isComplete = picked >= total && total > 0;
                                            const isZero = picked === 0;

                                            return (
                                                <tr key={idx} className="hover:bg-gray-100 dark:hover:bg-[#263238] transition-colors">
                                                    <td className="px-4 py-3 font-mono font-bold text-gray-900 dark:text-white break-all">
                                                        {orderItem.material}
                                                    </td>
                                                    <td className="px-4 py-3 text-center text-gray-600 dark:text-gray-300">
                                                        {total}
                                                    </td>
                                                    <td className={`px-4 py-3 text-center font-bold ${
                                                        isComplete ? 'text-[#00e676]' : 
                                                        isZero ? 'text-gray-400 dark:text-gray-500' : 'text-yellow-600 dark:text-[#ffeb3b]'
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
                                                isCurrent ? 'bg-[#0277bd]/10 dark:bg-[#0277bd]/20 border-[#0277bd] ring-1 ring-[#0277bd]' : 
                                                isCompleted ? 'bg-green-50 dark:bg-[#00e676]/5 border-green-200 dark:border-[#00e676]/30 opacity-60' : 
                                                'bg-white dark:bg-[#1e2736] border-gray-200 dark:border-[#37474f] hover:bg-gray-50 dark:hover:bg-[#263238]'
                                            }`}
                                        >
                                            <div className="flex justify-between items-center mb-1">
                                                <span className={`font-bold ${isCurrent ? 'text-blue-600 dark:text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                                                    {idx + 1}. {task.material}
                                                </span>
                                                <div className="flex items-center gap-1">
                                                    {task.isPartial && <span className="w-2 h-2 rounded-full bg-orange-500" title="Parcial"></span>}
                                                    {task.isSplit && <span className="w-2 h-2 rounded-full bg-purple-500" title="Split"></span>}
                                                    {isCompleted && <CheckCircle size={16} className="text-[#00e676]" />}
                                                    {isCurrent && <span className="text-xs bg-[#0277bd] text-white px-2 py-0.5 rounded font-bold">ATUAL</span>}
                                                </div>
                                            </div>
                                            <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400 font-mono">
                                                <span>{task.bin}</span>
                                                <span>Qtd: {task.qtyToPick}</span>
                                            </div>
                                        </div>
                                    );
                                })}

                                {skippedItems.length > 0 && (
                                    <div className="mt-6 pt-4 border-t border-gray-200 dark:border-[#37474f]">
                                        <h3 className="text-red-500 dark:text-red-400 font-bold text-sm mb-3 flex items-center gap-2">
                                            <EyeOff size={16} /> ITENS SEM LOCALIZAÇÃO ({skippedItems.length})
                                        </h3>
                                        {skippedItems.map((item, idx) => (
                                            <div key={`skipped-${idx}`} className="p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-lg mb-2 opacity-75">
                                                <div className="font-bold text-gray-800 dark:text-gray-300">{item.material}</div>
                                                <div className="text-xs text-gray-600 dark:text-gray-500">Qtd Requerida: {item.qty}</div>
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
    </div>
  );
};
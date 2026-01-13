import React, { useState, useEffect, useRef } from 'react';
import { Settings, Search, CheckCircle, X, Download, Plus, Trash2, Edit3, FileSpreadsheet, List, Camera, ChevronRight, ScanLine, Warehouse, Lock, FileText, AlertCircle, RefreshCw, AlertTriangle, Layers, MapPin, ThumbsUp, RotateCcw, Cloud, CloudUpload, CloudDownload, Database } from 'lucide-react';
import { Scene3D } from './components/Scene3D';
import { FileUpload } from './components/FileUpload';
import { parseExcel, processOrderFile, processStockFile } from './utils/excelParser';
import { saveStockToCloud, fetchStockFromCloud, fetchOpenOrdersFromCloud, markOrderComplete, fetchCompletedOrdersFromCloud } from './utils/firebase';
import { generatePickingList, reorderRemainingTasks, FLOORS, determineFloor } from './utils/optimizer';
import { LayoutNode, OrderItem, PickingTask, StockItem, WarehouseLayout, PickingSession, CloudOrder } from './types';
import { DEFAULT_LAYOUT_COORDS, DEFAULT_VISUAL_LAYOUT } from './utils/defaults';
import { Html5Qrcode } from 'html5-qrcode';
import * as XLSX from 'xlsx';
import { ManagerDashboard } from './components/ManagerDashboard';

type AppStep = 'warehouse-select' | 'password' | 'main';

const App: React.FC = () => {
  // --- Auth & Navigation State ---
  const [appStep, setAppStep] = useState<AppStep>('warehouse-select');
  const [selectedWarehouse, setSelectedWarehouse] = useState<string | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState(false);

  // --- Data State ---
  const [layoutCoords, setLayoutCoords] = useState<Map<string, LayoutNode>>(new Map());
  const [visualLayout, setVisualLayout] = useState<WarehouseLayout | null>(null);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  
  // --- Cloud State ---
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);
  const [cloudStockDate, setCloudStockDate] = useState<string | null>(null);
  const [cloudOrders, setCloudOrders] = useState<CloudOrder[]>([]);
  const [currentCloudOrder, setCurrentCloudOrder] = useState<CloudOrder | null>(null);

  // --- UI State ---
  const [activeOrderName, setActiveOrderName] = useState<string>('');
  const [activeOrderDate, setActiveOrderDate] = useState<string>('');
  const [stockStatus, setStockStatus] = useState<'idle' | 'loaded' | 'error'>('idle');

  // --- Logic State ---
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [pickingTasks, setPickingTasks] = useState<PickingTask[]>([]);
  const [completedTasks, setCompletedTasks] = useState<PickingTask[]>([]);
  const [focusedTaskIndex, setFocusedTaskIndex] = useState<number | null>(null);
  const [sessionHistory, setSessionHistory] = useState<PickingSession[]>([]);
  const [shortages, setShortages] = useState<Map<string, boolean>>(new Map());
  
  // --- UI Toggles ---
  const [isSetupOpen, setIsSetupOpen] = useState(true);
  const [isManagerOpen, setIsManagerOpen] = useState(false); // Dashboard Toggle
  const [isPickListOpen, setIsPickListOpen] = useState(false);
  const [isCompletionOpen, setIsCompletionOpen] = useState(false);
  const [pickListViewMode, setPickListViewMode] = useState<'summary' | 'detailed'>('detailed');
  const [visibleFloor, setVisibleFloor] = useState<number | null>(null); 
  
  // Modal States
  const [pendingConfirmation, setPendingConfirmation] = useState<PickingTask | null>(null);
  const [confirmQty, setConfirmQty] = useState<number>(0);
  const [isEditingTask, setIsEditingTask] = useState(false);

  // Scan Other - Material Selection State
  const [isMaterialSelectOpen, setIsMaterialSelectOpen] = useState(false);
  const [scannedBinForSelection, setScannedBinForSelection] = useState<string | null>(null);
  const [materialCandidates, setMaterialCandidates] = useState<StockItem[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<LayoutNode[]>([]);
  
  // --- Camera State ---
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [scanMode, setScanMode] = useState<'normal' | 'adhoc'>('normal');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scanLockRef = useRef(false);
  
  // --- Initialize Defaults ---
  useEffect(() => {
    setVisualLayout(DEFAULT_VISUAL_LAYOUT);

    const map = new Map<string, LayoutNode>();
    DEFAULT_LAYOUT_COORDS.forEach(node => map.set(node.bin, node));
    setLayoutCoords(map);
    
    // Auto-fetch Stock and Orders on load
    refreshCloudData();
  }, []);

  const refreshCloudData = async () => {
      setIsCloudSyncing(true);
      try {
          // 1. Fetch Stock
          const cloudStock = await fetchStockFromCloud();
          if (cloudStock.length > 0) {
              setStock(cloudStock);
              setStockStatus('loaded');
              setCloudStockDate(new Date().toLocaleTimeString());
          }
          
          // 2. Fetch Open Orders
          const openOrders = await fetchOpenOrdersFromCloud();
          setCloudOrders(openOrders);
      } catch (e) {
          console.error("Cloud fetch failed", e);
          setStockStatus('error');
      } finally {
          setIsCloudSyncing(false);
      }
  };

  // --- Auth Handlers ---
  const handleWarehouseSelect = (wh: string) => {
    setSelectedWarehouse(wh);
    setAppStep('password');
    setPasswordError(false);
    setPasswordInput('');
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedWarehouse === 'SETLING AVAC' && passwordInput === '1234') {
        setAppStep('main');
        refreshCloudData(); // Ensure fresh data on login
    } else {
        setPasswordError(true);
        setTimeout(() => setPasswordError(false), 500);
    }
  };

  // --- Handlers ---
  const selectCloudOrder = (order: CloudOrder) => {
      setActiveOrderName(order.name);
      setActiveOrderDate(new Date(order.createdAt).toLocaleString());
      setOrders(order.items);
      setCurrentCloudOrder(order);
  };

  const calculateShortages = (currentOrders: OrderItem[], currentStock: StockItem[]) => {
    const shortageMap = new Map<string, boolean>();
    currentOrders.forEach(order => {
        const totalAvailable = currentStock
            .filter(s => s.material === order.material)
            .reduce((sum, s) => sum + s.qtyAvailable, 0);
        if (totalAvailable < order.qty) {
            shortageMap.set(order.material, true);
        }
    });
    setShortages(shortageMap);
  };

  const generateRoute = () => {
    if (layoutCoords.size === 0 || stock.length === 0 || orders.length === 0) {
      alert("Aguarde o carregamento do stock ou selecione uma encomenda.");
      return;
    }
    calculateShortages(orders, stock);
    const tasks = generatePickingList(orders, stock, layoutCoords);
    setPickingTasks(tasks);
    setCompletedTasks([]);
    if(tasks.length > 0) {
        setFocusedTaskIndex(0);
        setVisibleFloor(tasks[0].floorId);
    } else {
        alert("Não foi possível gerar tarefas. Verifique se os materiais da encomenda existem no stock.");
        return;
    }
    
    // Create new session ID
    setCurrentSessionId(`SESSION-${Date.now()}-${Math.floor(Math.random() * 10000)}`);
    
    setIsSetupOpen(false);
  };

  // ... [Keep addAdHocItem, handleManualTaskSelect, etc. unchanged] ...
  const addAdHocItem = (node: LayoutNode) => {
    const stockItem = stock.find(s => s.bin === node.bin);
    if (!stockItem) return;
    
    const isNeeded = orders.some(o => o.material === stockItem.material);

    const newTask: PickingTask = {
        sequence: Math.floor(Math.random() * 100000), 
        material: stockItem.material,
        bin: stockItem.bin,
        qtyToPick: 1, 
        coordinates: { x: node.x, y: node.y, z: node.z },
        distanceFromLast: 0,
        floorId: determineFloor(node.x),
        startNewSection: false,
        isAdHoc: !isNeeded, 
        requiresConfirmation: !isNeeded
    };

    if (isNeeded) {
        setPendingConfirmation(newTask);
        setConfirmQty(1);
    } else {
        const remainingTasks = pickingTasks.filter(t => !completedTasks.some(c => c.sequence === t.sequence));
        const reordered = reorderRemainingTasks(newTask, remainingTasks);
        setPickingTasks([...completedTasks, ...reordered]);
        setFocusedTaskIndex(completedTasks.length); 
        setSearchQuery('');
    }
  };

  const handleManualTaskSelect = (taskIndex: number) => {
      const selectedTask = pickingTasks[taskIndex];
      const isCompleted = completedTasks.some(c => c.sequence === selectedTask.sequence);
      
      if (isCompleted) return;

      const remainingOthers = pickingTasks.filter(t => 
          t.sequence !== selectedTask.sequence && 
          !completedTasks.some(c => c.sequence === t.sequence)
      );

      const optimizedRemaining = reorderRemainingTasks(selectedTask, remainingOthers);
      const newTaskList = [...completedTasks, ...optimizedRemaining];
      
      setPickingTasks(newTaskList);
      setFocusedTaskIndex(completedTasks.length);
      setIsPickListOpen(false);
      setVisibleFloor(selectedTask.floorId);
  };

  const initiateEditTask = (task: PickingTask) => {
      const completion = completedTasks.find(c => c.sequence === task.sequence);
      const picked = completion ? completion.pickedQty : task.qtyToPick;
      
      setPendingConfirmation(task);
      setConfirmQty(picked || 0);
      setIsEditingTask(true);
  };

  const handleResetOrDeleteTask = () => {
      if (!pendingConfirmation) return;
      
      const isPlanned = !pendingConfirmation.isAdHoc && pendingConfirmation.sequence < 900000;
      
      if (confirm("Tem a certeza que deseja remover este registo?")) {
          setCompletedTasks(prev => prev.filter(c => c.sequence !== pendingConfirmation.sequence));
          if (!isPlanned) {
              setPickingTasks(prev => prev.filter(t => t.sequence !== pendingConfirmation.sequence));
          }
          setPendingConfirmation(null);
          setIsEditingTask(false);
      }
  };

  // --- Ad-Hoc / Scan Other Logic ---
  const initiateScanOther = () => {
      setScanMode('adhoc');
      setIsCameraOpen(true);
  };

  const handleScanOtherResult = (binCode: string) => {
      const candidates = stock.filter(s => s.bin === binCode);
      if (candidates.length === 0) {
          setScanError(`Bin vazio ou inválido: ${binCode}`);
          setTimeout(() => setScanError(null), 2000);
          return;
      }
      setIsCameraOpen(false); 
      if (candidates.length === 1) {
          prepareAdHocConfirmation(candidates[0]);
      } else {
          setScannedBinForSelection(binCode);
          setMaterialCandidates(candidates);
          setIsMaterialSelectOpen(true);
      }
  };

  const prepareAdHocConfirmation = (item: StockItem) => {
      const node = layoutCoords.get(item.bin);
      const plannedTask = pickingTasks.find(t => t.material === item.material && !completedTasks.some(c => c.sequence === t.sequence));
      const isSubstitute = !!plannedTask;
      
      const task: PickingTask = {
          sequence: isSubstitute ? plannedTask.sequence : 999999 + Math.floor(Math.random() * 1000), 
          material: item.material,
          bin: item.bin,
          qtyToPick: isSubstitute ? plannedTask.qtyToPick : 1, 
          coordinates: node ? { x: node.x, y: node.y, z: node.z } : { x:0, y:0, z:0 },
          distanceFromLast: 0,
          floorId: node ? determineFloor(node.x) : 0,
          startNewSection: false,
          isAdHoc: !isSubstitute, 
          requiresConfirmation: !isSubstitute 
      };
      
      setPendingConfirmation(task);
      setConfirmQty(task.qtyToPick); 
      setIsEditingTask(false);
  };

  const processScan = (rawCode: string) => {
    if (scanLockRef.current) return;
    const scanned = rawCode.trim().toUpperCase();

    if (scanMode === 'adhoc') {
        scanLockRef.current = true;
        handleScanOtherResult(scanned);
        return;
    }

    if (pickingTasks.length === 0) return;
    
    const matchIndex = pickingTasks.findIndex(t => 
        (t.bin.trim().toUpperCase() === scanned || t.material.trim().toUpperCase() === scanned) &&
        !completedTasks.some(ct => ct.sequence === t.sequence)
    );

    if (matchIndex !== -1) {
        scanLockRef.current = true; 
        const task = pickingTasks[matchIndex];
        
        if (matchIndex !== focusedTaskIndex) {
            handleManualTaskSelect(matchIndex);
        }

        setScanError(null);
        setIsCameraOpen(false); 
        setPendingConfirmation(task);
        setConfirmQty(task.qtyToPick);
        setIsEditingTask(false);
    } else {
        setScanError(`Desconhecido: ${scanned}`);
        if (navigator.vibrate) navigator.vibrate(200);
        setTimeout(() => setScanError(null), 2000);
    }
  };

  const confirmPick = () => {
    if (!pendingConfirmation) return;
    
    const completedTask: PickingTask = { 
        ...pendingConfirmation, 
        pickedQty: confirmQty,
        status: 'picked', 
        timestamp: new Date().toISOString() 
    };
    
    setCompletedTasks(prev => {
        let updated = [...prev];
        if (completedTask.sequence && completedTask.sequence < 999999) {
             updated = updated.filter(c => c.sequence !== completedTask.sequence);
        } else {
             updated = updated.filter(c => c.sequence !== completedTask.sequence);
        }
        updated.push(completedTask);
        return updated;
    });

    setPendingConfirmation(null);
    setIsEditingTask(false);
    
    if (!isEditingTask) {
        setTimeout(() => {
            setFocusedTaskIndex(prev => {
                 if (prev === null) return null;
                 return prev; 
            });
            
            if (focusedTaskIndex !== null && pickingTasks[focusedTaskIndex].sequence === completedTask.sequence) {
                 if (focusedTaskIndex < pickingTasks.length - 1) {
                     setFocusedTaskIndex(focusedTaskIndex + 1);
                     if (pickingTasks[focusedTaskIndex + 1].floorId !== visibleFloor && visibleFloor !== null) {
                         setVisibleFloor(pickingTasks[focusedTaskIndex + 1].floorId);
                     }
                 } else {
                     setIsCompletionOpen(true);
                     setFocusedTaskIndex(null);
                 }
            }
        }, 50);
    }
  };

  // --- Excel & Session & Helper Functions ---
  const generateExcelFile = (sessionTasks: PickingTask[], orderName: string) => {
      const d = new Date();
      const formattedDate = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth()+1).padStart(2, '0')}.${d.getFullYear()}`;
      const headers = ["Itm", "C", "I", "Cen.", "Depósito de saída", "Depósito", "Material", "Texto breve", "Lote", "Qtd.pedido", "Dt.remessa"];
      const dataRows = sessionTasks.map((task, index) => {
          return [(index + 1) * 10, "P", "", "1700", "0001", "0004", task.material, "", task.bin, task.pickedQty || 0, formattedDate];
      });
      const wsData = [headers, ...dataRows];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Picking");
      XLSX.writeFile(wb, `${orderName || 'Picking'}_Concluido.xlsx`);
  };

  const finishSession = () => {
       const sid = currentSessionId || `SESSION-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
       const session: PickingSession = {
        id: sid,
        orderName: activeOrderName || 'Picking Rápido',
        orderDate: activeOrderDate || new Date().toLocaleString('pt-PT'),
        dateCompleted: new Date().toLocaleString('pt-PT'),
        tasks: [...completedTasks]
      };
      setSessionHistory(prev => {
          const index = prev.findIndex(s => s.id === sid);
          if (index !== -1) {
              const updated = [...prev];
              updated[index] = session;
              return updated;
          }
          return [session, ...prev];
      });
  };

  const clearSession = () => {
      setPickingTasks([]);
      setCompletedTasks([]);
      setActiveOrderName('');
      setActiveOrderDate('');
      setCurrentSessionId(null);
      setCurrentCloudOrder(null);
      setIsCompletionOpen(false);
      setIsPickListOpen(false);
      setFocusedTaskIndex(null);
      
      // Auto-reopen setup so they can pick next order
      setIsSetupOpen(true);
      refreshCloudData();
  };

  const exportAndFinish = async () => {
      generateExcelFile(completedTasks, activeOrderName);
      
      // Update Cloud Status
      if (currentCloudOrder) {
          await markOrderComplete(currentCloudOrder.id);
      }

      finishSession();
      clearSession();
  };

  const handleCloseCompletion = () => {
      // Just finish locally without updating cloud status? Or update anyway?
      // Assuming if they close completion they still finished the work.
      if (currentCloudOrder && confirm("Marcar encomenda como concluída na Cloud?")) {
          markOrderComplete(currentCloudOrder.id);
      }
      finishSession();
      clearSession();
  };

  const getPickListSummary = () => {
      const summary = new Map<string, { material: string, desc: string, ordered: number, picked: number, short: boolean, adHocItems?: PickingTask[] }>();
      orders.forEach(o => {
          const stockInfo = stock.find(s => s.material === o.material);
          summary.set(o.material, {
              material: o.material,
              desc: stockInfo ? stockInfo.description : 'Desconhecido',
              ordered: o.qty,
              picked: 0,
              short: shortages.get(o.material) || false,
              adHocItems: []
          });
      });
      completedTasks.forEach(t => {
          if (summary.has(t.material)) {
              const rec = summary.get(t.material)!;
              rec.picked += (t.pickedQty || t.qtyToPick);
          } else {
               const stockInfo = stock.find(s => s.material === t.material);
               if (!summary.has(t.material)) {
                   summary.set(t.material, {
                      material: t.material,
                      desc: stockInfo ? stockInfo.description : 'Ad-Hoc',
                      ordered: 0,
                      picked: 0, 
                      short: false,
                      adHocItems: []
                   });
               }
               const rec = summary.get(t.material)!;
               rec.picked += (t.pickedQty || t.qtyToPick);
               if (t.isAdHoc) rec.adHocItems?.push(t);
          }
      });
      return Array.from(summary.values());
  };

  const getPickListDetailed = () => {
      return pickingTasks.map(t => {
          const completed = completedTasks.find(c => c.sequence === t.sequence);
          const stockInfo = stock.find(s => s.material === t.material);
          return {
              ...t,
              desc: stockInfo ? stockInfo.description : '',
              actualPicked: completed ? (completed.pickedQty ?? t.qtyToPick) : 0,
              isCompleted: !!completed
          };
      });
  };

  const resumeSession = (session: PickingSession) => {
      setPickingTasks(session.tasks);
      setCompletedTasks(session.tasks); 
      setActiveOrderName(session.orderName);
      setActiveOrderDate(session.orderDate);
      setCurrentSessionId(session.id); 
      setIsSetupOpen(false);
      setFocusedTaskIndex(null);
      setIsPickListOpen(true);
  };

  const getValidationInfo = (task: PickingTask) => {
      const stockItem = stock.find(s => s.bin === task.bin && s.material === task.material);
      const localAvailable = stockItem ? stockItem.qtyAvailable : 0;
      
      const totalGlobalStock = stock
        .filter(s => s.material === task.material)
        .reduce((acc, curr) => acc + curr.qtyAvailable, 0);

      const orderTotal = orders
        .filter(o => o.material === task.material)
        .reduce((a, c) => a + c.qty, 0);

      const isGlobalShortage = totalGlobalStock < orderTotal;

      return { localAvailable, totalGlobalStock, orderTotal, isGlobalShortage };
  };

  // --- Camera Effect ---
  useEffect(() => {
    if (isCameraOpen) { scanLockRef.current = false; } else { return; }
    let isMounted = true;
    const startScanner = async () => {
        try {
            const scanner = new Html5Qrcode("reader");
            scannerRef.current = scanner;
            await scanner.start(
                { facingMode: "environment" },
                { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 }, 
                (decodedText) => { if (isMounted) processScan(decodedText); },
                () => {}
            );
        } catch (err) { console.error(err); if (isMounted) setIsCameraOpen(false); }
    };
    startScanner();
    return () => {
        isMounted = false;
        if (scannerRef.current) {
             try { if (scannerRef.current.isScanning) scannerRef.current.stop().catch(console.error); scannerRef.current.clear(); } catch(e) {}
             scannerRef.current = null;
        }
    };
  }, [isCameraOpen]);

  const getActivePathStart = () => {
     if (focusedTaskIndex === null) return null;
     const current = pickingTasks[focusedTaskIndex];
     if (!current) return null;
     if (current.startNewSection || focusedTaskIndex === 0) {
         return FLOORS.find(f => f.id === current.floorId)?.start || null;
     }
     const prev = pickingTasks[focusedTaskIndex - 1];
     if (prev) {
         if (prev.floorId !== current.floorId) return FLOORS.find(f => f.id === current.floorId)?.start || null;
         return prev.coordinates;
     }
     return null;
  };

  const currentTask = focusedTaskIndex !== null ? pickingTasks[focusedTaskIndex] : null;

  const renderSummaryTable = () => {
    const summaryData = getPickListSummary();
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm text-left text-gray-400">
                <thead className="text-xs text-gray-200 uppercase bg-[#263238]">
                    <tr>
                        <th className="px-4 py-3">Material</th>
                        <th className="px-4 py-3 text-center">Pedido</th>
                        <th className="px-4 py-3 text-center">Recolhido</th>
                        <th className="px-4 py-3 text-center">Status</th>
                    </tr>
                </thead>
                <tbody>
                    {summaryData.map((row, i) => {
                        const isComplete = row.picked >= row.ordered;
                        const isAdHoc = row.ordered === 0;
                        return (
                            <tr key={i} className="border-b border-[#37474f] hover:bg-[#1e2736]">
                                <td className="px-4 py-3">
                                    <div className="font-bold text-white">{row.material}</div>
                                    <div className="text-xs truncate max-w-[200px]">{row.desc}</div>
                                    {row.adHocItems && row.adHocItems.length > 0 && (
                                        <div className="text-[10px] text-blue-400 mt-1">Extra: {row.adHocItems.length}</div>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-center font-mono">{isAdHoc ? '-' : row.ordered}</td>
                                <td className="px-4 py-3 text-center font-mono text-white font-bold">{row.picked}</td>
                                <td className="px-4 py-3 text-center">
                                    {isAdHoc ? (
                                        <span className="bg-blue-500/20 text-blue-400 text-xs px-2 py-1 rounded font-bold">EXTRA</span>
                                    ) : isComplete ? (
                                        <span className="bg-green-500/20 text-green-400 text-xs px-2 py-1 rounded font-bold">OK</span>
                                    ) : row.short ? (
                                        <span className="bg-red-500/20 text-red-400 text-xs px-2 py-1 rounded font-bold">FALTA</span>
                                    ) : (
                                        <span className="bg-yellow-500/20 text-yellow-400 text-xs px-2 py-1 rounded font-bold">PARCIAL</span>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
  };

  // --- RENDER ---
  
  if (appStep === 'warehouse-select') return (
      <div className="w-screen h-screen bg-[#1a2332] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#141923] border border-[#37474f] rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-6">
               <div className="w-20 h-20 bg-[#0277bd] rounded-full flex items-center justify-center shadow-lg"><Warehouse size={40} className="text-white" /></div>
               <h1 className="text-2xl font-bold text-white text-center">Selecione o Armazém</h1>
               <div className="w-full space-y-4">
                   <button onClick={() => handleWarehouseSelect('SETLING AVAC')} className="w-full py-4 bg-[#263238] hover:bg-[#37474f] border border-[#455a64] rounded-lg text-white font-bold text-lg transition-all flex items-center justify-between px-6 group">SETLING AVAC <ChevronRight className="text-[#4fc3f7]" /></button>
                   <button className="w-full py-4 bg-[#1a2332] border border-[#2d3a4b] rounded-lg text-gray-500 font-bold text-lg cursor-not-allowed opacity-60 flex items-center justify-between px-6">SETLING HOTELARIA <span className="text-xs uppercase bg-black/40 px-2 py-1 rounded">Brevemente</span></button>
               </div>
          </div>
      </div>
  );

  if (appStep === 'password') return (
      <div className="w-screen h-screen bg-[#1a2332] flex items-center justify-center p-6">
           <div className="max-w-xs w-full bg-[#141923] border border-[#37474f] rounded-2xl shadow-2xl p-6 flex flex-col items-center gap-6 animate-fade-in">
               <div className="w-16 h-16 bg-[#263238] rounded-full flex items-center justify-center border border-[#37474f]"><Lock size={28} className="text-[#4fc3f7]" /></div>
               <div className="text-center"><h2 className="text-lg font-bold text-white">{selectedWarehouse}</h2><p className="text-sm text-gray-400">Introduza a password de acesso</p></div>
               <form onSubmit={handlePasswordSubmit} className="w-full space-y-4">
                   <input type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} className={`w-full bg-[#1a2332] border rounded-lg p-3 text-center text-white text-lg tracking-widest focus:outline-none focus:border-[#4fc3f7] ${passwordError ? 'border-red-500 animate-shake' : 'border-[#37474f]'}`} placeholder="••••" autoFocus />
                   <button type="submit" className="w-full py-3 bg-[#0277bd] text-white font-bold rounded-lg shadow hover:bg-[#0288d1]">ENTRAR</button>
               </form>
               <button onClick={() => setAppStep('warehouse-select')} className="text-gray-500 text-sm hover:text-white">Voltar</button>
           </div>
      </div>
  );

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-gray-900 text-white font-sans">
      <div className="absolute inset-0 z-0">
         <Scene3D 
            visualLayout={visualLayout} layoutCoords={layoutCoords}
            tasks={searchQuery ? [] : pickingTasks.filter(t => !completedTasks.find(c => c.sequence === t.sequence))} 
            searchResults={searchResults} focusedTaskIndex={focusedTaskIndex !== null ? 0 : null}
            activePathStart={getActivePathStart() || undefined} visibleFloor={visibleFloor}
         />
      </div>

      <div className="absolute top-0 left-0 right-0 z-20 p-4 pointer-events-none">
        <div className="flex gap-2 pointer-events-auto mb-2">
          <button onClick={() => setIsSetupOpen(true)} className="bg-[#263238] p-3 rounded-lg shadow-lg border border-[#37474f] text-white hover:bg-[#37474f] transition-colors"><Settings size={24} /></button>
          
          <div className="flex-1 relative">
            <input type="text" placeholder="Pesquisar / Ad-Hoc..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full h-full bg-[#263238] border border-[#37474f] rounded-lg pl-10 pr-4 text-white focus:outline-none" />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            {searchQuery && <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"><X size={16} /></button>}
            {searchResults.length > 0 && searchQuery && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-[#1e2736] rounded-lg shadow-xl border border-[#37474f] max-h-60 overflow-y-auto z-50">
                    {searchResults.map((node, i) => (
                        <div key={i} onClick={() => addAdHocItem(node)} className="p-3 border-b border-[#37474f] flex justify-between items-center">
                            <div><div className="text-white font-bold">{stock.find(s=>s.bin===node.bin)?.material || 'Desconhecido'}</div><div className="text-xs text-gray-400">{node.bin}</div></div>
                            <Plus size={20} className="text-[#00e676]" />
                        </div>
                    ))}
                </div>
            )}
          </div>
        </div>

        {/* Floor Toggles */}
        {!isSetupOpen && !isCompletionOpen && (
            <div className="flex justify-end gap-2 pointer-events-auto mt-2">
                <button onClick={() => setVisibleFloor(null)} className={`px-3 py-1.5 rounded font-bold text-xs shadow border ${visibleFloor === null ? 'bg-[#0277bd] text-white border-[#4fc3f7]' : 'bg-[#263238] text-gray-400 border-[#37474f]'}`}>ALL</button>
                <button onClick={() => setVisibleFloor(0)} className={`px-3 py-1.5 rounded font-bold text-xs shadow border ${visibleFloor === 0 ? 'bg-[#0277bd] text-white border-[#4fc3f7]' : 'bg-[#263238] text-gray-400 border-[#37474f]'}`}>P0</button>
                <button onClick={() => setVisibleFloor(1)} className={`px-3 py-1.5 rounded font-bold text-xs shadow border ${visibleFloor === 1 ? 'bg-[#0277bd] text-white border-[#4fc3f7]' : 'bg-[#263238] text-gray-400 border-[#37474f]'}`}>P1</button>
                <button onClick={() => setVisibleFloor(2)} className={`px-3 py-1.5 rounded font-bold text-xs shadow border ${visibleFloor === 2 ? 'bg-[#0277bd] text-white border-[#4fc3f7]' : 'bg-[#263238] text-gray-400 border-[#37474f]'}`}>P2</button>
            </div>
        )}

        {/* Order Badge */}
        {!isSetupOpen && !isCompletionOpen && activeOrderName && (
             <div className="flex justify-center animate-fade-in pointer-events-auto mt-2">
                <div className="bg-[#141923]/90 backdrop-blur border border-[#37474f] text-white px-4 py-2 rounded-full text-sm font-bold shadow-lg flex items-center gap-2 max-w-full">
                    <FileText size={14} className="text-[#4fc3f7] shrink-0" />
                    <span className="truncate">{activeOrderName}</span>
                </div>
             </div>
        )}
      </div>

      {isSetupOpen && (
        <div className="absolute inset-0 z-50 bg-[#1a2332] flex flex-col animate-fade-in">
          <div className="p-4 border-b border-[#37474f] flex justify-between items-center bg-[#141923]">
            <h2 className="text-xl font-bold text-[#4fc3f7] flex items-center gap-2"><Settings size={20} /> Seleção de Pedido</h2>
            <div className="flex gap-3">
                 <button onClick={() => setIsManagerOpen(true)} className="text-xs bg-[#263238] hover:bg-[#37474f] border border-[#37474f] px-3 py-2 rounded flex items-center gap-2">
                    <Database size={14} /> PLATAFORMA GESTÃO
                 </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
             
             {/* Open Orders Section */}
             <div className="bg-[#141923] p-4 rounded-lg border border-[#37474f]">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-sm font-bold text-[#ffeb3b] uppercase flex items-center gap-2">
                        <List size={16} /> Pedidos Abertos
                    </h3>
                    <button onClick={refreshCloudData} className="p-2 bg-[#263238] rounded-full hover:bg-[#37474f]">
                        <RefreshCw size={14} className={isCloudSyncing ? 'animate-spin' : ''} />
                    </button>
                </div>
                
                <div className="space-y-2 max-h-[60vh] overflow-y-auto min-h-[100px]">
                    {cloudOrders.length === 0 ? (
                        <div className="text-center text-gray-500 py-8 flex flex-col items-center">
                            <Cloud size={32} className="mb-2 opacity-20" />
                            <p>Sem pedidos pendentes</p>
                        </div>
                    ) : (
                        cloudOrders.map(order => (
                            <button 
                                key={order.id} 
                                onClick={() => selectCloudOrder(order)}
                                className={`w-full text-left p-4 rounded-lg border transition-all flex justify-between items-center ${activeOrderName === order.name ? 'bg-[#263238] border-[#00e676]' : 'bg-[#1e2736] border-[#37474f] hover:border-[#4fc3f7]'}`}
                            >
                                <div>
                                    <div className="font-bold text-white text-lg">{order.name}</div>
                                    <div className="text-xs text-gray-400 mt-1">{new Date(order.createdAt).toLocaleString()}</div>
                                </div>
                                <div className="text-right">
                                    <div className="bg-[#0277bd]/20 text-[#4fc3f7] font-bold px-3 py-1 rounded text-sm">{order.items.length} ITENS</div>
                                </div>
                            </button>
                        ))
                    )}
                </div>
             </div>
             
             {/* Stock Status Section */}
             <div className="flex justify-between items-center text-xs text-gray-500 bg-[#1e2736] p-3 rounded border border-[#37474f]">
                 <div className="flex items-center gap-2">
                     <Database size={14} />
                     <span>Stock Atual: {stock.length} registos</span>
                 </div>
                 <button onClick={refreshCloudData} className="text-[#4fc3f7] hover:underline flex items-center gap-1">
                     <RefreshCw size={10} /> Atualizar Stock
                 </button>
             </div>

          </div>
          <div className="p-4 border-t border-[#37474f] bg-[#141923]">
            <button 
                onClick={generateRoute} 
                disabled={!activeOrderName || stock.length === 0}
                className={`w-full py-4 rounded-lg shadow-lg font-bold text-lg flex justify-center items-center gap-2 ${!activeOrderName || stock.length === 0 ? 'bg-[#263238] text-gray-500 cursor-not-allowed' : 'bg-[#00e676] text-black hover:bg-[#00c853]'}`}
            >
                INICIAR PICKING <ChevronRight />
            </button>
          </div>
        </div>
      )}

      {/* Manager Dashboard Overlay */}
      {isManagerOpen && (
          <ManagerDashboard onClose={() => { setIsManagerOpen(false); refreshCloudData(); }} />
      )}

      {/* ... [Rest of the App - Task View, Pick List Modal, etc.] ... */}
      
      {!isSetupOpen && !isCompletionOpen && !searchQuery && !pendingConfirmation && !isMaterialSelectOpen && pickingTasks.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 z-30 p-4">
          <div className="absolute bottom-72 left-4 z-40">
            <button onClick={() => setIsPickListOpen(true)} className="w-14 h-14 bg-[#0277bd] rounded-full flex items-center justify-center border-2 border-[#4fc3f7] shadow-xl"><List size={28} className="text-white" /></button>
          </div>
          <div className="bg-[#141923] rounded-xl shadow-2xl border border-[#37474f] p-4 flex flex-col gap-3">
              {currentTask ? (
                  <>
                    <div className="flex justify-between items-start">
                        <div><span className="bg-[#00e676] text-black text-xs font-bold px-2 py-0.5 rounded">#{currentTask.sequence}</span><h2 className="text-xl font-bold text-white mt-1">{currentTask.material}</h2></div>
                        <div className="text-right"><div className="text-3xl font-bold text-[#ffeb3b]">{currentTask.qtyToPick}</div></div>
                    </div>
                    <div className="bg-[#263238] p-3 rounded-lg flex justify-between items-center border border-[#37474f]">
                        <span className="text-gray-400 text-xs uppercase">Local Alvo</span>
                        <span className="text-2xl font-mono font-bold text-[#4fc3f7]">{currentTask.bin}</span>
                        <span className="bg-[#37474f] text-xs px-2 py-1 rounded text-gray-300">Piso {currentTask.floorId}</span>
                    </div>
                  </>
              ) : <div className="text-center text-gray-400 py-4">Nenhuma tarefa ativa</div>}
              
              <button onClick={() => { setScanMode('normal'); setIsCameraOpen(true); }} className={`w-full bg-[#00e676] text-black h-12 rounded-lg flex items-center justify-center gap-2 font-bold shadow-lg active:scale-95 transition-transform text-sm uppercase`}><Camera size={20} />{scanError ? 'ERRO AO LER' : 'DIGITALIZAR POSIÇÃO RECOMENDADA'}</button>
              <button onClick={initiateScanOther} className="w-full bg-[#37474f] text-gray-200 h-10 rounded-lg flex items-center justify-center gap-2 font-bold shadow active:scale-95 transition-transform text-xs uppercase hover:bg-[#455a64]"><ScanLine size={16} />DIGITALIZAR OUTRA POSIÇÃO</button>
          </div>
        </div>
      )}

      {/* Pick List Modal */}
      {isPickListOpen && (
          <div className="absolute inset-0 z-50 flex items-center justify-center p-4 animate-fade-in bg-black/50 backdrop-blur-sm">
             <div className="w-full max-w-2xl max-h-[85vh] bg-[#1a2332]/90 border border-[#37474f] rounded-xl shadow-2xl flex flex-col overflow-hidden backdrop-blur-md">
                 <div className="p-4 border-b border-[#37474f] flex justify-between items-center bg-[#141923]/80">
                    <h2 className="text-lg font-bold text-white flex items-center gap-2"><FileText size={20} /> Detalhes da Encomenda</h2>
                    <div className="flex gap-2">
                        <button onClick={() => setPickListViewMode(pickListViewMode === 'summary' ? 'detailed' : 'summary')} className="p-2 bg-[#263238] rounded text-xs font-bold text-gray-300 border border-[#37474f]">{pickListViewMode === 'summary' ? 'VER ROTA' : 'VER RESUMO'}</button>
                        <button onClick={() => setIsPickListOpen(false)}><X size={24} /></button>
                    </div>
                 </div>
                 
                 <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {pickListViewMode === 'detailed' && (
                        <div className="grid grid-cols-12 gap-2 text-[10px] uppercase font-bold text-gray-400 border-b border-[#37474f] pb-2 mb-2 sticky top-0 bg-[#1a2332] z-10 py-2">
                            <div className="col-span-1 text-center">Seq</div>
                            <div className="col-span-4">Material</div>
                            <div className="col-span-3">Local</div>
                            <div className="col-span-2 text-center">Qtd</div>
                            <div className="col-span-2 text-center">Ação</div>
                        </div>
                    )}

                    {pickListViewMode === 'summary' ? renderSummaryTable() : getPickListDetailed().map((item, i) => (
                         <div key={i} className={`bg-[#1e2736]/50 p-2 rounded border text-sm ${item.isCompleted ? 'border-green-500/50' : 'border-[#37474f]'} flex flex-col`}>
                            <div className="grid grid-cols-12 items-center gap-2">
                                <div className="col-span-1 text-center font-mono text-xs text-gray-500">{item.sequence}</div>
                                <div className="col-span-4"><div className="font-bold truncate">{item.material}</div><div className="text-[10px] text-gray-500 truncate">{item.desc}</div></div>
                                <div className="col-span-3 text-[#4fc3f7] font-mono text-xs truncate">{item.bin}</div>
                                <div className="col-span-2 text-center">
                                    {!item.isCompleted ? (
                                        <span className="text-white font-bold">{item.qtyToPick}</span>
                                    ) : (
                                        item.actualPicked < item.qtyToPick ? (
                                            <div className="flex flex-col items-center">
                                                <span className="text-red-500 font-bold text-lg leading-none">{item.actualPicked}</span>
                                                <span className="text-[9px] text-gray-400">de {item.qtyToPick}</span>
                                            </div>
                                        ) : (
                                            <span className="text-[#00e676] font-bold text-lg">{item.actualPicked}</span>
                                        )
                                    )}
                                </div>
                                <div className="col-span-2 flex justify-center gap-1">
                                    {!item.isCompleted ? (
                                        <button onClick={() => handleManualTaskSelect(i)} className="p-1 bg-[#0277bd] text-white rounded hover:bg-[#0288d1]" title="Definir como alvo"><MapPin size={16} /></button>
                                    ) : (
                                        <button onClick={() => initiateEditTask(item)} className="p-1 bg-[#263238] text-gray-300 border border-[#37474f] rounded hover:bg-[#37474f]" title="Editar / Resetar"><Edit3 size={16} /></button>
                                    )}
                                </div>
                            </div>
                         </div>
                    ))}
                 </div>
                 
                 <div className="p-4 bg-[#141923]/80 border-t border-[#37474f]">
                     <button onClick={exportAndFinish} className="w-full py-3 bg-[#0277bd] text-white font-bold rounded-lg shadow-lg flex items-center justify-center gap-2 text-sm"><Download size={18} />CONCLUIR E EXPORTAR</button>
                 </div>
             </div>
          </div>
      )}

      {/* Material Selection Modal */}
      {isMaterialSelectOpen && (
          <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
              <div className="w-full max-w-sm bg-[#1a2332] border border-[#37474f] rounded-xl p-6 shadow-2xl">
                  <h2 className="text-xl font-bold text-white mb-2">Posição {scannedBinForSelection}</h2>
                  <p className="text-gray-400 text-sm mb-4">Selecione o material que deseja recolher:</p>
                  <div className="space-y-2 max-h-60 overflow-y-auto mb-4">
                      {materialCandidates.map((cand, i) => (
                          <button key={i} onClick={() => { setIsMaterialSelectOpen(false); prepareAdHocConfirmation(cand); }} className="w-full text-left p-3 bg-[#263238] hover:bg-[#37474f] rounded border border-[#37474f] flex justify-between items-center">
                              <div><div className="font-bold text-[#4fc3f7]">{cand.material}</div><div className="text-xs text-gray-500">{cand.description}</div></div>
                              <div className="text-white font-mono bg-black/20 px-2 py-1 rounded">Qtd: {cand.qtyAvailable}</div>
                          </button>
                      ))}
                  </div>
                  <button onClick={() => setIsMaterialSelectOpen(false)} className="w-full py-3 bg-red-600 text-white font-bold rounded">CANCELAR</button>
              </div>
          </div>
      )}

      {/* Completion Modal */}
      {isCompletionOpen && (
         <div className="absolute inset-0 z-50 bg-[#1a2332] flex flex-col animate-fade-in">
             <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                 <div className="w-24 h-24 bg-[#00e676] rounded-full flex items-center justify-center shadow-lg mb-6"><CheckCircle size={50} className="text-black" /></div>
                 <h1 className="text-3xl font-bold text-white mb-2">Picking Concluído!</h1>
                 <p className="text-gray-400 mb-8">Todos os itens da rota foram processados.</p>
                 <div className="w-full max-w-lg bg-[#141923] rounded-xl border border-[#37474f] overflow-hidden flex-1 max-h-[50vh] flex flex-col">
                     <div className="p-4 border-b border-[#37474f] bg-[#1e2736] font-bold text-left">Resumo Final</div>
                     <div className="flex-1 overflow-y-auto p-4 text-left">{renderSummaryTable()}</div>
                 </div>
             </div>
             <div className="p-6 bg-[#141923] border-t border-[#37474f] flex gap-3">
                 <button onClick={exportAndFinish} className="flex-1 py-4 bg-[#00e676] text-black font-bold rounded-lg shadow-lg flex items-center justify-center gap-2 text-lg hover:bg-[#00c853] transition-colors"><Download size={24} /> EXPORTAR EXCEL E SAIR</button>
                 <button onClick={handleCloseCompletion} className="w-20 bg-red-600 text-white font-bold rounded-lg shadow-lg flex items-center justify-center hover:bg-red-700 transition-colors"><X size={28} /></button>
             </div>
         </div>
      )}

      {/* Confirmation / Edit Modal */}
      {pendingConfirmation && (
         <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-6">
             <div className="bg-[#1a2332] w-full max-w-sm rounded-xl overflow-hidden border border-[#37474f] animate-scale-in">
                 <div className={`p-4 flex justify-center ${isEditingTask ? 'bg-orange-500' : (pendingConfirmation.isAdHoc ? 'bg-blue-500' : 'bg-[#00e676]')}`}>
                     {isEditingTask ? <Edit3 size={48} className="text-white" /> : <CheckCircle size={48} className="text-black" />}
                 </div>
                 <div className="p-6 text-center">
                    <h2 className="text-2xl font-bold text-white mb-1">{pendingConfirmation.material}</h2>
                    <div className="text-[#4fc3f7] font-mono mb-2">{pendingConfirmation.bin}</div>
                    
                    {/* Warnings */}
                    {getValidationInfo(pendingConfirmation).isGlobalShortage && !isEditingTask && (
                        <div className="bg-red-500/20 border border-red-500 p-2 rounded mb-4 text-xs text-red-400 font-bold flex items-center justify-center gap-2">
                            <AlertCircle size={16} /> STOCK INSUFICIENTE (Total: {getValidationInfo(pendingConfirmation).totalGlobalStock})
                        </div>
                    )}
                    
                    {!getValidationInfo(pendingConfirmation).isGlobalShortage && confirmQty < getValidationInfo(pendingConfirmation).orderTotal && !pendingConfirmation.isAdHoc && (
                        <div className="bg-yellow-500/10 border border-yellow-500 p-2 rounded mb-4 text-xs text-yellow-500 font-bold flex items-center justify-center gap-2">
                            <AlertTriangle size={16} /> RECOLHA PARCIAL (Restante noutro local)
                        </div>
                    )}

                    <div className="flex justify-center gap-6 text-xs text-gray-400 mb-4 bg-[#0f131a] p-3 rounded-lg border border-[#37474f]">
                        <div className="flex flex-col items-center"><span className="uppercase tracking-wider font-bold mb-1">Qtd. Pedida</span><span className="text-[#4fc3f7] font-mono text-lg font-bold">{getValidationInfo(pendingConfirmation).orderTotal}</span></div>
                        <div className="w-px bg-[#37474f]"></div>
                        <div className="flex flex-col items-center"><span className="uppercase tracking-wider font-bold mb-1">Stock Local</span><span className="text-[#00e676] font-mono text-lg font-bold">{getValidationInfo(pendingConfirmation).localAvailable}</span></div>
                    </div>
                    
                    <div className="flex items-center justify-center gap-4 mb-6">
                        <button onClick={() => setConfirmQty(Math.max(1, confirmQty - 1))} className="w-12 h-12 rounded bg-[#37474f] text-white font-bold text-xl active:scale-95 transition-transform">-</button>
                        <input type="number" value={confirmQty} onChange={(e) => setConfirmQty(Number(e.target.value))} className="w-24 text-center bg-transparent text-4xl font-bold text-[#ffeb3b]" />
                        <button onClick={() => { const max = getValidationInfo(pendingConfirmation).localAvailable; if (confirmQty < max) setConfirmQty(confirmQty + 1); }} className={`w-12 h-12 rounded bg-[#37474f] text-white font-bold text-xl active:scale-95 transition-transform ${confirmQty >= getValidationInfo(pendingConfirmation).localAvailable ? 'opacity-50 cursor-not-allowed' : ''}`}>+</button>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3">
                        {isEditingTask ? (
                            <button onClick={handleResetOrDeleteTask} className="py-4 bg-red-600 text-white font-bold rounded flex items-center justify-center gap-2 shadow-lg"><Trash2 size={18} /> REMOVER</button>
                        ) : (
                            <button onClick={() => setPendingConfirmation(null)} className="py-4 bg-[#37474f] text-white font-bold rounded">CANCELAR</button>
                        )}
                        <button onClick={confirmPick} className={`py-4 ${isEditingTask ? 'bg-orange-500' : 'bg-[#00e676]'} text-white font-bold rounded shadow-lg`}>
                            {isEditingTask ? 'ATUALIZAR' : 'CONFIRMAR'}
                        </button>
                    </div>
                    {isEditingTask && <div onClick={() => setPendingConfirmation(null)} className="mt-4 text-xs text-gray-500 underline cursor-pointer">Cancelar Edição</div>}
                 </div>
             </div>
         </div>
      )}

      {isCameraOpen && (
         <div className="absolute inset-0 z-50 bg-black flex flex-col">
            <button onClick={() => setIsCameraOpen(false)} className="absolute top-4 right-4 z-10 bg-black/50 p-2 rounded-full"><X size={32} /></button>
            <div className="flex-1 flex flex-col items-center justify-center relative">
               <div id="reader" className="w-full max-w-sm h-96 bg-black" />
               <div className="absolute pointer-events-none flex flex-col items-center justify-center"><ScanLine size={200} className={`opacity-50 animate-pulse ${scanMode === 'adhoc' ? 'text-blue-500' : 'text-[#00e676]'}`} /></div>
               <p className="text-gray-400 mt-6 text-sm font-medium">{scanMode === 'adhoc' ? 'Digitalizar QUALQUER posição...' : 'Aponte para o código de barras da Posição Recomendada'}</p>
               {scanError && (<div className="absolute bottom-10 bg-red-600/90 text-white px-4 py-2 rounded-lg text-sm font-bold animate-bounce">{scanError}</div>)}
            </div>
         </div>
      )}
    </div>
  );
};

export default App;
import React, { useState, useEffect, useRef } from 'react';
import { Settings, Search, Scan, CheckCircle, Menu, X, Camera, ClipboardList, Download, Plus, Trash2, Edit3, FileSpreadsheet, Box, List, AlertTriangle } from 'lucide-react';
import { Scene3D } from './components/Scene3D';
import { FileUpload } from './components/FileUpload';
import { parseExcel, processLayoutFile, processOrderFile, processStockFile } from './utils/excelParser';
import { generatePickingList } from './utils/optimizer';
import { LayoutNode, OrderItem, PickingTask, StockItem, WarehouseLayout, PickingSession } from './types';
import { Html5Qrcode } from 'html5-qrcode';
import { DEFAULT_LAYOUT_COORDS, DEFAULT_VISUAL_LAYOUT } from './utils/defaults';
import * as XLSX from 'xlsx';

const App: React.FC = () => {
  // --- Data State ---
  const [layoutCoords, setLayoutCoords] = useState<Map<string, LayoutNode>>(new Map());
  const [visualLayout, setVisualLayout] = useState<WarehouseLayout | null>(null);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  
  // --- Order Metadata ---
  const [availableOrders, setAvailableOrders] = useState<File[]>([]);
  const [activeOrderName, setActiveOrderName] = useState<string>('');
  const [activeOrderDate, setActiveOrderDate] = useState<string>('');
  
  // --- Status State ---
  const [coordsStatus, setCoordsStatus] = useState<'idle' | 'loaded' | 'error'>('idle');
  const [visualStatus, setVisualStatus] = useState<'idle' | 'loaded' | 'error'>('idle');
  const [stockStatus, setStockStatus] = useState<'idle' | 'loaded' | 'error'>('idle');
  const [orderStatus, setOrderStatus] = useState<'idle' | 'loaded' | 'error'>('idle');

  // --- Logic State ---
  const [pickingTasks, setPickingTasks] = useState<PickingTask[]>([]);
  const [completedTasks, setCompletedTasks] = useState<PickingTask[]>([]);
  const [focusedTaskIndex, setFocusedTaskIndex] = useState<number | null>(null);
  const [sessionHistory, setSessionHistory] = useState<PickingSession[]>([]);
  const [shortages, setShortages] = useState<Map<string, boolean>>(new Map());
  
  // --- UI State ---
  const [isSetupOpen, setIsSetupOpen] = useState(true);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isPickListOpen, setIsPickListOpen] = useState(false);
  const [pickListViewMode, setPickListViewMode] = useState<'summary' | 'detailed'>('summary');
  
  // Modal States
  const [pendingConfirmation, setPendingConfirmation] = useState<PickingTask | null>(null);
  const [confirmQty, setConfirmQty] = useState<number>(0);

  const [searchQuery, setSearchQuery] = useState('');
  const [scanInput, setScanInput] = useState('');
  const [scanError, setScanError] = useState(false);
  const [searchResults, setSearchResults] = useState<LayoutNode[]>([]);
  
  // --- Camera State ---
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  // --- Initialize Defaults ---
  useEffect(() => {
    setVisualLayout(DEFAULT_VISUAL_LAYOUT);
    setVisualStatus('loaded');

    const map = new Map<string, LayoutNode>();
    DEFAULT_LAYOUT_COORDS.forEach(node => map.set(node.bin, node));
    setLayoutCoords(map);
    setCoordsStatus('loaded');
  }, []);

  // --- Handlers ---
  const handleStockUpload = async (file: File) => {
    try {
      const data = await parseExcel(file);
      const processed = processStockFile(data);
      setStock(processed);
      setStockStatus('loaded');
    } catch (e) { console.error(e); setStockStatus('error'); }
  };

  const handleOrdersFolderSelect = (files: File[]) => {
    const excelFiles = files.filter(f => f.name.endsWith('.xlsx') || f.name.endsWith('.xls'));
    excelFiles.sort((a, b) => b.lastModified - a.lastModified);
    setAvailableOrders(excelFiles);
    if (excelFiles.length === 0) {
      alert("Nenhum ficheiro Excel encontrado na pasta selecionada.");
    }
  };

  const selectOrderFile = async (file: File) => {
    try {
      setActiveOrderName(file.name.replace(/\.[^/.]+$/, ""));
      setActiveOrderDate(new Date(file.lastModified).toLocaleString('pt-PT'));
      const data = await parseExcel(file);
      const processed = processOrderFile(data);
      setOrders(processed);
      setOrderStatus('loaded');
    } catch (e) { console.error(e); setOrderStatus('error'); }
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
      alert("Por favor carregue Coordenadas, Stock e selecione uma Encomenda.");
      return;
    }
    calculateShortages(orders, stock);
    const tasks = generatePickingList(orders, stock, layoutCoords);
    setPickingTasks(tasks);
    setCompletedTasks([]);
    if(tasks.length > 0) setFocusedTaskIndex(0);
    setIsSetupOpen(false);
  };

  const addAdHocItem = (node: LayoutNode) => {
    const stockItem = stock.find(s => s.bin === node.bin);
    if (!stockItem) return;
    const existing = pickingTasks.find(t => t.bin === node.bin && t.material === stockItem.material);
    if (existing) {
       const idx = pickingTasks.indexOf(existing);
       setFocusedTaskIndex(idx);
       setSearchQuery('');
       return;
    }
    const newTask: PickingTask = {
        sequence: pickingTasks.length + 1,
        material: stockItem.material,
        bin: stockItem.bin,
        qtyToPick: 1,
        coordinates: { x: node.x, y: node.y, z: node.z },
        distanceFromLast: 0
    };
    setPickingTasks(prev => [...prev, newTask]);
    setFocusedTaskIndex(pickingTasks.length);
    setSearchQuery('');
  };

  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const lowerQ = searchQuery.toLowerCase();
    const matchingStock = stock.filter(s => 
      s.material.toLowerCase().includes(lowerQ) || 
      s.description.toLowerCase().includes(lowerQ) ||
      s.bin.toLowerCase().includes(lowerQ)
    );
    const bins = new Set(matchingStock.map(s => s.bin));
    const nodes: LayoutNode[] = [];
    bins.forEach(bin => {
      if (layoutCoords.has(bin)) nodes.push(layoutCoords.get(bin)!);
    });
    setSearchResults(nodes);
  }, [searchQuery, stock, layoutCoords]);

  const processScan = (rawCode: string) => {
    if (pickingTasks.length === 0) return;
    const scanned = rawCode.trim().toUpperCase();
    const matchIndex = pickingTasks.findIndex(t => 
        t.bin.trim().toUpperCase() === scanned &&
        !completedTasks.some(ct => ct.sequence === t.sequence)
    );

    if (matchIndex !== -1) {
        const task = pickingTasks[matchIndex];
        setFocusedTaskIndex(matchIndex);
        setScanInput('');
        setScanError(false);
        if (isCameraOpen) setIsCameraOpen(false);
        setPendingConfirmation(task);
        setConfirmQty(task.qtyToPick);
    } else {
        setScanError(true);
        if (!isCameraOpen) setScanInput(''); 
        if (navigator.vibrate) navigator.vibrate(200);
    }
  };

  const handleScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    processScan(scanInput);
  };

  const confirmPick = () => {
    if (!pendingConfirmation || focusedTaskIndex === null) return;
    const completedTask: PickingTask = { 
        ...pendingConfirmation, 
        pickedQty: confirmQty,
        status: 'picked', 
        timestamp: new Date().toISOString() 
    };
    setCompletedTasks(prev => {
        const existing = prev.findIndex(t => t.sequence === completedTask.sequence);
        if (existing !== -1) {
            const copy = [...prev];
            copy[existing] = completedTask;
            return copy;
        }
        return [...prev, completedTask];
    });
    setPendingConfirmation(null);
    const nextIndex = pickingTasks.findIndex((t, i) => i > focusedTaskIndex && !completedTasks.find(c => c.sequence === t.sequence));
    if (nextIndex !== -1) {
      setFocusedTaskIndex(nextIndex);
    } else {
      const firstIncomplete = pickingTasks.findIndex(t => !completedTasks.find(c => c.sequence === t.sequence));
      if (firstIncomplete !== -1) setFocusedTaskIndex(firstIncomplete);
      else {
          finishSession();
          alert("Rota de Picking Concluída!");
          setFocusedTaskIndex(null);
      }
    }
  };

  const finishSession = () => {
    const session: PickingSession = {
        id: `SESSION-${Date.now()}`,
        orderName: activeOrderName || 'Picking Rápido',
        orderDate: activeOrderDate || new Date().toLocaleString('pt-PT'),
        dateCompleted: new Date().toLocaleString('pt-PT'),
        tasks: [...completedTasks]
    };
    setSessionHistory(prev => [session, ...prev]);
    setPickingTasks([]); 
    setCompletedTasks([]);
    setPendingConfirmation(null);
    setIsHistoryOpen(true);
  };

  const resumeSession = (session: PickingSession) => {
      setPickingTasks(session.tasks);
      setCompletedTasks(session.tasks);
      setActiveOrderName(session.orderName);
      setActiveOrderDate(session.orderDate);
      setIsHistoryOpen(false);
      setIsSetupOpen(false);
      setFocusedTaskIndex(null);
      alert("Sessão retomada.");
  };

  const deleteSession = (sessionId: string) => {
      if(window.confirm("Tem a certeza que deseja apagar esta sessão?")) {
          setSessionHistory(prev => prev.filter(s => s.id !== sessionId));
      }
  };

  const exportSession = (session: PickingSession) => {
    const d = new Date();
    const formattedDate = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth()+1).padStart(2, '0')}.${d.getFullYear()}`;
    const rows = session.tasks.map((task, index) => {
        const stockInfo = stock.find(s => s.material === task.material);
        const description = stockInfo ? stockInfo.description : "";
        return {
            "Itm": (index + 1) * 10,
            "C": "", "I": "", "Cen.": "1700", "Depósito de saída": "0001", "Depósito": "0004",
            "Material": task.material,
            "Texto breve": description,
            "Lote": task.bin,
            "Qtd.pedido": task.pickedQty ?? task.qtyToPick,
            "Dt.remessa": formattedDate
        };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    XLSX.writeFile(wb, `${session.orderName}_Concluido.xlsx`);
    alert(`Ficheiro descarregado.`);
  };

  const getPickListSummary = () => {
      const summary = new Map<string, { material: string, desc: string, ordered: number, picked: number, short: boolean }>();
      orders.forEach(o => {
          const stockInfo = stock.find(s => s.material === o.material);
          summary.set(o.material, {
              material: o.material,
              desc: stockInfo ? stockInfo.description : 'Desconhecido',
              ordered: o.qty,
              picked: 0,
              short: shortages.get(o.material) || false
          });
      });
      completedTasks.forEach(t => {
          if (summary.has(t.material)) {
              const rec = summary.get(t.material)!;
              rec.picked += (t.pickedQty || t.qtyToPick);
          } else {
               const stockInfo = stock.find(s => s.material === t.material);
               summary.set(t.material, {
                  material: t.material,
                  desc: stockInfo ? stockInfo.description : 'Ad-Hoc',
                  ordered: 0,
                  picked: (t.pickedQty || t.qtyToPick),
                  short: false
               });
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

  // --- Camera Logic ---
  useEffect(() => {
    if (!isCameraOpen) return;
    let isMounted = true;
    
    const startScanner = async () => {
        try {
            const scanner = new Html5Qrcode("reader");
            scannerRef.current = scanner;
            
            // Rectangular box for barcodes
            await scanner.start(
                { facingMode: "environment" },
                { fps: 10, qrbox: { width: 300, height: 150 } }, 
                (decodedText) => {
                    if (isMounted) processScan(decodedText);
                },
                () => {}
            );
        } catch (err) {
            console.error(err);
            if (isMounted) setIsCameraOpen(false);
        }
    };
    startScanner();

    return () => {
        isMounted = false;
        if (scannerRef.current) {
             // Safe synchronous cleanup attempt
             try {
                 if (scannerRef.current.isScanning) {
                     scannerRef.current.stop().catch(console.error);
                 }
                 scannerRef.current.clear();
             } catch(e) { console.error("Scanner cleanup error", e); }
             scannerRef.current = null;
        }
    };
  }, [isCameraOpen]);

  const currentTask = focusedTaskIndex !== null ? pickingTasks[focusedTaskIndex] : null;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-gray-900 text-white font-sans">
      <div className="absolute inset-0 z-0">
         <Scene3D 
            visualLayout={visualLayout} 
            layoutCoords={layoutCoords}
            tasks={searchQuery ? [] : pickingTasks.filter(t => !completedTasks.find(c => c.sequence === t.sequence))} 
            searchResults={searchResults}
            focusedTaskIndex={focusedTaskIndex !== null ? 0 : null}
         />
      </div>

      <div className="absolute top-0 left-0 right-0 z-20 p-4 pointer-events-none">
        <div className="flex gap-2 pointer-events-auto">
          <button onClick={() => setIsSetupOpen(true)} className="bg-[#263238] p-3 rounded-lg shadow-lg border border-[#37474f] text-white"><Settings size={24} /></button>
          <button onClick={() => setIsSetupOpen(true)} className="bg-[#263238] p-3 rounded-lg shadow-lg border border-[#37474f] text-white"><FileSpreadsheet size={24} className="text-[#4fc3f7]" /></button>
          <button onClick={() => setIsHistoryOpen(true)} className="bg-[#263238] p-3 rounded-lg shadow-lg border border-[#37474f] text-white"><ClipboardList size={24} /></button>
          <div className="flex-1 relative">
            <input type="text" placeholder="Pesquisar..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full h-full bg-[#263238] border border-[#37474f] rounded-lg pl-10 pr-4 text-white focus:outline-none" />
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
      </div>

      {isSetupOpen && (
        <div className="absolute inset-0 z-50 bg-[#1a2332] flex flex-col animate-fade-in">
          <div className="p-4 border-b border-[#37474f] flex justify-between items-center bg-[#141923]">
            <h2 className="text-xl font-bold text-[#4fc3f7] flex items-center gap-2"><Settings size={20} /> Configuração</h2>
            <button onClick={() => setIsSetupOpen(false)} className="text-gray-400 p-2"><X size={24} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
             <div className="space-y-4 bg-[#141923] p-4 rounded-lg border border-[#37474f]">
                <h3 className="text-sm font-bold text-[#ffeb3b] uppercase flex items-center gap-2"><FileSpreadsheet size={16} /> Selecionar Encomenda</h3>
                <FileUpload label="Carregar Pasta" folderMode={true} onFilesSelect={handleOrdersFolderSelect} status={availableOrders.length > 0 ? 'loaded' : 'idle'} />
                {availableOrders.length > 0 && (
                    <div className="mt-4 max-h-60 overflow-y-auto bg-[#1a2332] rounded border border-[#37474f]">
                        {availableOrders.map((file, i) => {
                            const isSelected = activeOrderName === file.name.replace(/\.[^/.]+$/, "");
                            return (
                                <div key={i} onClick={() => selectOrderFile(file)} className={`p-3 border-b border-[#2d3a4b] cursor-pointer ${isSelected ? 'bg-[#263238] border-l-4 border-l-[#00e676]' : ''}`}>
                                    <div className="text-sm font-medium text-gray-300">{file.name}</div>
                                </div>
                            );
                        })}
                    </div>
                )}
             </div>
             <FileUpload label="Stock (MB52)" onFileSelect={handleStockUpload} status={stockStatus} />
          </div>
          <div className="p-4 border-t border-[#37474f] bg-[#141923]">
            <button onClick={generateRoute} className="w-full bg-[#0277bd] text-white font-bold py-4 rounded-lg shadow-lg">INICIAR RECOLHA</button>
          </div>
        </div>
      )}

      {isHistoryOpen && (
          <div className="absolute inset-0 z-50 bg-[#1a2332] flex flex-col animate-fade-in">
             <div className="p-4 border-b border-[#37474f] flex justify-between items-center bg-[#141923]">
                <h2 className="text-xl font-bold text-[#ff9800]">Sessões Anteriores</h2>
                <button onClick={() => setIsHistoryOpen(false)}><X size={24} /></button>
             </div>
             <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {sessionHistory.map(session => (
                    <div key={session.id} className="bg-[#1e2736] rounded-lg border border-[#37474f] overflow-hidden">
                        <div className="p-3 bg-[#263238] flex justify-between items-center">
                            <div><div className="text-white font-bold">{session.orderName}</div><div className="text-xs text-gray-400">{session.orderDate}</div></div>
                        </div>
                        <div className="grid grid-cols-3 divide-x divide-[#37474f] border-t border-[#37474f]">
                            <button onClick={() => resumeSession(session)} className="p-3 flex justify-center"><Edit3 size={18} className="text-[#00e676]" /></button>
                            <button onClick={() => exportSession(session)} className="p-3 flex justify-center"><Download size={18} className="text-[#4fc3f7]" /></button>
                            <button onClick={() => deleteSession(session.id)} className="p-3 flex justify-center"><Trash2 size={18} className="text-red-500" /></button>
                        </div>
                    </div>
                ))}
             </div>
          </div>
      )}

      {!isSetupOpen && !isHistoryOpen && !searchQuery && !pendingConfirmation && pickingTasks.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 z-30 p-4">
          <div className="absolute bottom-64 left-4 z-40">
            <button onClick={() => setIsPickListOpen(true)} className="w-14 h-14 bg-[#0277bd] rounded-full flex items-center justify-center border-2 border-[#4fc3f7] shadow-xl"><List size={28} className="text-white" /></button>
          </div>
          <div className="bg-[#141923] rounded-xl shadow-2xl border border-[#37474f] p-4 flex flex-col gap-4">
              {currentTask ? (
                  <>
                    <div className="flex justify-between items-start">
                        <div><span className="bg-[#00e676] text-black text-xs font-bold px-2 py-0.5 rounded">#{currentTask.sequence}</span><h2 className="text-xl font-bold text-white mt-1">{currentTask.material}</h2></div>
                        <div className="text-right"><div className="text-3xl font-bold text-[#ffeb3b]">{currentTask.qtyToPick}</div></div>
                    </div>
                    <div className="bg-[#263238] p-3 rounded-lg flex justify-between items-center border border-[#37474f]">
                        <span className="text-gray-400 text-xs uppercase">Local</span>
                        <span className="text-2xl font-mono font-bold text-[#4fc3f7]">{currentTask.bin}</span>
                    </div>
                  </>
              ) : <div className="text-center text-gray-400 py-4">Nenhuma tarefa ativa</div>}
              <form onSubmit={handleScanSubmit} className="relative flex gap-2">
                <button type="button" onClick={() => setIsCameraOpen(true)} className="flex-1 bg-[#263238] border-2 border-[#37474f] rounded-lg h-14 flex items-center justify-center text-white gap-2 font-bold"><Camera size={24} /> DIGITALIZAR</button>
              </form>
          </div>
        </div>
      )}

      {isPickListOpen && (
          <div className="absolute inset-0 z-50 bg-[#1a2332] flex flex-col animate-fade-in">
             <div className="p-4 border-b border-[#37474f] flex justify-between items-center bg-[#141923]">
                <h2 className="text-xl font-bold text-white">Lista de Picking</h2>
                <div className="flex gap-2">
                    <button onClick={() => setPickListViewMode(pickListViewMode === 'summary' ? 'detailed' : 'summary')} className="p-2 bg-[#263238] rounded text-xs font-bold text-gray-300">{pickListViewMode === 'summary' ? 'VER DETALHE' : 'VER RESUMO'}</button>
                    <button onClick={() => setIsPickListOpen(false)}><X size={24} /></button>
                </div>
             </div>
             <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {pickListViewMode === 'summary' ? getPickListSummary().map((item, i) => (
                     <div key={i} className={`bg-[#1e2736] p-3 rounded border ${item.short ? 'border-red-500' : 'border-[#37474f]'}`}>
                        <div className="grid grid-cols-12 items-center">
                            <div className="col-span-6 font-bold">{item.material}</div>
                            <div className="col-span-3 text-center text-[#ffeb3b]">{item.ordered}</div>
                            <div className="col-span-3 text-center text-[#00e676]">{item.picked}</div>
                        </div>
                     </div>
                )) : getPickListDetailed().map((item, i) => (
                     <div key={i} className={`bg-[#1e2736] p-3 rounded border ${item.isCompleted ? 'border-green-500' : 'border-[#37474f]'}`} onClick={() => { setFocusedTaskIndex(i); setIsPickListOpen(false); }}>
                        <div className="grid grid-cols-12 items-center">
                            <div className="col-span-6"><div className="font-bold">{item.material}</div><div className="text-xs text-[#4fc3f7]">{item.bin}</div></div>
                            <div className="col-span-3 text-center text-[#ffeb3b]">{item.qtyToPick}</div>
                            <div className="col-span-3 text-center text-[#00e676]">{item.actualPicked}</div>
                        </div>
                     </div>
                ))}
             </div>
          </div>
      )}

      {pendingConfirmation && (
         <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-6">
             <div className="bg-[#1a2332] w-full max-w-sm rounded-xl overflow-hidden border border-[#37474f]">
                 <div className="bg-[#00e676] p-4 flex justify-center"><CheckCircle size={48} className="text-black" /></div>
                 <div className="p-6 text-center">
                    <h2 className="text-2xl font-bold text-white mb-1">{pendingConfirmation.material}</h2>
                    <div className="text-[#4fc3f7] font-mono mb-6">{pendingConfirmation.bin}</div>
                    <div className="flex items-center justify-center gap-4 mb-6">
                        <button onClick={() => setConfirmQty(Math.max(1, confirmQty - 1))} className="w-8 h-8 rounded bg-[#37474f] text-white font-bold">-</button>
                        <input type="number" value={confirmQty} onChange={(e) => setConfirmQty(Number(e.target.value))} className="w-20 text-center bg-transparent text-3xl font-bold text-[#ffeb3b]" />
                        <button onClick={() => setConfirmQty(confirmQty + 1)} className="w-8 h-8 rounded bg-[#37474f] text-white font-bold">+</button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <button onClick={() => setPendingConfirmation(null)} className="py-3 bg-[#37474f] text-white font-bold rounded">CANCELAR</button>
                        <button onClick={confirmPick} className="py-3 bg-[#00e676] text-black font-bold rounded">CONFIRMAR</button>
                    </div>
                 </div>
             </div>
         </div>
      )}

      {isCameraOpen && (
         <div className="absolute inset-0 z-50 bg-black flex flex-col">
            <button onClick={() => setIsCameraOpen(false)} className="absolute top-4 right-4 z-10 bg-black/50 p-2 rounded-full"><X size={32} /></button>
            <div className="flex-1 flex flex-col items-center justify-center">
               <div id="reader" className="w-full max-w-sm h-80 bg-black" />
               <p className="text-gray-400 mt-4 text-sm">Aponte a câmara para o código de barras</p>
            </div>
         </div>
      )}
    </div>
  );
};

export default App;
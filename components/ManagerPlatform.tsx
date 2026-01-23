import React, { useState, useEffect } from 'react';
import { CheckCircle, Trash2, RefreshCw, ArrowLeft, Clock, List, X, RotateCcw, Eye } from 'lucide-react';
import { fetchCompletedOrdersFromCloud, deleteOrder, fetchOpenOrdersFromCloud, revertOrderToOpen } from '../utils/firebase';
import { CloudOrder } from '../types';

interface ManagerPlatformProps {
    onBack: () => void;
}

export const ManagerPlatform: React.FC<ManagerPlatformProps> = ({ onBack }) => {
    const [activeTab, setActiveTab] = useState<'open_orders' | 'finished_orders'>('open_orders');
    const [isLoading, setIsLoading] = useState(false);
    
    // Data State
    const [openOrders, setOpenOrders] = useState<CloudOrder[]>([]);
    const [completedOrders, setCompletedOrders] = useState<CloudOrder[]>([]);
    
    // Selection for Details Modal
    const [selectedOrder, setSelectedOrder] = useState<CloudOrder | null>(null);

    useEffect(() => {
        loadData();
    }, [activeTab]);

    const loadData = async () => {
        setIsLoading(true);
        try {
            if (activeTab === 'open_orders') {
                const data = await fetchOpenOrdersFromCloud();
                setOpenOrders(data);
            } else if (activeTab === 'finished_orders') {
                const data = await fetchCompletedOrdersFromCloud();
                setCompletedOrders(data);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteOrder = async (id: string) => {
        if (!confirm("Tem a certeza que deseja apagar esta encomenda? Esta ação é irreversível.")) return;
        setIsLoading(true);
        await deleteOrder(id);
        if (selectedOrder?.id === id) setSelectedOrder(null);
        loadData();
        setIsLoading(false);
    };

    const handleRevertOrder = async (id: string) => {
        if (!confirm("Isto irá apagar os dados de picking e mover a encomenda para 'Aberto'. Continuar?")) return;
        setIsLoading(true);
        try {
            await revertOrderToOpen(id);
            setSelectedOrder(null);
            loadData();
            alert("Encomenda revertida com sucesso.");
        } catch (e) {
            console.error(e);
            alert("Erro ao reverter encomenda.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="absolute inset-0 bg-[#0f131a] flex flex-col text-white overflow-hidden font-sans">
            {/* Header & Tabs */}
            <div className="bg-[#141923] border-b border-[#37474f] flex-shrink-0 shadow-xl z-10">
                <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-4">
                        <button 
                            onClick={onBack} 
                            className="bg-[#1e2736] p-2 rounded-full hover:bg-[#263238] border border-[#37474f] transition-all active:scale-95"
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <h1 className="font-bold text-xl text-white tracking-wide">Histórico de Pedidos</h1>
                    </div>
                    
                    <button 
                        onClick={() => loadData()} 
                        disabled={isLoading}
                        className="p-2 hover:bg-[#263238] rounded-full text-[#4fc3f7] transition-colors disabled:opacity-50"
                    >
                        <RefreshCw className={isLoading ? "animate-spin" : ""} size={20} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex px-4 gap-6 overflow-x-auto no-scrollbar">
                    <button 
                        onClick={() => setActiveTab('open_orders')}
                        className={`pb-3 px-2 text-sm font-bold border-b-2 transition-all whitespace-nowrap flex items-center gap-2 ${activeTab === 'open_orders' ? 'border-[#ffeb3b] text-white' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
                    >
                        <List size={18} className={activeTab === 'open_orders' ? 'text-[#ffeb3b]' : ''} />
                        Pedidos Abertos
                    </button>
                    <button 
                        onClick={() => setActiveTab('finished_orders')}
                        className={`pb-3 px-2 text-sm font-bold border-b-2 transition-all whitespace-nowrap flex items-center gap-2 ${activeTab === 'finished_orders' ? 'border-[#00e676] text-white' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
                    >
                        <CheckCircle size={18} className={activeTab === 'finished_orders' ? 'text-[#00e676]' : ''} />
                        Pedidos Concluídos
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-[#0f131a] scroll-smooth">
                 {/* OPEN ORDERS VIEW */}
                 {activeTab === 'open_orders' && (
                    <div className="space-y-4 max-w-4xl mx-auto pb-10">
                        {openOrders.length === 0 && !isLoading && (
                             <div className="text-center py-12 text-gray-500 flex flex-col items-center">
                                <div className="bg-[#1e2736] p-4 rounded-full mb-4">
                                    <CheckCircle size={32} className="text-gray-600" />
                                </div>
                                <p className="font-medium">Tudo limpo! Não há pedidos pendentes.</p>
                             </div>
                        )}
                        
                        {openOrders.map(order => (
                            <div key={order.id} className="bg-[#1e2736] rounded-xl border border-[#37474f] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg hover:border-[#4fc3f7] transition-colors">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-2">
                                        <h3 className="font-bold text-white text-lg">{order.name}</h3>
                                        {order.status === 'IN PROCESS' && (
                                            <span className="text-[10px] font-bold bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded border border-yellow-500/30">EM ANDAMENTO</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-4 text-xs text-gray-400">
                                        <span className="flex items-center gap-1 bg-[#141923] px-2 py-1 rounded border border-[#37474f]">
                                            <Clock size={12}/> {new Date(order.createdAt).toLocaleString()}
                                        </span>
                                        <span className="bg-[#0277bd]/20 text-[#4fc3f7] px-2 py-1 rounded font-bold border border-[#0277bd]/30">
                                            {order.items.length} ITENS
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center justify-end sm:border-l border-[#37474f] sm:pl-4">
                                    <button 
                                        onClick={() => handleDeleteOrder(order.id)} 
                                        className="text-red-400 hover:bg-red-900/20 p-2 px-3 rounded-lg transition-colors flex items-center gap-2 text-sm font-bold border border-red-900/30 hover:border-red-500/50"
                                    >
                                        <Trash2 size={16} /> <span className="">Apagar</span>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                 )}

                 {/* FINISHED ORDERS VIEW */}
                 {activeTab === 'finished_orders' && (
                    <div className="space-y-4 max-w-4xl mx-auto pb-10">
                        {completedOrders.length === 0 && !isLoading && (
                             <div className="text-center py-12 text-gray-500">
                                <p>Histórico vazio.</p>
                             </div>
                        )}

                        {completedOrders.map(order => (
                            <div 
                                key={order.id} 
                                onClick={() => setSelectedOrder(order)}
                                className="bg-[#1e2736]/50 rounded-xl border border-[#37474f] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-[#263238] cursor-pointer transition-all shadow-md hover:shadow-lg hover:border-[#00e676]"
                            >
                                <div className="flex-1">
                                    <h3 className="font-bold text-gray-300 text-lg mb-1">{order.name}</h3>
                                    <div className="flex items-center gap-3 text-xs text-gray-500">
                                        <span>Concluído: {order.completedAt ? new Date(order.completedAt).toLocaleString() : '-'}</span>
                                        <span className="font-mono bg-[#141923] px-2 py-0.5 rounded">{order.items.length} ITENS</span>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between sm:justify-end gap-3 pt-3 sm:pt-0 border-t sm:border-t-0 border-[#37474f]">
                                    <div className="flex items-center gap-2 text-[#00e676]">
                                        <CheckCircle size={16} />
                                        <span className="text-xs font-bold">CONCLUÍDO</span>
                                    </div>
                                    <div className="text-gray-500">
                                        <Eye size={18} />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                 )}
            </div>

            {/* ORDER DETAILS MODAL */}
            {selectedOrder && (
                <div className="absolute inset-0 z-50 bg-black/95 backdrop-blur-md flex items-center justify-center p-4">
                    <div className="bg-[#141923] border border-[#37474f] rounded-2xl w-full max-w-3xl h-[80vh] flex flex-col shadow-2xl relative overflow-hidden">
                        <div className="flex justify-between items-center p-6 border-b border-[#37474f] bg-[#1e2736]">
                            <div>
                                <div className="text-xs text-[#00e676] font-bold uppercase tracking-wider mb-1">Detalhes do Pedido</div>
                                <h2 className="text-2xl font-bold text-white">{selectedOrder.name}</h2>
                            </div>
                            <button onClick={() => setSelectedOrder(null)} className="p-2 hover:bg-[#263238] rounded-full text-gray-400 hover:text-white">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-[#263238] text-gray-400 font-bold text-xs uppercase sticky top-0">
                                        <tr>
                                            <th className="px-4 py-3 rounded-tl-lg">Item / Material</th>
                                            <th className="px-4 py-3">Lote (Bin)</th>
                                            <th className="px-4 py-3 text-right">Qtd Recolhida</th>
                                            <th className="px-4 py-3 rounded-tr-lg text-right">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#37474f]">
                                        {/* Prefer pickedItems if available (actual results), fall back to order items */}
                                        {(selectedOrder.pickedItems || selectedOrder.items).map((item: any, idx: number) => (
                                            <tr key={idx} className="hover:bg-[#1e2736] transition-colors">
                                                <td className="px-4 py-3 font-medium text-white">{item.material}</td>
                                                <td className="px-4 py-3 font-mono text-[#4fc3f7]">{item.bin || '-'}</td>
                                                <td className="px-4 py-3 text-right font-bold text-[#ffeb3b]">
                                                    {item.pickedQty !== undefined ? item.pickedQty : item.qty}
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    <span className="text-[#00e676] text-xs font-bold px-2 py-1 bg-[#00e676]/10 rounded">OK</span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="p-4 border-t border-[#37474f] bg-[#1e2736] flex gap-3">
                            <button 
                                onClick={() => handleRevertOrder(selectedOrder.id)}
                                disabled={isLoading}
                                className="flex-1 bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-500 border border-yellow-600/50 py-3 rounded-xl font-bold flex justify-center items-center gap-2 transition-colors disabled:opacity-50"
                            >
                                <RotateCcw size={18} /> Reabrir Pedido (Reset)
                            </button>
                            <button 
                                onClick={() => handleDeleteOrder(selectedOrder.id)}
                                disabled={isLoading}
                                className="flex-1 bg-red-900/20 hover:bg-red-900/30 text-red-400 border border-red-900/50 py-3 rounded-xl font-bold flex justify-center items-center gap-2 transition-colors disabled:opacity-50"
                            >
                                <Trash2 size={18} /> Apagar Definitivamente
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
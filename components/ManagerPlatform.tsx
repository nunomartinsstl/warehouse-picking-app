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
        <div className="absolute inset-0 bg-gray-100 dark:bg-[#0f131a] flex flex-col text-gray-900 dark:text-white overflow-hidden font-sans transition-colors duration-500">
            {/* Header & Tabs */}
            <div className="bg-white dark:bg-[#141923] border-b border-gray-200 dark:border-[#37474f] flex-shrink-0 shadow-xl z-10 transition-colors">
                <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-4">
                        <button 
                            onClick={onBack} 
                            className="bg-gray-100 dark:bg-[#1e2736] p-2 rounded-full hover:bg-gray-200 dark:hover:bg-[#263238] border border-gray-200 dark:border-[#37474f] transition-all active:scale-95 text-gray-600 dark:text-white"
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <h1 className="font-bold text-xl text-gray-900 dark:text-white tracking-wide">Histórico de Pedidos</h1>
                    </div>
                    
                    <button 
                        onClick={() => loadData()} 
                        disabled={isLoading}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-[#263238] rounded-full text-[#4fc3f7] transition-colors disabled:opacity-50"
                    >
                        <RefreshCw className={isLoading ? "animate-spin" : ""} size={20} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex px-4 gap-6 overflow-x-auto no-scrollbar">
                    <button 
                        onClick={() => setActiveTab('open_orders')}
                        className={`pb-3 px-2 text-sm font-bold border-b-2 transition-all whitespace-nowrap flex items-center gap-2 ${activeTab === 'open_orders' ? 'border-[#ffeb3b] text-yellow-600 dark:text-white' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'}`}
                    >
                        <List size={18} className={activeTab === 'open_orders' ? 'text-yellow-600 dark:text-[#ffeb3b]' : ''} />
                        Pedidos Abertos
                    </button>
                    <button 
                        onClick={() => setActiveTab('finished_orders')}
                        className={`pb-3 px-2 text-sm font-bold border-b-2 transition-all whitespace-nowrap flex items-center gap-2 ${activeTab === 'finished_orders' ? 'border-[#00e676] text-[#00e676] dark:text-white' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'}`}
                    >
                        <CheckCircle size={18} className={activeTab === 'finished_orders' ? 'text-[#00e676]' : ''} />
                        Pedidos Concluídos
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-gray-100 dark:bg-[#0f131a] scroll-smooth transition-colors">
                 {/* OPEN ORDERS VIEW */}
                 {activeTab === 'open_orders' && (
                    <div className="space-y-4 max-w-4xl mx-auto pb-10">
                        {openOrders.length === 0 && !isLoading && (
                             <div className="text-center py-12 text-gray-500 flex flex-col items-center">
                                <div className="bg-white dark:bg-[#1e2736] p-4 rounded-full mb-4 shadow">
                                    <CheckCircle size={32} className="text-gray-400 dark:text-gray-600" />
                                </div>
                                <p className="font-medium">Tudo limpo! Não há pedidos pendentes.</p>
                             </div>
                        )}
                        
                        {openOrders.map(order => (
                            <div key={order.id} className="bg-white dark:bg-[#1e2736] rounded-xl border border-gray-200 dark:border-[#37474f] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg hover:border-[#4fc3f7] transition-colors">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-2">
                                        <h3 className="font-bold text-gray-900 dark:text-white text-lg">{order.name}</h3>
                                        {order.status === 'IN PROCESS' && (
                                            <span className="text-[10px] font-bold bg-yellow-100 dark:bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 px-2 py-0.5 rounded border border-yellow-200 dark:border-yellow-500/30">EM ANDAMENTO</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                                        <span className="flex items-center gap-1 bg-gray-100 dark:bg-[#141923] px-2 py-1 rounded border border-gray-200 dark:border-[#37474f]">
                                            <Clock size={12}/> {new Date(order.createdAt).toLocaleString()}
                                        </span>
                                        <span className="bg-[#0277bd]/10 dark:bg-[#0277bd]/20 text-[#0277bd] dark:text-[#4fc3f7] px-2 py-1 rounded font-bold border border-[#0277bd]/20 dark:border-[#0277bd]/30">
                                            {order.items.length} ITENS
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center justify-end sm:border-l border-gray-200 dark:border-[#37474f] sm:pl-4">
                                    <button 
                                        onClick={() => handleDeleteOrder(order.id)} 
                                        className="text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 p-2 px-3 rounded-lg transition-colors flex items-center gap-2 text-sm font-bold border border-red-200 dark:border-red-900/30 hover:border-red-300 dark:hover:border-red-500/50"
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
                                className="bg-white dark:bg-[#1e2736]/50 rounded-xl border border-gray-200 dark:border-[#37474f] p-5 flex
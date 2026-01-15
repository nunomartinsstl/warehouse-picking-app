
import React, { useState, useEffect } from 'react';
import { CloudUpload, FileText, CheckCircle, Trash2, RefreshCw, X, Database, List } from 'lucide-react';
import { FileUpload } from './FileUpload';
import { parseExcel, processStockFile, processOrderFile } from '../utils/excelParser';
import { saveStockToCloud, createCloudOrder, fetchCompletedOrdersFromCloud, deleteOrder, fetchOpenOrdersFromCloud, fetchStockFromCloud } from '../utils/firebase';
import { CloudOrder, StockItem } from '../types';

interface ManagerDashboardProps {
    onClose: () => void;
}

export const ManagerDashboard: React.FC<ManagerDashboardProps> = ({ onClose }) => {
    const [activeTab, setActiveTab] = useState<'stock' | 'orders' | 'history'>('orders');
    const [isLoading, setIsLoading] = useState(false);
    
    // Data State
    const [openOrders, setOpenOrders] = useState<CloudOrder[]>([]);
    const [completedOrders, setCompletedOrders] = useState<CloudOrder[]>([]);
    const [currentStockCount, setCurrentStockCount] = useState<number | null>(null);

    useEffect(() => {
        loadData();
    }, [activeTab]);

    const loadData = async () => {
        setIsLoading(true);
        try {
            if (activeTab === 'orders') {
                const data = await fetchOpenOrdersFromCloud();
                setOpenOrders(data);
            } else if (activeTab === 'history') {
                const data = await fetchCompletedOrdersFromCloud();
                setCompletedOrders(data);
            } else if (activeTab === 'stock') {
                const stock = await fetchStockFromCloud();
                setCurrentStockCount(stock.length);
            }
        } catch (e: any) {
            console.error(e);
            alert(`Erro ao carregar dados: ${e.message || e}. Verifique a configuração do Firebase.`);
        } finally {
            setIsLoading(false);
        }
    };

    // --- STOCK HANDLERS ---
    const handleStockUpload = async (file: File) => {
        if (!confirm("Isto irá substituir TODO o stock atual na Cloud. Continuar?")) return;
        setIsLoading(true);
        try {
            const raw = await parseExcel(file);
            const processed = processStockFile(raw);
            if (processed.
import * as XLSX from 'xlsx';
import { LayoutNode, OrderItem, StockItem } from '../types';

export const parseExcel = (file: File): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet);
        resolve(jsonData);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
};

export const processOrderFile = (data: any[]): OrderItem[] => {
  // Expected: MATERIAL, QTD
  return data.map((row) => ({
    material: String(row['MATERIAL'] || row['Material'] || '').trim(),
    qty: Number(row['QTD'] || row['Qtd'] || 0),
  })).filter(i => i.material && i.qty > 0);
};

export const processStockFile = (data: any[]): StockItem[] => {
  // Expected: Material, Lote, Utilização livre, Texto breve material
  return data.map((row) => ({
    material: String(row['Material'] || '').trim(),
    description: row['Texto breve material'] || '',
    bin: String(row['Lote'] || '').trim(), // Lote is used as Bin Location based on prompt
    qtyAvailable: Number(row['Utilização livre'] || 0),
  })).filter(i => i.bin && i.material);
};

export const processLayoutFile = (data: any[]): LayoutNode[] => {
  // Expected: Ref Completa, X, Y, Z
  return data.map((row) => ({
    bin: String(row['Ref Completa'] || '').trim(),
    x: Number(row['X'] || 0),
    y: Number(row['Y'] || 0),
    z: Number(row['Z'] || 0),
    type: row['Tipo'] || 'Standard',
  })).filter(i => i.bin);
};
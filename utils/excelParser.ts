
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
  // Accepted headers (Case insensitive check logic needed or just check common variations)
  return data.map((row) => {
    // Find material column
    const material = String(
        row['MATERIAL'] || row['Material'] || row['Ref'] || row['Referencia'] || row['Referência'] || row['Part No'] || ''
    ).trim();

    // Find quantity column
    const qty = Number(
        row['QTD'] || row['Qtd'] || row['Quantity'] || row['Quantidade'] || row['Qty'] || 0
    );

    return { material, qty };
  }).filter(i => i.material && i.qty > 0);
};

export const processStockFile = (data: any[]): StockItem[] => {
  return data.map((row) => ({
    material: String(row['Material'] || row['MATERIAL'] || '').trim(),
    description: row['Texto breve material'] || row['Descricao'] || row['Descrição'] || '',
    bin: String(row['Lote'] || row['Bin'] || row['Local'] || '').trim(), 
    qtyAvailable: Number(row['Utilização livre'] || row['Qtd'] || row['Qty'] || 0),
  })).filter(i => i.bin && i.material);
};

export const processLayoutFile = (data: any[]): LayoutNode[] => {
  return data.map((row) => ({
    bin: String(row['Ref Completa'] || row['Bin'] || '').trim(),
    x: Number(row['X'] || 0),
    y: Number(row['Y'] || 0),
    z: Number(row['Z'] || 0),
    type: row['Tipo'] || 'Standard',
  })).filter(i => i.bin);
};

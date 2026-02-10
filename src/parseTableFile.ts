/**
 * 上传表格解析：CSV / Excel → TableData
 * 用于本地文件上传后的系统验证
 */

import type { TableData, TableRow } from './types';

function parseCSV(text: string): string[][] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      current += c;
    } else if (inQuotes) {
      current += c;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      lines.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  if (current) lines.push(current);
  return lines.map((line) => {
    const row: string[] = [];
    let cell = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQ = !inQ;
        cell += c;
      } else if (inQ) {
        cell += c;
      } else if (c === ',' || c === '\t') {
        row.push(cell.replace(/^"|"$/g, '').replace(/""/g, '"'));
        cell = '';
      } else {
        cell += c;
      }
    }
    row.push(cell.replace(/^"|"$/g, '').replace(/""/g, '"'));
    return row;
  });
}

function csvToTableData(text: string): TableData {
  const grid = parseCSV(text);
  if (grid.length === 0) return { columns: [], rows: [] };
  const columns = grid[0].map((h, i) => (h && String(h).trim()) || `列${i + 1}`);
  const rows: TableRow[] = grid.slice(1).map((row) => {
    const obj: TableRow = {};
    columns.forEach((col, i) => {
      const raw = row[i];
      const s = raw == null ? '' : String(raw).trim();
      if (s === '') obj[col] = null;
      else if (/^-?\d+(\.\d+)?$/.test(s)) obj[col] = Number(s);
      else obj[col] = s;
    });
    return obj;
  });
  return { columns, rows };
}

export interface ParseResult {
  ok: true;
  data: TableData;
  fileName: string;
  sheetName?: string;
}

export interface ParseError {
  ok: false;
  error: string;
  fileName: string;
}

export type ParseFileResult = ParseResult | ParseError;

/** 解析上传的 CSV 文件 */
export async function parseCSVFile(file: File): Promise<ParseFileResult> {
  const text = await file.text();
  const data = csvToTableData(text);
  if (data.columns.length === 0) {
    return { ok: false, fileName: file.name, error: '未能识别表头，请检查文件编码或分隔符（支持逗号、制表符）' };
  }
  return { ok: true, data, fileName: file.name };
}

/** 解析上传的 Excel 文件（.xlsx / .xls），依赖 xlsx 库 */
export async function parseExcelFile(file: File): Promise<ParseFileResult> {
  try {
    const XLSX = await import('xlsx');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const firstSheetName = wb.SheetNames[0];
    if (!firstSheetName) {
      return { ok: false, fileName: file.name, error: '工作簿中无工作表' };
    }
    const ws = wb.Sheets[firstSheetName];
    const json: unknown[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: false,
      defval: null,
    });
    if (!Array.isArray(json) || json.length === 0) {
      return { ok: true, data: { columns: [], rows: [] }, fileName: file.name, sheetName: firstSheetName };
    }
    const headerRow = json[0] as unknown[];
    const columns = headerRow.map((h, i) => (h != null && String(h).trim()) ? String(h).trim() : `列${i + 1}`);
    const rows: TableRow[] = (json as unknown[][]).slice(1).map((row) => {
      const obj: TableRow = {};
      columns.forEach((col, i) => {
        const raw = row[i];
        if (raw == null || raw === '') obj[col] = null;
        else if (typeof raw === 'number' && !Number.isNaN(raw)) obj[col] = raw;
        else obj[col] = String(raw);
      });
      return obj;
    });
    return {
      ok: true,
      data: { columns, rows },
      fileName: file.name,
      sheetName: firstSheetName,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, fileName: file.name, error: `解析失败：${message}` };
  }
}

const CSV_EXT = /\.csv$/i;
const EXCEL_EXT = /\.(xlsx|xls)$/i;

/**
 * 根据文件类型解析上传的表格文件
 * 支持：.csv（UTF-8）、.xlsx、.xls
 */
export async function parseTableFile(file: File): Promise<ParseFileResult> {
  const name = file.name || '';
  if (CSV_EXT.test(name)) return parseCSVFile(file);
  if (EXCEL_EXT.test(name)) return parseExcelFile(file);
  return { ok: false, fileName: name, error: '不支持的文件格式，请上传 .csv、.xlsx 或 .xls' };
}

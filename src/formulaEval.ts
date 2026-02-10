/**
 * 简单公式求值器：支持合并表内常见公式的清洗场景
 * - 支持 A1、B2 等单元格引用（列字母 + 行号，1-based）
 * - 支持四则运算 + - * / 与括号
 * - 支持 SUM(范围)、AVERAGE(范围)、IF(条件, 真值, 假值)
 */

import type { TableData, TableRow, CellValue } from './types';
import { getCellValue, isFormulaCell } from './types';

/** 列字母 -> 列索引 (A=0, B=1, ..., Z=25, AA=26, ...) */
function colLetterToIndex(letters: string): number {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.toUpperCase().charCodeAt(i) - 64);
  }
  return idx - 1;
}

/** 解析 A1 风格引用，返回 [rowIndex 0-based, colIndex] */
function parseRef(ref: string): [number, number] | null {
  const m = ref.trim().match(/^([A-Za-z]+)(\d+)$/);
  if (!m) return null;
  const colIdx = colLetterToIndex(m[1]);
  const rowIdx = parseInt(m[2], 10) - 1;
  return [rowIdx, colIdx];
}

/** 从表格中按 A1 引用取值；公式未求值按 0 */
function refValue(
  ref: string,
  data: TableData,
  currentRowIndex: number
): number {
  const parsed = parseRef(ref);
  if (!parsed) return 0;
  const [rowIdx, colIdx] = parsed;
  if (rowIdx < 0 || rowIdx >= data.rows.length) return 0;
  if (colIdx < 0 || colIdx >= data.columns.length) return 0;
  const row = data.rows[rowIdx];
  const col = data.columns[colIdx];
  const cell = row[col];
  const v = getCellValue(cell);
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

/** 解析范围 A1:B10，返回该范围内数值数组 */
function rangeValues(
  range: string,
  data: TableData
): number[] {
  const parts = range.split(':').map((s) => s.trim());
  if (parts.length !== 2) return [];
  const [r1, c1] = parseRef(parts[0]) ?? [-1, -1];
  const [r2, c2] = parseRef(parts[1]) ?? [-1, -1];
  if (r1 < 0 || c1 < 0 || r2 < 0 || c2 < 0) return [];
  const minR = Math.min(r1, r2);
  const maxR = Math.max(r1, r2);
  const minC = Math.min(c1, c2);
  const maxC = Math.max(c1, c2);
  const nums: number[] = [];
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      if (r < data.rows.length && c < data.columns.length) {
        const row = data.rows[r];
        const col = data.columns[c];
        const cell = row[col];
        const v = getCellValue(cell);
        if (v != null && v !== '') {
          const n = Number(v);
          if (!Number.isNaN(n)) nums.push(n);
        }
      }
    }
  }
  return nums;
}

/**
 * 对单格公式求值（A1 风格 + 四则运算 + SUM/AVERAGE/IF）
 * - 公式字符串应已去掉开头的 =
 * - 若求值失败返回 null
 */
export function evaluateFormula(
  expr: string,
  rowIndex: number,
  colIndex: number,
  data: TableData
): string | number | null {
  const raw = (expr || '').trim().replace(/^=/, '').trim();
  if (!raw) return null;

  const getRef = (ref: string) => refValue(ref, data, rowIndex);
  const getRange = (range: string) => rangeValues(range, data);

  try {
    // SUM(A1:A10) / AVERAGE(A1:A10)
    const sumMatch = raw.match(/^SUM\s*\(\s*([A-Za-z]+\d+\s*:\s*[A-Za-z]+\d+)\s*\)$/i);
    if (sumMatch) {
      const vals = getRange(sumMatch[1]);
      return vals.length ? vals.reduce((a, b) => a + b, 0) : 0;
    }
    const avgMatch = raw.match(/^AVERAGE\s*\(\s*([A-Za-z]+\d+\s*:\s*[A-Za-z]+\d+)\s*\)$/i);
    if (avgMatch) {
      const vals = getRange(avgMatch[1]);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    }

    // IF(条件, 真值, 假值) 简化：条件为 A1>0 形式，真值/假值可为数字或引用
    const ifMatch = raw.match(/^IF\s*\(\s*(.+?)\s*,\s*(.+?)\s*,\s*(.+?)\s*\)$/i);
    if (ifMatch) {
      const cond = ifMatch[1].trim();
      const thenVal = ifMatch[2].trim();
      const elseVal = ifMatch[3].trim();
      const opMatch = cond.match(/^([A-Za-z]+\d+)\s*(>=|<=|>|<|=|<>)\s*(.+)$/);
      let condResult = false;
      if (opMatch) {
        const left = getRef(opMatch[1]);
        const right = /^\d+(\.\d+)?$/.test(opMatch[3].trim())
          ? Number(opMatch[3].trim())
          : getRef(opMatch[3].trim());
        const op = opMatch[2];
        if (op === '>') condResult = left > right;
        else if (op === '<') condResult = left < right;
        else if (op === '>=') condResult = left >= right;
        else if (op === '<=') condResult = left <= right;
        else if (op === '=' || op === '==') condResult = left === right;
        else if (op === '<>') condResult = left !== right;
      }
      const chosen = condResult ? thenVal : elseVal;
      const refParsed = parseRef(chosen);
      if (refParsed) return getRef(chosen);
      const n = Number(chosen);
      return Number.isNaN(n) ? chosen : n;
    }

    // 四则运算：替换 A1 风格引用为数值，再安全求值
    let exprForEval = raw.replace(/\b([A-Za-z]+\d+)\b/g, (_, ref) => {
      return String(getRef(ref));
    });
    exprForEval = exprForEval.replace(/\s+/g, '');
    // 只允许数字、小数点、+-*/()
    if (!/^[\d.\+\-\*\/()]+$/.test(exprForEval)) return null;
    const result = Function(`"use strict"; return (${exprForEval})`)();
    const num = Number(result);
    return Number.isNaN(num) ? null : num;
  } catch {
    return null;
  }
}

/**
 * 对整表执行公式求值：按行优先、列优先顺序求值，引用已求值单元格
 */
export function evaluateAllFormulas(
  data: TableData,
  columnsToEval?: string[]
): TableData {
  const cols = columnsToEval ?? data.columns;
  const colSet = new Set(cols);
  const resultRows: TableRow[] = [];

  for (let rowIndex = 0; rowIndex < data.rows.length; rowIndex++) {
    const oldRow = data.rows[rowIndex];
    const newRow: TableRow = { ...oldRow };
    for (let colIndex = 0; colIndex < data.columns.length; colIndex++) {
      const col = data.columns[colIndex];
      if (!colSet.has(col)) continue;
      const cell = newRow[col];
      if (!isFormulaCell(cell)) continue;
      const view: TableData = {
        columns: data.columns,
        rows: [...resultRows, newRow, ...data.rows.slice(rowIndex + 1)],
      };
      const value = evaluateFormula(cell.expr, rowIndex, colIndex, view);
      newRow[col] = value ?? null;
    }
    resultRows.push(newRow);
  }
  return { columns: data.columns, rows: resultRows };
}

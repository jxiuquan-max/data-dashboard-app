/**
 * 显式差异计算：数值归一化 + 严格共有列对比，消除虚假报错
 */

const ANCHOR_COLUMN = '商品名称';
const PRICE_COLUMNS = ['售价', '成本价'];

export type RowStatus = 'MODIFIED' | 'ADDED';

export interface DiffItem {
  productName: string;
  status: RowStatus;
  col?: string;
  oldValue?: string | null;
  newValue?: string | null;
}

export type RowWithStatus = Record<string, string | null> & {
  status?: RowStatus;
  _diffChanges?: Array<{ col: string; oldValue: string | null; newValue: string | null }>;
};

/**
 * 数值归一化：移除货币符号、千分位逗号、首尾空格
 * 示例：￥79.00、79、￥79 均视为 79
 */
export function sanitizeValue(value: string | null | undefined): string {
  if (value == null) return '';
  let s = String(value).trim();
  s = s.replace(/￥/g, '').replace(/,/g, '').trim();
  return s;
}

/**
 * 严格比较：归一化后相等则视为一致
 */
export function valuesEqualAfterSanitize(a: string | null | undefined, b: string | null | undefined): boolean {
  return sanitizeValue(a) === sanitizeValue(b);
}

const DEBUG_DIFF = true;
function logDiff(productName: string, col: string, oldVal: string | null, newVal: string | null, isConflict: boolean) {
  if (!DEBUG_DIFF) return;
  const oldS = sanitizeValue(oldVal);
  const newS = sanitizeValue(newVal);
  const result = isConflict ? '冲突' : '一致';
  console.log(`[Diff] 商品：${productName}，列：${col}，底表值：${oldS || '(空)'}，新表值：${newS || '(空)'} -> 结果：${result}`);
}

/**
 * 以 '商品名称' 为唯一标识，遍历新表计算差异
 * - 售价/成本价与 baseline 不符（归一化后）-> MODIFIED
 * - 底表没有该商品 -> ADDED
 * - 仅对比共有列（baseColumns 与 newRow 都有的列），新列不计入
 */
export function calculateDiff(
  baseline: Record<string, string | null>[],
  newMappedRows: Record<string, string | null>[],
  anchorColumn: string = ANCHOR_COLUMN,
  priceColumns: string[] = PRICE_COLUMNS,
  baseColumns?: string[]
): { rowsWithStatus: RowWithStatus[]; diffList: DiffItem[] } {
  const baselineByProduct = new Map<string, Record<string, string | null>>();
  for (const r of baseline) {
    const pn = String(r[anchorColumn] ?? '').trim();
    if (pn) baselineByProduct.set(pn, r);
  }

  const diffList: DiffItem[] = [];
  const rowsWithStatus: RowWithStatus[] = [];
  const sharedCols = baseColumns
    ? priceColumns.filter((c) => baseColumns.includes(c))
    : priceColumns;

  // 1. 遍历 baseline：若新表有匹配且价格变动（归一化后）-> MODIFIED
  for (const baseRow of baseline) {
    const pn = String(baseRow[anchorColumn] ?? '').trim();
    const newRow = newMappedRows.find((r) => String(r[anchorColumn] ?? '').trim() === pn);

    if (newRow) {
      const changes: Array<{ col: string; oldValue: string | null; newValue: string | null }> = [];
      for (const col of sharedCols) {
        const oldV = baseRow[col] ?? null;
        const newV = newRow[col] ?? null;
        const isConflict = !valuesEqualAfterSanitize(oldV, newV);
        logDiff(pn, col, oldV, newV, isConflict);
        if (isConflict) {
          changes.push({ col, oldValue: oldV, newValue: newV });
          diffList.push({
            productName: pn,
            status: 'MODIFIED',
            col,
            oldValue: oldV,
            newValue: newV,
          });
        }
      }
      const merged: RowWithStatus = { ...baseRow };
      for (const [k, v] of Object.entries(newRow)) {
        if (v != null) merged[k] = v;
      }
      merged.status = changes.length > 0 ? 'MODIFIED' : undefined;
      merged._diffChanges = changes.length > 0 ? changes : undefined;
      rowsWithStatus.push(merged);
    } else {
      rowsWithStatus.push({ ...baseRow });
    }
  }

  // 2. 遍历新表：底表没有 -> ADDED
  for (const newRow of newMappedRows) {
    const pn = String(newRow[anchorColumn] ?? '').trim();
    if (!pn) continue;
    if (!baselineByProduct.has(pn)) {
      rowsWithStatus.push({ ...newRow, status: 'ADDED' });
      diffList.push({ productName: pn, status: 'ADDED' });
    }
  }

  return { rowsWithStatus, diffList };
}

/** 从 diffList 构建 ChangeReport，供侧边栏使用 */
export function buildChangeReportFromDiffList(
  diffList: DiffItem[],
  baseline?: Record<string, string | null>[],
  anchorColumn: string = '商品名称'
): { addedCount: number; modifiedCount: number; deletedCount: number; addedProducts: string[]; modifiedRows: Array<{ productName: string; baseRowIndex: number; changes: Array<{ col: string; oldVal: string | null; newVal: string | null }> }>; deletedProducts: string[] } {
  const addedProducts = [...new Set(diffList.filter((d) => d.status === 'ADDED').map((d) => d.productName))];
  const modifiedByProduct = new Map<string, Array<{ col: string; oldVal: string | null; newVal: string | null }>>();
  for (const d of diffList) {
    if (d.status === 'MODIFIED' && d.col) {
      const arr = modifiedByProduct.get(d.productName) ?? [];
      arr.push({ col: d.col, oldVal: d.oldValue ?? null, newVal: d.newValue ?? null });
      modifiedByProduct.set(d.productName, arr);
    }
  }
  const getBaseRowIndex = (pn: string) => {
    if (!baseline) return 0;
    const i = baseline.findIndex((r) => String(r[anchorColumn] ?? '').trim() === pn);
    return i >= 0 ? i : 0;
  };
  const modifiedRows = Array.from(modifiedByProduct.entries()).map(([productName, changes]) => ({
    productName,
    baseRowIndex: getBaseRowIndex(productName),
    changes,
  }));
  return {
    addedCount: addedProducts.length,
    modifiedCount: modifiedRows.length,
    deletedCount: 0,
    addedProducts,
    modifiedRows,
    deletedProducts: [],
  };
}

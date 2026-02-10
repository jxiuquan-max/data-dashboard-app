/**
 * 表格数据清洗 - 类型定义
 * 用于模拟 AI 还原用户对表格数据清洗的全过程
 */

/** 公式单元格：存储表达式，计算时再求值 */
export interface FormulaCell {
  t: 'formula';
  expr: string;
}

/** 单元格值：普通值或公式 */
export type CellValue = string | number | null | undefined | FormulaCell;

/** 表格行：列名 -> 单元格值（含公式） */
export type TableRow = Record<string, CellValue>;

/** 判断是否为公式单元格 */
export function isFormulaCell(cell: CellValue): cell is FormulaCell {
  return typeof cell === 'object' && cell !== null && 't' in cell && (cell as FormulaCell).t === 'formula';
}

/** 取单元格的“可比较/展示值”：公式未求值时按空处理，求值后为值 */
export function getCellValue(cell: CellValue): string | number | null | undefined {
  if (cell == null) return cell;
  if (isFormulaCell(cell)) return undefined;
  return cell as string | number;
}

/** 表格数据 */
export interface TableData {
  columns: string[];
  rows: TableRow[];
}

/** 合并方式 */
export type MergeType =
  | 'union'        // 纵向合并（按列对齐，追加行）
  | 'inner_join'  // 内连接：仅保留两表键值均匹配的行
  | 'left_join'   // 左连接：保留左表全部，右表匹配则合并
  | 'right_join'  // 右连接：保留右表全部，左表匹配则合并
  | 'full_join';  // 全外连接：左右均保留，能匹配则合并

/** 清洗操作类型 */
export type CleanOpType =
  | 'DELETE_ROW'           // 删除行
  | 'FILL_NULL'            // 填充空值
  | 'REMOVE_DUPLICATES'    // 去重
  | 'RENAME_COLUMN'        // 重命名列
  | 'TRIM_WHITESPACE'      // 去除首尾空格
  | 'DROP_COLUMN'          // 删除列
  | 'FILTER_ROWS'          // 按条件过滤
  | 'NORMALIZE_CASE'       // 统一大小写
  | 'REPLACE_VALUE'        // 替换值
  | 'MERGE_TABLES'         // 复杂合并（Union / Join）
  | 'CONVERT_TYPE'         // 列类型转换
  | 'SPLIT_COLUMN'         // 按分隔符拆分列
  | 'CONCAT_COLUMNS'       // 多列合并为一列
  | 'COALESCE_COLUMNS'     // 多列取先有值合并为一列（用于合并相似列）
  | 'SORT_ROWS'            // 按列排序
  | 'ADD_COLUMN'           // 添加列（常量或表达式）
  | 'MAP_VALUES'           // 列值映射（枚举替换）
  | 'SLICE_ROWS'           // 保留前/后 N 行
  | 'SAMPLE_ROWS'          // 随机抽样
  | 'COLLAPSE_WHITESPACE'  // 连续空格压成单个
  | 'DROP_EMPTY_ROWS'      // 删除整行为空的行
  | 'REORDER_COLUMNS'      // 调整列顺序
  | 'EVALUATE_FORMULAS'    // 公式求值（扁平化为值）
  | 'REMOVE_FORMULAS'      // 移除公式（替换为占位或空）
  | 'FORMULA_AUDIT';       // 公式审计（标记含公式的单元格/行）

/** 过滤运算符（扩展：数值、正则） */
export type FilterOperator =
  | 'eq' | 'ne' | 'contains' | 'empty' | 'not_empty'
  | 'gt' | 'gte' | 'lt' | 'lte' | 'regex';

/** 单条清洗操作的参数（按类型不同） */
export interface CleanOpParams {
  DELETE_ROW?: { rowIndex: number };
  FILL_NULL?: { column: string; value: string | number };
  REMOVE_DUPLICATES?: { columns: string[] };
  RENAME_COLUMN?: { oldName: string; newName: string };
  TRIM_WHITESPACE?: { columns: string[] };
  DROP_COLUMN?: { column: string };
  FILTER_ROWS?: { column: string; operator: FilterOperator; value?: string };
  NORMALIZE_CASE?: { column: string; mode: 'upper' | 'lower' };
  REPLACE_VALUE?: { column: string; from: string; to: string };
  /** 复杂合并 */
  MERGE_TABLES?: {
    mergeType: MergeType;
    rightTable: TableData;
    rightTableName?: string;
    leftKeys?: string[];
    rightKeys?: string[];
    columnMapping?: Record<string, string>;
  };
  /** 列类型转换 */
  CONVERT_TYPE?: { column: string; targetType: 'string' | 'number' | 'boolean' };
  /** 按分隔符拆分列 */
  SPLIT_COLUMN?: { column: string; separator: string; newColumnNames: string[] };
  /** 多列合并为一列 */
  CONCAT_COLUMNS?: { columns: string[]; newColumn: string; separator?: string };
  /** 多列取先有值合并为一列（行内从左到右取第一个非空） */
  COALESCE_COLUMNS?: { columns: string[]; newColumnName: string };
  /** 按列排序 */
  SORT_ROWS?: { by: { column: string; order: 'asc' | 'desc' }[] };
  /** 添加列 */
  ADD_COLUMN?: { column: string; value: string | number };
  /** 列值映射 */
  MAP_VALUES?: { column: string; mapping: Record<string, string | number> };
  /** 保留前/后 N 行 */
  SLICE_ROWS?: { mode: 'head' | 'tail'; count: number };
  /** 随机抽样 */
  SAMPLE_ROWS?: { count: number; seed?: number };
  /** 连续空格压成单个 */
  COLLAPSE_WHITESPACE?: { columns: string[] };
  /** 删除整行为空的行 */
  DROP_EMPTY_ROWS?: { columns?: string[] };
  /** 调整列顺序 */
  REORDER_COLUMNS?: { columnOrder: string[] };
  /** 公式求值：将公式单元格替换为计算结果 */
  EVALUATE_FORMULAS?: { columns?: string[] };
  /** 移除公式：替换为占位符或空 */
  REMOVE_FORMULAS?: { columns?: string[]; placeholder?: string };
  /** 公式审计：新增列标记该行/列是否含公式 */
  FORMULA_AUDIT?: { outputColumn?: string };
}

/** 一条历史记录：用户执行的清洗步骤 */
export interface CleanStep {
  id: string;
  type: CleanOpType;
  params: CleanOpParams;
  /** 人类可读描述，用于 AI 还原展示 */
  description: string;
  /** 操作前的行数（用于回放校验） */
  rowCountBefore: number;
  /** 操作后的行数 */
  rowCountAfter: number;
  timestamp: number;
}

/** 公式求值器：由外部注入，避免循环依赖 */
export type FormulaEvaluator = (data: TableData, columns?: string[]) => TableData;

/** 应用某条步骤到表格数据，返回新表格（不可变） */
export function applyStep(
  data: TableData,
  step: CleanStep,
  options?: { formulaEvaluator?: FormulaEvaluator }
): TableData {
  const { type, params } = step;
  let rows = [...data.rows];
  let columns = [...data.columns];

  switch (type) {
    case 'DELETE_ROW': {
      const { rowIndex } = params.DELETE_ROW!;
      rows = rows.filter((_, i) => i !== rowIndex);
      break;
    }
    case 'FILL_NULL': {
      const { column, value } = params.FILL_NULL!;
      rows = rows.map((row) => {
        const cv = getCellValue(row[column]);
        const isEmpty = cv == null || cv === '';
        return { ...row, [column]: isEmpty ? value : row[column] };
      });
      break;
    }
    case 'REMOVE_DUPLICATES': {
      const cols = params.REMOVE_DUPLICATES!.columns;
      const seen = new Set<string>();
      rows = rows.filter((row) => {
        const key = cols.map((c) => String(getCellValue(row[c]) ?? '')).join('\0');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      break;
    }
    case 'RENAME_COLUMN': {
      const { oldName, newName } = params.RENAME_COLUMN!;
      columns = columns.map((c) => (c === oldName ? newName : c));
      rows = rows.map((row) => {
        const next = { ...row };
        if (oldName in next) {
          next[newName] = next[oldName];
          delete next[oldName];
        }
        return next;
      });
      break;
    }
    case 'TRIM_WHITESPACE': {
      const cols = params.TRIM_WHITESPACE!.columns;
      rows = rows.map((row) => {
        const next = { ...row };
        for (const c of cols) {
          const v = next[c];
          if (typeof v === 'string') next[c] = v.trim();
        }
        return next;
      });
      break;
    }
    case 'DROP_COLUMN': {
      const col = params.DROP_COLUMN!.column;
      columns = columns.filter((c) => c !== col);
      rows = rows.map((row) => {
        const next = { ...row };
        delete next[col];
        return next;
      });
      break;
    }
    case 'FILTER_ROWS': {
      const { column, operator, value } = params.FILTER_ROWS!;
      rows = rows.filter((row) => {
        const cell = getCellValue(row[column]);
        const str = cell == null ? '' : String(cell).trim();
        const num = Number(cell);
        const isNum = cell !== '' && cell != null && !Number.isNaN(num);
        if (operator === 'empty') return str === '';
        if (operator === 'not_empty') return str !== '';
        if (operator === 'contains') return value != null && String(cell ?? '').includes(value);
        if (operator === 'regex' && value != null) {
          try {
            return new RegExp(value).test(String(cell ?? ''));
          } catch {
            return false;
          }
        }
        if (operator === 'regex') return false;
        if (operator === 'eq') return value != null && str === value;
        if (operator === 'ne') return value != null && str !== value;
        if (operator === 'gt' && value != null) return isNum ? num > Number(value) : str > value;
        if (operator === 'gte' && value != null) return isNum ? num >= Number(value) : str >= value;
        if (operator === 'lt' && value != null) return isNum ? num < Number(value) : str < value;
        if (operator === 'lte' && value != null) return isNum ? num <= Number(value) : str <= value;
        return true;
      });
      break;
    }
    case 'NORMALIZE_CASE': {
      const { column, mode } = params.NORMALIZE_CASE!;
      rows = rows.map((row) => {
        const next = { ...row };
        const v = next[column];
        if (typeof v === 'string')
          next[column] = mode === 'upper' ? v.toUpperCase() : v.toLowerCase();
        return next;
      });
      break;
    }
    case 'REPLACE_VALUE': {
      const { column, from, to } = params.REPLACE_VALUE!;
      rows = rows.map((row) => {
        const next = { ...row };
        const v = next[column];
        if (typeof v === 'string') next[column] = v.replace(new RegExp(escapeRe(from), 'g'), to);
        return next;
      });
      break;
    }
    case 'MERGE_TABLES': {
      const mergeParams = params.MERGE_TABLES!;
      const result = mergeTables(data, mergeParams.mergeType, mergeParams.rightTable, {
        leftKeys: mergeParams.leftKeys,
        rightKeys: mergeParams.rightKeys,
        columnMapping: mergeParams.columnMapping,
      });
      columns.length = 0;
      columns.push(...result.columns);
      rows.length = 0;
      rows.push(...result.rows);
      break;
    }
    case 'CONVERT_TYPE': {
      const { column, targetType } = params.CONVERT_TYPE!;
      rows = rows.map((row) => {
        const next = { ...row };
        const v = next[column];
        if (targetType === 'string') next[column] = v == null ? '' : String(v);
        else if (targetType === 'number') {
          const n = Number(v);
          next[column] = v === '' || v == null || Number.isNaN(n) ? null : n;
        } else if (targetType === 'boolean') {
          const s = String(v ?? '').toLowerCase();
          next[column] = s === 'true' || s === '1' || s === '是' || s === 'yes';
        }
        return next;
      });
      break;
    }
    case 'SPLIT_COLUMN': {
      const { column, separator, newColumnNames } = params.SPLIT_COLUMN!;
      const idx = columns.indexOf(column);
      const before = idx < 0 ? columns : columns.slice(0, idx);
      const after = idx < 0 ? [] : columns.slice(idx + 1);
      columns = [...before, ...newColumnNames, ...after];
      rows = rows.map((row) => {
        const raw = String(row[column] ?? '');
        const parts = raw.split(separator);
        const next: TableRow = {};
        for (const c of before) next[c] = row[c] ?? null;
        for (let i = 0; i < newColumnNames.length; i++) next[newColumnNames[i]] = parts[i] ?? '';
        for (const c of after) next[c] = row[c] ?? null;
        return next;
      });
      break;
    }
    case 'CONCAT_COLUMNS': {
      const { columns: srcCols, newColumn, separator = '' } = params.CONCAT_COLUMNS!;
      const newCols: string[] = [];
      let inserted = false;
      for (const c of data.columns) {
        if (srcCols.includes(c)) {
          if (!inserted) {
            newCols.push(newColumn);
            inserted = true;
          }
        } else newCols.push(c);
      }
      columns = newCols;
      rows = rows.map((row) => {
        const next: TableRow = {};
        const concatVal = srcCols.map((c) => String(row[c] ?? '')).join(separator);
        for (const c of columns) next[c] = c === newColumn ? concatVal : (row[c] ?? null);
        return next;
      });
      break;
    }
    case 'COALESCE_COLUMNS': {
      const { columns: srcCols, newColumnName } = params.COALESCE_COLUMNS!;
      const newCols: string[] = [];
      let inserted = false;
      for (const c of data.columns) {
        if (srcCols.includes(c)) {
          if (!inserted) {
            newCols.push(newColumnName);
            inserted = true;
          }
        } else newCols.push(c);
      }
      columns = newCols;
      rows = rows.map((row) => {
        let coalesced: CellValue = null;
        for (const col of srcCols) {
          const v = getCellValue(row[col]);
          if (v != null && String(v).trim() !== '') {
            coalesced = v;
            break;
          }
        }
        const next: TableRow = {};
        for (const c of columns) next[c] = c === newColumnName ? coalesced : (row[c] ?? null);
        return next;
      });
      break;
    }
    case 'SORT_ROWS': {
      const by = params.SORT_ROWS!.by;
      rows = [...rows].sort((a, b) => {
        for (const { column: col, order } of by) {
          const va = getCellValue(a[col]) ?? '';
          const vb = getCellValue(b[col]) ?? '';
          const cmp = typeof va === 'number' && typeof vb === 'number'
            ? va - vb
            : String(va).localeCompare(String(vb));
          if (cmp !== 0) return order === 'desc' ? -cmp : cmp;
        }
        return 0;
      });
      break;
    }
    case 'ADD_COLUMN': {
      const { column: newCol, value } = params.ADD_COLUMN!;
      if (!columns.includes(newCol)) columns.push(newCol);
      rows = rows.map((row) => ({ ...row, [newCol]: value }));
      break;
    }
    case 'MAP_VALUES': {
      const { column, mapping } = params.MAP_VALUES!;
      rows = rows.map((row) => {
        const next = { ...row };
        const key = String(row[column] ?? '');
        if (key in mapping) next[column] = mapping[key];
        return next;
      });
      break;
    }
    case 'SLICE_ROWS': {
      const { mode, count } = params.SLICE_ROWS!;
      if (mode === 'head') rows = rows.slice(0, Math.max(0, count));
      else rows = rows.slice(-Math.max(0, count));
      break;
    }
    case 'SAMPLE_ROWS': {
      const { count, seed } = params.SAMPLE_ROWS!;
      const n = Math.min(Math.max(0, count), rows.length);
      let arr = [...rows];
      if (seed != null) {
        let s = seed;
        const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
      } else {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
      }
      rows = arr.slice(0, n);
      break;
    }
    case 'COLLAPSE_WHITESPACE': {
      const cols = params.COLLAPSE_WHITESPACE!.columns;
      rows = rows.map((row) => {
        const next = { ...row };
        for (const c of cols) {
          const v = next[c];
          if (typeof v === 'string') next[c] = v.replace(/\s+/g, ' ').trim();
        }
        return next;
      });
      break;
    }
    case 'DROP_EMPTY_ROWS': {
      const checkCols = params.DROP_EMPTY_ROWS!.columns ?? data.columns;
      rows = rows.filter((row) =>
        checkCols.some((c) => {
          const v = getCellValue(row[c]);
          return v != null && String(v).trim() !== '';
        })
      );
      break;
    }
    case 'REORDER_COLUMNS': {
      const order = params.REORDER_COLUMNS!.columnOrder;
      const set = new Set(data.columns);
      columns = order.filter((c) => set.has(c));
      const rest = data.columns.filter((c) => !order.includes(c));
      columns.push(...rest);
      rows = rows.map((row) => {
        const next: TableRow = {};
        for (const c of columns) next[c] = row[c] ?? null;
        return next;
      });
      break;
    }
    case 'EVALUATE_FORMULAS': {
      const cols = params.EVALUATE_FORMULAS!.columns;
      if (options?.formulaEvaluator) {
        const next = options.formulaEvaluator(data, cols);
        columns = [...next.columns];
        rows = next.rows.map((r) => ({ ...r }));
      }
      break;
    }
    case 'REMOVE_FORMULAS': {
      const cols = params.REMOVE_FORMULAS!.columns ?? data.columns;
      const placeholder = params.REMOVE_FORMULAS!.placeholder ?? null;
      const colSet = new Set(cols);
      rows = rows.map((row) => {
        const next = { ...row };
        for (const c of cols) {
          if (colSet.has(c) && isFormulaCell(next[c])) {
            next[c] = placeholder as CellValue;
          }
        }
        return next;
      });
      break;
    }
    case 'FORMULA_AUDIT': {
      const outCol = params.FORMULA_AUDIT!.outputColumn ?? '含公式';
      if (!columns.includes(outCol)) columns.push(outCol);
      rows = rows.map((row) => {
        const next = { ...row };
        const hasFormula = data.columns.some((c) => isFormulaCell(row[c]));
        next[outCol] = hasFormula;
        return next;
      });
      break;
    }
    default:
      break;
  }

  return { columns, rows };
}

/** 行键：多列值拼接 */
function rowKey(row: TableRow, keys: string[]): string {
  return keys.map((k) => String(getCellValue(row[k]) ?? '')).join('\0');
}

/** 复杂合并：Union 或多种 Join */
export function mergeTables(
  left: TableData,
  mergeType: MergeType,
  right: TableData,
  options: {
    leftKeys?: string[];
    rightKeys?: string[];
    columnMapping?: Record<string, string>;
  }
): TableData {
  const { leftKeys = [], rightKeys = [], columnMapping = {} } = options;

  if (mergeType === 'union') {
    const outColumns = [...left.columns];
    const seen = new Set(left.columns);
    for (const c of right.columns) {
      const target = columnMapping[c] ?? c;
      if (!seen.has(target)) {
        seen.add(target);
        outColumns.push(target);
      }
    }
    const outRows: TableRow[] = [];
    for (const row of left.rows) {
      const r: TableRow = {};
      for (const col of outColumns) r[col] = row[col] ?? null;
      outRows.push(r);
    }
    for (const row of right.rows) {
      const r: TableRow = {};
      for (const col of outColumns) {
        const rightCol =
          Object.keys(columnMapping).find((k) => columnMapping[k] === col) ?? col;
        r[col] = right.columns.includes(rightCol) ? (row[rightCol] ?? null) : null;
      }
      outRows.push(r);
    }
    return { columns: outColumns, rows: outRows };
  }

  // Join：右表按 rightKeys 建索引（一个键可能对应多行）
  const rightIndex = new Map<string, TableRow[]>();
  for (const row of right.rows) {
    const key = rowKey(row, rightKeys);
    if (!rightIndex.has(key)) rightIndex.set(key, []);
    rightIndex.get(key)!.push(row);
  }

  const rightOnlyCols = right.columns.filter((c) => !rightKeys.includes(c));
  const leftOnlyCols = left.columns.filter((c) => !leftKeys.includes(c));
  const suffix = '_2';
  const rightColNames = rightOnlyCols.map((c) => {
    const collision = left.columns.includes(c);
    return collision ? c + suffix : c;
  });
  const outColumns = [...left.columns];
  for (let i = 0; i < rightOnlyCols.length; i++) {
    if (!outColumns.includes(rightColNames[i])) outColumns.push(rightColNames[i]);
  }

  const outRows: TableRow[] = [];

  const emitJoinRow = (l: TableRow, r: TableRow | null) => {
    const row: TableRow = { ...l };
    if (r) {
      for (let i = 0; i < rightOnlyCols.length; i++) {
        row[rightColNames[i]] = r[rightOnlyCols[i]] ?? null;
      }
    } else {
      for (const col of rightColNames) row[col] = null;
    }
    return row;
  };

  const emptyLeftRow = (): TableRow => {
    const row: TableRow = {};
    for (const c of left.columns) row[c] = null;
    return row;
  };

  if (mergeType === 'inner_join') {
    for (const lRow of left.rows) {
      const key = rowKey(lRow, leftKeys);
      for (const r of rightIndex.get(key) ?? []) {
        outRows.push(emitJoinRow(lRow, r));
      }
    }
  } else if (mergeType === 'left_join') {
    for (const lRow of left.rows) {
      const key = rowKey(lRow, leftKeys);
      const rRows = rightIndex.get(key) ?? [];
      if (rRows.length > 0) {
        for (const r of rRows) outRows.push(emitJoinRow(lRow, r));
      } else {
        outRows.push(emitJoinRow(lRow, null));
      }
    }
  } else if (mergeType === 'right_join') {
    const leftIndex = new Map<string, TableRow[]>();
    for (const row of left.rows) {
      const key = rowKey(row, leftKeys);
      if (!leftIndex.has(key)) leftIndex.set(key, []);
      leftIndex.get(key)!.push(row);
    }
    for (const rRow of right.rows) {
      const key = rowKey(rRow, rightKeys);
      const lRows = leftIndex.get(key) ?? [];
      if (lRows.length > 0) {
        for (const l of lRows) outRows.push(emitJoinRow(l, rRow));
      } else {
        outRows.push(emitJoinRow(emptyLeftRow(), rRow));
      }
    }
  } else if (mergeType === 'full_join') {
    const leftKeysSet = new Set(left.rows.map((l) => rowKey(l, leftKeys)));
    for (const lRow of left.rows) {
      const key = rowKey(lRow, leftKeys);
      const rRows = rightIndex.get(key) ?? [];
      if (rRows.length > 0) {
        for (const r of rRows) outRows.push(emitJoinRow(lRow, r));
      } else {
        outRows.push(emitJoinRow(lRow, null));
      }
    }
    for (const rRow of right.rows) {
      const key = rowKey(rRow, rightKeys);
      if (!leftKeysSet.has(key)) outRows.push(emitJoinRow(emptyLeftRow(), rRow));
    }
  }

  return { columns: outColumns, rows: outRows };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 深拷贝表格 */
export function cloneTable(data: TableData): TableData {
  return {
    columns: [...data.columns],
    rows: data.rows.map((r) => ({ ...r })),
  };
}

/** 表格内容指纹，用于检测源数据是否变更（列 + 行内容） */
export function tableDataFingerprint(data: TableData): string {
  const { columns, rows } = data;
  const header = columns.join('\t');
  const body = rows.map((r) => columns.map((c) => String(getCellValue(r[c]) ?? '')).join('\t')).join('\n');
  return header + '\n' + body;
}

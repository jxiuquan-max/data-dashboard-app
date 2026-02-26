/**
 * 全能审计路径 (Unified Audit Path)
 * 三维体检标准：针对 商品库存表-多错误类型 等场景
 */

import { sanitizeValue } from './diffUtils';

/** 维度 A：数据类型硬伤 - 指定列 */
const TYPE_CHECK_COLUMNS = ['售价', '商品采购入库数', '剩余库存数'];

/** 维度 B：空值警报 - 关键业务列 */
const EMPTY_CHECK_COLUMNS = ['售价', '商品采购入库数', '剩余库存数'];

/** 问题类型 */
export type HealthIssueType =
  | 'DATA_TYPE_VIOLATION'   // 维度 A：无法转换为数字（待定、aaa、不确定）
  | 'EMPTY_VALUE'           // 维度 B：关键列为空
  | 'IDENTITY_GAP';         // 维度 C：名称微差（34寸 vs 34吋）

/** 严重程度 */
export type HealthSeverity = 'blocker' | 'warning';

/** 受影响单元格 */
export interface AffectedCell {
  rowIndex: number;
  colKey: string;
  rawValue?: string | null;
  baseValue?: string | null;
}

/** 名称对齐建议：含重合度与可视化证据 */
export interface IdentityPair {
  newName: string;
  baseName: string;
  /** 0-1 重合度，用于 UI 展示 */
  overlapScore?: number;
  /** 底表名称中「额外部分」的标注，如 VR[虚拟现实]头盔 */
  overlapEvidence?: string;
}

/** 单条健康问题 */
export interface HealthIssue {
  type: HealthIssueType;
  severity: HealthSeverity;
  message: string;
  affectedRows: Array<{ rowIndex: number; productName?: string }>;
  affectedCells?: AffectedCell[];
  /** 名称差异时：新表名 -> 底表相似名（含重合度与证据） */
  identityPairs?: IdentityPair[];
  fixSuggestion?: string;
}

/** 健康报告 */
export interface HealthReport {
  /** 数据乱码 (ERROR) */
  dirtyErrors: HealthIssue | null;
  /** 名称差异 (IDENTITY_GAP) */
  identityGaps: HealthIssue | null;
  /** 关键信息缺失 (WARNING) */
  emptyWarnings: HealthIssue | null;
  /** 供画布高亮：乱码格（红色） */
  dirtyCells: Array<{ rowIndex: number; colKey: string }>;
  /** 供画布高亮：名称微差格（黄色闪烁）- 锚点列 */
  identityGapCells: Array<{ rowIndex: number; colKey: string }>;
  /** 供画布高亮：空值格（浅橙） */
  emptyCells: Array<{ rowIndex: number; colKey: string }>;
}

/** 清洗后能否解析为数字 */
function canParseAsNumber(value: string | null | undefined): boolean {
  const s = sanitizeValue(value);
  if (s === '') return false; // 空不算可解析
  const n = parseFloat(s);
  return !Number.isNaN(n) && isFinite(n);
}

/** 脱水处理：移除空格、特殊字符，转小写，用于名称对比 */
function dehydrate(s: string): string {
  return s
    .replace(/\s/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '') // 移除标点等特殊字符，保留字母数字和 CJK
    .toLowerCase();
}

/** 规范化名称：脱水 + 寸/吋、显示屏/显示器 等语义归一 */
function normalizeForMatch(s: string): string {
  const d = dehydrate(s);
  return d
    .replace(/寸/g, '吋')
    .replace(/显示屏/g, '显示器');
}

/** 字符重合度：新表名称中有多少比例的字符出现在底表名称中 (0-1) */
function charOverlapScore(newStr: string, baseStr: string): number {
  const na = normalizeForMatch(newStr);
  const nb = normalizeForMatch(baseStr);
  if (na.length === 0) return 0;
  const baseSet = new Set([...nb]);
  let hit = 0;
  for (const c of na) {
    if (baseSet.has(c)) hit++;
  }
  return hit / na.length;
}

/** 生成重叠证据：底表名称中「额外」部分用方括号标注，如 VR[虚拟现实]头盔 */
function buildOverlapEvidence(newName: string, baseName: string): string {
  const na = normalizeForMatch(newName);
  if (na.length === 0) return baseName;
  const newSet = new Set([...na]);
  const charInNew = (ch: string): boolean => {
    if (!ch.trim()) return true;
    const n = ch.toLowerCase().replace(/\s/g, '');
    return newSet.has(n) || na.includes(ch);
  };
  let result = '';
  let i = 0;
  while (i < baseName.length) {
    const c = baseName[i];
    if (charInNew(c)) {
      result += c;
      i++;
    } else {
      let extra = '';
      while (i < baseName.length && !charInNew(baseName[i])) {
        extra += baseName[i];
        i++;
      }
      if (extra) result += `[${extra}]`;
    }
  }
  return result || baseName;
}

/** 计算两字符串相似度 (0-1)：脱水对比 + 字符重合度，审计阶段宁可错报不可漏报 */
function similarity(a: string, b: string): { score: number; overlapScore: number } {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (na === nb) return { score: 1, overlapScore: 1 };
  if (na.includes(nb) || nb.includes(na)) return { score: 0.95, overlapScore: 1 };
  const overlapScore = charOverlapScore(a, b);
  let posScore = 0;
  const minLen = Math.min(na.length, nb.length);
  for (let i = 0; i < minLen; i++) {
    if (na[i] === nb[i]) posScore++;
  }
  posScore = posScore / Math.max(na.length, nb.length, 1);
  const score = Math.max(posScore, overlapScore >= 0.6 ? overlapScore : posScore);
  return { score, overlapScore };
}

/** 维度 A：数据类型硬伤 - 有值但无法转数字 = ERROR */
function ruleDataTypeViolation(
  rows: Record<string, string | null>[],
  anchorColumn: string,
  columns: string[] = TYPE_CHECK_COLUMNS
): HealthIssue | null {
  const affectedCells: AffectedCell[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? {};
    for (const col of columns) {
      if (!(col in row)) continue;
      const val = row[col];
      if (val == null) continue;
      const s = String(val).trim();
      if (s === '') continue;

      if (!canParseAsNumber(val)) {
        affectedCells.push({
          rowIndex: i,
          colKey: col,
          rawValue: val,
        });
      }
    }
  }

  if (affectedCells.length === 0) return null;

  const affectedRows = [...new Set(affectedCells.map((c) => c.rowIndex))].map((ri) => ({
    rowIndex: ri,
    productName: String(rows[ri]?.[anchorColumn] ?? `行${ri + 1}`),
  }));

  return {
    type: 'DATA_TYPE_VIOLATION',
    severity: 'blocker',
    message: `发现 ${affectedCells.length} 处数据乱码（如 待定、aaa、不确定 等无法转换为数字）`,
    affectedRows,
    affectedCells,
    fixSuggestion: '可将乱码置为 0 或空值',
  };
}

/** 维度 B：空值警报 - 关键列为空 = WARNING */
function ruleEmptyValue(
  rows: Record<string, string | null>[],
  anchorColumn: string,
  columns: string[] = EMPTY_CHECK_COLUMNS
): HealthIssue | null {
  const affectedCells: AffectedCell[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? {};
    for (const col of columns) {
      if (!(col in row)) continue;
      const val = row[col];
      const s = String(val ?? '').trim();
      if (s !== '') continue;

      affectedCells.push({ rowIndex: i, colKey: col, rawValue: val });
    }
  }

  if (affectedCells.length === 0) return null;

  const affectedRows = [...new Set(affectedCells.map((c) => c.rowIndex))].map((ri) => ({
    rowIndex: ri,
    productName: String(rows[ri]?.[anchorColumn] ?? `行${ri + 1}`),
  }));

  return {
    type: 'EMPTY_VALUE',
    severity: 'blocker',
    message: `发现 ${affectedCells.length} 处数据缺失（价格或库存为空）`,
    affectedRows,
    affectedCells,
    fixSuggestion: '请补全或确认是否 intentionally 留空',
  };
}

/** 维度 C：锚点匹配度 - 无精确匹配但有相似项 = IDENTITY_GAP；审计阶段阈值 0.6，宁可错报不可漏报 */
function ruleIdentityGap(
  baseRows: Record<string, string | null>[],
  newRows: Record<string, string | null>[],
  anchorColumn: string,
  similarityThreshold = 0.6
): HealthIssue | null {
  const baseProducts = baseRows.map((r) => String(r[anchorColumn] ?? '').trim()).filter(Boolean);
  const baseSet = new Set(baseProducts);

  const identityPairs: IdentityPair[] = [];
  const affectedRows: Array<{ rowIndex: number; productName?: string }> = [];

  newRows.forEach((row, i) => {
    const pn = String(row[anchorColumn] ?? '').trim();
    if (!pn) return;
    if (baseSet.has(pn)) return; // 精确匹配，跳过

    let bestBase = '';
    let bestScore = 0;
    let bestOverlap = 0;
    for (const bp of baseProducts) {
      const { score, overlapScore } = similarity(pn, bp);
      const effectiveScore = Math.max(score, overlapScore >= 0.6 ? overlapScore : 0);
      if (effectiveScore >= similarityThreshold && effectiveScore > bestScore) {
        bestScore = effectiveScore;
        bestOverlap = overlapScore;
        bestBase = bp;
      }
    }
    if (bestBase) {
      identityPairs.push({
        newName: pn,
        baseName: bestBase,
        overlapScore: Math.round(bestOverlap * 100) / 100,
        overlapEvidence: buildOverlapEvidence(pn, bestBase),
      });
      affectedRows.push({ rowIndex: i, productName: pn });
    }
  });

  if (identityPairs.length === 0) return null;

  return {
    type: 'IDENTITY_GAP',
    severity: 'blocker',
    message: `发现 ${identityPairs.length} 处名称微差（如 VR头盔 vs VR虚拟现实头盔、充电宝电源 vs 充电宝移动电源）`,
    affectedRows,
    identityPairs,
    fixSuggestion: '请确认是否同一商品，或统一命名',
  };
}

export interface UnifiedHealthCheckInput {
  baseRows: Record<string, string | null>[];
  newMappedRows: Record<string, string | null>[];
  anchorColumn?: string;
  typeCheckColumns?: string[];
  emptyCheckColumns?: string[];
  identitySimilarityThreshold?: number;
}

/** 审计错误总数，> 0 时严禁进入 PREVIEW */
export function getAuditErrorCount(report: HealthReport): number {
  const a = report.dirtyErrors?.affectedCells?.length ?? 0;
  const b = report.identityGaps?.affectedRows?.length ?? 0;
  const c = report.emptyWarnings?.affectedCells?.length ?? 0;
  return a + b + c;
}

/**
 * 硬核验证函数 strictAudit
 * 合表前全量扫描，必须拦截：乱码、空值、名称疑似错误
 * 审计阶段阈值 0.6，宁可错报不可漏报（VR头盔↔VR虚拟现实头盔、充电宝电源↔充电宝移动电源）
 */
export function strictAudit(input: UnifiedHealthCheckInput): HealthReport {
  return runUnifiedHealthCheck({
    ...input,
    identitySimilarityThreshold: 0.6,
  });
}

/**
 * 统一健康检查入口 - 三维体检
 * MAPPING 确认后强制调用，阻塞式拦截
 */
export function runUnifiedHealthCheck(input: UnifiedHealthCheckInput): HealthReport {
  const {
    baseRows,
    newMappedRows,
    anchorColumn = '商品名称',
    typeCheckColumns = TYPE_CHECK_COLUMNS,
    emptyCheckColumns = EMPTY_CHECK_COLUMNS,
    identitySimilarityThreshold,
  } = input;
  const simThreshold = identitySimilarityThreshold ?? 0.6;

  const allCols = Object.keys(newMappedRows[0] ?? {});
  const typeCols = typeCheckColumns.filter((c) => allCols.includes(c));
  const emptyCols = emptyCheckColumns.filter((c) => allCols.includes(c));

  const dirtyCells: Array<{ rowIndex: number; colKey: string }> = [];
  const identityGapCells: Array<{ rowIndex: number; colKey: string }> = [];
  const emptyCells: Array<{ rowIndex: number; colKey: string }> = [];

  /** 维度 A */
  const ruleA = ruleDataTypeViolation(newMappedRows, anchorColumn, typeCols);
  if (ruleA?.affectedCells) {
    ruleA.affectedCells.forEach((c) => dirtyCells.push({ rowIndex: c.rowIndex, colKey: c.colKey }));
  }

  /** 维度 B */
  const ruleB = ruleEmptyValue(newMappedRows, anchorColumn, emptyCols);
  if (ruleB?.affectedCells) {
    ruleB.affectedCells.forEach((c) => emptyCells.push({ rowIndex: c.rowIndex, colKey: c.colKey }));
  }

  /** 维度 C */
  const ruleC = ruleIdentityGap(baseRows, newMappedRows, anchorColumn, simThreshold);
  if (ruleC?.affectedRows) {
    ruleC.affectedRows.forEach((r) => identityGapCells.push({ rowIndex: r.rowIndex, colKey: anchorColumn }));
  }

  return {
    dirtyErrors: ruleA,
    identityGaps: ruleC,
    emptyWarnings: ruleB,
    dirtyCells,
    identityGapCells,
    emptyCells,
  };
}

/** 是否有阻塞项（ERROR 或 IDENTITY_GAP） */
export function hasBlockingIssues(report: HealthReport): boolean {
  return !!(report.dirtyErrors || report.identityGaps);
}

/**
 * 一键修复：将脏数据置为指定值
 */
export function applyDirtyDataFix(
  rows: Record<string, string | null>[],
  dirtyCells: Array<{ rowIndex: number; colKey: string }>,
  replaceWith: '' | '0' = '0'
): Record<string, string | null>[] {
  const set = new Set(dirtyCells.map((c) => `${c.rowIndex}-${c.colKey}`));
  return rows.map((row, ri) => {
    const out = { ...row };
    for (const col of Object.keys(out)) {
      if (set.has(`${ri}-${col}`)) {
        out[col] = replaceWith === '0' ? '0' : null;
      }
    }
    return out;
  });
}

/** 单格修正：修改指定单元格 */
export function applyCellFix(
  rows: Record<string, string | null>[],
  rowIndex: number,
  colKey: string,
  newValue: string
): Record<string, string | null>[] {
  return rows.map((row, ri) => {
    if (ri !== rowIndex) return row;
    return { ...row, [colKey]: newValue };
  });
}

/** 名称对齐：将某行的锚点列改为底表名称 */
export function applyNameFix(
  rows: Record<string, string | null>[],
  rowIndex: number,
  anchorColumn: string,
  newName: string
): Record<string, string | null>[] {
  return rows.map((row, ri) => {
    if (ri !== rowIndex) return row;
    return { ...row, [anchorColumn]: newName };
  });
}

/** 将映射后的行转回新表格式 */
export function unmapRowsToNewFormat(
  mappedRows: Record<string, string | null>[],
  mapping: Record<string, string>,
  newColumnMarker: string
): Record<string, string | null>[] {
  return mappedRows.map((row) => {
    const out: Record<string, string | null> = {};
    for (const [newCol, baseCol] of Object.entries(mapping)) {
      const key = baseCol === newColumnMarker ? newCol : baseCol;
      out[newCol] = row[key] ?? null;
    }
    return out;
  });
}

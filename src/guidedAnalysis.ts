/**
 * AI 引导：分析多表并给出合并/清洗建议
 */

import type { TableData, TableRow } from './types';
import { getCellValue } from './types';
import type { QualityReport, CleanSuggestion } from './guidedTypes';
import { mergeTables } from './types';

/** 列名规范化：去掉括号及括号内内容，用于检测相似列 */
function columnBaseName(name: string): string {
  return name.replace(/[（(].*?[）)]\s*$/, '').trim() || name;
}

/** 两列名是否相似（同基名或一方包含另一方） */
function columnsSimilar(a: string, b: string): boolean {
  const baseA = columnBaseName(a);
  const baseB = columnBaseName(b);
  if (baseA === baseB) return true;
  if (baseA.length >= 2 && baseB.includes(baseA)) return true;
  if (baseB.length >= 2 && baseA.includes(baseB)) return true;
  return false;
}

/** 分析多表列结构，建议合并方式，并返回合并前警告（如相似列） */
export function analyzeForMerge(tables: { name: string; data: TableData }[]): {
  suggested: 'union' | 'left_join' | 'inner_join';
  reason: string;
  sameColumns?: boolean;
  commonColumns?: string[];
  firstColumns?: string[];
  /** 合并前警告：如「右表列 X 与左表列 Y 含义可能相同，合并后将保留两列」 */
  mergeWarnings?: string[];
} {
  if (tables.length === 0) return { suggested: 'union', reason: '暂无表格' };
  if (tables.length === 1) return { suggested: 'union', reason: '仅一张表，无需合并' };

  const first = tables[0].data.columns;
  const rest = tables.slice(1).map((t) => t.data.columns);
  const allSame = rest.every((cols) => cols.length === first.length && cols.every((c, i) => c === first[i]));
  const common = first.filter((c) => rest.every((cols) => cols.includes(c)));

  const mergeWarnings: string[] = [];
  for (let t = 0; t < rest.length; t++) {
    const rightCols = rest[t];
    for (const rc of rightCols) {
      if (first.includes(rc)) continue;
      const similar = first.find((lc) => columnsSimilar(lc, rc));
      if (similar) {
        mergeWarnings.push(`表间存在相似列：左表「${similar}」与右表「${rc}」含义可能相同，纵向合并后将保留两列，合并建议在「数据质量」中删除重复列或合并为一列。`);
      }
    }
  }

  const base = {
    suggested: 'union' as const,
    reason: '',
    firstColumns: first,
    ...(mergeWarnings.length > 0 ? { mergeWarnings } : {}),
  };

  if (allSame) {
    return { ...base, suggested: 'union', reason: '所有表列名完全一致，建议纵向合并(Union)。', sameColumns: true };
  }
  if (common.length > 0) {
    return {
      ...base,
      suggested: 'inner_join',
      reason: `表间存在共同列 [${common.join(', ')}]，可按其中一列做连接合并；若只需追加行且列顺序一致，也可选纵向合并。`,
      commonColumns: common,
    };
  }
  return {
    ...base,
    reason: '表间列名不一致，建议先统一列名或选择纵向合并后手动处理。',
  };
}

/** 分析单表数据质量 */
export function analyzeQuality(data: TableData): QualityReport {
  const nullCounts: { column: string; count: number }[] = data.columns.map((col) => ({
    column: col,
    count: data.rows.filter((row) => {
      const v = getCellValue(row[col]);
      return v == null || String(v).trim() === '';
    }).length,
  })).filter((x) => x.count > 0);

  const seen = new Set<string>();
  let duplicateCount = 0;
  for (const row of data.rows) {
    const k = data.columns.map((c) => String(getCellValue(row[c]) ?? '')).join('\0');
    if (seen.has(k)) duplicateCount++;
    else seen.add(k);
  }

  const trimNeededColumns = data.columns.filter((col) =>
    data.rows.some((row) => {
      const v = row[col];
      return typeof v === 'string' && (v !== v.trim() || /\s{2,}/.test(v));
    })
  );

  const emptyRowCount = data.rows.filter((row) =>
    data.columns.every((c) => {
      const v = getCellValue(row[c]);
      return v == null || String(v).trim() === '';
    })
  ).length;

  // 列内类型不一致：同一列既有数字又有非数字文本
  const typeInconsistentColumns: { column: string; types: string[] }[] = [];
  for (const col of data.columns) {
    const types = new Set<string>();
    for (const row of data.rows) {
      const v = getCellValue(row[col]);
      if (v == null || String(v).trim() === '') continue;
      if (typeof v === 'number' && !Number.isNaN(v)) types.add('number');
      else types.add('string');
    }
    if (types.size > 1) typeInconsistentColumns.push({ column: col, types: [...types].sort() });
  }

  // 重复/相似含义的列：同基名（去掉括号后缀）或名称高度相似
  const byBase = new Map<string, string[]>();
  for (const col of data.columns) {
    const base = columnBaseName(col);
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base)!.push(col);
  }
  const redundantColumnGroups = [...byBase.values()].filter((g) => g.length > 1);

  return {
    nullCounts,
    duplicateCount,
    trimNeededColumns,
    emptyRowCount,
    typeInconsistentColumns,
    redundantColumnGroups,
  };
}

/** 将质量报告格式化为「合并后所有错误」清单，便于在界面明确展示 */
export function formatQualityReportSummary(report: QualityReport): string[] {
  const lines: string[] = [];
  const typeLabel = (t: string) => (t === 'number' ? '数字' : t === 'string' ? '文本' : t);

  if (report.typeInconsistentColumns?.length) {
    for (const { column, types } of report.typeInconsistentColumns) {
      lines.push(`类型不一致：列「${column}」存在 ${types.map(typeLabel).join('、')} 混用，需统一为同一类型。`);
    }
  }
  if (report.redundantColumnGroups?.length) {
    for (const group of report.redundantColumnGroups) {
      const newName = columnBaseName(group[0]) || group[0];
      lines.push(`相似列需合并：「${group.join('」「')}」建议合并为一列「${newName}」（取先有值）。`);
    }
  }
  if (report.nullCounts.length > 0) {
    for (const { column, count } of report.nullCounts) {
      lines.push(`空值：列「${column}」存在 ${count} 处空值，建议填充。`);
    }
  }
  if (report.duplicateCount > 0) {
    lines.push(`重复行：存在 ${report.duplicateCount} 行重复，建议去重。`);
  }
  if (report.trimNeededColumns.length > 0) {
    lines.push(`首尾/连续空格：列 [${report.trimNeededColumns.join('、')}] 需去除空格。`);
  }
  if (report.emptyRowCount > 0) {
    lines.push(`空行：存在 ${report.emptyRowCount} 行整行为空，建议删除。`);
  }
  return lines;
}

/** 根据质量报告生成清洗建议步骤 */
export function suggestCleanSteps(report: QualityReport, columns: string[]): CleanSuggestion[] {
  const steps: CleanSuggestion[] = [];
  let id = 0;

  // 类型不一致：建议统一为文本（最安全），界面明确展示「数字」「文本」
  const typeLabel = (t: string) => (t === 'number' ? '数字' : t === 'string' ? '文本' : t);
  if (report.typeInconsistentColumns?.length) {
    for (const { column, types } of report.typeInconsistentColumns) {
      steps.push({
        id: `type-${id++}`,
        type: 'normalize_type',
        description: `列「${column}」存在类型不一致（${types.map(typeLabel).join('、')}混用），建议统一为文本`,
        params: { column, targetType: 'string' as const },
      });
    }
  }

  // 重复/相似列：合并为一列（取先有值），不再删列
  if (report.redundantColumnGroups?.length) {
    for (const group of report.redundantColumnGroups) {
      const newColumnName = columnBaseName(group[0]) || group[0];
      steps.push({
        id: `merge-${id++}`,
        type: 'merge_redundant_columns',
        description: `相似列「${group.join('」「')}」合并为一列「${newColumnName}」（取先有值）`,
        params: { columns: group, newColumnName },
      });
    }
  }

  if (report.nullCounts.length > 0) {
    for (const { column, count } of report.nullCounts) {
      steps.push({
        id: `fn-${id++}`,
        type: 'fill_null',
        description: `列「${column}」存在 ${count} 处空值，建议填充`,
        params: { column },
      });
    }
  }
  if (report.duplicateCount > 0) {
    steps.push({
      id: `rd-${id++}`,
      type: 'remove_duplicates',
      description: `存在 ${report.duplicateCount} 行重复，建议去重`,
      params: { columns },
    });
  }
  if (report.trimNeededColumns.length > 0) {
    steps.push({
      id: `trim-${id++}`,
      type: 'trim',
      description: `列 [${report.trimNeededColumns.join(', ')}] 含首尾空格或连续空格，建议去除`,
      params: { columns: report.trimNeededColumns },
    });
  }
  if (report.emptyRowCount > 0) {
    steps.push({
      id: `empty-${id++}`,
      type: 'drop_empty_rows',
      description: `存在 ${report.emptyRowCount} 行全空，建议删除`,
    });
  }
  return steps;
}

/** 执行纵向合并（多表 Union） */
export function doUnion(tables: TableData[]): TableData {
  if (tables.length === 0) return { columns: [], rows: [] };
  if (tables.length === 1) return tables[0];
  let acc = tables[0];
  for (let i = 1; i < tables.length; i++) {
    acc = mergeTables(acc, 'union', tables[i], {});
  }
  return acc;
}

/**
 * 动态聚合引擎：基于用户选择的维度/指标与聚合方式（均值/求和/占比）实时计算统计数据。
 * 透明化反馈：返回公式说明，供侧边栏展示。
 */

export type AggregationType = 'mean' | 'sum' | 'ratio';

export interface GroupStat {
  /** 维度取值（如班级名） */
  dimValue: string;
  /** 指标值（聚合结果） */
  value: number;
  /** 该组行数（用于占比分母说明） */
  count?: number;
}

export interface AggregationResult {
  groups: GroupStat[];
  formulaHint: string;
  /** 当前使用的聚合类型 */
  aggType: AggregationType;
}

function toNum(v: string | null | undefined): number | null {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim().replace(/%$/, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * 按维度分组并聚合指标列。
 * - mean: 平均值，自动过滤空值
 * - sum: 求和
 * - ratio: 各组占全部的占比（各组 sum / 总 sum）
 */
export function computeGroupByStats(
  rows: Record<string, string | null>[],
  dimensionCol: string,
  metricCol: string,
  aggType: AggregationType
): AggregationResult {
  const groups = new Map<string, number[]>();

  for (const row of rows) {
    const dimVal = row[dimensionCol] != null ? String(row[dimensionCol]).trim() : '';
    const num = toNum(row[metricCol]);
    if (aggType === 'mean' || aggType === 'sum') {
      if (num !== null) {
        const arr = groups.get(dimVal) ?? [];
        arr.push(num);
        groups.set(dimVal, arr);
      }
    } else {
      const arr = groups.get(dimVal) ?? [];
      arr.push(num ?? 0);
      groups.set(dimVal, arr);
    }
  }

  const result: GroupStat[] = [];
  let formulaHint = '';

  if (aggType === 'mean') {
    formulaHint = `我正在按照（${metricCol} 非空值的和 / 非空个数）计算平均值，并自动过滤了空值。`;
    for (const [dimVal, vals] of groups) {
      if (vals.length === 0) continue;
      const sum = vals.reduce((a, b) => a + b, 0);
      result.push({ dimValue: dimVal || '(空)', value: sum / vals.length, count: vals.length });
    }
  } else if (aggType === 'sum') {
    formulaHint = `我正在按照各「${dimensionCol}」分组，对「${metricCol}」求和，并自动过滤了空值。`;
    for (const [dimVal, vals] of groups) {
      if (vals.length === 0) continue;
      const sum = vals.reduce((a, b) => a + b, 0);
      result.push({ dimValue: dimVal || '(空)', value: sum, count: vals.length });
    }
  } else {
    const allVals = rows.map((r) => toNum(r[metricCol]) ?? 0);
    const total = allVals.reduce((a, b) => a + b, 0);
    formulaHint = `我正在按照（各组「${metricCol}」之和 / 全部之和）计算占比，并自动将空值视为 0。`;
    for (const [dimVal, vals] of groups) {
      const sum = vals.reduce((a, b) => a + b, 0);
      const pct = total > 0 ? (sum / total) * 100 : 0;
      result.push({ dimValue: dimVal || '(空)', value: Math.round(pct * 100) / 100, count: vals.length });
    }
  }

  result.sort((a, b) => (a.dimValue < b.dimValue ? -1 : 1));

  return {
    groups: result,
    formulaHint,
    aggType,
  };
}

/**
 * 单维度 + 多指标：按同一维度分组，对多个指标分别聚合，合并为一张表。
 * 返回每行 = { dimValue, values: { [metricCol]: number } }，便于多指标看板与图表。
 */
export interface GroupStatMultiMetric {
  dimValue: string;
  values: Record<string, number>;
  count?: number;
}

export interface AggregationResultMultiMetric {
  groups: GroupStatMultiMetric[];
  formulaHint: string;
  aggType: AggregationType;
  metricCols: string[];
}

export function computeGroupByStatsMultiMetric(
  rows: Record<string, string | null>[],
  dimensionCol: string,
  metricCols: string[],
  aggType: AggregationType
): AggregationResultMultiMetric {
  if (metricCols.length === 0) {
    return { groups: [], formulaHint: '', aggType, metricCols: [] };
  }
  const results = metricCols.map((m) => computeGroupByStats(rows, dimensionCol, m, aggType));
  const dimSet = new Set<string>();
  results.forEach((r) => r.groups.forEach((g) => dimSet.add(g.dimValue)));
  const dimOrder = [...dimSet].sort((a, b) => (a < b ? -1 : 1));
  const groups: GroupStatMultiMetric[] = dimOrder.map((dimValue) => {
    const values: Record<string, number> = {};
    let count: number | undefined;
    metricCols.forEach((col, i) => {
      const g = results[i].groups.find((x) => x.dimValue === dimValue);
      values[col] = g?.value ?? 0;
      if (g?.count != null) count = g.count;
    });
    return { dimValue: dimValue || '(空)', values, count };
  });
  const formulaHint =
    metricCols.length === 1
      ? results[0].formulaHint
      : `按「${dimensionCol}」分组，对 ${metricCols.length} 个指标（${metricCols.join('、')}）分别做${aggType === 'mean' ? '平均值' : aggType === 'sum' ? '求和' : '占比'}。`;
  return { groups, formulaHint, aggType, metricCols };
}

/**
 * 根据聚合结果生成一句简短发现，供 AI 确认图表用。
 * 例如：初步发现 2 班的平均分领先
 */
export function getPreliminaryFinding(
  result: AggregationResult,
  dimensionCol: string,
  metricCol: string,
  aggType: AggregationType
): string {
  if (result.groups.length === 0) return `按「${dimensionCol}」分组后暂无有效数据。`;
  const sorted = [...result.groups].sort((a, b) => b.value - a.value);
  const top = sorted[0];
  const unit = aggType === 'ratio' ? '%' : '';
  return `初步发现「${top.dimValue}」的${metricCol}${aggType === 'mean' ? '平均值' : aggType === 'sum' ? '合计' : '占比'}最高（${top.value}${unit}），需要我为您生成一张「${dimensionCol}对比${aggType === 'mean' ? '平均' : aggType === 'sum' ? '合计' : '占比'}」图来直观展示吗？`;
}

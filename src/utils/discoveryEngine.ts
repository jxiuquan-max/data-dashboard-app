/**
 * 发现引擎：扫描 fixerRows，识别数值列（指标）与分类列（维度），
 * 按方差与数据完整度对维度-指标配对打分，返回前 8 个最有意义的组合。
 */

import type { AggregationType } from './analysisEngine';
import { computeGroupByStats } from './analysisEngine';

export type ColumnKind = 'numerical' | 'categorical';

const NUMERIC_THRESHOLD = 0.6;
const MAX_TOP_PAIRS = 8;

function toNum(v: string | null | undefined): number | null {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim().replace(/%$/, '').replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * 推断列类型：数值列（指标）与分类列（维度）。
 * - numerical：非空值中可解析为数字的比例 >= NUMERIC_THRESHOLD
 * - categorical：唯一值占比不太高（适合做分组）或多数为非数字
 */
export function inferColumnTypes(
  rows: Record<string, string | null>[],
  columns: string[]
): { numerical: string[]; categorical: string[] } {
  const numerical: string[] = [];
  const categorical: string[] = [];
  const n = rows.length || 1;

  for (const col of columns) {
    const values = rows.map((r) => r[col]);
    const nonNull = values.filter((v) => v != null && String(v).trim() !== '');
    const numericCount = nonNull.filter((v) => toNum(v) !== null).length;
    const numericRatio = nonNull.length > 0 ? numericCount / nonNull.length : 0;

    if (numericRatio >= NUMERIC_THRESHOLD && nonNull.length >= 2) {
      numerical.push(col);
    } else {
      categorical.push(col);
    }
  }

  return { numerical, categorical };
}

export interface DiscoveredPair {
  dimension: string;
  metric: string;
  score: number;
  completeness: number;
  varianceScore: number;
  aggType: AggregationType;
  /** 预计算聚合结果，供卡片预览与最终看板使用 */
  groups: { dimValue: string; value: number }[];
  /** 一句话 AI 解读 */
  insight: string;
}

/**
 * 计算分组均值的方差（无量纲）：组均值序列的变异系数或标准化方差，用于衡量“有区分度”。
 */
function groupMeanVarianceScore(
  rows: Record<string, string | null>[],
  dimensionCol: string,
  metricCol: string,
  aggType: AggregationType
): number {
  const result = computeGroupByStats(rows, dimensionCol, metricCol, aggType);
  if (result.groups.length < 2) return 0;
  const vals = result.groups.map((g) => g.value);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  const std = Math.sqrt(variance);
  if (mean === 0) return std;
  return std / Math.abs(mean);
}

/**
 * 数据完整度：同时具备维度与指标非空的行数占比。
 */
function completeness(
  rows: Record<string, string | null>[],
  dimensionCol: string,
  metricCol: string
): number {
  if (rows.length === 0) return 0;
  const valid = rows.filter((r) => {
    const d = r[dimensionCol];
    const m = r[metricCol];
    const dimOk = d != null && String(d).trim() !== '';
    const numOk = toNum(m) !== null;
    return dimOk && numOk;
  }).length;
  return valid / rows.length;
}

function buildInsight(
  dimension: string,
  metric: string,
  groups: { dimValue: string; value: number }[],
  aggType: AggregationType
): string {
  if (groups.length === 0) return `「${dimension}」与「${metric}」暂无有效数据。`;
  const sorted = [...groups].sort((a, b) => b.value - a.value);
  const top = sorted[0];
  const unit = aggType === 'ratio' ? '%' : '';
  const aggLabel = aggType === 'mean' ? '平均值' : aggType === 'sum' ? '合计' : '占比';
  return `「${top.dimValue}」的${metric}${aggLabel}最高（${Number(top.value).toFixed(2)}${unit}），共 ${groups.length} 个分组。`;
}

/**
 * 扫描所有维度-指标配对，按“方差（区分度）”和“数据完整度”综合打分，返回前 8 个推荐组合。
 */
export function discoverTopPairs(
  rows: Record<string, string | null>[],
  columns: string[],
  aggType: AggregationType = 'mean',
  topN: number = MAX_TOP_PAIRS
): DiscoveredPair[] {
  const { numerical, categorical } = inferColumnTypes(rows, columns);
  if (categorical.length === 0 || numerical.length === 0) return [];

  const pairs: { dimension: string; metric: string; completeness: number; varianceScore: number; result: ReturnType<typeof computeGroupByStats> }[] = [];

  for (const dim of categorical) {
    for (const met of numerical) {
      const comp = completeness(rows, dim, met);
      if (comp < 0.05) continue;
      const result = computeGroupByStats(rows, dim, met, aggType);
      if (result.groups.length < 2) continue;
      const varScore = groupMeanVarianceScore(rows, dim, met, aggType);
      pairs.push({ dimension: dim, metric: met, completeness: comp, varianceScore: varScore, result });
    }
  }

  const maxVar = Math.max(...pairs.map((p) => p.varianceScore), 1e-6);
  const scored: DiscoveredPair[] = pairs.map((p) => {
    const normalizedVar = p.varianceScore / maxVar;
    const score = p.completeness * (0.5 + 0.5 * normalizedVar);
    return {
      dimension: p.dimension,
      metric: p.metric,
      score,
      completeness: p.completeness,
      varianceScore: p.varianceScore,
      aggType,
      groups: p.result.groups,
      insight: buildInsight(p.dimension, p.metric, p.result.groups, aggType),
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

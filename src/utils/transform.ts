/**
 * 数据适配器：处理 DataFixer 导出的行数据，供图表使用
 * - 逻辑 A：按班级统计平均分（柱状图）
 * - 逻辑 B：按分数段统计人数与占比（饼图）
 */

export type RowRecord = Record<string, string | null>;

/** 柱状图：班级 -> 平均分 */
export interface ClassAverageItem {
  name: string;
  average: number;
  count: number;
}

/** 饼图：分数段 -> 人数与占比 */
export interface ScoreSegmentItem {
  name: string;
  value: number;
  ratio: number;
}

export interface AggregateResult {
  classAverages: ClassAverageItem[];
  scoreSegments: ScoreSegmentItem[];
}

const SEGMENT_LABELS = {
  low: '<60',
  mid: '60-80',
  high: '80-100',
} as const;

function parseScore(v: string | null | undefined): number | null {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * 从 DataFixer 导出的行数据中聚合：
 * A. 各班级平均分（仅统计可解析为数字的分数）
 * B. 分数段 <60 / 60-80 / 80-100 的人数与占比
 * @param rows DataFixer 的 rows
 * @param classCol 班级列名，默认 "班级"
 * @param scoreCol 分数列名，默认 "分数"
 */
export function aggregateData(
  rows: RowRecord[],
  classCol: string = '班级',
  scoreCol: string = '分数'
): AggregateResult {
  const byClass = new Map<string, number[]>();
  const segments = { low: 0, mid: 0, high: 0 };

  for (const row of rows) {
    const score = parseScore(row[scoreCol]);
    if (score == null) continue;

    const cls = String(row[classCol] ?? '').trim() || '未分类';
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls)!.push(score);

    if (score < 60) segments.low += 1;
    else if (score <= 80) segments.mid += 1;
    else if (score <= 100) segments.high += 1;
  }

  const classAverages: ClassAverageItem[] = Array.from(byClass.entries())
    .map(([name, values]) => {
      const sum = values.reduce((a, b) => a + b, 0);
      const average = values.length ? sum / values.length : 0;
      return { name, average: Math.round(average * 100) / 100, count: values.length };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const total = segments.low + segments.mid + segments.high;
  const scoreSegments: ScoreSegmentItem[] = [
    { name: SEGMENT_LABELS.low, value: segments.low, ratio: total ? segments.low / total : 0 },
    { name: SEGMENT_LABELS.mid, value: segments.mid, ratio: total ? segments.mid / total : 0 },
    { name: SEGMENT_LABELS.high, value: segments.high, ratio: total ? segments.high / total : 0 },
  ].filter((s) => s.value > 0);

  return { classAverages, scoreSegments };
}

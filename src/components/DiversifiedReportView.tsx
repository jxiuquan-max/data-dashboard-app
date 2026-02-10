/**
 * 数据看板：现代、专业、高设计感
 * - 顶部主标题
 * - 左侧 40%：2x2 KPI（极简卡片）
 * - 右侧 60%：面积趋势图（渐变填充、仅水平网格线、数据点标注）
 * - 底部：全宽蓝色页脚
 */

import { useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Pill, Heart, Package, Activity } from 'lucide-react';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
  Line,
  LabelList,
} from 'recharts';
import { KPICard } from './KPICard';

export interface KPICardItem {
  icon: React.ReactNode;
  value: string;
  label: string;
}

export interface TrendDataPoint {
  year: string;
  value: number;
  label?: string;
}

export interface TrendSeriesItem {
  name: string;
  data: TrendDataPoint[];
}

export interface DiversifiedReportViewProps {
  mainTitle?: string;
  leftSectionTitle?: string;
  kpiCards?: KPICardItem[];
  rightSectionTitle?: string;
  trendData?: TrendDataPoint[];
  trendSeries?: TrendSeriesItem[];
  trendLegend?: string;
  trendValueSuffix?: string;
  dataSource?: string;
}

const DEFAULT_MAIN_TITLE = '居民主动健康管理意识显著强化，大家更愿意为健康付费';
const DEFAULT_LEFT_TITLE = '预防性消费品类增长亮眼';
const DEFAULT_RIGHT_TITLE = '医疗保健消费支出占人均总支出比例趋势';
const DEFAULT_TREND_LEGEND = '医疗保健支出占人均总支出比例';
const DEFAULT_DATA_SOURCE = '数据来源：国家统计局、国家卫生健康委员会、国家财务总局。';

const DEFAULT_KPI_CARDS: KPICardItem[] = [
  { icon: <Pill className="h-10 w-10" />, value: '30.1%', label: '老人营养保健' },
  { icon: <Heart className="h-10 w-10" />, value: '105%', label: '心电/血氧仪' },
  { icon: <Package className="h-10 w-10" />, value: '3.3倍', label: '智能药物收纳盒' },
  { icon: <Activity className="h-10 w-10" />, value: '7.5%', label: '健康监测设备' },
];

const DEFAULT_TREND_DATA: TrendDataPoint[] = [
  { year: '2018', value: 8.5 },
  { year: '2019', value: 8.8 },
  { year: '2020', value: 8.7 },
  { year: '2021', value: 8.8 },
  { year: '2022', value: 8.6 },
  { year: '2023', value: 9.2 },
  { year: '2024', value: 9.0 },
  { year: '2025E', value: 9.2 },
];

const ROYAL_BLUE = '#3B82F6';

export function DiversifiedReportView({
  mainTitle = DEFAULT_MAIN_TITLE,
  leftSectionTitle = DEFAULT_LEFT_TITLE,
  kpiCards = DEFAULT_KPI_CARDS,
  rightSectionTitle = DEFAULT_RIGHT_TITLE,
  trendData = DEFAULT_TREND_DATA,
  trendSeries,
  trendLegend = DEFAULT_TREND_LEGEND,
  trendValueSuffix = '%',
  dataSource = DEFAULT_DATA_SOURCE,
}: DiversifiedReportViewProps) {
  const isMultiSeries = trendSeries != null && trendSeries.length > 0;
  const effectiveTrendData = useMemo(
    () =>
      isMultiSeries && trendSeries
        ? (() => {
            const yearSet = new Set<string>();
            trendSeries.forEach((s) => s.data.forEach((d) => yearSet.add(d.year)));
            const years = [...yearSet].sort();
            return years.map((year) => {
              const point: Record<string, string | number> = { year };
              trendSeries.forEach((s) => {
                const d = s.data.find((p) => p.year === year);
                point[s.name] = d?.value ?? 0;
              });
              return point;
            });
          })()
        : trendData.map((d) => ({ ...d })),
    [isMultiSeries, trendSeries, trendData]
  );

  const chartData = useMemo(
    () =>
      Array.isArray(effectiveTrendData) && effectiveTrendData.length > 0 ? effectiveTrendData : [],
    [effectiveTrendData]
  );

  const formatTick = useCallback(
    (v: number) => (trendValueSuffix ? `${v}${trendValueSuffix}` : String(v)),
    [trendValueSuffix]
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="bg-white"
    >
      <header className="border-b border-gray-100 px-6 pt-8 pb-6">
        <h1 className="text-left text-3xl font-bold text-gray-900">{mainTitle}</h1>
      </header>

      <div className="grid grid-cols-1 gap-12 px-6 py-8 lg:grid-cols-12 lg:gap-16">
        <section className="lg:col-span-5">
          <h2 className="mb-6 text-left text-xl font-bold text-gray-900">{leftSectionTitle}</h2>
          <div className="grid grid-cols-2 gap-x-6">
            <div className="col-span-2 grid grid-cols-2 gap-x-6">
              <KPICard icon={kpiCards[0]?.icon} value={kpiCards[0]?.value ?? '—'} label={kpiCards[0]?.label ?? ''} variant="cyan" />
              <KPICard icon={kpiCards[1]?.icon} value={kpiCards[1]?.value ?? '—'} label={kpiCards[1]?.label ?? ''} variant="royalBlue" />
            </div>
            <div className="col-span-2 border-b border-gray-200" />
            <div className="col-span-2 grid grid-cols-2 gap-x-6">
              <KPICard icon={kpiCards[2]?.icon} value={kpiCards[2]?.value ?? '—'} label={kpiCards[2]?.label ?? ''} variant="cyan" />
              <KPICard icon={kpiCards[3]?.icon} value={kpiCards[3]?.value ?? '—'} label={kpiCards[3]?.label ?? ''} variant="royalBlue" />
            </div>
          </div>
        </section>

        <section className="lg:col-span-7">
          <h2 className="mb-2 text-left text-xl font-bold text-gray-900">{rightSectionTitle}</h2>
          <div className="mb-2 flex items-center gap-2">
            <span className="h-0.5 w-8 bg-blue-600" aria-hidden />
            <span className="text-sm text-gray-500">— {trendLegend}</span>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="diversifiedAreaGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ROYAL_BLUE} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={ROYAL_BLUE} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" stroke="#e5e7eb" horizontal={false} vertical />
                <XAxis dataKey="year" tick={{ fontSize: 12, fill: '#374151' }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 12, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={formatTick}
                  domain={trendValueSuffix === '%' ? ['dataMin - 0.5', 'dataMax + 0.5'] : undefined}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }}
                  labelStyle={{ color: '#111827' }}
                  formatter={
                    isMultiSeries && trendSeries
                      ? (value: number, name: string) => [formatTick(value), name]
                      : (value: number) => [formatTick(value), trendLegend]
                  }
                />
                {!isMultiSeries && chartData.length > 0 && (
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={ROYAL_BLUE}
                    strokeWidth={3}
                    fill="url(#diversifiedAreaGradient)"
                    dot={{ r: 4, fill: '#fff', stroke: ROYAL_BLUE, strokeWidth: 2 }}
                    activeDot={{ r: 5, fill: '#fff', stroke: ROYAL_BLUE, strokeWidth: 2 }}
                  >
                    <LabelList
                      dataKey="value"
                      position="top"
                      formatter={(v: number) => (trendValueSuffix ? `${v}${trendValueSuffix}` : String(v))}
                      style={{ fill: '#111827', fontSize: 12, fontWeight: 700 }}
                    />
                  </Area>
                )}
                {isMultiSeries &&
                  trendSeries?.map((s) => (
                    <Line
                      key={s.name}
                      type="monotone"
                      dataKey={s.name}
                      name={s.name}
                      stroke={ROYAL_BLUE}
                      strokeWidth={2}
                      dot={{ fill: ROYAL_BLUE, r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                  ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <footer className="flex h-12 items-center justify-center bg-blue-600 px-6 text-sm font-medium text-white">
        {dataSource}
      </footer>
    </motion.div>
  );
}

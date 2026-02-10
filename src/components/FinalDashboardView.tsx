/**
 * 最终看板视图：专业数据可视化报告风格（像素级还原参考图）
 * - 纯白画布、无卡片包裹
 * - 顶部主标题 H1 左对齐 | 左右分栏 (35–40% / 60–65%) | 底部深蓝通栏 h-12
 * - 左侧：二级标题 + 2x2 KPI（左列青蓝、右列深蓝）+ 行间分隔线
 * - 右侧：面积图深蓝渐变→透明、粗线、白点蓝边、垂直虚线网格、数据标签加粗
 */

import { useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Pill, Heart, Package, Activity, BarChart3 } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { KPICard } from './KPICard';
import { DiversifiedReportView } from './DiversifiedReportView';
import type { DiscoveredPair } from '../utils/discoveryEngine';

export interface DashboardModule {
  pair: DiscoveredPair;
  title?: string;
}

export interface FinalDashboardViewProps {
  modules: DashboardModule[];
  dataSource?: string;
  mainTitle?: string;
  leftSectionTitle?: string;
  rightSectionTitle?: string;
}

const KPI_ICONS = [Pill, Heart, Package, Activity];
const ROYAL_BLUE = '#3B82F6';
const CHART_GRADIENT_ID = 'finalReportAreaGradient';

function formatKpiValue(groups: { dimValue: string; value: number }[]): string {
  if (!groups.length) return '—';
  const sum = groups.reduce((a, g) => a + g.value, 0);
  const avg = sum / groups.length;
  if (groups.length === 1) return String(groups[0].value.toFixed(1));
  if (avg < 100 && avg > 0 && !Number.isInteger(avg)) return `${avg.toFixed(1)}%`;
  if (sum >= 1000) return `${(sum / 1000).toFixed(1)}k`;
  return sum.toFixed(1);
}

export function FinalDashboardView({
  modules,
  dataSource = '数据来源：当前工作台已合并并标准化数据。',
  mainTitle = '我的数据看板',
  leftSectionTitle = '核心指标概览',
  rightSectionTitle: rightSectionTitleProp,
}: FinalDashboardViewProps) {
  const { kpiCards, trendData, rightSectionTitle, trendLegend } = useMemo(() => {
    const kpiCards = modules.slice(0, 4).map((mod, i) => {
      const Icon = KPI_ICONS[i] ?? BarChart3;
      return {
        icon: <Icon className="h-10 w-10" />,
        value: formatKpiValue(mod.pair.groups),
        label: mod.pair.metric || mod.pair.dimension || `指标 ${i + 1}`,
      };
    });
    const trendModule = modules.length >= 5 ? modules[4] : modules[0];
    const trendData =
      trendModule?.pair.groups?.length
        ? trendModule.pair.groups.map((g) => ({ year: String(g.dimValue), value: g.value }))
        : [];
    const rightTitle = trendModule
      ? `${trendModule.pair.dimension} · ${trendModule.pair.metric} 趋势`
      : '趋势分析';
    const legend = trendModule ? trendModule.pair.metric : '';
    return {
      kpiCards,
      trendData,
      rightSectionTitle: rightTitle,
      trendLegend: legend,
    };
  }, [modules]);

  const finalRightTitle = rightSectionTitleProp ?? rightSectionTitle;
  const formatTick = useCallback((v: number) => String(v), []);

  if (modules.length === 0) {
    return (
      <DiversifiedReportView
        mainTitle={mainTitle}
        leftSectionTitle={leftSectionTitle}
        rightSectionTitle="趋势分析"
        dataSource={dataSource}
      />
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="bg-white"
    >
      {/* 主标题：贯穿全宽、左对齐 */}
      <header className="border-b border-gray-100 px-6 pt-8 pb-6">
        <h1 className="text-left text-3xl font-bold text-gray-900">
          {mainTitle}
        </h1>
      </header>

      {/* 左右分栏：宽敞留白 */}
      <div className="grid grid-cols-1 gap-12 px-6 py-8 lg:grid-cols-12 lg:gap-16">
        {/* 左栏 KPI 区：约 35–40% */}
        <section className="lg:col-span-5">
          <h2 className="mb-6 text-left text-xl font-bold text-gray-900">
            {leftSectionTitle}
          </h2>
          <div className="grid grid-cols-2 gap-x-6">
            {/* 第一行：KPI 0 (青蓝) | KPI 1 (深蓝) */}
            <div className="col-span-2 grid grid-cols-2 gap-x-6">
              <KPICard
                icon={kpiCards[0]?.icon}
                value={kpiCards[0]?.value ?? '—'}
                label={kpiCards[0]?.label ?? ''}
                variant="cyan"
              />
              <KPICard
                icon={kpiCards[1]?.icon}
                value={kpiCards[1]?.value ?? '—'}
                label={kpiCards[1]?.label ?? ''}
                variant="royalBlue"
              />
            </div>
            {/* 浅灰水平分隔线 */}
            <div className="col-span-2 border-b border-gray-200" />
            {/* 第二行：KPI 2 (青蓝) | KPI 3 (深蓝) */}
            <div className="col-span-2 grid grid-cols-2 gap-x-6">
              <KPICard
                icon={kpiCards[2]?.icon}
                value={kpiCards[2]?.value ?? '—'}
                label={kpiCards[2]?.label ?? ''}
                variant="cyan"
              />
              <KPICard
                icon={kpiCards[3]?.icon}
                value={kpiCards[3]?.value ?? '—'}
                label={kpiCards[3]?.label ?? ''}
                variant="royalBlue"
              />
            </div>
          </div>
        </section>

        {/* 右栏 图表区：约 60–65% */}
        <section className="lg:col-span-7">
          <h2 className="mb-2 text-left text-xl font-bold text-gray-900">
            {finalRightTitle}
          </h2>
          <div className="mb-2 flex items-center gap-2">
            <span className="h-0.5 w-8 bg-blue-600" aria-hidden />
            <span className="text-sm text-gray-500">— {trendLegend}</span>
          </div>
          <div className="h-64 w-full">
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={trendData}
                  margin={{ top: 20, right: 8, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient
                      id={CHART_GRADIENT_ID}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor={ROYAL_BLUE} stopOpacity={0.4} />
                      <stop offset="100%" stopColor={ROYAL_BLUE} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="4 4"
                    stroke="#e5e7eb"
                    horizontal={false}
                    vertical
                  />
                  <XAxis
                    dataKey="year"
                    tick={{ fontSize: 12, fill: '#374151' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: '#9ca3af' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={formatTick}
                    domain={['dataMin - 0.5', 'dataMax + 0.5']}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#fff',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                    labelStyle={{ color: '#111827' }}
                    formatter={(value: number) => [String(value), trendLegend]}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={ROYAL_BLUE}
                    strokeWidth={3}
                    fill={`url(#${CHART_GRADIENT_ID})`}
                    dot={{
                      r: 4,
                      fill: '#fff',
                      stroke: ROYAL_BLUE,
                      strokeWidth: 2,
                    }}
                    activeDot={{
                      r: 5,
                      fill: '#fff',
                      stroke: ROYAL_BLUE,
                      strokeWidth: 2,
                    }}
                  >
                    <LabelList
                      dataKey="value"
                      position="top"
                      style={{
                        fill: '#111827',
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    />
                  </Area>
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center border border-dashed border-gray-200 bg-gray-50/50 text-sm font-bold text-gray-500">
                暂无趋势数据
              </div>
            )}
          </div>
        </section>
      </div>

      {/* 底部通栏：深蓝 h-12 */}
      <footer className="flex h-12 items-center justify-center bg-blue-600 px-6 text-sm font-medium text-white">
        {dataSource}
      </footer>
    </motion.div>
  );
}

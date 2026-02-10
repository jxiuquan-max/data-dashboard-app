/**
 * AI 推荐与看板组装模式
 * - 发现引擎扫描 fixerRows，推荐前 8 个维度-指标组合
 * - AI 发现广场：卡片流展示 8 个推荐，勾选最多 5 个
 * - 组装看板：FinalDashboardView 平铺展示选中的模块
 */

import { useCallback, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, LayoutDashboard, Sparkles } from 'lucide-react';
import { FinalDashboardView } from './FinalDashboardView';
import type { DashboardModule } from './FinalDashboardView';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { discoverTopPairs } from '../utils/discoveryEngine';
import type { DiscoveredPair } from '../utils/discoveryEngine';

export interface AnalysisPlannerProps {
  columns: string[];
  rows: Record<string, string | null>[];
  onBack?: () => void;
}

const MAX_SELECTED = 5;
const COLORS = ['#388bfd', '#22c55e', '#eab308', '#f97316', '#ec4899', '#8b5cf6'];

type ViewMode = 'discovery' | 'dashboard';

function pairKey(p: DiscoveredPair): string {
  return `${p.dimension}\0${p.metric}`;
}

export function AnalysisPlanner({ columns, rows, onBack }: AnalysisPlannerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('discovery');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const discoveredPairs = useMemo(
    () => (columns.length > 0 && rows.length > 0 ? discoverTopPairs(rows, columns, 'mean', 8) : []),
    [columns, rows]
  );

  const toggleSelect = useCallback((p: DiscoveredPair) => {
    const key = pairKey(p);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else if (next.size < MAX_SELECTED) {
        next.add(key);
      }
      return next;
    });
  }, []);

  const selectedModules: DashboardModule[] = useMemo(() => {
    return discoveredPairs
      .filter((p) => selectedKeys.has(pairKey(p)))
      .map((p) => ({ pair: p, title: `${p.dimension} · ${p.metric}` }));
  }, [discoveredPairs, selectedKeys]);

  const canAssemble = selectedModules.length >= 1;

  const goToDashboard = useCallback(() => {
    if (canAssemble) setViewMode('dashboard');
  }, [canAssemble]);

  if (viewMode === 'dashboard') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col gap-4 h-full"
      >
        <div className="flex justify-end gap-2 px-4 py-2 border-b" style={{ borderColor: 'var(--border)' }}>
          <button
            type="button"
            onClick={() => setViewMode('discovery')}
            className="rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            返回发现广场
          </button>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              返回
            </button>
          )}
        </div>
        <div className="flex-1 overflow-auto p-4">
          <FinalDashboardView modules={selectedModules} dataSource="数据来源：当前工作台已合并并标准化数据。" />
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex flex-col gap-4"
    >
      <div
        className="rounded-lg border px-4 py-3 text-sm"
        style={{ borderColor: 'var(--accent)', background: 'var(--accent)/8', color: 'var(--text-primary)' }}
      >
        <p>我已从 {columns.length} 个维度中发现了 8 个有趣的趋势，请挑选最多 5 个您最感兴趣的加入您的看板。</p>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        <div className="flex-1 min-w-0 overflow-auto">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-3" style={{ color: 'var(--text-primary)' }}>
            <Sparkles className="h-4 w-4 text-[var(--accent)]" />
            AI 发现广场
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {discoveredPairs.map((p) => {
              const key = pairKey(p);
              const selected = selectedKeys.has(key);
              const chartData = p.groups.map((g) => ({ name: g.dimValue, value: g.value }));
              return (
                <motion.div
                  key={key}
                  layout
                  className="relative rounded-lg border overflow-hidden cursor-pointer transition-all"
                  style={{
                    borderColor: selected ? 'var(--accent)' : 'var(--border)',
                    background: selected ? 'var(--accent)/8' : 'var(--bg-card)',
                    boxShadow: selected ? '0 0 0 2px var(--accent)' : undefined,
                  }}
                  onClick={() => toggleSelect(p)}
                >
                  <div className="absolute top-2 right-2 z-10">
                    <div
                      className="w-6 h-6 rounded-full border-2 flex items-center justify-center"
                      style={{
                        borderColor: selected ? 'var(--accent)' : 'var(--border)',
                        background: selected ? 'var(--accent)' : 'var(--bg-page)',
                      }}
                    >
                      {selected && <Check className="h-4 w-4 text-white" />}
                    </div>
                  </div>
                  <div className="p-3 pb-2">
                    <h4 className="text-xs font-semibold mb-1 truncate" style={{ color: 'var(--text-primary)' }}>
                      {p.dimension} · {p.metric}
                    </h4>
                    <p className="text-xs leading-relaxed line-clamp-2 mb-2" style={{ color: 'var(--text-muted)' }}>
                      {p.insight}
                    </p>
                    <div className="h-20 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                          <XAxis dataKey="name" hide />
                          <YAxis hide />
                          <Tooltip
                            contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '11px' }}
                            formatter={(value: number) => [Number(value).toFixed(2), p.metric]}
                          />
                          <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                            {chartData.map((_, i) => (
                              <Cell key={i} fill={COLORS[i % COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        <aside className="w-64 shrink-0 flex flex-col gap-4 rounded-lg border overflow-y-auto" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)', padding: '1rem' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            已选 {selectedKeys.size} / {MAX_SELECTED} 个模块
          </p>
          <button
            type="button"
            onClick={goToDashboard}
            disabled={!canAssemble}
            className="rounded-lg border-0 px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'var(--accent)', color: '#fff', boxShadow: 'var(--shadow)' }}
          >
            <LayoutDashboard className="h-4 w-4" />
            组装看板
          </button>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="rounded-lg border px-3 py-2 text-sm mt-auto"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              返回
            </button>
          )}
        </aside>
      </div>
    </motion.div>
  );
}

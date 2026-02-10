/**
 * 策略选择界面：上传后 AI 弹出，用户选择合并方式并确认主键，点击「开始合并」后执行 merge-and-scan
 * - [保持简洁-取交集] / [完整保留-取并集] / [严格对齐-按模板]
 * - 实时预览：选 A 会丢弃哪些列；选 B 会多出哪些列
 * - 主键：展示 AI 推断的主键，可多选/切换
 */

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Layers, CheckCircle, Key } from 'lucide-react';
import type { HeaderAnalyzeResult } from '../types/schemaReport';
import type { MergeStrategy } from '../types/schemaReport';

export interface MergeStrategyConfigProps {
  /** 扩展后的 analyze-headers 返回（含 columns_intersection, columns_union, suggested_primary_key 等） */
  report: HeaderAnalyzeResult;
  onStartMerge: (params: { strategy: MergeStrategy; baseline_columns: string[]; primary_key_columns: string[] }) => void;
  loading?: boolean;
}

const STRATEGY_OPTIONS: { value: MergeStrategy; label: string; short: string }[] = [
  { value: 'intersection', label: '保持简洁 - 取交集', short: '取交集' },
  { value: 'union', label: '完整保留 - 取并集', short: '取并集' },
  { value: 'template', label: '基准左连接 - 按模板', short: '基准左连接' },
];

export function MergeStrategyConfig({ report, onStartMerge, loading = false }: MergeStrategyConfigProps) {
  const [strategy, setStrategy] = useState<MergeStrategy>('template');
  const [selectedKeys, setSelectedKeys] = useState<string[]>(() => report.suggested_primary_key ?? []);

  const base_columns = report.base_columns ?? [];
  const columns_intersection = report.columns_intersection ?? base_columns;
  const columns_union = report.columns_union ?? base_columns;
  const all_candidates = useMemo(() => {
    const set = new Set(columns_union);
    return Array.from(set);
  }, [columns_union]);

  const baseline_columns = useMemo(() => {
    if (strategy === 'intersection') return columns_intersection;
    if (strategy === 'union') return columns_union;
    return base_columns;
  }, [strategy, columns_intersection, columns_union, base_columns]);

  const previewText = useMemo(() => {
    if (strategy === 'intersection') {
      const dropped = columns_union.filter((c) => !columns_intersection.includes(c));
      if (dropped.length === 0) return '所有列均在各文件中存在，不会丢弃列。';
      return `将丢弃 ${dropped.length} 列：${dropped.slice(0, 5).join('、')}${dropped.length > 5 ? ' 等' : ''}`;
    }
    if (strategy === 'union') {
      const extra = columns_union.filter((c) => !base_columns.includes(c));
      if (extra.length === 0) return '与首文件列一致，无额外列。';
      return `将多出 ${extra.length} 列：${extra.slice(0, 5).join('、')}${extra.length > 5 ? ' 等' : ''}`;
    }
    return '以首文件列为基准左连接，缺列补空；非基准表多余列可丢弃或扩展。';
  }, [strategy, columns_union, columns_intersection, base_columns]);

  const toggleKey = (col: string) => {
    setSelectedKeys((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );
  };

  const handleSubmit = () => {
    onStartMerge({
      strategy,
      baseline_columns,
      primary_key_columns: selectedKeys.length > 0 ? selectedKeys : (report.suggested_primary_key ?? []),
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex flex-col gap-4"
    >
      <div
        className="rounded-[var(--radius-lg)] border border-[var(--border)] overflow-hidden"
        style={{ background: 'var(--bg-card)', boxShadow: 'var(--shadow)' }}
      >
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Layers className="h-4 w-4 text-[var(--accent)]" aria-hidden />
            我已经扫描了数据，请选择合并方式：
          </h3>
        </div>
        <div className="p-4 space-y-4">
          {/* 三个单选项 */}
          <div className="space-y-2">
            {STRATEGY_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors"
                style={{
                  borderColor: strategy === opt.value ? 'var(--accent)' : 'var(--border)',
                  background: strategy === opt.value ? 'var(--accent)/10' : 'var(--bg-page)',
                }}
              >
                <input
                  type="radio"
                  name="merge-strategy"
                  value={opt.value}
                  checked={strategy === opt.value}
                  onChange={() => setStrategy(opt.value)}
                  className="sr-only"
                />
                <span className="flex h-5 w-5 items-center justify-center rounded-full border-2" style={{ borderColor: strategy === opt.value ? 'var(--accent)' : 'var(--border)' }}>
                  {strategy === opt.value && <CheckCircle className="h-3.5 w-3.5 text-[var(--accent)]" />}
                </span>
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {opt.label}
                </span>
              </label>
            ))}
          </div>
          {/* 实时预览 */}
          <div className="rounded-lg p-3 text-sm" style={{ background: 'var(--bg-page)', color: 'var(--text-secondary)' }}>
            {previewText}
          </div>

          {/* 主键确认 */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
              <Key className="h-4 w-4 text-[var(--accent)]" aria-hidden />
              主键（用于去重，可多选）
            </h4>
            <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
              AI 建议：{report.suggested_primary_key?.length ? report.suggested_primary_key.join('、') : '未推断'}。点击列名切换是否作为主键。
            </p>
            <div className="flex flex-wrap gap-2">
              {all_candidates.slice(0, 20).map((col) => (
                <button
                  key={col}
                  type="button"
                  onClick={() => toggleKey(col)}
                  className="rounded-full px-3 py-1 text-xs font-medium transition-colors"
                  style={{
                    background: selectedKeys.includes(col) ? 'var(--accent)' : 'var(--bg-page)',
                    color: selectedKeys.includes(col) ? '#fff' : 'var(--text-primary)',
                    border: `1px solid ${selectedKeys.includes(col) ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                >
                  {col}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading}
          className="btn-primary rounded-[var(--radius)] border-0 px-5 py-2.5 text-sm font-medium disabled:opacity-50"
          style={{ background: 'var(--accent)', color: '#fff', boxShadow: 'var(--shadow)' }}
        >
          {loading ? '正在合并…' : '开始合并'}
        </button>
      </div>
    </motion.div>
  );
}

/**
 * 合并决策工作台：全透明、决策驱动的结构确认步骤
 * - 对齐预览表：各文件列的去向（保留/丢弃/补空）
 * - 合并重复行策略：覆盖 / 追加 / 补全
 * - AI 文案：根据同义列等自动生成说明（如「分数」与「成绩」单位是否归一化）
 * - 确认后进入规则确认，不在此步执行合并
 */

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Table2, Key, RefreshCw, MessageSquare } from 'lucide-react';
import type { HeaderAnalyzeResult } from '../types/schemaReport';
import type { MergeStrategy, DuplicateRowStrategy } from '../types/schemaReport';

export interface StructureConfirmParams {
  strategy: MergeStrategy;
  baseline_columns: string[];
  primary_key_columns: string[];
  duplicate_row_strategy: DuplicateRowStrategy;
  /** 按模板时：true=增量列合并(B)，false=严格按模板丢弃(A) */
  template_incremental?: boolean;
}

export interface MergeDecisionCenterProps {
  report: HeaderAnalyzeResult;
  /** 确认结构后进入规则确认，不在此步执行合并 */
  onConfirmStructure: (params: StructureConfirmParams) => void;
  loading?: boolean;
}

const STRATEGY_OPTIONS: { value: MergeStrategy; label: string }[] = [
  { value: 'intersection', label: '取交集（保持简洁）' },
  { value: 'union', label: '取并集（完整保留）' },
  { value: 'template', label: '基准左连接（按模板）' },
];

const DUPLICATE_ROW_OPTIONS: { value: DuplicateRowStrategy; label: string }[] = [
  { value: 'overwrite', label: '覆盖（主键重复时后文件覆盖前文件）' },
  { value: 'append', label: '追加（全部保留，不去重）' },
  { value: 'fill', label: '补全（按主键合并，空位补全）' },
];

/** 根据分析结果生成 AI 引导语（同义列、单位差异等） */
export function buildStructureAICopy(report: HeaderAnalyzeResult): string {
  const groups = report.duplicate_column_groups ?? report.synonym_candidates ?? [];
  const fileNames = report.files?.map((f) => f.file).filter(Boolean) ?? [];
  const tableLabel = fileNames.length >= 2 ? `表 ${fileNames[0]} 和 ${fileNames[1]}` : '多个文件';
  if (groups.length > 0) {
    const first = groups[0];
    const names = first.join('」与「');
    return `我发现 ${tableLabel} 中「${names}」可能表示同一含义，合并时如需统一为一列，请选择「按模板」并保留其一；或先确认列含义后再合并。`;
  }
  const hasDiff = report.files?.some(
    (f) => (f.missing_columns?.length ?? 0) > 0 || (f.extra_columns?.length ?? 0) > 0
  );
  if (hasDiff) {
    return `各文件列存在差异：缺列将在合并时补空，多出列将按所选策略保留或丢弃。请在下表确认每列的走向后点击「确认结构」进入规则确认。`;
  }
  return `表头已对齐，请选择合并模式与主键，并选择重复行处理方式后点击「确认结构」进入规则确认。`;
}

/** 按模板且存在多余列时，生成「发现第二张表有 N 个新字段」的询问文案 */
export function getTemplateExtraCopy(report: HeaderAnalyzeResult): { message: string; totalExtra: number } | null {
  const files = report.files ?? [];
  const extraCounts = files.map((f) => (f.extra_columns ?? []).length);
  const totalExtra = extraCounts.reduce((a, b) => a + b, 0);
  if (totalExtra === 0) return null;
  const secondFile = files[1];
  const n = secondFile ? (secondFile.extra_columns ?? []).length : totalExtra;
  return {
    message: `发现第二张表有 ${n} 个新字段，您是想 A. 严格按模板丢弃它们，还是 B. 作为增量列合并进来？`,
    totalExtra,
  };
}

export function MergeDecisionCenter({ report, onConfirmStructure, loading = false }: MergeDecisionCenterProps) {
  const [strategy, setStrategy] = useState<MergeStrategy>(
    () => (report.suggested_merge_mode === 'union' ? 'union' : 'template') as MergeStrategy
  );
  const [templateIncremental, setTemplateIncremental] = useState<boolean>(false);
  const [duplicateRowStrategy, setDuplicateRowStrategy] = useState<DuplicateRowStrategy>('fill');
  const [selectedKeys, setSelectedKeys] = useState<string[]>(() => report.suggested_primary_key ?? []);

  const templateExtra = useMemo(() => getTemplateExtraCopy(report), [report]);
  const showTemplateChoice = strategy === 'template' && templateExtra != null;

  const base_columns = report.base_columns ?? [];
  const columns_intersection = report.columns_intersection ?? base_columns;
  const columns_union = report.columns_union ?? base_columns;
  const files = report.files ?? [];

  const baseline_columns = useMemo(() => {
    if (strategy === 'intersection') return columns_intersection;
    if (strategy === 'union') return columns_union;
    return base_columns;
  }, [strategy, columns_intersection, columns_union, base_columns]);

  const all_candidates = useMemo(() => {
    const set = new Set(columns_union);
    return Array.from(set);
  }, [columns_union]);

  const aiCopy = useMemo(() => buildStructureAICopy(report), [report]);

  const toggleKey = (col: string) => {
    setSelectedKeys((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );
  };

  const handleConfirm = () => {
    onConfirmStructure({
      strategy,
      baseline_columns: baseline_columns,
      primary_key_columns: selectedKeys.length > 0 ? selectedKeys : (report.suggested_primary_key ?? []),
      duplicate_row_strategy: duplicateRowStrategy,
      template_incremental: strategy === 'template' ? templateIncremental : false,
    });
  };

  const statusLabel = (s: string) => (s === 'keep' ? '保留' : s === 'fill_empty' ? '补空' : '丢弃');

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
            <Table2 className="h-4 w-4 text-[var(--accent)]" aria-hidden />
            合并决策工作台 · 结构确认
          </h3>
        </div>
        <div className="p-4 space-y-4">
          {/* AI 文案 */}
          <div
            className="flex gap-2 rounded-lg p-3 text-sm"
            style={{ background: 'var(--accent)/8', borderLeft: '4px solid var(--accent)', color: 'var(--text-primary)' }}
          >
            <MessageSquare className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            <p>{aiCopy}</p>
          </div>

          {/* 按模板时：发现多余列，主动询问 A/B */}
          {showTemplateChoice && (
            <div
              className="rounded-lg border-2 p-4 space-y-3"
              style={{ borderColor: 'var(--accent)', background: 'var(--accent)/10', color: 'var(--text-primary)' }}
            >
              <p className="text-sm font-medium">{templateExtra!.message}</p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setTemplateIncremental(false)}
                  className="rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
                  style={{
                    borderColor: !templateIncremental ? 'var(--accent)' : 'var(--border)',
                    background: !templateIncremental ? 'var(--accent)/15' : 'var(--bg-page)',
                    color: 'var(--text-primary)',
                  }}
                >
                  A. 严格按模板丢弃
                </button>
                <button
                  type="button"
                  onClick={() => setTemplateIncremental(true)}
                  className="rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
                  style={{
                    borderColor: templateIncremental ? 'var(--accent)' : 'var(--border)',
                    background: templateIncremental ? 'var(--accent)/15' : 'var(--bg-page)',
                    color: 'var(--text-primary)',
                  }}
                >
                  B. 作为增量列合并进来
                </button>
              </div>
            </div>
          )}

          {/* 对齐预览表：各文件列去向 */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
              对齐预览（保留 / 补空 / 丢弃）
            </h4>
            <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr style={{ background: 'var(--bg-page)' }}>
                    <th className="px-3 py-2 font-medium" style={{ color: 'var(--text-muted)' }}>
                      列名
                    </th>
                    {files.map((f) => (
                      <th key={f.file} className="px-3 py-2 font-medium whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                        {f.file}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {baseline_columns.slice(0, 20).map((col) => (
                    <tr key={col} className="border-t border-[var(--border)]">
                      <td className="px-3 py-1.5 font-medium" style={{ color: 'var(--text-primary)' }}>
                        {col}
                      </td>
                      {files.map((f, fidx) => {
                        if (f.error) {
                          return (
                          <td key={f.file} className="px-3 py-1.5">
                            <span className="inline-block rounded px-2 py-0.5 text-xs font-medium" style={{ background: 'var(--text-muted)/15', color: 'var(--text-muted)' }}>丢弃</span>
                          </td>
                          );
                        }
                        const missing = (f.missing_columns ?? []).includes(col);
                        const status = fidx === 0 ? (base_columns.includes(col) ? 'keep' : 'fill_empty') : (missing ? 'fill_empty' : 'keep');
                        return (
                          <td key={f.file} className="px-3 py-1.5">
                            <span
                              className="inline-block rounded px-2 py-0.5 text-xs font-medium"
                              style={{
                                background: status === 'keep' ? 'var(--accent)/15' : status === 'fill_empty' ? 'var(--warning)/15' : 'var(--text-muted)/15',
                                color: status === 'keep' ? 'var(--accent)' : status === 'fill_empty' ? 'var(--warning)' : 'var(--text-muted)',
                              }}
                            >
                              {statusLabel(status)}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {baseline_columns.length > 20 && (
                <p className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                  仅展示前 20 列，共 {baseline_columns.length} 列
                </p>
              )}
            </div>
            {files.some((f) => (f.extra_columns ?? []).length > 0) && (
              <p
                className="mt-2 text-xs font-medium px-2 py-1.5 rounded"
                style={{
                  color: strategy === 'template' ? 'var(--accent)' : 'var(--text-muted)',
                  background: strategy === 'template' ? 'var(--accent)/15' : 'transparent',
                }}
              >
                {strategy === 'template'
                  ? '各文件多余列：待定/增加（请在上方选择 A 或 B）'
                  : '各文件多余列（按当前策略将忽略）'}
                ：{files.map((f) => (f.extra_columns ?? []).length ? `${f.file}：${(f.extra_columns ?? []).join('、')}` : null).filter(Boolean).join('；')}
              </p>
            )}
          </div>

          {/* 合并模式 */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
              <RefreshCw className="h-4 w-4" aria-hidden />
              合并列模式
            </h4>
            <div className="flex flex-wrap gap-2">
              {STRATEGY_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors"
                  style={{
                    borderColor: strategy === opt.value ? 'var(--accent)' : 'var(--border)',
                    background: strategy === opt.value ? 'var(--accent)/10' : 'var(--bg-page)',
                  }}
                >
                  <input
                    type="radio"
                    name="merge-mode"
                    value={opt.value}
                    checked={strategy === opt.value}
                    onChange={() => setStrategy(opt.value as MergeStrategy)}
                    className="sr-only"
                  />
                  <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 合并重复行策略 */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
              合并重复行策略
            </h4>
            <div className="space-y-1">
              {DUPLICATE_ROW_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors"
                  style={{
                    borderColor: duplicateRowStrategy === opt.value ? 'var(--accent)' : 'var(--border)',
                    background: duplicateRowStrategy === opt.value ? 'var(--accent)/10' : 'var(--bg-page)',
                  }}
                >
                  <input
                    type="radio"
                    name="duplicate-row"
                    value={opt.value}
                    checked={duplicateRowStrategy === opt.value}
                    onChange={() => setDuplicateRowStrategy(opt.value as DuplicateRowStrategy)}
                    className="sr-only"
                  />
                  <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 主键 */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
              <Key className="h-4 w-4 text-[var(--accent)]" aria-hidden />
              主键（用于去重与补全，可多选）
            </h4>
            <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
              AI 建议：{report.suggested_primary_key?.length ? report.suggested_primary_key.join('、') : '未推断'}。点击列名切换。
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
          onClick={handleConfirm}
          disabled={loading}
          className="btn-primary rounded-[var(--radius)] border-0 px-5 py-2.5 text-sm font-medium disabled:opacity-50"
          style={{ background: 'var(--accent)', color: '#fff', boxShadow: 'var(--shadow)' }}
        >
          {loading ? '正在进入规则确认…' : '确认结构'}
        </button>
      </div>
    </motion.div>
  );
}

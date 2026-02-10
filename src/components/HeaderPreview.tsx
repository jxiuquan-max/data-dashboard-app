/**
 * 预审工作台：展示 AI 的对齐计划
 * 左侧：标准列名；右侧：各文件对应状态；非基准表有多余列时引导选择「丢弃」或「扩展（基准左连接）」；下方展示合并缩略预览。
 */

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Check, AlertCircle, MinusCircle, Table2 } from 'lucide-react';
import type { HeaderAnalyzeResult, MergePreview } from '../types/schemaReport';
import type { MergeStrategy } from '../types/schemaReport';

export interface AlignParams {
  /** 非基准表多余列：true=扩展合并（基准左连接），false=丢弃 */
  extend_extra?: boolean;
}

export interface HeaderPreviewProps {
  /** /api/analyze-headers 返回的对比结果 */
  report: HeaderAnalyzeResult;
  /** 确认对齐；若存在多余列会传入用户选择的 extend_extra */
  onConfirm: (alignParams?: AlignParams) => void;
  confirmDisabled?: boolean;
  /** 当为「按模板」时，多余列显示「待定/增加」并高亮 */
  mergeStrategy?: MergeStrategy;
}

function fileStatus(
  entry: HeaderAnalyzeResult['files'][0],
  useTemplatePending?: boolean
): { kind: 'ok' | 'missing' | 'extra' | 'mixed'; label: string } {
  if (entry.error) return { kind: 'missing', label: `错误: ${entry.error}` };
  const hasMissing = entry.missing_columns.length > 0;
  const hasExtra = entry.extra_columns.length > 0;
  if (!hasMissing && !hasExtra) return { kind: 'ok', label: '对齐' };
  if (hasMissing && !hasExtra) return { kind: 'missing', label: `缺失 ${entry.missing_columns.length} 列·将补空` };
  if (!hasMissing && hasExtra)
    return {
      kind: 'extra',
      label: useTemplatePending ? `多余 ${entry.extra_columns.length} 列·待定/增加` : `多余 ${entry.extra_columns.length} 列·将忽略`,
    };
  return {
    kind: 'mixed',
    label: useTemplatePending
      ? `缺失 ${entry.missing_columns.length} 列·多余 ${entry.extra_columns.length} 列·待定/增加`
      : `缺失 ${entry.missing_columns.length} 列·多余 ${entry.extra_columns.length} 列`,
  };
}

export function HeaderPreview({ report, onConfirm, confirmDisabled = false, mergeStrategy }: HeaderPreviewProps) {
  const { base_columns, files, preview } = report;
  const useTemplatePending = mergeStrategy === 'template';
  const hasExtra = useMemo(() => files.some((f) => (f.extra_columns?.length ?? 0) > 0), [files]);
  const [extendExtra, setExtendExtra] = useState(false);

  const handleConfirm = () => {
    onConfirm(hasExtra ? { extend_extra: extendExtra } : undefined);
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
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-0 min-h-[200px]">
          {/* 左侧：标准列名 */}
          <div
            className="p-4 border-r border-[var(--border)]"
            style={{ background: 'var(--bg-page)' }}
          >
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
              标准列（基准）
            </h3>
            <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
              共 {base_columns.length} 列
            </p>
            <ul className="space-y-1.5 text-sm" style={{ color: 'var(--text-primary)' }}>
              {base_columns.length === 0 ? (
                <li className="text-[var(--text-muted)]">无（请检查文件编码或重试）</li>
              ) : (
                base_columns.map((col, i) => (
                  <li key={i} className="truncate font-medium">
                    {col}
                  </li>
                ))
              )}
            </ul>
          </div>
          {/* 右侧：各文件状态 */}
          <div className="p-4 overflow-auto">
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
              各文件对齐情况
            </h3>
            <ul className="space-y-3">
              {files.map((entry, i) => {
                const { kind, label } = fileStatus(entry, useTemplatePending);
                const isExtraPending = useTemplatePending && (kind === 'extra' || kind === 'mixed');
                return (
                  <li
                    key={i}
                    className="flex items-center gap-3 text-sm flex-wrap"
                  >
                    <span className="font-medium truncate max-w-[180px]" style={{ color: 'var(--text-primary)' }} title={entry.file}>
                      {entry.file}
                    </span>
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
                      style={{
                        background:
                          kind === 'ok'
                            ? 'var(--accent)/20'
                            : isExtraPending
                              ? 'var(--accent)/20'
                              : kind === 'extra'
                                ? 'hsl(var(--muted))'
                                : 'rgba(234,179,8,0.2)',
                        color:
                          kind === 'ok'
                            ? 'var(--accent)'
                            : isExtraPending
                              ? 'var(--accent)'
                              : kind === 'extra'
                                ? 'var(--text-muted)'
                                : 'hsl(45,93%,47%)',
                      }}
                    >
                      {kind === 'ok' && <Check className="h-3.5 w-3.5" />}
                      {kind === 'missing' && <AlertCircle className="h-3.5 w-3.5" />}
                      {(kind === 'extra' || kind === 'mixed') && <MinusCircle className="h-3.5 w-3.5" />}
                      {label}
                    </span>
                    {entry.missing_columns.length > 0 && (
                      <span className="text-xs text-[var(--text-muted)]">
                        缺失: {entry.missing_columns.slice(0, 3).join('、')}
                        {entry.missing_columns.length > 3 ? ` 等${entry.missing_columns.length}列` : ''}
                      </span>
                    )}
                    {entry.extra_columns.length > 0 && (
                      <span className="text-xs text-[var(--text-muted)]">
                        多余: {entry.extra_columns.slice(0, 3).join('、')}
                        {entry.extra_columns.length > 3 ? ` 等${entry.extra_columns.length}列` : ''}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>

      {/* 非基准表有多余列时：必须在界面引导用户选择「丢弃」或「扩展（基准左连接）」 */}
      {hasExtra && (
        <div
          className="rounded-lg border-2 p-4 space-y-3"
          style={{ borderColor: 'var(--accent)', background: 'var(--accent)/10', color: 'var(--text-primary)' }}
        >
          <p className="text-sm font-medium">非基准表有多余列，请选择合并方式（基准左连接）：</p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setExtendExtra(false)}
              className="rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
              style={{
                borderColor: !extendExtra ? 'var(--accent)' : 'var(--border)',
                background: !extendExtra ? 'var(--accent)/15' : 'var(--bg-page)',
                color: 'var(--text-primary)',
              }}
            >
              丢弃多余列
            </button>
            <button
              type="button"
              onClick={() => setExtendExtra(true)}
              className="rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
              style={{
                borderColor: extendExtra ? 'var(--accent)' : 'var(--border)',
                background: extendExtra ? 'var(--accent)/15' : 'var(--bg-page)',
                color: 'var(--text-primary)',
              }}
            >
              扩展合并（基准左连接）
            </button>
          </div>
        </div>
      )}

      {/* 合并缩略预览：确认对齐前展示 Row 1, Row 2... + New Columns */}
      {preview?.columns?.length > 0 && (
        <div
          className="rounded-[var(--radius-lg)] border overflow-hidden"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-card)', boxShadow: 'var(--shadow)' }}
        >
          <div className="px-4 py-2 border-b flex items-center gap-2" style={{ borderColor: 'var(--border)' }}>
            <Table2 className="h-4 w-4 text-[var(--accent)]" aria-hidden />
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              合并预览（Row 1, Row 2… + 列）
            </span>
          </div>
          <div className="overflow-x-auto max-h-48 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead style={{ background: 'var(--bg-page)' }}>
                <tr>
                  {preview.columns.map((col, i) => (
                    <th key={i} className="px-2 py-1.5 font-medium whitespace-nowrap truncate max-w-[120px]" style={{ color: 'var(--text-muted)' }} title={col}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody style={{ color: 'var(--text-primary)' }}>
                {preview.rows.slice(0, 5).map((row, ri) => (
                  <tr key={ri} className="border-t border-[var(--border)]">
                    {preview.columns.map((col, ci) => (
                      <td key={ci} className="px-2 py-1 whitespace-nowrap truncate max-w-[120px]" title={String(row[col] ?? '')}>
                        {row[col] ?? '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length > 5 && (
            <p className="px-3 py-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              仅展示前 5 行，共 {preview.rows.length} 行
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={confirmDisabled}
          className="btn-primary rounded-[var(--radius)] border-0 px-5 py-2.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: 'var(--accent)', color: '#fff', boxShadow: 'var(--shadow)' }}
        >
          确认对齐
        </button>
      </div>
    </motion.div>
  );
}

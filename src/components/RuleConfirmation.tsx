/**
 * 规则确认看板：在表头确认后、扫描前，透明化展示 AI 诊断方案
 * 空值规则、类型规则、去重规则；仅点击「确认规则并开始扫描」后才触发 merge-and-scan
 */

import { motion } from 'framer-motion';
import { FileCheck, Hash, Link2 } from 'lucide-react';
import type { ScanRules } from '../types/schemaReport';

export interface RuleConfirmationProps {
  /** /api/get-scan-rules 返回的规则 */
  rules: ScanRules;
  onConfirm: () => void;
  confirmDisabled?: boolean;
}

export function RuleConfirmation({ rules, onConfirm, confirmDisabled = false }: RuleConfirmationProps) {
  const { required_columns, numeric_columns, composite_key_columns } = rules;

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
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            AI 诊断方案
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            以下规则将在合并后由 DataHealthScanner 执行，确认后开始扫描。
          </p>
        </div>
        <div className="p-4 space-y-4">
          {/* 空值规则：必填项 */}
          <section>
            <div className="flex items-center gap-2 mb-2" style={{ color: 'var(--text-secondary)' }}>
              <FileCheck className="h-4 w-4 text-[var(--accent)]" aria-hidden />
              <span className="text-xs font-semibold uppercase tracking-wider">空值规则</span>
            </div>
            <p className="text-sm mb-1.5" style={{ color: 'var(--text-primary)' }}>
              以下列将检查空值（结构性缺列补空 / 业务空值）：
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {required_columns.length === 0 ? (
                <li className="text-xs text-[var(--text-muted)]">无</li>
              ) : (
                required_columns.map((col, i) => (
                  <li
                    key={i}
                    className="rounded px-2 py-0.5 text-xs font-medium"
                    style={{ background: 'var(--bg-page)', color: 'var(--text-primary)' }}
                  >
                    {col}
                  </li>
                ))
              )}
            </ul>
          </section>

          {/* 类型规则：数值列 */}
          <section>
            <div className="flex items-center gap-2 mb-2" style={{ color: 'var(--text-secondary)' }}>
              <Hash className="h-4 w-4 text-[var(--accent)]" aria-hidden />
              <span className="text-xs font-semibold uppercase tracking-wider">类型规则</span>
            </div>
            <p className="text-sm mb-1.5" style={{ color: 'var(--text-primary)' }}>
              以下列将按 Numeric 类型检查（非数值且非空记为类型错误）：
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {numeric_columns.length === 0 ? (
                <li className="text-xs text-[var(--text-muted)]">无（当前表头中无默认数值列「分数」）</li>
              ) : (
                numeric_columns.map((col, i) => (
                  <li
                    key={i}
                    className="rounded px-2 py-0.5 text-xs font-medium"
                    style={{ background: 'var(--accent)/15', color: 'var(--accent)' }}
                  >
                    {col}
                  </li>
                ))
              )}
            </ul>
          </section>

          {/* 去重规则：组合主键 */}
          <section>
            <div className="flex items-center gap-2 mb-2" style={{ color: 'var(--text-secondary)' }}>
              <Link2 className="h-4 w-4 text-[var(--accent)]" aria-hidden />
              <span className="text-xs font-semibold uppercase tracking-wider">去重规则</span>
            </div>
            <p className="text-sm mb-1.5" style={{ color: 'var(--text-primary)' }}>
              组合主键（重复则记为重复项）：
            </p>
            {composite_key_columns.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">无（当前表头中无默认主键列「姓名」「班级」）</p>
            ) : (
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {composite_key_columns.join(' + ')}
              </p>
            )}
          </section>
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirmDisabled}
          className="btn-primary rounded-[var(--radius)] border-0 px-5 py-2.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: 'var(--accent)', color: '#fff', boxShadow: 'var(--shadow)' }}
        >
          确认规则并开始扫描
        </button>
      </div>
    </motion.div>
  );
}

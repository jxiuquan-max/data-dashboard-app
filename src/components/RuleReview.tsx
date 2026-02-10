/**
 * 规则确认页 (RuleReview)：在「确认对齐」之后，展示 AI 准备执行的所有专业规则
 * 卡片列表：基础规则 + 专业规则（异常值、日期/邮箱格式等），引导语由 generateAIMessage 生成
 * 可选展示「合并效果小结」：合并后将新增 X 列，保持原有 Y 行不变
 */

import { motion } from 'framer-motion';
import { FileCheck, Hash, Link2, AlertCircle, Calendar, LayoutList } from 'lucide-react';
import type { ProposeRulesResult, ProposedRule } from '../types/schemaReport';

export interface MergeSummary {
  /** 合并后新增列数（接上去的列） */
  newColumns: number;
  /** 保持不变的基准表行数 */
  keptRows: number;
}

export interface RuleReviewProps {
  /** /api/propose-rules 返回：basic + proposed */
  result: ProposeRulesResult;
  onConfirm: () => void;
  confirmDisabled?: boolean;
  /** 合并效果小结（确认对齐后、开始合并前展示） */
  mergeSummary?: MergeSummary | null;
}

function ruleIcon(rule_type: string) {
  if (rule_type === 'outlier') return <AlertCircle className="h-4 w-4 text-amber-500" aria-hidden />;
  if (rule_type === 'pattern') return <Calendar className="h-4 w-4 text-[var(--accent)]" aria-hidden />;
  return <Hash className="h-4 w-4 text-[var(--accent)]" aria-hidden />;
}

export function RuleReview({ result, onConfirm, confirmDisabled = false, mergeSummary }: RuleReviewProps) {
  const { basic, proposed } = result;
  const { required_columns, numeric_columns, composite_key_columns } = basic;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex flex-col gap-4"
    >
      {mergeSummary != null && (
        <div
          className="rounded-[var(--radius-lg)] border border-[var(--border)] overflow-hidden flex items-center gap-3 px-4 py-3"
          style={{ background: 'var(--accent)/10', borderLeft: '4px solid var(--accent)', color: 'var(--text-primary)' }}
        >
          <LayoutList className="h-5 w-5 shrink-0 text-[var(--accent)]" aria-hidden />
          <p className="text-sm font-medium">
            合并效果小结：合并后将新增 <strong>{mergeSummary.newColumns}</strong> 列，保持原有 <strong>{mergeSummary.keptRows}</strong> 行不变（基准左连接，接上去的效果）。
          </p>
        </div>
      )}
      <div
        className="rounded-[var(--radius-lg)] border border-[var(--border)] overflow-hidden"
        style={{ background: 'var(--bg-card)', boxShadow: 'var(--shadow)' }}
      >
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            AI 诊断方案 · 专业规则
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            为保证数据标准，建议增加以下规则；确认后开始合并与健康扫描。
          </p>
        </div>
        <div className="p-4 space-y-4 max-h-[400px] overflow-y-auto">
          {/* 基础规则 */}
          <section>
            <div className="flex items-center gap-2 mb-2" style={{ color: 'var(--text-secondary)' }}>
              <FileCheck className="h-4 w-4 text-[var(--accent)]" aria-hidden />
              <span className="text-xs font-semibold uppercase tracking-wider">空值规则</span>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-1">
              以下 {required_columns.length} 列将检查空值。
            </p>
          </section>
          <section>
            <div className="flex items-center gap-2 mb-2" style={{ color: 'var(--text-secondary)' }}>
              <Hash className="h-4 w-4 text-[var(--accent)]" aria-hidden />
              <span className="text-xs font-semibold uppercase tracking-wider">类型规则</span>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-1">
              {numeric_columns.length ? `「${numeric_columns.join('」「')}」按数值类型检查。` : '无默认数值列。'}
            </p>
          </section>
          <section>
            <div className="flex items-center gap-2 mb-2" style={{ color: 'var(--text-secondary)' }}>
              <Link2 className="h-4 w-4 text-[var(--accent)]" aria-hidden />
              <span className="text-xs font-semibold uppercase tracking-wider">去重规则</span>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-1">
              {composite_key_columns.length ? `组合主键：${composite_key_columns.join(' + ')}` : '无默认主键。'}
            </p>
          </section>

          {/* 专业规则卡片列表 */}
          {proposed.length > 0 && (
            <>
              <div className="text-xs font-semibold uppercase tracking-wider pt-2 border-t border-[var(--border)]" style={{ color: 'var(--text-muted)' }}>
                专业规则（按表头自动推断）
              </div>
              <ul className="space-y-2">
                {proposed.map((rule: ProposedRule, i: number) => (
                  <li
                    key={i}
                    className="flex items-start gap-3 rounded-lg border border-[var(--border)] p-3"
                    style={{ background: 'var(--bg-page)' }}
                  >
                    <span className="shrink-0 mt-0.5">{ruleIcon(rule.rule_type)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {rule.description}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        涉及列：{rule.columns.join('、')} · 处理：{rule.handling}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
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

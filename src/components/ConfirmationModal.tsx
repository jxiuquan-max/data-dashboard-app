/**
 * 分析前确认弹窗：角色确认、算法透明、数据范围，用户点击「确认分析」后才进入报告视图。
 */

import { CheckCircle2, BarChart2, Calculator, Database } from 'lucide-react';

export interface ConfirmationModalProps {
  /** 是否显示弹窗 */
  open: boolean;
  /** 关闭（取消 / 点击遮罩） */
  onClose: () => void;
  /** 用户点击「确认分析」 */
  onConfirm: () => void;
  /** 对比维度列名 */
  dimension: string | null;
  /** 数值指标列名 */
  metric: string | null;
  /** 聚合公式说明（算法透明） */
  formulaText: string;
  /** 当前数据行数（清洗后） */
  rowCount: number;
  /** 是否允许点击「确认分析」（未选维度/指标时为 false） */
  canConfirm?: boolean;
}

export function ConfirmationModal({
  open,
  onClose,
  onConfirm,
  dimension,
  metric,
  formulaText,
  rowCount,
  canConfirm = true,
}: ConfirmationModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirmation-modal-title"
    >
      <div
        className="rounded-xl shadow-xl max-w-md w-full overflow-hidden"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="px-5 py-4 border-b flex items-center gap-2"
          style={{ borderColor: 'var(--border)' }}
        >
          <CheckCircle2 className="h-5 w-5 text-[var(--accent)]" />
          <h2
            id="confirmation-modal-title"
            className="text-base font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            分析前确认
          </h2>
        </header>

        <div className="px-5 py-4 space-y-4">
          {/* 1. 角色确认 */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider flex items-center gap-2 mb-2" style={{ color: 'var(--text-muted)' }}>
              <BarChart2 className="h-4 w-4" />
              角色确认
            </h3>
            <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--border)', background: 'var(--bg-page)' }}>
              <div className="flex justify-between items-center text-sm">
                <span style={{ color: 'var(--text-secondary)' }}>对比维度</span>
                <span className="font-medium" style={{ color: dimension ? 'var(--accent)' : 'var(--text-muted)' }}>
                  {dimension ?? '未选择'}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span style={{ color: 'var(--text-secondary)' }}>数值指标</span>
                <span className="font-medium" style={{ color: metric ? 'hsl(142 76% 36%)' : 'var(--text-muted)' }}>
                  {metric ?? '未选择'}
                </span>
              </div>
            </div>
          </section>

          {/* 2. 算法透明 */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider flex items-center gap-2 mb-2" style={{ color: 'var(--text-muted)' }}>
              <Calculator className="h-4 w-4" />
              算法透明
            </h3>
            <div
              className="rounded-lg border p-3 text-sm font-mono whitespace-pre-wrap"
              style={{ borderColor: 'var(--border)', background: 'var(--bg-page)', color: 'var(--text-primary)' }}
            >
              {formulaText}
            </div>
          </section>

          {/* 3. 数据范围 */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider flex items-center gap-2 mb-2" style={{ color: 'var(--text-muted)' }}>
              <Database className="h-4 w-4" />
              数据范围
            </h3>
            <div className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--border)', background: 'var(--bg-page)' }}>
              <p style={{ color: 'var(--text-primary)' }}>
                已包含清洗阶段修复后的全部数据，共 <strong>{rowCount}</strong> 行参与本次分析。
              </p>
            </div>
          </section>
        </div>

        <footer className="px-5 py-4 border-t flex justify-end gap-2" style={{ borderColor: 'var(--border)' }}>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium border"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              if (canConfirm) {
                onConfirm();
                onClose();
              }
            }}
            disabled={!canConfirm}
            className="rounded-lg px-4 py-2 text-sm font-medium border-0 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: canConfirm ? 'var(--accent)' : 'var(--text-muted)' }}
          >
            确认分析
          </button>
        </footer>
      </div>
    </div>
  );
}

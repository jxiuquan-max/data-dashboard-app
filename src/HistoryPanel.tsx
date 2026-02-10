import type { CleanStep } from './types';
import './HistoryPanel.css';

interface HistoryPanelProps {
  steps: CleanStep[];
  onStartReplay: () => void;
  onReplayAll: () => void;
  isReplaying: boolean;
  disabled?: boolean;
}

export function HistoryPanel({
  steps,
  onStartReplay,
  onReplayAll,
  isReplaying,
  disabled,
}: HistoryPanelProps) {
  return (
    <div className="history-panel">
      <div className="history-header">
        <h3 className="panel-title">操作历史（{steps.length} 步）</h3>
        <div className="history-actions">
          <button
            type="button"
            onClick={onStartReplay}
            disabled={disabled || steps.length === 0 || isReplaying}
            title="逐步回放：AI 模拟执行每一步"
          >
            逐步回放
          </button>
          <button
            type="button"
            onClick={onReplayAll}
            disabled={disabled || steps.length === 0 || isReplaying}
            title="一次性还原：AI 按历史全部步骤还原数据"
          >
            AI 一键还原
          </button>
        </div>
      </div>
      <ul className="history-list">
        {steps.length === 0 ? (
          <li className="history-empty">暂无操作，请在上方执行清洗操作</li>
        ) : (
          steps.map((step, i) => (
            <li key={step.id} className="history-item">
              <span className="history-index">{i + 1}</span>
              <span className="history-desc">{step.description}</span>
              <span className="history-meta">
                {step.rowCountBefore} → {step.rowCountAfter} 行
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

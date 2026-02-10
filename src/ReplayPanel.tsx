import './ReplayPanel.css';

interface ReplayPanelProps {
  log: string[];
  currentStep: number | null;
  totalSteps: number;
  onNext: () => void;
  isReplaying: boolean;
}

export function ReplayPanel({
  log,
  currentStep,
  totalSteps,
  onNext,
  isReplaying,
}: ReplayPanelProps) {
  if (log.length === 0) return null;

  return (
    <div className="replay-panel">
      <div className="replay-header">
        <span className="replay-badge">AI 还原</span>
        {isReplaying && (
          <span className="replay-progress">
            步骤 {currentStep != null ? currentStep : totalSteps} / {totalSteps}
          </span>
        )}
        {isReplaying && currentStep != null && (
          <button type="button" onClick={onNext} className="replay-next">
            执行下一步
          </button>
        )}
      </div>
      <ul className="replay-log">
        {log.map((line, i) => (
          <li key={i} className={line.startsWith('执行：') ? 'replay-log-step' : 'replay-log-msg'}>
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

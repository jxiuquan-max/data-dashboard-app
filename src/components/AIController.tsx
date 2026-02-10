/**
 * AIController：浮动 AI 引导面板
 * 根据 schema_report 与 health_manifest 状态展示三阶段引导文案与操作按钮，
 * 文案由 generateAIMessage(stage, data) 拟人化生成。
 */

import { Bot, ChevronRight, LayoutDashboard } from 'lucide-react';
import type { HealthManifest } from '../DataFixer';
import type { SchemaReport } from '../types/schemaReport';
import { generateAIMessage, type AIMessageStage } from '../utils/generateAIMessage';

export type AIControllerStage = 'merged' | 'fixing' | 'clean';

export interface AIControllerProps {
  /** 合并阶段产生的 schema 报告，null 表示尚未合并或无报告 */
  schemaReport: SchemaReport | null;
  /** 健康扫描结果 */
  healthManifest: HealthManifest | null;
  /** 用户是否已进入「修复模式」（点击过「带我处理」） */
  fixModeActive: boolean;
  /** 未忽略且未修复的错误剩余数（由 DataFixer onProgress 回传） */
  remainingErrorCount?: number;
  /** 当前合并行数（用于 AI 文案） */
  mergedRowCount?: number;
  /** 阶段 1：用户点击「带我处理」 */
  onEnterFixMode?: () => void;
  /** 阶段 3：用户点击「查看看板」 */
  onGoToDashboard?: () => void;
}

function deriveStage(
  schemaReport: SchemaReport | null,
  healthManifest: HealthManifest | null,
  fixModeActive: boolean
): AIControllerStage | null {
  if (!healthManifest) return null;
  const errorCount = healthManifest.errors?.length ?? 0;
  if (errorCount === 0) return 'clean';
  if (fixModeActive) return 'fixing';
  const hasMerged = schemaReport != null || (healthManifest.summary != null && healthManifest.errors?.length != null);
  if (hasMerged && errorCount > 0) return 'merged';
  return null;
}

function stageToMessageStage(stage: AIControllerStage): AIMessageStage {
  if (stage === 'merged') return 'upload';
  if (stage === 'fixing') return 'diagnosis';
  return 'complete';
}

export function AIController({
  schemaReport,
  healthManifest,
  fixModeActive,
  remainingErrorCount = 0,
  mergedRowCount = 0,
  onEnterFixMode,
  onGoToDashboard,
}: AIControllerProps) {
  const stage = deriveStage(schemaReport, healthManifest, fixModeActive);
  if (stage == null) return null;

  const message = generateAIMessage(stageToMessageStage(stage), {
    schema_report: schemaReport ?? undefined,
    health_manifest: healthManifest ?? undefined,
    merged: mergedRowCount > 0 ? { columns: [], rows: Array(mergedRowCount) } : undefined,
    remainingErrorCount,
  });

  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    bottom: '1.5rem',
    right: '1.5rem',
    maxWidth: '320px',
    padding: '1rem 1.25rem',
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
    color: 'var(--text-primary)',
    fontSize: '14px',
    lineHeight: 1.5,
    zIndex: 1000,
  };

  if (stage === 'merged') {
    return (
      <div className="ai-controller ai-controller-merged" style={panelStyle} role="status" aria-live="polite">
        <div className="flex items-start gap-2 mb-3">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ background: 'rgba(var(--accent-rgb, 88, 166, 255), 0.2)', color: 'var(--accent)' }}
          >
            <Bot className="h-4 w-4" aria-hidden />
          </div>
          <p className="mt-0.5 text-[var(--text-primary)]">{message}</p>
        </div>
        {onEnterFixMode && (
          <button
            type="button"
            onClick={onEnterFixMode}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 px-3 text-sm font-medium transition-colors"
            style={{
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
            }}
          >
            带我处理
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
    );
  }

  if (stage === 'fixing') {
    return (
      <div className="ai-controller ai-controller-fixing" style={panelStyle} role="status" aria-live="polite">
        <div className="flex items-start gap-2">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ background: 'rgba(var(--accent-rgb, 88, 166, 255), 0.2)', color: 'var(--accent)' }}
          >
            <Bot className="h-4 w-4" aria-hidden />
          </div>
          <p className="mt-0.5 text-[var(--text-primary)]">{message}</p>
        </div>
      </div>
    );
  }

  // stage === 'clean'
  return (
    <div className="ai-controller ai-controller-clean" style={panelStyle} role="status" aria-live="polite">
      <div className="flex items-start gap-2 mb-3">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'rgba(var(--accent-rgb, 88, 166, 255), 0.2)', color: 'var(--accent)' }}
        >
          <Bot className="h-4 w-4" aria-hidden />
        </div>
        <p className="mt-0.5 text-[var(--text-primary)]">{message}</p>
      </div>
      {onGoToDashboard && (
        <button
          type="button"
          onClick={onGoToDashboard}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 px-3 text-sm font-medium transition-colors"
          style={{
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
          }}
        >
          <LayoutDashboard className="h-4 w-4" aria-hidden />
          查看看板
        </button>
      )}
    </div>
  );
}

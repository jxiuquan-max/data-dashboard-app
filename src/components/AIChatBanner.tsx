/**
 * AI 消息中心化：页面顶部/中心显眼横幅，实时读取 generateAIMessage 输出；
 * fixing 阶段与 DataFixer 的 activeError 绑定，显示当前错误的引导文案；
 * 打字机效果
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Bot, RefreshCw, AlertCircle } from 'lucide-react';
import type { HealthManifest, HealthError } from '../DataFixer';
import { getGuideCopy } from '../DataFixer';
import type { SchemaReport } from '../types/schemaReport';
import { generateAIMessage, type AIMessageStage } from '../utils/generateAIMessage';
import { useTypewriter } from '../hooks/useTypewriter';

export type FlowStep = 'idle' | 'analyzing_headers' | 'structure_confirm' | 'strategy' | 'preview' | 'rules' | 'merging' | 'fixing' | 'done' | 'analysis';

export interface AIChatBannerProps {
  step: FlowStep;
  /** fixing 阶段当前高亮错误，用于绑定引导文案 */
  activeError: HealthError | null;
  schemaReport: SchemaReport | null;
  healthManifest: HealthManifest | null;
  /** 预审阶段：表头对比结果 */
  headerReport?: import('../types/schemaReport').HeaderAnalyzeResult | null;
  /** 规则确认阶段：诊断规则 */
  scanRules?: import('../types/schemaReport').ScanRules | null;
  /** 规则确认阶段：专业规则（propose-rules），用于生成「异常值/日期格式」引导语 */
  proposeResult?: import('../types/schemaReport').ProposeRulesResult | null;
  /** idle 时正在分析表头，展示「正在扫描表头… 正在对比差异…」 */
  isAnalyzingHeaders?: boolean;
  remainingErrorCount: number;
  mergedRowCount: number;
  /** 分析工作台：合并后的列名，用于 AI 文案「X 个维度」 */
  mergedColumns?: string[];
  /** 轮询发现源文档已更新，显示蓝色提示与「同步更新」 */
  sourceUpdated?: boolean;
  /** 用户点击「同步更新」时触发静默 merge-and-scan */
  onSyncUpdate?: () => void;
  /** 同步更新完成后在分析工作台显示一次「数据已刷新」 */
  syncJustDone?: boolean;
  onSyncJustDoneDismiss?: () => void;
  /** 正在执行同步更新（禁用按钮、显示加载） */
  isSyncing?: boolean;
}

function stepToMessageStage(step: FlowStep, isAnalyzingHeaders?: boolean): AIMessageStage {
  if (step === 'idle' && isAnalyzingHeaders) return 'analyzing_headers';
  if (step === 'idle' || step === 'merging') return 'upload';
  if (step === 'structure_confirm' || step === 'strategy') return 'structure_confirm';
  if (step === 'preview') return 'preview';
  if (step === 'rules') return 'rules';
  if (step === 'fixing') return 'diagnosis';
  if (step === 'analysis') return 'analysis_pilot';
  return 'complete';
}

export function AIChatBanner({
  step,
  activeError,
  schemaReport,
  healthManifest,
  headerReport,
  scanRules,
  proposeResult,
  isAnalyzingHeaders,
  remainingErrorCount,
  mergedRowCount,
  mergedColumns,
  sourceUpdated = false,
  onSyncUpdate,
  syncJustDone = false,
  onSyncJustDoneDismiss,
  isSyncing = false,
}: AIChatBannerProps) {
  const messageFromStage = useMemo(
    () =>
      generateAIMessage(stepToMessageStage(step, isAnalyzingHeaders), {
        schema_report: schemaReport ?? undefined,
        health_manifest: healthManifest ?? undefined,
        header_report: headerReport ?? undefined,
        scan_rules: scanRules ?? undefined,
        propose_result: proposeResult ?? undefined,
        merged: mergedRowCount > 0 ? { columns: mergedColumns ?? [], rows: Array(mergedRowCount) } : undefined,
        remainingErrorCount,
      }),
    [step, schemaReport, healthManifest, headerReport, scanRules, proposeResult, isAnalyzingHeaders, mergedRowCount, mergedColumns, remainingErrorCount]
  );

  const displayMessage =
    step === 'fixing' && activeError ? getGuideCopy(activeError) : messageFromStage;
  const showSyncMessage = syncJustDone && step === 'analysis';

  const typewriterKey = `${step}-${activeError?.row_index ?? ''}-${activeError?.col_name ?? ''}-${remainingErrorCount}-${displayMessage.slice(0, 30)}`;
  const displayed = useTypewriter(
    showSyncMessage ? '数据已刷新，已为您更新了分析建议。' : displayMessage,
    true,
    showSyncMessage ? 'sync-just-done' : typewriterKey
  );

  return (
    <motion.div
      className="ai-chat-banner"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        padding: '0.875rem 1.25rem',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)',
        background: 'var(--bg-card)',
        boxShadow: 'var(--shadow-lg)',
        marginBottom: '1rem',
      }}
    >
      {schemaReport?.merge_warning && (
        <div
          className="flex items-start gap-3 rounded-lg px-3 py-2 text-sm"
          style={{
            background: 'rgba(245, 158, 11, 0.12)',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            color: 'var(--text-primary)',
          }}
        >
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-amber-500" aria-hidden />
          <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{schemaReport.merge_warning}</p>
        </div>
      )}
      {sourceUpdated && (
        <div
          className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm"
          style={{
            background: 'rgba(var(--accent-rgb), 0.12)',
            border: '1px solid rgba(var(--accent-rgb), 0.35)',
            color: 'var(--text-primary)',
          }}
        >
          <span className="font-medium">源文档已更新</span>
          <button
            type="button"
            onClick={onSyncUpdate}
            disabled={isSyncing}
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium border-0 text-white disabled:opacity-60"
            style={{ background: 'var(--accent)' }}
          >
            {isSyncing ? (
              <>
                <span className="inline-block h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" aria-hidden />
                同步中…
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" aria-hidden />
                同步更新
              </>
            )}
          </button>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          <Bot className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="text-sm leading-relaxed"
            style={{ color: 'var(--text-primary)' }}
          >
            {displayed}
            {displayed.length < (showSyncMessage ? '数据已刷新，已为您更新了分析建议。' : displayMessage).length && (
              <span
                className="inline-block w-0.5 h-4 ml-0.5 align-middle animate-pulse"
                style={{ background: 'var(--accent)' }}
                aria-hidden
              />
            )}
          </p>
          {showSyncMessage && onSyncJustDoneDismiss && (
            <button
              type="button"
              onClick={onSyncJustDoneDismiss}
              className="mt-2 text-xs underline"
              style={{ color: 'var(--text-muted)' }}
            >
              知道了
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

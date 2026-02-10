/**
 * AICompanion：带头像的聊天气泡 + 打字机效果
 * 数据状态改变时（如错误数减少）文案逐字显示，增强 AI 模拟感
 */

import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Bot, ChevronRight, LayoutDashboard } from 'lucide-react';
import type { HealthManifest } from '../DataFixer';
import type { SchemaReport } from '../types/schemaReport';
import { generateAIMessage, type AIMessageStage } from '../utils/generateAIMessage';
import type { AIControllerStage } from './AIController';

export interface AICompanionProps {
  schemaReport: SchemaReport | null;
  healthManifest: HealthManifest | null;
  fixModeActive: boolean;
  remainingErrorCount?: number;
  mergedRowCount?: number;
  onEnterFixMode?: () => void;
  onGoToDashboard?: () => void;
}

const TYPING_MS = 28;
const deriveStage = (
  schemaReport: SchemaReport | null,
  healthManifest: HealthManifest | null,
  fixModeActive: boolean
): AIControllerStage | null => {
  if (!healthManifest) return null;
  const errorCount = healthManifest.errors?.length ?? 0;
  if (errorCount === 0) return 'clean';
  if (fixModeActive) return 'fixing';
  const hasMerged = schemaReport != null || (healthManifest.summary != null && healthManifest.errors?.length != null);
  if (hasMerged && errorCount > 0) return 'merged';
  return null;
};

function stageToMessageStage(stage: AIControllerStage): AIMessageStage {
  if (stage === 'merged') return 'upload';
  if (stage === 'fixing') return 'diagnosis';
  return 'complete';
}

function useTypewriter(text: string, enabled: boolean, key: string) {
  const [displayedLength, setDisplayedLength] = useState(0);
  const prevKey = useRef(key);

  useEffect(() => {
    if (key !== prevKey.current) {
      prevKey.current = key;
      setDisplayedLength(0);
    }
  }, [key]);

  useEffect(() => {
    if (!enabled || displayedLength >= text.length) return;
    const t = setInterval(() => {
      setDisplayedLength((n) => {
        if (n >= text.length) return n;
        return n + 1;
      });
    }, TYPING_MS);
    return () => clearInterval(t);
  }, [enabled, text.length, displayedLength]);

  useEffect(() => {
    if (text.length < displayedLength) setDisplayedLength(text.length);
  }, [text, displayedLength]);

  return text.slice(0, displayedLength);
}

export function AICompanion({
  schemaReport,
  healthManifest,
  fixModeActive,
  remainingErrorCount = 0,
  mergedRowCount = 0,
  onEnterFixMode,
  onGoToDashboard,
}: AICompanionProps) {
  const stage = deriveStage(schemaReport, healthManifest, fixModeActive);
  const message = stage
    ? generateAIMessage(stageToMessageStage(stage), {
        schema_report: schemaReport ?? undefined,
        health_manifest: healthManifest ?? undefined,
        merged: mergedRowCount > 0 ? { columns: [], rows: Array(mergedRowCount) } : undefined,
        remainingErrorCount,
      })
    : '';
  const typewriterKey = `${stage}-${remainingErrorCount}-${message.slice(0, 20)}`;
  const displayed = useTypewriter(message, !!stage, typewriterKey);

  if (stage == null || !message) return null;

  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    bottom: '1.5rem',
    right: '1.5rem',
    maxWidth: '340px',
    zIndex: 1000,
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-lg)',
    border: '1px solid var(--border)',
    background: 'var(--bg-card)',
    overflow: 'hidden',
  };

  return (
    <motion.div
      className="ai-companion-bubble bubble"
      style={panelStyle}
      role="status"
      aria-live="polite"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex gap-3 p-4">
        {/* 头像 */}
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          <Bot className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
            {displayed}
            {displayed.length < message.length && (
              <span className="inline-block w-0.5 h-4 ml-0.5 align-middle bg-[var(--accent)] animate-pulse" aria-hidden />
            )}
          </p>
          {(stage === 'merged' && onEnterFixMode) && (
            <button
              type="button"
              onClick={onEnterFixMode}
              className="btn-primary mt-3 flex w-full items-center justify-center gap-1.5 rounded-[var(--radius)] py-2 px-3 text-sm font-medium"
              style={{ background: 'var(--accent)', color: '#fff', border: 'none' }}
            >
              带我处理
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          )}
          {(stage === 'clean' && onGoToDashboard) && (
            <button
              type="button"
              onClick={onGoToDashboard}
              className="btn-primary mt-3 flex w-full items-center justify-center gap-1.5 rounded-[var(--radius)] py-2 px-3 text-sm font-medium"
              style={{ background: 'var(--accent)', color: '#fff', border: 'none' }}
            >
              <LayoutDashboard className="h-4 w-4" aria-hidden />
              查看看板
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

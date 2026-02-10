/**
 * AI 引导合并与清洗 - 对话流类型
 */

import type { TableData, MergeType } from './types';

/** 上传项：文件名 + 解析后的表 */
export interface UploadedTable {
  id: string;
  name: string;
  data: TableData;
}

/** 对话消息 */
export interface ChatMessage {
  id: string;
  role: 'ai' | 'user';
  content: string;
  createdAt: number;
  /** 附加数据：如表摘要、检测结果、合并前警告 */
  meta?: {
    tableSummary?: { name: string; rows: number; columns: number; columnNames: string[] }[];
    mergeSuggestion?: { suggested: MergeType; reason: string };
    qualityReport?: QualityReport;
    mergeWarnings?: string[];
  };
}

/** 数据质量检测报告 */
export interface QualityReport {
  nullCounts: { column: string; count: number }[];
  duplicateCount: number;
  trimNeededColumns: string[];
  emptyRowCount: number;
  /** 列内类型不一致（数字与文本混用） */
  typeInconsistentColumns: { column: string; types: string[] }[];
  /** 重复/相似含义的列组（如「教室面积（室内）」与「教室面积（含分摊）」） */
  redundantColumnGroups: string[][];
}

/** 待用户确认的操作 */
export type PendingAction =
  | { type: 'confirm_merge'; message: string; options: { label: string; value: MergeType | 'union' }[]; payload?: { leftKeys?: string[]; rightKeys?: string[] } }
  | { type: 'confirm_clean'; message: string; options: { label: string; value: 'all' | 'step' | 'skip' }[]; steps: CleanSuggestion[]; report: QualityReport }
  | { type: 'single_step'; step: CleanSuggestion; stepIndex: number; totalSteps: number; guidance: string; onExecute: () => void; onSkip: () => void; onExecuteAll: () => void; onSkipAll: () => void }
  | { type: 'fill_null_input'; message: string; column: string; onConfirm: (value: string) => void }
  | { type: 'choose_join_key'; message: string; leftColumns: string[]; rightColumns: string[]; onConfirm: (leftKey: string, rightKey: string) => void }
  | null;

/** 建议的清洗步骤 */
export interface CleanSuggestion {
  id: string;
  type: 'fill_null' | 'remove_duplicates' | 'trim' | 'drop_empty_rows' | 'normalize_type' | 'merge_redundant_columns';
  description: string;
  params?: Record<string, unknown>;
}

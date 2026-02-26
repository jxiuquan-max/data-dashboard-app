/**
 * 任务驱动型 Agent 侧边栏
 * 状态机：IDLE -> INTENT_CONFIRM -> MAPPING_ALIGN -> CONFLICT_RESOLVE -> FINAL_PREVIEW -> IDLE
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Loader2, Calendar, LayoutGrid, AlertTriangle, Eye, GitMerge, Check, X, Sparkles, BookOpen, Trash2, Plus } from 'lucide-react';
import type { HeaderAnalyzeResult } from '../types/schemaReport';
import type { IntentType, FieldMapping, ConflictItem, DiffMatchStats } from '../types/agentTask';
import type { SavedSkill, HistoryFix } from '../types/skill';
import type { ChangeReport } from '../types/changeTracking';
import { sanitizeValue } from '../utils/diffUtils';
import { strictAudit, runUnifiedHealthCheck, applyDirtyDataFix, applyCellFix, applyNameFix, unmapRowsToNewFormat, getAuditErrorCount, hasBlockingIssues, type HealthReport, type HealthIssue } from '../utils/validateData';
import { FileDropzone } from './FileDropzone';
import { BackendStatus } from './BackendStatus';
import { DEFAULT_BASE_DATA } from '../constants/defaultData';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const isProd = import.meta.env.PROD;
const FINAL_API_URL = isProd ? API_BASE : 'http://127.0.0.1:5001';

const stepTransition = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] },
};

const BASE_COLUMNS = Object.keys(DEFAULT_BASE_DATA[0] ?? {});
const ANCHOR_COLUMN = '商品名称';
const NEW_COLUMN_MARKER = '__new__';

/**
 * 严格基于字段名的对比：仅底表与新表名称完全一致的列才参与对比
 * - 交集字段 = baseColumns ∩ mappedColumns，排除关联键（商品名称）
 * - 若只有商品名称共有，则 0 处冲突
 * - 禁止语义匹配：新表独有的列（如剩余库存数）不与底表任何列对比
 */
function getSharedCompareColumns(baseColumns: string[], mappedCols: string[], anchorCol: string): string[] {
  const shared = baseColumns.filter((c) => mappedCols.includes(c));
  return shared.filter((c) => c !== anchorCol);
}

/** 严格过滤后的冲突数：仅共有列且归一化后不等 */
function computeFilteredConflictCount(report: ChangeReport | null, sharedCompareCols: string[]): number {
  if (!report?.modifiedRows?.length) return 0;
  let count = 0;
  for (const mr of report.modifiedRows) {
    for (const c of mr.changes ?? []) {
      if (!sharedCompareCols.includes(c.col)) continue;
      if (sanitizeValue(c.oldVal) !== sanitizeValue(c.newVal)) count++;
    }
  }
  return count;
}

function injectDiffStatus(
  rows: Record<string, string | null>[],
  report: ChangeReport | null,
  anchorCol: string,
  baseColumns: string[],
  sharedCompareCols: string[]
): Array<Record<string, string | null> & { _diffStatus?: 'added' | 'conflict' | 'unchanged'; _diffChangedCols?: string[] }> {
  if (!report) {
    return rows.map((r) => ({ ...r, _diffStatus: 'unchanged' as const }));
  }
  const addedSet = new Set(report.addedProducts ?? []);
  const modifiedMap = new Map<string, string[]>();
  for (const mr of report.modifiedRows ?? []) {
    /** 仅交集列（排除关联键）+ 归一化后仍不相等 -> 真正的冲突 */
    const conflictCols: string[] = [];
    for (const c of mr.changes ?? []) {
      if (!sharedCompareCols.includes(c.col)) continue; // 非共有列不参与对比
      const oldS = sanitizeValue(c.oldVal);
      const newS = sanitizeValue(c.newVal);
      const isConflict = oldS !== newS;
      if (typeof console !== 'undefined' && console.log) {
        console.log(`[Diff] 商品：${mr.productName}，列：${c.col}，底表值：${oldS || '(空)'}，新表值：${newS || '(空)'} -> 结果：${isConflict ? '冲突' : '一致'}`);
      }
      if (isConflict) conflictCols.push(c.col);
    }
    if (conflictCols.length > 0) {
      modifiedMap.set(mr.productName, conflictCols);
    }
  }
  return rows.map((row) => {
    const pn = String(row[anchorCol] ?? '');
    const rowWithMeta = { ...row } as Record<string, string | null> & { _diffStatus?: 'added' | 'conflict' | 'unchanged'; _diffChangedCols?: string[] };
    if (addedSet.has(pn)) {
      rowWithMeta._diffStatus = 'added';
    } else if (modifiedMap.has(pn)) {
      rowWithMeta._diffStatus = 'conflict';
      rowWithMeta._diffChangedCols = modifiedMap.get(pn) ?? [];
    } else {
      rowWithMeta._diffStatus = 'unchanged';
    }
    return rowWithMeta;
  });
}

export type { AgentTask } from '../types/agentTask';

export interface AgentSidebarProps {
  task: import('../types/agentTask').AgentTask;
  onTaskChange: (t: import('../types/agentTask').AgentTask) => void;
  isAnalyzingHeaders?: boolean;
  headerReport: HeaderAnalyzeResult | null;
  onHeaderResult: (report: HeaderAnalyzeResult, files: File[]) => void;
  onAnalyzingHeaders: () => void;
  onAnalyzeError: () => void;
  baseRows: Record<string, string | null>[];
  newRows: Record<string, string | null>[];
  /** 合并源数据：AUDIT 纠错后使用 cleanedExtraData，否则使用 newRows；合并算法严禁使用原始 CSV */
  mergeSourceRows: Record<string, string | null>[];
  onMergeComplete: (rows: Record<string, string | null>[], meta?: { newColumns?: string[]; conflictCells?: Array<{ rowIndex: number; colKey: string }> }) => void;
  highlightedColumn?: string | null;
  onHighlightColumn?: (col: string | null) => void;
  conflictRowIndex?: number | null;
  onConflictRowIndex?: (idx: number | null) => void;
  /** 维度合入：点击匹配行时同步画布定位 */
  onSyncToProduct?: (productName: string | null, newColumns: string[]) => void;
  /** 技能实验室：已保存技能 */
  savedSkills?: SavedSkill[];
  /** 技能实验室：删除技能 */
  onDeleteSkill?: (skillId: string) => void;
  /** 技能实验室：保存当前操作为技能 */
  onSaveSkill?: (skill: Omit<SavedSkill, 'id'>) => void;
  /** 技能实验室：检测到匹配技能 */
  matchedSkill?: SavedSkill | null;
  /** 技能实验室：应用技能 */
  onApplySkill?: (skill: SavedSkill) => void;
  /** 技能实验室：跳过应用 */
  onSkipSkillApply?: () => void;
  /** 技能实验室：上传后检测到匹配时调用 */
  onSkillMatchDetected?: (skill: SavedSkill | null) => void;
  /** 变更提醒：baseline 快照（由 App 在 MAPPING 确认时捕获） */
  baselineRows?: Record<string, string | null>[];
  /** 变更提醒：MAPPING 确认后、PREVIEW 前捕获 baseline */
  onBaselineCapture?: (rows: Record<string, string | null>[]) => void;
  /** 数据体检：用户点击「我去修改文件」时，清空上传状态以便重新上传 */
  onRequestReUpload?: () => void;
  /** 数据体检：展示异常时，将新表数据与异常单元格传给画布以高亮 */
  onHealthCheckDisplay?: (rows: Record<string, string | null>[] | null, dirtyCells: Array<{ rowIndex: number; colKey: string }>, identityGapCells: Array<{ rowIndex: number; colKey: string }>, emptyCells: Array<{ rowIndex: number; colKey: string }>) => void;
  /** 数据体检：一键修复后更新新表数据（将脏数据置为 0 或空） */
  onHealthCheckFix?: (fixedNewRows: Record<string, string | null>[]) => void;
  /** 技能自我进化：更新已有 Skill */
  onUpdateSkill?: (skill: SavedSkill) => void;
  /** 多表流水线：关联下一张表，将当前合并结果设为新底表 */
  onChainNextTable?: (rows: Record<string, string | null>[], completedStepName?: string) => void;
  /** 多表流水线：阶段进度，用于面包屑 */
  pipelineSteps?: Array<{ name: string; status: 'completed' | 'in_progress' }>;
}

function AgentBubble({ message, loading = false }: { message: string; loading?: boolean }) {
  return (
    <motion.div
      {...stepTransition}
      className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-white">
        <Bot className="h-5 w-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-relaxed text-gray-700">{message}</p>
        {loading && (
          <div className="mt-3 flex items-center gap-2 text-indigo-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            <span className="text-xs">处理中…</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

/** 技能保存提示卡片：任务结项阶段 */
function SkillSavePromptCard({
  onSave,
  onSkip,
  loading,
}: {
  onSave: (name: string) => void;
  onSkip: () => void;
  loading: boolean;
}) {
  const [name, setName] = useState('');
  return (
    <motion.div {...stepTransition} className="flex flex-col gap-4">
      <AgentBubble message="✨ 本次操作表现完美，是否将其记录为新技能？" />
      <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">技能名称</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="如：周度库存同步技能"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onSave(name.trim())}
          disabled={!name.trim() || loading}
          className="flex-1 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? '保存中…' : '保存技能'}
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={loading}
          className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-600 disabled:opacity-50"
        >
          跳过
        </button>
      </div>
    </motion.div>
  );
}

/** 技能应用确认卡片：检测到匹配 */
function SkillApplyConfirmCard({
  skillName,
  onApply,
  onSkip,
  loading,
}: {
  skillName: string;
  onApply: () => void;
  onSkip: () => void;
  loading: boolean;
}) {
  return (
    <motion.div {...stepTransition} className="flex flex-col gap-4">
      <AgentBubble message={`检测到文件结构与 [${skillName}] 高度匹配，是否直接应用该技能？`} />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onApply}
          disabled={loading}
          className="flex-1 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? '应用中…' : '直接应用'}
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={loading}
          className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-600 disabled:opacity-50"
        >
          手动配置
        </button>
      </div>
    </motion.div>
  );
}

/** 意图确认卡片 */
function IntentCard({
  onSelect,
  loading,
}: {
  onSelect: (intent: IntentType) => void;
  loading: boolean;
}) {
  return (
    <motion.div {...stepTransition} className="flex flex-col gap-4">
      <AgentBubble message="对比底表，这批新数据是增加新日期记录，还是增加新信息维度？" />
      <div className="grid grid-cols-1 gap-3">
        <button
          type="button"
          onClick={() => onSelect('append')}
          disabled={loading}
          className="flex items-center gap-3 rounded-xl border-2 border-gray-200 bg-white p-4 text-left transition hover:border-indigo-400 hover:bg-indigo-50/50 disabled:opacity-50"
        >
          <Calendar className="h-8 w-8 text-indigo-500" aria-hidden />
          <div>
            <p className="font-medium text-gray-800">增加新日期记录</p>
            <p className="text-xs text-gray-500">按行追加，主键不重复</p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => onSelect('expand')}
          disabled={loading}
          className="flex items-center gap-3 rounded-xl border-2 border-gray-200 bg-white p-4 text-left transition hover:border-indigo-400 hover:bg-indigo-50/50 disabled:opacity-50"
        >
          <LayoutGrid className="h-8 w-8 text-indigo-500" aria-hidden />
          <div>
            <p className="font-medium text-gray-800">增加新信息维度</p>
            <p className="text-xs text-gray-500">扩展列，左连接合并</p>
          </div>
        </button>
      </div>
    </motion.div>
  );
}

/** 逻辑解释卡片：维度合入时显式合并逻辑 */
function JoinLogicCard({
  anchorColumn,
  newColumnNames,
  onConfirm,
  loading,
}: {
  anchorColumn: string;
  newColumnNames: string[];
  onConfirm: () => void;
  loading: boolean;
}) {
  const displayNames = newColumnNames.length ? newColumnNames.slice(0, 5).join('、') + (newColumnNames.length > 5 ? ' 等' : '') : '新字段';
  return (
    <motion.div {...stepTransition} className="flex flex-col gap-4">
      <AgentBubble message={`我将以 ${anchorColumn} 为锚点，将新表的 [${displayNames}] 横向合入底表。`} />
      <div className="flex items-center justify-center gap-4 rounded-xl border-2 border-indigo-100 bg-indigo-50/50 p-6">
        <div className="flex flex-col items-center gap-1">
          <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm">底表</div>
          <span className="text-xs text-gray-500">左</span>
        </div>
        <GitMerge className="h-10 w-10 text-indigo-500" aria-hidden />
        <div className="flex flex-col items-center gap-1">
          <div className="h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 font-bold text-sm">新表</div>
          <span className="text-xs text-gray-500">右</span>
        </div>
      </div>
      <p className="text-center text-xs text-gray-500">左连接：以底表为主，新表按锚点匹配补充新列</p>
      <button
        type="button"
        onClick={onConfirm}
        disabled={loading}
        className="w-full rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {loading ? '处理中…' : '确认合并逻辑'}
      </button>
    </motion.div>
  );
}

/** 字段映射卡片 */
function MappingCard({
  newColumns,
  mapping,
  onMappingChange,
  onConfirm,
  onHighlightColumn,
  loading,
}: {
  newColumns: string[];
  mapping: Record<string, string>;
  onMappingChange: (newCol: string, baseCol: string) => void;
  onConfirm: () => void;
  onHighlightColumn?: (col: string | null) => void;
  loading: boolean;
}) {
  return (
    <motion.div {...stepTransition} className="flex flex-col gap-4">
      <AgentBubble message="请确认新表字段与底表的对应关系，不确定的请从下拉框选择。" />
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-3 py-2 text-left font-medium text-gray-600">新表字段</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">底表对应</th>
            </tr>
          </thead>
          <tbody>
            {newColumns.map((nc) => (
              <tr
                key={nc}
                className="border-t border-gray-100"
                onMouseEnter={() => onHighlightColumn?.(mapping[nc] || null)}
                onMouseLeave={() => onHighlightColumn?.(null)}
              >
                <td className="px-3 py-2 text-gray-800">{nc}</td>
                <td className="px-3 py-2">
                  <select
                    value={mapping[nc] ?? ''}
                    onChange={(e) => onMappingChange(nc, e.target.value)}
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">-- 不映射 --</option>
                    <option value={NEW_COLUMN_MARKER}>-- 新增列（保持原名）--</option>
                    {BASE_COLUMNS.map((bc) => (
                      <option key={bc} value={bc}>
                        {bc}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={onConfirm}
        disabled={loading}
        className="w-full rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {loading ? '处理中…' : '确认映射'}
      </button>
    </motion.div>
  );
}

/** 判断是否为差异行：新商品 或 任一字段底表与合并后不一致 */
function isDiffRow(row: { before: Record<string, string | null>; after: Record<string, string | null>; baseRowIndex: number }): boolean {
  if (row.baseRowIndex === -1) return true;
  const allKeys = [...new Set([...Object.keys(row.before), ...Object.keys(row.after)])];
  return allKeys.some((k) => String(row.before[k] ?? '') !== String(row.after[k] ?? ''));
}

/** 对比预览窗：匹配统计、抽样对比、新商品开关 */
function DiffPreviewCard({
  stats,
  sampleRows,
  addNewRows,
  onAddNewRowsChange,
  onConfirm,
  onRowClick,
  newColumns,
  loading,
  removeDeletedRows,
  onRemoveDeletedRowsChange,
  diffStatsSummary,
}: {
  stats: DiffMatchStats;
  sampleRows: Array<{ before: Record<string, string | null>; after: Record<string, string | null>; productName: string; baseRowIndex: number; changeType?: 'added' | 'modified' | 'deleted' }>;
  addNewRows: boolean;
  onAddNewRowsChange: (v: boolean) => void;
  onConfirm: () => void;
  onRowClick?: (productName: string, baseRowIndex: number) => void;
  newColumns: string[];
  loading: boolean;
  removeDeletedRows?: boolean;
  onRemoveDeletedRowsChange?: (v: boolean) => void;
  /** 维度增强报告：补充维度数、数据差异数、新列名列表 */
  diffStatsSummary?: { newColumnsCount: number; newColumnNames: string[]; valueConflictCount: number };
}) {
  const [showOnlyDiff, setShowOnlyDiff] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPosRef = useRef({ scrollTop: 0, scrollLeft: 0 });

  const filteredRows = useMemo(() => {
    let rows = sampleRows;
    if (showOnlyDiff) rows = rows.filter(isDiffRow);
    return rows;
  }, [sampleRows, showOnlyDiff]);

  const handleToggleDiff = useCallback((checked: boolean) => {
    if (scrollRef.current) {
      scrollPosRef.current = { scrollTop: scrollRef.current.scrollTop, scrollLeft: scrollRef.current.scrollLeft };
    }
    setShowOnlyDiff(checked);
  }, []);

  useEffect(() => {
    if (scrollRef.current && filteredRows.length > 0 && (scrollPosRef.current.scrollTop > 0 || scrollPosRef.current.scrollLeft > 0)) {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = Math.min(scrollPosRef.current.scrollTop, scrollRef.current.scrollHeight - scrollRef.current.clientHeight);
          scrollRef.current.scrollLeft = Math.min(scrollPosRef.current.scrollLeft, scrollRef.current.scrollWidth - scrollRef.current.clientWidth);
        }
      });
    }
  }, [filteredRows]);

  return (
    <motion.div {...stepTransition} className="flex flex-col gap-4">
      <AgentBubble message="请确认合并预览，点击匹配行可查看画布对应位置。" />
      {diffStatsSummary && (diffStatsSummary.newColumnsCount > 0 || diffStatsSummary.valueConflictCount > 0) && (
        <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-blue-50 p-4 shadow-sm">
          <p className="text-base font-semibold text-indigo-800 mb-3">✨ 合并报告</p>
          <p className="text-sm text-indigo-700">
            检测到 <strong>{diffStatsSummary.valueConflictCount}</strong> 处冲突
            {diffStatsSummary.newColumnsCount > 0 ? (
              <>，成功为您新增了 <strong>[{diffStatsSummary.newColumnNames.join('、')}]</strong> 等 <strong>{diffStatsSummary.newColumnsCount}</strong> 个新维度。</>
            ) : (
              <>。</>
            )}
          </p>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-center">
          <p className="font-semibold text-green-700">匹配成功</p>
          <p className="text-sm text-green-600">{stats.matchedCount} 行</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-center">
          <p className="font-semibold text-amber-700">新商品</p>
          <p className="text-sm text-amber-600">{stats.newOnlyCount} 行，将新增</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-center">
          <p className="font-semibold text-gray-700">底表独有</p>
          <p className="text-sm text-gray-600">{stats.baseOnlyCount} 行，保持原样</p>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-gray-600">合并前后对比（抽样 3 行）</p>
          <label className="flex items-center gap-2 cursor-pointer select-none shrink-0">
            <span className="text-xs text-gray-600">🔍 只看差异行</span>
            <span className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors">
              <input
                type="checkbox"
                checked={showOnlyDiff}
                onChange={(e) => handleToggleDiff(e.target.checked)}
                className="peer sr-only"
              />
              <span className={`block h-5 w-9 rounded-full transition-colors ${showOnlyDiff ? 'bg-indigo-500' : 'bg-gray-200'}`} />
              <span className={`pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${showOnlyDiff ? 'translate-x-4' : 'translate-x-0'}`} />
            </span>
          </label>
        </div>
        <div ref={scrollRef} className="diff-preview-scroll rounded-lg border border-gray-200 min-h-[120px] overflow-x-auto overflow-y-auto max-h-[400px]">
          {filteredRows.length === 0 ? (
            <div className="flex items-center justify-center min-h-[120px] px-4 py-8 text-center">
              <p className="text-sm text-gray-500">✨ 所有数据均已对齐，无冲突或新增项。</p>
            </div>
          ) : (
          <table className="w-full min-w-max text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 sticky top-0 z-10">
                <th className="sticky left-0 z-20 bg-gray-100 px-2 py-2 text-center font-medium text-gray-600 border-b border-r border-gray-200 min-w-[56px] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">
                  状态
                </th>
                <th className="sticky z-20 bg-gray-100 px-3 py-2 text-left font-medium text-gray-600 border-b border-r border-gray-200 min-w-[100px] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]" style={{ left: 56 }}>
                  商品名称
                </th>
                {(() => {
                  const allKeys = [...new Set(filteredRows.flatMap((s) => [...Object.keys(s.before), ...Object.keys(s.after)]))].filter((k) => k !== '商品名称');
                  return allKeys.map((k) => (
                    <th key={k} className="px-3 py-2 text-left font-medium text-gray-600 border-b border-r border-gray-200 whitespace-nowrap">
                      {k}
                    </th>
                  ));
                })()}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((s, i) => {
                const allKeys = [...new Set(filteredRows.flatMap((r) => [...Object.keys(r.before), ...Object.keys(r.after)]))].filter((k) => k !== '商品名称');
                const statusTag = s.changeType === 'added' ? (
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-green-700 text-white whitespace-nowrap">新增</span>
                ) : s.changeType === 'modified' ? (
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-orange-400 text-black whitespace-nowrap">变更</span>
                ) : s.changeType === 'deleted' ? (
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-red-600 text-white whitespace-nowrap">缺失</span>
                ) : (
                  <span className="inline-block px-2 py-0.5 rounded text-xs text-gray-500 bg-gray-100 whitespace-nowrap">—</span>
                );
                return (
                  <React.Fragment key={i}>
                    <tr className="hover:bg-gray-50/50">
                      <td rowSpan={2} className="sticky left-0 z-10 bg-gray-50 px-2 py-2 border-b border-r border-gray-200 align-top text-center" style={{ minWidth: 52 }}>
                        {statusTag}
                      </td>
                      <td
                        rowSpan={2}
                        className="sticky z-10 bg-gray-50 px-3 py-2 border-b border-r border-gray-200 align-top font-medium text-gray-800 cursor-pointer hover:bg-indigo-50/50 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.05)]"
                        style={{ left: '56px' }}
                        onClick={() => onRowClick?.(s.productName, s.baseRowIndex)}
                      >
                        {s.productName}
                      </td>
                      {allKeys.map((k) => (
                        <td key={k} className="px-3 py-2 border-b border-r border-gray-200 whitespace-nowrap h-8 bg-gray-100/90">
                          {s.before[k] ?? '-'}
                        </td>
                      ))}
                    </tr>
                    <tr className="hover:bg-emerald-50/30">
                      {allKeys.map((k) => (
                        <td key={k} className="px-3 py-2 border-b border-r border-gray-200 whitespace-nowrap h-8 bg-emerald-50/90">
                          {s.after[k] ?? '-'}
                        </td>
                      ))}
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          )}
        </div>
      </div>
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
        <p className="text-sm text-gray-700 mb-2">新表中有但底表中没有的商品（如新库存项），是否要在底表中新增行？</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onAddNewRowsChange(true)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${addNewRows ? 'bg-green-500 text-white' : 'bg-white border border-gray-300 text-gray-600'}`}
          >
            <Check className="h-4 w-4" aria-hidden />
            是
          </button>
          <button
            type="button"
            onClick={() => onAddNewRowsChange(false)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${!addNewRows ? 'bg-green-500 text-white' : 'bg-white border border-gray-300 text-gray-600'}`}
          >
            <X className="h-4 w-4" aria-hidden />
            忽略
          </button>
        </div>
      </div>
      {stats.baseOnlyCount > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-800 mb-2">
            底表中有 <strong>{stats.baseOnlyCount}</strong> 个商品在源文件中未出现，是否从底表中移除？
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onRemoveDeletedRowsChange?.(true)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${removeDeletedRows ? 'bg-red-600 text-white' : 'bg-white border border-red-300 text-red-700 hover:bg-red-100'}`}
            >
              是，移除
            </button>
            <button
              type="button"
              onClick={() => onRemoveDeletedRowsChange?.(false)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${!removeDeletedRows ? 'bg-red-600 text-white' : 'bg-white border border-red-300 text-red-700 hover:bg-red-100'}`}
            >
              否，保留
            </button>
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={onConfirm}
        disabled={loading}
        className="w-full rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {loading ? '处理中…' : '确认并继续'}
      </button>
    </motion.div>
  );
}

/** 冲突处理卡片 */
function ConflictCard({
  conflicts,
  onResolve,
  onHighlightRow,
  loading,
}: {
  conflicts: ConflictItem[];
  onResolve: (resolution: 'new' | 'base') => void;
  onHighlightRow?: (idx: number | null) => void;
  loading: boolean;
}) {
  const first = conflicts[0];
  if (!first) return null;
  return (
    <motion.div {...stepTransition} className="flex flex-col gap-4">
      <AgentBubble message="发现主键冲突（如商品名相同但售价不同），请选择保留哪一侧的数据。" />
      <div
        className="rounded-lg border border-amber-200 bg-amber-50/80 p-4"
        onMouseEnter={() => onHighlightRow?.(first.rowIndex)}
        onMouseLeave={() => onHighlightRow?.(null)}
      >
        <div className="mb-2 flex items-center gap-2 text-amber-700">
          <AlertTriangle className="h-5 w-5" aria-hidden />
          <span className="font-medium">冲突列：{first.colKey}</span>
        </div>
        <div className="space-y-1 text-sm">
          <p>
            <span className="text-gray-500">底表值：</span>
            <span className="font-medium">{first.baseValue ?? '(空)'}</span>
          </p>
          <p>
            <span className="text-gray-500">新表值：</span>
            <span className="font-medium">{first.newValue ?? '(空)'}</span>
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onResolve('new')}
          disabled={loading}
          className="flex-1 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          以新表为准
        </button>
        <button
          type="button"
          onClick={() => onResolve('base')}
          disabled={loading}
          className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50"
        >
          保留底表
        </button>
      </div>
    </motion.div>
  );
}

/** 合并后 Skill 沉淀面板：展示变动摘要，支持更新当前 Skill 或另存为新 Skill */
function PostMergeSkillPanel({
  matchedSkill,
  appliedNameMappings,
  appliedHistoryFixes,
  currentMapping,
  onUpdateCurrent,
  onSaveAsNew,
  onSkip,
  updating,
}: {
  matchedSkill: SavedSkill;
  appliedNameMappings: Array<{ oldName: string; newName: string }>;
  appliedHistoryFixes: HistoryFix[];
  currentMapping: Record<string, string>;
  onUpdateCurrent: () => Promise<void>;
  onSaveAsNew: (name: string) => Promise<void>;
  onSkip: () => void;
  updating: boolean;
}) {
  const [saveAsNewMode, setSaveAsNewMode] = useState(false);
  const [newSkillName, setNewSkillName] = useState('');

  const mappingChanges: Array<{ newCol: string; oldBase: string; newBase: string }> = [];
  const origMapping = matchedSkill.mapping ?? {};
  for (const [nc, bc] of Object.entries(currentMapping)) {
    const orig = origMapping[nc];
    if (orig !== bc) mappingChanges.push({ newCol: nc, oldBase: orig ?? '(未映射)', newBase: bc });
  }

  const hasChanges = appliedNameMappings.length > 0 || appliedHistoryFixes.length > 0 || mappingChanges.length > 0;

  return (
    <motion.div {...stepTransition} className="flex flex-col gap-4">
      <p className="text-sm font-semibold text-gray-800">📊 本次合并已成功，是否沉淀为 Skill 经验？</p>
      {hasChanges ? (
        <div className="rounded-xl border border-violet-200 bg-violet-50/80 p-4 space-y-3">
          <p className="text-xs font-medium text-violet-800">变动摘要</p>
          <ul className="space-y-1.5 text-xs text-violet-900">
            {appliedNameMappings.map((m, i) => (
              <li key={`nm-${i}`}>✨ 学习了：将「{m.oldName}」关联至「{m.newName}」</li>
            ))}
            {appliedHistoryFixes.map((h, i) => (
              <li key={`hf-${i}`}>🛠️ 修正了：将商品「{h.productName}」的 {h.colKey}「{h.originalValue || '(空)'}」处理为「{h.correctedValue}」</li>
            ))}
            {mappingChanges.map((c, i) => (
              <li key={`mc-${i}`}>列对齐：将「{c.newCol}」从「{c.oldBase}」修正为「{c.newBase}」</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-gray-600">本次合并未产生新的纠错经验。</p>
      )}
      {saveAsNewMode ? (
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-gray-700">新 Skill 名称</label>
          <input
            type="text"
            value={newSkillName}
            onChange={(e) => setNewSkillName(e.target.value)}
            placeholder="如：周度库存同步技能"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={async () => { await onSaveAsNew(newSkillName.trim()); setSaveAsNewMode(false); }}
              disabled={!newSkillName.trim() || updating}
              className="flex-1 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {updating ? '保存中…' : '保存'}
            </button>
            <button type="button" onClick={() => setSaveAsNewMode(false)} disabled={updating} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600">
              取消
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {hasChanges && (
            <button
              type="button"
              onClick={onUpdateCurrent}
              disabled={updating}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {updating ? '更新中…' : '更新并保存当前 Skill'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setSaveAsNewMode(true)}
            disabled={updating}
            className="rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
          >
            作为新 Skill 另存为
          </button>
          <button type="button" onClick={onSkip} disabled={updating} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 disabled:opacity-50">
            跳过
          </button>
        </div>
      )}
    </motion.div>
  );
}

/** 互动纠错助理：审计报告阶段 */
function AuditReportCard({
  report,
  mappedRows,
  mapping,
  onViewDetail,
  onFixDirty,
  onFixEmpty,
  onApplyNameFix,
  onApplyCellFix,
  onIgnore,
  onConfirmAndContinue,
  showOnCanvas,
  onToggleCanvas,
  loading,
  interruptFromSkill,
}: {
  report: HealthReport;
  mappedRows: Record<string, string | null>[];
  mapping: Record<string, string>;
  onViewDetail: (issue: HealthIssue) => void;
  onFixDirty: () => void;
  onFixEmpty: () => void;
  onApplyNameFix: (rowIndex: number, oldName: string, newName: string) => void;
  onApplyCellFix: (rowIndex: number, colKey: string, newValue: string, originalValue?: string) => void;
  onIgnore: () => void;
  onConfirmAndContinue: () => void;
  showOnCanvas: boolean;
  onToggleCanvas: () => void;
  loading: boolean;
  interruptFromSkill?: boolean;
}) {
  const { dirtyErrors, identityGaps, emptyWarnings, dirtyCells, emptyCells } = report;
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; colKey: string } | null>(null);
  const [editValue, setEditValue] = useState('');

  return (
    <motion.div {...stepTransition} className="flex flex-col gap-4">
      {interruptFromSkill ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-800">⚠️ 检测到 Skill 无法处理的异常数据，请先人工核对。</p>
          <p className="text-xs text-amber-700 mt-1">下方为审计发现的分类报错，修正后可继续合并。</p>
        </div>
      ) : (
        <AgentBubble message="合并前已执行三维体检，您可以在下方直接修正问题，无需回 CSV 修改。" />
      )}
      <div className="space-y-3">
        {dirtyErrors && (
          <div className="rounded-xl border border-red-200 bg-red-50/80 p-4">
            <div className="mb-2 flex items-center gap-2 text-red-800 font-semibold">
              <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
              ❌ 无法计算的乱码 ({dirtyErrors.affectedCells?.length ?? 0} 处)
            </div>
            <p className="text-xs text-red-700/90 mb-2">老板，价格里的「待定」会让利润算不出来，建议填入一个预估价。</p>
            <ul className="max-h-32 overflow-y-auto space-y-2 text-sm text-red-800/90">
              {dirtyErrors.affectedCells?.slice(0, 6).map((c, i) => {
                const pn = String(mappedRows[c.rowIndex]?.['商品名称'] ?? `行${c.rowIndex + 1}`);
                const isEditing = editingCell?.rowIndex === c.rowIndex && editingCell?.colKey === c.colKey;
                return (
                  <li key={i} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span><strong>{pn}</strong> · {c.colKey}：{c.rawValue ?? '空'}</span>
                      <button type="button" onClick={() => onViewDetail(dirtyErrors)} className="text-xs text-indigo-600 underline shrink-0">定位</button>
                    </div>
                    <p className="text-xs text-gray-600">此列应为数字。建议：</p>
                    <div className="flex flex-wrap gap-1">
                      <button type="button" onClick={() => onApplyCellFix(c.rowIndex, c.colKey, '0', String(c.rawValue ?? ''))} className="text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50">设为 0</button>
                      <button type="button" onClick={() => { setEditingCell(isEditing ? null : { rowIndex: c.rowIndex, colKey: c.colKey }); setEditValue(String(c.rawValue ?? '')); }} className="text-xs px-2 py-1 rounded border border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100">手动修改</button>
                    </div>
                    {isEditing && (
                      <div className="flex gap-1 mt-1">
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { onApplyCellFix(c.rowIndex, c.colKey, editValue, String(c.rawValue ?? '')); setEditingCell(null); } }}
                          className="flex-1 text-xs px-2 py-1 border rounded"
                          placeholder="输入数字"
                          autoFocus
                        />
                        <button type="button" onClick={() => { onApplyCellFix(c.rowIndex, c.colKey, editValue, String(c.rawValue ?? '')); setEditingCell(null); }} className="text-xs px-2 py-1 rounded bg-indigo-500 text-white">确定</button>
                      </div>
                    )}
                  </li>
                );
              })}
              {(dirtyErrors.affectedCells?.length ?? 0) > 6 && (
                <li className="text-red-600">… 还有 {(dirtyErrors.affectedCells?.length ?? 0) - 6} 处</li>
              )}
            </ul>
            {dirtyCells.length > 0 && (
              <button type="button" onClick={onFixDirty} className="text-xs text-indigo-600 underline mt-1">一键全部设为 0</button>
            )}
          </div>
        )}
        {identityGaps && identityGaps.identityPairs && identityGaps.identityPairs.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4">
            <div className="mb-2 flex items-center gap-2 text-amber-800 font-semibold">
              <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
              ❓ 疑似名称错位 ({identityGaps.identityPairs.length} 处)
            </div>
            <p className="text-xs text-amber-700/90 mb-2">这两个商品名字太像了，建议统一以底表为准，方便后续分析。</p>
            <ul className="max-h-40 overflow-y-auto space-y-2 text-sm text-amber-800/90">
              {identityGaps.identityPairs.slice(0, 6).map((p, i) => {
                const rowInfo = identityGaps.affectedRows?.[i];
                const rowIndex = rowInfo?.rowIndex ?? -1;
                const overlapPct = p.overlapScore != null ? Math.round(p.overlapScore * 100) : null;
                const evidence = p.overlapEvidence ?? p.baseName;
                return (
                  <li key={i} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span>「{p.newName}」vs「{p.baseName}」</span>
                      <button type="button" onClick={() => onViewDetail(identityGaps)} className="text-xs text-indigo-600 underline shrink-0">定位</button>
                    </div>
                    <p className="text-xs text-amber-700">
                      💡 发现高相似项：<strong className="text-amber-800">{evidence}</strong>
                      {overlapPct != null && <span>，重合度 {overlapPct}%</span>}
                      ，是否对齐？
                    </p>
                    <button type="button" onClick={() => rowIndex >= 0 && onApplyNameFix(rowIndex, p.newName, p.baseName)} className="text-xs px-2 py-1 rounded border border-amber-400 bg-amber-100 text-amber-800 hover:bg-amber-200 w-fit">替换并对齐</button>
                  </li>
                );
              })}
              {identityGaps.identityPairs.length > 6 && (
                <li className="text-amber-600">… 还有 {identityGaps.identityPairs.length - 6} 处</li>
              )}
            </ul>
          </div>
        )}
        {emptyWarnings && (
          <div className="rounded-xl border border-orange-200 bg-orange-50/80 p-4">
            <div className="mb-2 flex items-center gap-2 text-orange-800 font-semibold">
              <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
              ⚠️ 数据缺失 ({emptyWarnings.affectedCells?.length ?? 0} 处)
            </div>
            <p className="text-xs text-orange-700/90 mb-2">关键列（价格/库存）为空，建议补全或确认是否 intentionally 留空。</p>
            <ul className="max-h-32 overflow-y-auto space-y-2 text-sm text-orange-800/90">
              {emptyWarnings.affectedCells?.slice(0, 6).map((c, i) => {
                const pn = String(mappedRows[c.rowIndex]?.['商品名称'] ?? `行${c.rowIndex + 1}`);
                const isEditing = editingCell?.rowIndex === c.rowIndex && editingCell?.colKey === c.colKey;
                return (
                  <li key={i} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span><strong>{pn}</strong> · {c.colKey}：空</span>
                      <button type="button" onClick={() => onViewDetail(emptyWarnings)} className="text-xs text-indigo-600 underline shrink-0">定位</button>
                    </div>
                    <p className="text-xs text-gray-600">此列应为数字。建议：</p>
                    <div className="flex flex-wrap gap-1">
                      <button type="button" onClick={() => onApplyCellFix(c.rowIndex, c.colKey, '0', '')} className="text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50">设为 0</button>
                      <button type="button" onClick={() => { setEditingCell(isEditing ? null : { rowIndex: c.rowIndex, colKey: c.colKey }); setEditValue(''); }} className="text-xs px-2 py-1 rounded border border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100">手动修改</button>
                    </div>
                    {isEditing && (
                      <div className="flex gap-1 mt-1">
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { onApplyCellFix(c.rowIndex, c.colKey, editValue, ''); setEditingCell(null); } }}
                          className="flex-1 text-xs px-2 py-1 border rounded"
                          placeholder="输入数字"
                          autoFocus
                        />
                        <button type="button" onClick={() => { onApplyCellFix(c.rowIndex, c.colKey, editValue, ''); setEditingCell(null); }} className="text-xs px-2 py-1 rounded bg-orange-500 text-white">确定</button>
                      </div>
                    )}
                  </li>
                );
              })}
              {(emptyWarnings.affectedCells?.length ?? 0) > 6 && (
                <li className="text-orange-600">… 还有 {(emptyWarnings.affectedCells?.length ?? 0) - 6} 处</li>
              )}
            </ul>
            {emptyCells.length > 0 && (
              <button type="button" onClick={onFixEmpty} className="text-xs text-orange-600 underline mt-1">一键全部设为 0</button>
            )}
          </div>
        )}
        <button type="button" onClick={onToggleCanvas} className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">
          {showOnCanvas ? '关闭画布高亮' : '查看明细'}
        </button>
        <div className="flex gap-2">
          <button type="button" onClick={onIgnore} disabled={loading} className="flex-1 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            我已知晓，忽略并强制合并
          </button>
          <button type="button" onClick={onConfirmAndContinue} disabled={loading} className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            确认所有并继续
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/** 合并预演卡片 */
function FinalPreviewCard({
  rowCount,
  onConfirm,
  onChainNext,
  loading,
  stepName,
}: {
  rowCount: number;
  onConfirm: () => void;
  onChainNext?: (rows: Record<string, string | null>[]) => void;
  loading: boolean;
  stepName?: string;
}) {
  return (
    <motion.div {...stepTransition} className="flex flex-col gap-4">
      <AgentBubble message={`合并预演完成，将生成约 ${rowCount} 行数据。确认后更新画布。`} />
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className="flex items-center justify-center gap-2 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
          确认并完成
        </button>
        {onChainNext && (
          <button
            type="button"
            onClick={() => onChainNext([])}
            disabled={loading}
            className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-violet-400 bg-violet-50 px-4 py-2.5 text-sm font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" aria-hidden />
            关联下一张表
          </button>
        )}
      </div>
    </motion.div>
  );
}

/** 模糊匹配：新列名与底表列名的相似度 */
function fuzzyMatch(newCol: string, baseCol: string): number {
  const n = newCol.replace(/\s/g, '');
  const b = baseCol.replace(/\s/g, '');
  if (n === b) return 1;
  if (n.includes(b) || b.includes(n)) return 0.8;
  return 0;
}

export function AgentSidebar({
  task,
  onTaskChange,
  isAnalyzingHeaders = false,
  headerReport,
  onHeaderResult,
  onAnalyzingHeaders,
  onAnalyzeError,
  baseRows,
  newRows,
  mergeSourceRows,
  onMergeComplete,
  highlightedColumn,
  onHighlightColumn,
  conflictRowIndex,
  onConflictRowIndex,
  onSyncToProduct,
  savedSkills = [],
  onDeleteSkill,
  onSaveSkill,
  matchedSkill,
  onApplySkill,
  onSkipSkillApply,
  onSkillMatchDetected,
  onBaselineCapture,
  onRequestReUpload,
  onHealthCheckDisplay,
  onHealthCheckFix,
  onUpdateSkill,
}: AgentSidebarProps) {
  const [loading, setLoading] = useState(false);
  const [intent, setIntent] = useState<IntentType | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [mergedPreview, setMergedPreview] = useState<Record<string, string | null>[]>([]);
  const [diffStats, setDiffStats] = useState<DiffMatchStats | null>(null);
  const [diffSampleRows, setDiffSampleRows] = useState<Array<{ before: Record<string, string | null>; after: Record<string, string | null>; productName: string; baseRowIndex: number; changeType?: 'added' | 'modified' | 'deleted' }>>([]);
  const [addNewRows, setAddNewRows] = useState(true);
  const [removeDeletedRows, setRemoveDeletedRows] = useState(false);
  /** 变更提醒：后端 change_detect 返回的报告，用于注入 _diffStatus */
  const [changeReport, setChangeReport] = useState<ChangeReport | null>(null);
  /** 数据体检：统一审计报告 */
  const [healthReport, setHealthReport] = useState<HealthReport | null>(null);
  /** 数据体检：新表映射后的行（供画布预览） */
  const [healthCheckMappedRows, setHealthCheckMappedRows] = useState<Record<string, string | null>[]>([]);
  /** 数据体检：用户是否选择在画布查看异常 */
  const [showAnomaliesOnCanvas, setShowAnomaliesOnCanvas] = useState(false);
  /** Skill 准入审计：因 strictAudit 拦截而进入 AUDIT_REPORT 时置为 true，用于显示「请先人工核对」提示 */
  const [auditInterruptFromSkill, setAuditInterruptFromSkill] = useState(false);
  /** Skill 自我进化：记录用户纠错成果，用于 DIFF_PREVIEW 时提示是否更新 Skill */
  const [appliedNameMappings, setAppliedNameMappings] = useState<Array<{ oldName: string; newName: string }>>([]);
  const [appliedHistoryFixes, setAppliedHistoryFixes] = useState<HistoryFix[]>([]);
  const [skillAutoFixToast, setSkillAutoFixToast] = useState(false);
  const [skillEvolutionUpdating, setSkillEvolutionUpdating] = useState(false);
  const [skillEvolutionToast, setSkillEvolutionToast] = useState(false);

  useEffect(() => {
    if (task === 'IDLE') setChangeReport(null);
  }, [task]);

  /** 离开 AUDIT_REPORT / HEALTH_CHECK 时清除画布体检预览及 Skill 中断标记 */
  useEffect(() => {
    if (task !== 'AUDIT_REPORT' && task !== 'HEALTH_CHECK') {
      onHealthCheckDisplay?.(null, [], [], []);
      setShowAnomaliesOnCanvas(false);
      setAuditInterruptFromSkill(false);
    }
  }, [task, onHealthCheckDisplay]);


  /** 无 matchedSkill 时清空纠错记录 */
  useEffect(() => {
    if (!matchedSkill) {
      setAppliedNameMappings([]);
      setAppliedHistoryFixes([]);
    }
  }, [matchedSkill]);

  /** 从 AUDIT_REPORT 进入 DIFF_PREVIEW：基于已清洗的 healthCheckMappedRows 计算 diffStats，确保名称对齐后为「增强维度」 */
  const transitionToDiffPreviewFromAudit = useCallback(() => {
    const mapped = healthCheckMappedRows;
    if (mapped.length === 0) {
      onTaskChange('DIFF_PREVIEW');
      return;
    }
    const newByProduct = new Map<string, Record<string, string | null>>();
    for (const row of mapped) {
      const pn = row[ANCHOR_COLUMN] ?? '';
      if (pn) newByProduct.set(String(pn), row);
    }
    const baseProductNames = new Set(baseRows.map((r) => String(r[ANCHOR_COLUMN] ?? '')));
    const newProductNames = new Set(newByProduct.keys());
    const matchedRows: Array<{ baseRowIndex: number; productName: string }> = [];
    const baseOnlyProductNames = new Set<string>();
    for (let i = 0; i < baseRows.length; i++) {
      const pn = String(baseRows[i][ANCHOR_COLUMN] ?? '');
      if (newProductNames.has(pn)) matchedRows.push({ baseRowIndex: i, productName: pn });
      else if (pn) baseOnlyProductNames.add(pn);
    }
    const newOnlyProducts = [...newProductNames].filter((p) => !baseProductNames.has(p));
    const stats: DiffMatchStats = {
      matchedCount: matchedRows.length,
      newOnlyCount: newOnlyProducts.length,
      baseOnlyCount: baseOnlyProductNames.size,
      matchedRows,
      newOnlyProducts,
      baseOnlyProductNames: [...baseOnlyProductNames],
    };
    setDiffStats(stats);
    const mappedCols = Object.keys(mapped[0] ?? {});
    const sharedCompareCols = getSharedCompareColumns(BASE_COLUMNS, mappedCols, ANCHOR_COLUMN);
    fetch(`${FINAL_API_URL}/ai-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'change_detect',
        baseline_rows: baseRows,
        new_mapped_rows: mapped,
        anchor_column: ANCHOR_COLUMN,
        compare_columns: sharedCompareCols,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ChangeReport | null) => {
        if (data) setChangeReport(data);
      })
      .catch(() => {});
    const sampleMatched = matchedRows.slice(0, 5);
    const samples = sampleMatched.map(({ baseRowIndex, productName }) => {
      const baseRow = baseRows[baseRowIndex];
      const newRow = newByProduct.get(productName) ?? {};
      const after = { ...baseRow };
      for (const [k, v] of Object.entries(newRow)) {
        if (v != null) after[k] = v;
      }
      const hasChange = sharedCompareCols.some((k) => sanitizeValue(baseRow?.[k]) !== sanitizeValue(after[k]));
      return { before: baseRow ?? {}, after, productName, baseRowIndex, changeType: hasChange ? ('modified' as const) : undefined };
    });
    const sampleNewOnly = newOnlyProducts.slice(0, 2).map((productName) => ({
      before: {} as Record<string, string | null>,
      after: newByProduct.get(productName) ?? {},
      productName,
      baseRowIndex: -1,
      changeType: 'added' as const,
    }));
    const sampleDeleted = [...baseOnlyProductNames].slice(0, 1).map((productName) => {
      const baseRow = baseRows.find((r) => String(r[ANCHOR_COLUMN] ?? '') === productName) ?? {};
      return { before: baseRow, after: {} as Record<string, string | null>, productName, baseRowIndex: -2, changeType: 'deleted' as const };
    });
    setDiffSampleRows([...samples, ...sampleNewOnly, ...sampleDeleted]);
    setMergedPreview([]);
    onTaskChange('DIFF_PREVIEW');
  }, [healthCheckMappedRows, baseRows, onTaskChange]);

  const newColumns = useMemo(() => {
    if (newRows.length === 0) return [];
    const first = newRows[0];
    return typeof first === 'object' && first ? Object.keys(first) : [];
  }, [newRows]);

  const initialMapping = useMemo(() => {
    const m: Record<string, string> = {};
    for (const nc of newColumns) {
      let best = '';
      let score = 0;
      for (const bc of BASE_COLUMNS) {
        const s = fuzzyMatch(nc, bc);
        if (s > score) {
          score = s;
          best = bc;
        }
      }
      m[nc] = best || NEW_COLUMN_MARKER;
    }
    return m;
  }, [newColumns]);

  const matchSkillByColumns = useCallback((fileColumns: string[]) => {
    const fileSet = new Set(fileColumns);
    for (const skill of savedSkills) {
      const expected = skill.expectedColumns || Object.keys(skill.mapping);
      if (expected.length === 0) continue;
      const matchCount = expected.filter((c) => fileSet.has(c)).length;
      if (matchCount / expected.length >= 0.8) return skill;
    }
    return null;
  }, [savedSkills]);

  const handleUploadResult = (r: HeaderAnalyzeResult, f: File[]) => {
    onHeaderResult(r, f);
    const cols = r.base_columns ?? [];
    const matched = matchSkillByColumns(cols);
    if (matched && onSkillMatchDetected) {
      onSkillMatchDetected(matched);
      onTaskChange('SKILL_APPLY_CONFIRM');
      return;
    }
    onSkillMatchDetected?.(null);
    const m: Record<string, string> = {};
    for (const nc of cols) {
      let best = '';
      let score = 0;
      for (const bc of BASE_COLUMNS) {
        const s = fuzzyMatch(nc, bc);
        if (s > score) {
          score = s;
          best = bc;
        }
      }
      m[nc] = best || NEW_COLUMN_MARKER;
    }
    setMapping(m);
    onTaskChange('INTENT_CONFIRM');
  };

  const callAiTask = async (payload: Record<string, unknown>) => {
    setLoading(true);
    try {
      const res = await fetch(`${FINAL_API_URL}/ai-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('请求失败');
      return await res.json();
    } finally {
      setLoading(false);
    }
  };

  const handleIntentSelect = async (selected: IntentType) => {
    setIntent(selected);
    await callAiTask({
      task: 'agent_step',
      step: 'intent_confirm',
      intent: selected,
      base_row_count: baseRows.length,
      new_row_count: newRows.length,
    });
    if (selected === 'expand') {
      onTaskChange('JOIN_LOGIC_CONFIRM');
    } else {
      onTaskChange('MAPPING_ALIGN');
    }
    setMapping((prev) => (Object.keys(prev).length ? prev : initialMapping));
  };

  const handleJoinLogicConfirm = async () => {
    await callAiTask({
      task: 'agent_step',
      step: 'join_logic_confirm',
      anchor_column: ANCHOR_COLUMN,
      intent: 'expand',
    });
    onTaskChange('MAPPING_ALIGN');
    setMapping((prev) => (Object.keys(prev).length ? prev : initialMapping));
  };

  const mapNewRowsToBase = useCallback((rows: Record<string, string | null>[], m: Record<string, string>) => {
    return rows.map((row) => {
      const out: Record<string, string | null> = {};
      for (const [nc, bc] of Object.entries(m)) {
        if (!bc) continue;
        const outCol = bc === NEW_COLUMN_MARKER ? nc : bc;
        if (row[nc] != null) out[outCol] = String(row[nc]);
      }
      return out;
    });
  }, []);

  const handleMappingConfirm = async () => {
    await callAiTask({
      task: 'agent_step',
      step: 'mapping_align',
      mapping,
      base_columns: BASE_COLUMNS,
      new_columns: newColumns,
    });
    const mapped = mapNewRowsToBase(newRows, mapping);
    const primaryKey = intent === 'expand'
      ? [ANCHOR_COLUMN].filter((c) => BASE_COLUMNS.includes(c) || Object.values(mapping).includes(c))
      : ['商品名称', '销售日期'].filter((c) => BASE_COLUMNS.includes(c));
    const conflictList: ConflictItem[] = [];
    const baseByKey = new Map<string, Record<string, string | null>>();
    for (let i = 0; i < baseRows.length; i++) {
      const key = primaryKey.map((k) => baseRows[i][k] ?? '').join('|');
      baseByKey.set(key, baseRows[i]);
    }
    for (let i = 0; i < mapped.length; i++) {
      const key = primaryKey.map((k) => mapped[i][k] ?? '').join('|');
      const baseRow = baseByKey.get(key);
      if (baseRow) {
        for (const col of BASE_COLUMNS) {
          const bv = baseRow[col];
          const nv = mapped[i][col];
          if (bv != null && nv != null && String(bv) !== String(nv)) {
            conflictList.push({
              rowIndex: baseRows.findIndex((r) => primaryKey.every((k) => (r[k] ?? '') === (mapped[i][k] ?? ''))),
              colKey: col,
              baseValue: bv,
              newValue: nv,
              primaryKeyValues: Object.fromEntries(primaryKey.map((k) => [k, mapped[i][k] ?? ''])),
            });
          }
        }
      }
    }
    if (conflictList.length > 0) {
      setConflicts(conflictList);
      onConflictRowIndex?.(conflictList[0].rowIndex);
      onTaskChange('CONFLICT_RESOLVE');
    } else if (intent === 'expand') {
      /** 变更提醒：MAPPING 确认后、PREVIEW 前捕获 baseline 快照 */
      onBaselineCapture?.(baseRows);

      /** 硬核审计：MAPPING 确认时强制 strictAudit，禁止静默通过 */
      const healthResult = strictAudit({
        baseRows,
        newMappedRows: mapped,
        anchorColumn: ANCHOR_COLUMN,
      });
      const auditErrorCount = getAuditErrorCount(healthResult);
      if (auditErrorCount > 0) {
        setHealthReport(healthResult);
        setHealthCheckMappedRows(mapped);
      }

      const newCols = Object.entries(mapping)
        .filter(([, bc]) => bc === NEW_COLUMN_MARKER)
        .map(([nc]) => nc);
      const baseColsFromMapping = Object.values(mapping).filter((bc) => bc && bc !== NEW_COLUMN_MARKER);
      const expandNewColumns = [...new Set([...newCols, ...baseColsFromMapping.filter((c) => !BASE_COLUMNS.includes(c))])];
      const mergedNewColumns = newCols.length ? newCols : expandNewColumns.length ? Object.keys(mapped[0] ?? {}).filter((c) => !BASE_COLUMNS.includes(c)) : [];
      const newByProduct = new Map<string, Record<string, string | null>>();
      for (const row of mapped) {
        const pn = row[ANCHOR_COLUMN] ?? Object.entries(mapping).reduce((v, [nc, bc]) => (bc === ANCHOR_COLUMN ? (row[bc] ?? row[nc]) : v), null);
        const key = String(pn ?? '');
        if (key) newByProduct.set(key, row);
      }
      const baseProductNames = new Set(baseRows.map((r) => String(r[ANCHOR_COLUMN] ?? '')));
      const newProductNames = new Set(newByProduct.keys());
      const matchedRows: Array<{ baseRowIndex: number; productName: string }> = [];
      const baseOnlyProductNames = new Set<string>();
      for (let i = 0; i < baseRows.length; i++) {
        const pn = String(baseRows[i][ANCHOR_COLUMN] ?? '');
        if (newProductNames.has(pn)) matchedRows.push({ baseRowIndex: i, productName: pn });
        else if (pn) baseOnlyProductNames.add(pn);
      }
      const newOnlyProducts = [...newProductNames].filter((p) => !baseProductNames.has(p));
      const stats: DiffMatchStats = {
        matchedCount: matchedRows.length,
        newOnlyCount: newOnlyProducts.length,
        baseOnlyCount: baseOnlyProductNames.size,
        matchedRows,
        newOnlyProducts,
        baseOnlyProductNames: [...baseOnlyProductNames],
      };
      setDiffStats(stats);
      /** 严格基于字段名：仅底表与新表名称完全一致的列才对比，禁止语义匹配 */
      const mappedCols = Object.keys(mapped[0] ?? {});
      const sharedCompareCols = getSharedCompareColumns(BASE_COLUMNS, mappedCols, ANCHOR_COLUMN);

      /** 变更提醒：仅对共有列调用 change_detect，若无共有列则 0 冲突 */
      fetch(`${FINAL_API_URL}/ai-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'change_detect',
          baseline_rows: baseRows,
          new_mapped_rows: mapped,
          anchor_column: ANCHOR_COLUMN,
          compare_columns: sharedCompareCols,
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: ChangeReport | null) => {
          if (data) setChangeReport(data);
        })
        .catch(() => {});
      const sampleMatched = matchedRows.slice(0, 5);
      const samples = sampleMatched.map(({ baseRowIndex, productName }) => {
        const baseRow = baseRows[baseRowIndex];
        const newRow = newByProduct.get(productName) ?? {};
        const after = { ...baseRow };
        for (const [k, v] of Object.entries(newRow)) {
          if (v != null) after[k] = v;
        }
        const hasChange = sharedCompareCols.some((k) => sanitizeValue(baseRow?.[k]) !== sanitizeValue(after[k]));
        return { before: baseRow ?? {}, after, productName, baseRowIndex, changeType: hasChange ? 'modified' as const : undefined };
      });
      const sampleNewOnly = newOnlyProducts.slice(0, 2).map((productName) => ({
        before: {} as Record<string, string | null>,
        after: newByProduct.get(productName) ?? {},
        productName,
        baseRowIndex: -1,
        changeType: 'added' as const,
      }));
      const sampleDeleted = [...baseOnlyProductNames].slice(0, 1).map((productName) => {
        const baseRow = baseRows.find((r) => String(r[ANCHOR_COLUMN] ?? '') === productName) ?? {};
        return { before: baseRow, after: {} as Record<string, string | null>, productName, baseRowIndex: -2, changeType: 'deleted' as const };
      });
      setDiffSampleRows([...samples, ...sampleNewOnly, ...sampleDeleted]);
      setMergedPreview([]);
      /** auditErrors.length > 0 严禁 PREVIEW，必须跳转 AUDIT_REPORT */
      onTaskChange(auditErrorCount > 0 ? 'AUDIT_REPORT' : 'DIFF_PREVIEW');
      fetch(`${FINAL_API_URL}/ai-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'agent_preview',
          base_rows: baseRows,
          new_rows: mapped,
          mapping,
          anchor_column: ANCHOR_COLUMN,
        }),
      }).catch(() => {});
    } else {
      /** append 流程：无 change_detect，客户端注入 _diffStatus */
      const merged = [...baseRows];
      for (const row of mapped) {
        const key = primaryKey.map((k) => row[k] ?? '').join('|');
        if (!baseByKey.has(key)) merged.push(row);
      }
      const mergedWithDiff = merged.map((row) => {
        const key = primaryKey.map((k) => row[k] ?? '').join('|');
        const isNew = !baseByKey.has(key);
        return { ...row, _diffStatus: (isNew ? 'added' : 'unchanged') as const };
      });
      setMergedPreview(mergedWithDiff);
      onTaskChange('FINAL_PREVIEW');
    }
  };

  const handleDiffPreviewConfirm = async () => {
    if (!diffStats) return;
    await callAiTask({
      task: 'agent_step',
      step: 'diff_preview',
      add_new_rows: addNewRows,
      matched_count: diffStats.matchedCount,
      new_only_count: diffStats.newOnlyCount,
    });
    onSyncToProduct?.(null, []);
    onConflictRowIndex?.(null);
    const mapped = mapNewRowsToBase(mergeSourceRows, mapping);
    const newByProduct = new Map<string, Record<string, string | null>>();
    for (const row of mapped) {
      const pn = row[ANCHOR_COLUMN] ?? '';
      if (pn) newByProduct.set(String(pn), row);
    }
    const baseProductNames = new Set(baseRows.map((r) => String(r[ANCHOR_COLUMN] ?? '')));
    const deletedSet = new Set(diffStats.baseOnlyProductNames ?? []);
    const merged: Record<string, string | null>[] = [];
    for (const baseRow of baseRows) {
      const pn = String(baseRow[ANCHOR_COLUMN] ?? '');
      if (removeDeletedRows && deletedSet.has(pn)) continue;
      const newRow = newByProduct.get(pn);
      const row = { ...baseRow };
      if (newRow) {
        for (const [k, v] of Object.entries(newRow)) {
          if (v != null) row[k] = v;
        }
      }
      merged.push(row);
    }
    if (addNewRows) {
      for (const [pn, newRow] of newByProduct) {
        if (!baseProductNames.has(pn)) {
          /** 正常合并：新表所有列追加到底表，不因缺列或数值不同而中断 */
          const row: Record<string, string | null> = {};
          for (const c of BASE_COLUMNS) row[c] = null;
          for (const [k, v] of Object.entries(newRow)) row[k] = v ?? null;
          merged.push(row);
        }
      }
    }
    /** 严格基于字段名：仅共有列参与对比 */
    const mappedCols = Object.keys(mapped[0] ?? {});
    const sharedCompareCols = getSharedCompareColumns(BASE_COLUMNS, mappedCols, ANCHOR_COLUMN);
    const mergedWithDiff = injectDiffStatus(merged, changeReport, ANCHOR_COLUMN, BASE_COLUMNS, sharedCompareCols);
    setMergedPreview(mergedWithDiff);
    onTaskChange('FINAL_PREVIEW');
  };

  const handleConflictResolve = async (resolution: 'new' | 'base') => {
    await callAiTask({
      task: 'agent_step',
      step: 'conflict_resolve',
      resolution,
      conflicts: conflicts.slice(0, 5),
    });
    onConflictRowIndex?.(null);
    const primaryKey = ['商品名称', '销售日期'].filter((c) => BASE_COLUMNS.includes(c));
    const baseByKey = new Map<string, Record<string, string | null>>();
    for (const r of baseRows) {
      const key = primaryKey.map((k) => r[k] ?? '').join('|');
      baseByKey.set(key, r);
    }
    const mapped = mergeSourceRows.map((row) => {
      const out: Record<string, string | null> = {};
      for (const [nc, bc] of Object.entries(mapping)) {
        if (bc && row[nc] != null) out[bc] = String(row[nc]);
      }
      return out;
    });
    if (resolution === 'base') {
      const merged = [...baseRows];
      for (const row of mapped) {
        const key = primaryKey.map((k) => row[k] ?? '').join('|');
        if (!baseByKey.has(key)) merged.push(row);
      }
      const mappedColsResolve = Object.keys(mapped[0] ?? {});
      const sharedResolve = getSharedCompareColumns(BASE_COLUMNS, mappedColsResolve, ANCHOR_COLUMN);
      const mergedWithDiff = injectDiffStatus(merged, null, ANCHOR_COLUMN, BASE_COLUMNS, sharedResolve);
      setMergedPreview(mergedWithDiff);
    } else {
      const mergedByKey = new Map<string, Record<string, string | null>>();
      for (const r of baseRows) {
        const key = primaryKey.map((k) => r[k] ?? '').join('|');
        mergedByKey.set(key, r);
      }
      for (const row of mapped) {
        const key = primaryKey.map((k) => row[k] ?? '').join('|');
        mergedByKey.set(key, row);
      }
      const merged = Array.from(mergedByKey.values());
      const mappedColsResolve2 = Object.keys(mapped[0] ?? {});
      const sharedResolve2 = getSharedCompareColumns(BASE_COLUMNS, mappedColsResolve2, ANCHOR_COLUMN);
      const mergedWithDiff = injectDiffStatus(merged, null, ANCHOR_COLUMN, BASE_COLUMNS, sharedResolve2);
      setMergedPreview(mergedWithDiff);
    }
    onTaskChange('FINAL_PREVIEW');
  };

  const handleFinalConfirm = async () => {
    await callAiTask({
      task: 'agent_step',
      step: 'final_preview',
      merged_row_count: mergedPreview.length,
    });
    const newCols = Object.entries(mapping).filter(([, bc]) => bc === NEW_COLUMN_MARKER).map(([nc]) => nc);
    /** 静默审计：计算冲突单元格，供「查看变更详情」按需高亮 */
    const conflictCells: Array<{ rowIndex: number; colKey: string }> = [];
    mergedPreview.forEach((row, i) => {
      if (row._diffStatus === 'conflict' && row._diffChangedCols?.length) {
        for (const col of row._diffChangedCols) {
          conflictCells.push({ rowIndex: i, colKey: col });
        }
      }
    });
    onMergeComplete(mergedPreview, { newColumns: newCols, conflictCells });
    onTaskChange('SKILL_SAVE_PROMPT');
  };

  const handleSaveSkill = async (skillName: string) => {
    if (!skillName.trim() || !onSaveSkill) return;
    setLoading(true);
    try {
      const skill: Omit<SavedSkill, 'id'> = {
        name: skillName.trim(),
        anchorColumn: ANCHOR_COLUMN,
        mapping: { ...mapping },
        intent: intent ?? 'expand',
        addNewRows,
        expectedColumns: Object.keys(mapping),
      };
      onSaveSkill(skill);
      onTaskChange('IDLE');
    } finally {
      setLoading(false);
    }
  };

  const handleSkipSkillSave = () => {
    onTaskChange('IDLE');
  };

  const applySkillToDiffPreview = useCallback((skill: SavedSkill) => {
    setIntent(skill.intent);
    setMapping(skill.mapping);
    setAddNewRows(skill.addNewRows);
    let rowsToMap = mergeSourceRows;
    let nameCount = 0;
    if (skill.nameMapping && Object.keys(skill.nameMapping).length > 0) {
      const anchorNewCol = Object.entries(skill.mapping).find(([, bc]) => bc === ANCHOR_COLUMN)?.[0];
      if (anchorNewCol) {
        rowsToMap = mergeSourceRows.map((row) => {
          const val = String(row[anchorNewCol] ?? '').trim();
          const mapped = skill.nameMapping![val];
          if (mapped) { nameCount++; return { ...row, [anchorNewCol]: mapped }; }
          return row;
        });
      }
    }
    let mapped = mapNewRowsToBase(rowsToMap, skill.mapping);

    /** 预加载修复 (Pre-emptive Auto-Fix)：在 strictAudit 前应用 historyFixes */
    let dataCount = 0;
    const historyFixes = skill.historyFixes ?? [];
    if (historyFixes.length > 0) {
      mapped = mapped.map((row) => {
        const productName = String(row[ANCHOR_COLUMN] ?? '').trim();
        let changed = false;
        const next = { ...row };
        for (const hf of historyFixes) {
          if (hf.productName !== productName) continue;
          const current = String(next[hf.colKey] ?? '');
          if (current === hf.originalValue) {
            next[hf.colKey] = hf.correctedValue;
            dataCount++;
            changed = true;
          }
        }
        return changed ? next : row;
      });
    }

    if (nameCount > 0 || dataCount > 0) {
      const fixedNew = unmapRowsToNewFormat(mapped, skill.mapping, NEW_COLUMN_MARKER);
      onHealthCheckFix?.(fixedNew);
      if (typeof console !== 'undefined' && console.log) {
        console.log(`[Skill] 自动修复了 ${nameCount} 处名称，${dataCount} 处数值错误`);
      }
      setSkillAutoFixToast(true);
      setTimeout(() => setSkillAutoFixToast(false), 2000);
    }

    /** Skill 准入审计：合并前强制 strictAudit，发现 ERROR 或 IDENTITY_GAP 则中断并切换到 AUDIT_REPORT */
    const healthResult = strictAudit({
      baseRows,
      newMappedRows: mapped,
      anchorColumn: ANCHOR_COLUMN,
    });
    if (hasBlockingIssues(healthResult)) {
      setHealthReport(healthResult);
      setHealthCheckMappedRows(mapped);
      setAuditInterruptFromSkill(true);
      setShowAnomaliesOnCanvas(true);
      onHealthCheckDisplay?.(mapped, healthResult.dirtyCells, healthResult.identityGapCells, healthResult.emptyCells);
      onTaskChange('AUDIT_REPORT');
      return;
    }

    /** 变更提醒：技能应用时也捕获 baseline 并调用 change_detect */
    onBaselineCapture?.(baseRows);
    const mappedColsSkill = Object.keys(mapped[0] ?? {});
    const sharedCompareColsSkill = getSharedCompareColumns(BASE_COLUMNS, mappedColsSkill, ANCHOR_COLUMN);
    fetch(`${FINAL_API_URL}/ai-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'change_detect',
        baseline_rows: baseRows,
        new_mapped_rows: mapped,
        anchor_column: ANCHOR_COLUMN,
        compare_columns: sharedCompareColsSkill,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ChangeReport | null) => {
        if (data) setChangeReport(data);
      })
      .catch(() => {});

    const newByProduct = new Map<string, Record<string, string | null>>();
    for (const row of mapped) {
      const pn = row[ANCHOR_COLUMN] ?? '';
      if (pn) newByProduct.set(String(pn), row);
    }
    const baseProductNames = new Set(baseRows.map((r) => String(r[ANCHOR_COLUMN] ?? '')));
    const newProductNames = new Set(newByProduct.keys());
    const matchedRows: Array<{ baseRowIndex: number; productName: string }> = [];
    const baseOnlyProductNames = new Set<string>();
    for (let i = 0; i < baseRows.length; i++) {
      const pn = String(baseRows[i][ANCHOR_COLUMN] ?? '');
      if (newProductNames.has(pn)) matchedRows.push({ baseRowIndex: i, productName: pn });
      else if (pn) baseOnlyProductNames.add(pn);
    }
    const newOnlyProducts = [...newProductNames].filter((p) => !baseProductNames.has(p));
    const stats: DiffMatchStats = {
      matchedCount: matchedRows.length,
      newOnlyCount: newOnlyProducts.length,
      baseOnlyCount: baseOnlyProductNames.size,
      matchedRows,
      newOnlyProducts,
      baseOnlyProductNames: [...baseOnlyProductNames],
    };
    setDiffStats(stats);
    const sampleMatched = matchedRows.slice(0, 5);
    const samples = sampleMatched.map(({ baseRowIndex, productName }) => {
      const baseRow = baseRows[baseRowIndex];
      const newRow = newByProduct.get(productName) ?? {};
      const after = { ...baseRow };
      for (const [k, v] of Object.entries(newRow)) {
        if (v != null) after[k] = v;
      }
      const hasChange = sharedCompareColsSkill.some((k) => sanitizeValue(baseRow?.[k]) !== sanitizeValue(after[k]));
      return { before: baseRow ?? {}, after, productName, baseRowIndex, changeType: hasChange ? 'modified' as const : undefined };
    });
    const sampleNewOnly = newOnlyProducts.slice(0, 2).map((productName) => ({
      before: {} as Record<string, string | null>,
      after: newByProduct.get(productName) ?? {},
      productName,
      baseRowIndex: -1,
      changeType: 'added' as const,
    }));
    const sampleDeleted = [...baseOnlyProductNames].slice(0, 1).map((productName) => {
      const baseRow = baseRows.find((r) => String(r[ANCHOR_COLUMN] ?? '') === productName) ?? {};
      return { before: baseRow, after: {} as Record<string, string | null>, productName, baseRowIndex: -2, changeType: 'deleted' as const };
    });
    setDiffSampleRows([...samples, ...sampleNewOnly, ...sampleDeleted]);
    setMergedPreview([]);
    onTaskChange('DIFF_PREVIEW');
    onApplySkill?.(skill);
  }, [baseRows, mergeSourceRows, mapNewRowsToBase, onTaskChange, onApplySkill, onBaselineCapture, onHealthCheckDisplay, onHealthCheckFix]);

  const handleApplySkill = async () => {
    if (!matchedSkill) return;
    setLoading(true);
    try {
      await callAiTask({
        task: 'agent_step',
        step: 'skill_apply',
        skill_name: matchedSkill.name,
      });
      applySkillToDiffPreview(matchedSkill);
    } finally {
      setLoading(false);
    }
  };

  const handleSkipSkillApply = () => {
    onSkillMatchDetected?.(null);
    onSkipSkillApply?.();
    const cols = headerReport?.base_columns ?? [];
    const m: Record<string, string> = {};
    for (const nc of cols) {
      let best = '';
      let score = 0;
      for (const bc of BASE_COLUMNS) {
        const s = fuzzyMatch(nc, bc);
        if (s > score) {
          score = s;
          best = bc;
        }
      }
      m[nc] = best || NEW_COLUMN_MARKER;
    }
    setMapping(m);
    onTaskChange('INTENT_CONFIRM');
  };

  return (
    <div className="flex flex-col gap-4 relative">
      <AnimatePresence>
        {skillAutoFixToast && (
          <motion.div
            key="skill-auto-fix-toast"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute top-0 right-0 z-50 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 shadow-sm"
          >
            已自动应用历史纠错经验 ✨
          </motion.div>
        )}
        {skillEvolutionToast && (
          <motion.div
            key="skill-evolution-toast"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute top-0 right-0 z-50 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-xs font-medium text-violet-800 shadow-sm"
          >
            ✨ Skill 已进化！历史纠错经验已永久存入配方。
          </motion.div>
        )}
      </AnimatePresence>
      {task === 'IDLE' && (
        <AnimatePresence mode="wait">
          {isAnalyzingHeaders ? (
            <motion.div key="analyzing" {...stepTransition}>
              <AgentBubble message="我已收到数据，正在分析结构，请稍候..." loading />
            </motion.div>
          ) : (
            <motion.div key="idle" {...stepTransition} className="flex flex-col gap-4">
              <FileDropzone
                onHeaderResult={handleUploadResult}
                onAnalyzingHeaders={onAnalyzingHeaders}
                onAnalyzeError={onAnalyzeError}
                disabled={false}
              />
              {savedSkills.length > 0 && (
                <div className="rounded-lg border border-gray-200 bg-gray-50/80 p-3">
                  <p className="text-xs font-medium text-gray-600 mb-2 flex items-center gap-1">
                    <BookOpen className="h-3.5 w-3.5" aria-hidden />
                    复用已有技能
                  </p>
                  <ul className="space-y-1">
                    {savedSkills.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-2 group">
                        <span className="text-xs text-gray-600 truncate flex-1 min-w-0" title={s.name}>
                          • {s.name}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm('确定要删除这个技能吗？此操作不可撤销。')) {
                              onDeleteSkill?.(s.id);
                            }
                          }}
                          className="shrink-0 p-0.5 rounded text-gray-400 hover:text-red-500 transition-colors"
                          title="删除技能"
                          aria-label={`删除技能 ${s.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <BackendStatus />
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {task === 'SKILL_APPLY_CONFIRM' && matchedSkill && (
        <SkillApplyConfirmCard
          skillName={matchedSkill.name}
          onApply={handleApplySkill}
          onSkip={handleSkipSkillApply}
          loading={loading}
        />
      )}

      {task === 'SKILL_SAVE_PROMPT' && (
        matchedSkill && (() => {
          const orig = matchedSkill.mapping ?? {};
          const hasMappingChanges = Object.entries(mapping).some(([nc, bc]) => orig[nc] !== bc);
          return appliedNameMappings.length > 0 || appliedHistoryFixes.length > 0 || hasMappingChanges;
        })() ? (
          <PostMergeSkillPanel
            matchedSkill={matchedSkill}
            appliedNameMappings={appliedNameMappings}
            appliedHistoryFixes={appliedHistoryFixes}
            currentMapping={mapping}
            onUpdateCurrent={async () => {
              setSkillEvolutionUpdating(true);
              try {
                const nameMapping: Record<string, string> = { ...(matchedSkill!.nameMapping ?? {}) };
                appliedNameMappings.forEach((m) => { nameMapping[m.oldName] = m.newName; });
                const historyFixes: HistoryFix[] = [...(matchedSkill!.historyFixes ?? []), ...appliedHistoryFixes];
                const deduped = historyFixes.filter((h, i, arr) => arr.findIndex((x) => x.productName === h.productName && x.colKey === h.colKey && x.originalValue === h.originalValue) === i);
                const updated: SavedSkill = {
                  ...matchedSkill!,
                  mapping,
                  nameMapping: Object.keys(nameMapping).length ? nameMapping : undefined,
                  historyFixes: deduped.length ? deduped : undefined,
                };
                await onUpdateSkill?.(updated);
                setSkillEvolutionToast(true);
                setTimeout(() => setSkillEvolutionToast(false), 2500);
                onTaskChange('IDLE');
              } finally {
                setSkillEvolutionUpdating(false);
              }
            }}
            onSaveAsNew={async (skillName: string) => {
              if (!skillName.trim() || !onSaveSkill) return;
              setSkillEvolutionUpdating(true);
              try {
                const nameMapping: Record<string, string> = { ...(matchedSkill!.nameMapping ?? {}) };
                appliedNameMappings.forEach((m) => { nameMapping[m.oldName] = m.newName; });
                const historyFixes: HistoryFix[] = [...(matchedSkill!.historyFixes ?? []), ...appliedHistoryFixes];
                const deduped = historyFixes.filter((h, i, arr) => arr.findIndex((x) => x.productName === h.productName && x.colKey === h.colKey && x.originalValue === h.originalValue) === i);
                const skill: Omit<SavedSkill, 'id'> = {
                  name: skillName.trim(),
                  anchorColumn: matchedSkill!.anchorColumn,
                  mapping: { ...mapping },
                  intent: intent ?? matchedSkill!.intent,
                  addNewRows,
                  expectedColumns: Object.keys(mapping),
                  nameMapping: Object.keys(nameMapping).length ? nameMapping : undefined,
                  historyFixes: deduped.length ? deduped : undefined,
                };
                onSaveSkill(skill);
                onTaskChange('IDLE');
              } finally {
                setSkillEvolutionUpdating(false);
              }
            }}
            onSkip={handleSkipSkillSave}
            updating={skillEvolutionUpdating}
          />
        ) : (
          <SkillSavePromptCard
            onSave={handleSaveSkill}
            onSkip={handleSkipSkillSave}
            loading={loading}
          />
        )
      )}

      {task === 'INTENT_CONFIRM' && (
        <IntentCard onSelect={handleIntentSelect} loading={loading} />
      )}

      {task === 'JOIN_LOGIC_CONFIRM' && (
        <JoinLogicCard
          anchorColumn={ANCHOR_COLUMN}
          newColumnNames={newColumns.filter((nc) => (mapping[nc] ?? '') === NEW_COLUMN_MARKER || !BASE_COLUMNS.includes(mapping[nc] ?? ''))}
          onConfirm={handleJoinLogicConfirm}
          loading={loading}
        />
      )}

      {task === 'MAPPING_ALIGN' && (
        <MappingCard
          newColumns={newColumns.length ? newColumns : headerReport?.base_columns ?? []}
          mapping={Object.keys(mapping).length ? mapping : initialMapping}
          onMappingChange={(nc, bc) => setMapping((m) => ({ ...m, [nc]: bc }))}
          onConfirm={handleMappingConfirm}
          onHighlightColumn={onHighlightColumn}
          loading={loading}
        />
      )}

      {task === 'AUDIT_REPORT' && healthReport && (
        <AuditReportCard
          report={healthReport}
          mappedRows={healthCheckMappedRows}
          mapping={mapping}
          interruptFromSkill={auditInterruptFromSkill}
          onViewDetail={(issue) => {
            const first = issue.affectedRows[0];
            if (first != null) {
              if (!showAnomaliesOnCanvas) {
                setShowAnomaliesOnCanvas(true);
                onHealthCheckDisplay?.(healthCheckMappedRows, healthReport.dirtyCells, healthReport.identityGapCells, healthReport.emptyCells);
              }
              onConflictRowIndex?.(first.rowIndex);
            }
          }}
          onFixDirty={() => {
            if (!healthReport.dirtyCells.length) return;
            if (auditInterruptFromSkill && healthReport.dirtyErrors?.affectedCells) {
              const toAdd: HistoryFix[] = healthReport.dirtyCells
                .map((c) => {
                  const cell = healthReport.dirtyErrors!.affectedCells!.find((ac) => ac.rowIndex === c.rowIndex && ac.colKey === c.colKey);
                  const productName = String(healthCheckMappedRows[c.rowIndex]?.['商品名称'] ?? `行${c.rowIndex + 1}`);
                  return { productName, colKey: c.colKey, originalValue: String(cell?.rawValue ?? ''), correctedValue: '0' };
                })
                .filter((h) => h.originalValue !== undefined);
              setAppliedHistoryFixes((prev) => {
                const keys = new Set(toAdd.map((h) => `${h.productName}-${h.colKey}-${h.originalValue}`));
                return [...prev.filter((h) => !keys.has(`${h.productName}-${h.colKey}-${h.originalValue}`)), ...toAdd];
              });
            }
            const fixed = applyDirtyDataFix(healthCheckMappedRows, healthReport.dirtyCells, '0');
            const fixedNew = unmapRowsToNewFormat(fixed, mapping, NEW_COLUMN_MARKER);
            onHealthCheckFix?.(fixedNew);
            const recheck = strictAudit({ baseRows, newMappedRows: fixed, anchorColumn: ANCHOR_COLUMN });
            setHealthReport(recheck);
            setHealthCheckMappedRows(fixed);
            if (showAnomaliesOnCanvas) {
              onHealthCheckDisplay?.(fixed, recheck.dirtyCells, recheck.identityGapCells, recheck.emptyCells);
            }
          }}
          onFixEmpty={() => {
            if (!healthReport.emptyCells.length) return;
            if (auditInterruptFromSkill) {
              const toAdd: HistoryFix[] = healthReport.emptyCells.map((c) => ({
                productName: String(healthCheckMappedRows[c.rowIndex]?.['商品名称'] ?? `行${c.rowIndex + 1}`),
                colKey: c.colKey,
                originalValue: '',
                correctedValue: '0',
              }));
              setAppliedHistoryFixes((prev) => {
                const keys = new Set(toAdd.map((h) => `${h.productName}-${h.colKey}-${h.originalValue}`));
                return [...prev.filter((h) => !keys.has(`${h.productName}-${h.colKey}-${h.originalValue}`)), ...toAdd];
              });
            }
            const fixed = applyDirtyDataFix(healthCheckMappedRows, healthReport.emptyCells, '0');
            const fixedNew = unmapRowsToNewFormat(fixed, mapping, NEW_COLUMN_MARKER);
            onHealthCheckFix?.(fixedNew);
            const recheck = strictAudit({ baseRows, newMappedRows: fixed, anchorColumn: ANCHOR_COLUMN });
            setHealthReport(recheck);
            setHealthCheckMappedRows(fixed);
            if (showAnomaliesOnCanvas) {
              onHealthCheckDisplay?.(fixed, recheck.dirtyCells, recheck.identityGapCells, recheck.emptyCells);
            }
          }}
          onApplyNameFix={(rowIndex, oldName, newName) => {
            if (auditInterruptFromSkill) {
              setAppliedNameMappings((prev) => [...prev.filter((m) => m.oldName !== oldName), { oldName, newName }]);
            }
            const fixed = applyNameFix(healthCheckMappedRows, rowIndex, ANCHOR_COLUMN, newName);
            const fixedNew = unmapRowsToNewFormat(fixed, mapping, NEW_COLUMN_MARKER);
            onHealthCheckFix?.(fixedNew);
            const recheck = strictAudit({ baseRows, newMappedRows: fixed, anchorColumn: ANCHOR_COLUMN });
            setHealthReport(recheck);
            setHealthCheckMappedRows(fixed);
            if (showAnomaliesOnCanvas) {
              onHealthCheckDisplay?.(fixed, recheck.dirtyCells, recheck.identityGapCells, recheck.emptyCells);
            }
          }}
          onApplyCellFix={(rowIndex, colKey, newValue, originalValue) => {
            if (auditInterruptFromSkill) {
              const productName = String(healthCheckMappedRows[rowIndex]?.['商品名称'] ?? `行${rowIndex + 1}`);
              setAppliedHistoryFixes((prev) => [...prev.filter((h) => !(h.productName === productName && h.colKey === colKey)), { productName, colKey, originalValue: String(originalValue ?? ''), correctedValue: newValue }]);
            }
            const fixed = applyCellFix(healthCheckMappedRows, rowIndex, colKey, newValue);
            const fixedNew = unmapRowsToNewFormat(fixed, mapping, NEW_COLUMN_MARKER);
            onHealthCheckFix?.(fixedNew);
            const recheck = strictAudit({ baseRows, newMappedRows: fixed, anchorColumn: ANCHOR_COLUMN });
            setHealthReport(recheck);
            setHealthCheckMappedRows(fixed);
            if (showAnomaliesOnCanvas) {
              onHealthCheckDisplay?.(fixed, recheck.dirtyCells, recheck.identityGapCells, recheck.emptyCells);
            }
          }}
          onIgnore={() => {
            onHealthCheckDisplay?.(null, [], [], []);
            transitionToDiffPreviewFromAudit();
          }}
          onConfirmAndContinue={() => {
            onHealthCheckDisplay?.(null, [], [], []);
            transitionToDiffPreviewFromAudit();
          }}
          showOnCanvas={showAnomaliesOnCanvas}
          onToggleCanvas={() => {
            const show = !showAnomaliesOnCanvas;
            setShowAnomaliesOnCanvas(show);
            onHealthCheckDisplay?.(show ? healthCheckMappedRows : null, show ? healthReport.dirtyCells : [], show ? healthReport.identityGapCells : [], show ? healthReport.emptyCells : []);
          }}
          loading={loading}
        />
      )}

      {task === 'DIFF_PREVIEW' && diffStats && (
        <DiffPreviewCard
          stats={diffStats}
          sampleRows={diffSampleRows}
          addNewRows={addNewRows}
          onAddNewRowsChange={setAddNewRows}
          onConfirm={handleDiffPreviewConfirm}
          onRowClick={(productName, baseRowIndex) => {
            const newCols = Object.entries(mapping).filter(([, bc]) => bc === NEW_COLUMN_MARKER).map(([nc]) => nc);
            onSyncToProduct?.(productName, newCols);
            onConflictRowIndex?.(baseRowIndex >= 0 ? baseRowIndex : null);
          }}
          newColumns={Object.entries(mapping).filter(([, bc]) => bc === NEW_COLUMN_MARKER).map(([nc]) => nc)}
          loading={loading}
          removeDeletedRows={removeDeletedRows}
          onRemoveDeletedRowsChange={setRemoveDeletedRows}
          diffStatsSummary={
            changeReport || (Object.entries(mapping).filter(([, bc]) => bc === NEW_COLUMN_MARKER).length > 0)
              ? (() => {
                  const mappedForSummary = mapNewRowsToBase(mergeSourceRows, mapping);
                  const mappedColsSummary = Object.keys(mappedForSummary[0] ?? {});
                  const sharedSummary = getSharedCompareColumns(BASE_COLUMNS, mappedColsSummary, ANCHOR_COLUMN);
                  return {
                    newColumnsCount: Object.entries(mapping).filter(([, bc]) => bc === NEW_COLUMN_MARKER).length,
                    newColumnNames: Object.entries(mapping).filter(([, bc]) => bc === NEW_COLUMN_MARKER).map(([nc]) => nc),
                    valueConflictCount: computeFilteredConflictCount(changeReport ?? null, sharedSummary),
                  };
                })()
              : undefined
          }
        />
      )}

      {task === 'CONFLICT_RESOLVE' && conflicts.length > 0 && (
        <ConflictCard
          conflicts={conflicts}
          onResolve={handleConflictResolve}
          onHighlightRow={onConflictRowIndex}
          loading={loading}
        />
      )}

      {task === 'FINAL_PREVIEW' && (
        <FinalPreviewCard
          rowCount={mergedPreview.length}
          onConfirm={handleFinalConfirm}
          loading={loading}
        />
      )}
    </div>
  );
}

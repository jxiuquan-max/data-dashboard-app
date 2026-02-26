/**
 * 全透明、决策驱动的 AI 合并引导流：
 * 上传 -> 结构确认（MergeDecisionCenter）-> 规则确认（RuleReview）-> 执行修复 -> 看板/导出。
 * 每个确认环节均有 AI 详细解释（AIChatBanner + generateAIMessage）。
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LayoutDashboard } from 'lucide-react';
import type { MergeScanResult } from './components/FileDropzone';
import type { StructureConfirmParams } from './components/MergeDecisionCenter';
import { DataFixer } from './DataFixer';
import { Dashboard } from './pages/Dashboard';
import { ExportModule } from './components/ExportModule';
import { AIChatBanner, type FlowStep } from './components/AIChatBanner';
import type { HealthManifest, MergedData, HealthError } from './DataFixer';
import type { HeaderAnalyzeResult, ScanRules, ProposeRulesResult, MergeStrategy } from './types/schemaReport';
import { AnalysisPlanner } from './components/AnalysisPlanner';
import DataCanvas from './components/DataCanvas';
import { AgentSidebar, type AgentTask } from './components/AgentSidebar';
import { DEFAULT_BASE_DATA } from './constants/defaultData';
import { parseCsvFromFile } from './utils/parseCsv';
import type { SavedSkill } from './types/skill';
import './App.css';

// --- 💡 粘贴这一段到 App.tsx 顶部 ---
const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const isProd = import.meta.env.PROD;
const FINAL_API_URL = isProd ? API_BASE : "http://127.0.0.1:5001";
// --- 粘贴结束 ---

const UPLOAD_TIMEOUT_MS = 60000;

const emptyManifest: HealthManifest = {
  summary: '暂无数据',
  errors: [],
  counts: {
    structural_nulls: 0,
    business_nulls: 0,
    type_errors: 0,
    duplicates: 0,
    outliers: 0,
    pattern_mismatch: 0,
    constraint_violation: 0,
    total: 0,
  },
};

const stepTransition = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] },
};

export default function App() {
  const [currentStep, setCurrentStep] = useState<FlowStep | 'dashboard' | 'canvas'>('canvas');
  const [mergeResult, setMergeResult] = useState<MergeScanResult | null>(null);
  /** 统一数据源：画布与侧边栏共用 fixerRows，默认使用产品销售统计表 */
  const [fixerRows, setFixerRows] = useState<Record<string, string | null>[]>(DEFAULT_BASE_DATA);
  const [remainingErrorCount, setRemainingErrorCount] = useState(0);
  const [activeError, setActiveError] = useState<HealthError | null>(null);
  const [headerReport, setHeaderReport] = useState<HeaderAnalyzeResult | null>(null);
  const [scanRules, setScanRules] = useState<ScanRules | null>(null);
  const [proposeResult, setProposeResult] = useState<ProposeRulesResult | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [isAnalyzingHeaders, setIsAnalyzingHeaders] = useState(false);
  const [confirmAlignLoading, setConfirmAlignLoading] = useState(false);
  const [confirmMergeLoading, setConfirmMergeLoading] = useState(false);
  const [confirmMergeError, setConfirmMergeError] = useState<string | null>(null);
  /** 结构确认后保存的合并参数，规则确认时用于调用 merge-and-scan */
  const [structureParams, setStructureParams] = useState<StructureConfirmParams | null>(null);
  /** preview 流程中用户选择的多余列处理：扩展（基准左连接）或丢弃 */
  const [alignExtendExtra] = useState(false);
  /** 上次合并返回的指纹，用于 check-status 轮询对比 */
  const [lastFingerprint, setLastFingerprint] = useState<string | null>(null);
  /** 轮询发现后端指纹与本地不一致时置为 true，AIChatBanner 显示「源文档已更新」 */
  const [sourceUpdated, setSourceUpdated] = useState(false);
  /** DataFixer 中用户忽略的 (col_name, value)，同步更新后尝试应用到新数据 */
  const [ignoredSignatures, setIgnoredSignatures] = useState<Array<{ col_name: string; value: string | null }>>([]);
  /** 同步更新完成后在 AnalysisPlanner 显示一次「数据已刷新」提示 */
  const [syncJustDone, setSyncJustDone] = useState(false);
  /** Agent 任务模式：驱动侧边栏微步骤视图 */
  const [currentAgentTask, setCurrentAgentTask] = useState<AgentTask>('IDLE');
  /** 左侧画布联动：Agent 处理某列时高亮 */
  const [highlightedColumn, setHighlightedColumn] = useState<string | null>(null);
  /** 冲突行索引：画布滚动并高亮 */
  const [conflictRowIndex, setConflictRowIndex] = useState<number | null>(null);
  /** 上传解析得到的新表行数据，供 Agent 流程使用 */
  const [newRows, setNewRows] = useState<Record<string, string | null>[]>([]);
  /** 已清洗数据：AUDIT_REPORT 阶段纠错后的结果，合并时强制使用此数据源 */
  const [cleanedExtraData, setCleanedExtraData] = useState<Record<string, string | null>[] | null>(null);
  /** 变更提醒：MAPPING 确认后、PREVIEW 前的 baseline 快照 */
  const [baselineRows, setBaselineRows] = useState<Record<string, string | null>[] | null>(null);
  /** 技能实验室：已保存技能 */
  const [savedSkills, setSavedSkills] = useState<SavedSkill[]>([]);
  /** 技能实验室：上传后检测到的匹配技能 */
  const [matchedSkill, setMatchedSkill] = useState<SavedSkill | null>(null);

  const hasData = mergeResult != null;
  const columns = mergeResult ? mergeResult.merged.columns : [];
  const healthManifest = mergeResult ? mergeResult.health_manifest : emptyManifest;
  const schemaReport = mergeResult ? mergeResult.schema_report : null;
  const data: MergedData = { columns, rows: fixerRows };

  useEffect(() => {
    if (hasData && remainingErrorCount === 0 && currentStep === 'fixing') {
      setCurrentStep('dashboard');
    }
  }, [hasData, remainingErrorCount, currentStep]);

  /** 上传后解析 CSV 得到 newRows，供 Agent 流程使用 */
  useEffect(() => {
    if (!pendingFiles?.length) {
      setNewRows([]);
      return;
    }
    parseCsvFromFile(pendingFiles[0])
      .then(setNewRows)
      .catch(() => setNewRows([]));
  }, [pendingFiles]);

  /** 技能实验室：加载已保存技能 */
  useEffect(() => {
    fetch(`${FINAL_API_URL}/skills`)
      .then((res) => res.ok ? res.json() : { skills: [] })
      .then((data: { skills?: SavedSkill[] }) => setSavedSkills(data?.skills ?? []))
      .catch(() => setSavedSkills([]));
  }, []);

  const handleMergeScanResult = useCallback((result: MergeScanResult) => {
    const rows = result.merged_data ?? result.merged?.rows ?? [];
    setMergeResult(result);
    setFixerRows(rows);
    setLastFingerprint(result.fingerprint ?? null);
    setLastMergeNewColumns([]);
    setLastMergeConflictCells([]);
    setHighlightedConflictCells(null);
    setCurrentStep('merging');
  }, []);

  const handleHeaderResult = useCallback((report: HeaderAnalyzeResult, files: File[]) => {
    setHeaderReport(report);
    setPendingFiles(files);
    setIsAnalyzingHeaders(false);
    setStructureParams(null);
    setCurrentStep('structure_confirm');
    /** currentAgentTask 由 AgentSidebar 的 handleUploadResult 通过 onTaskChange 设为 INTENT_CONFIRM */
  }, []);

  /** 技能实验室：删除技能（从 savedSkills 滤除对应 ID） */
  const handleDeleteSkill = useCallback(async (skillId: string) => {
    try {
      const res = await fetch(`${FINAL_API_URL}/ai-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: 'delete_skill', skill_id: skillId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail ?? '删除失败');
      }
      setSavedSkills((prev) => prev.filter((s) => s.id !== skillId));
      if (matchedSkill?.id === skillId) {
        setMatchedSkill(null);
        setCurrentAgentTask('INTENT_CONFIRM');
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '删除技能失败');
    }
  }, [matchedSkill?.id]);

  /** 技能实验室：保存技能 */
  const handleSaveSkill = useCallback(async (skill: Omit<SavedSkill, 'id'>) => {
    try {
      const res = await fetch(`${FINAL_API_URL}/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(skill),
      });
      if (res.ok) {
        const list = await fetch(`${FINAL_API_URL}/skills`).then((r) => r.json());
        setSavedSkills(list?.skills ?? []);
      }
    } catch {
      // 静默失败
    }
  }, []);

  /** 维度增强：上次合并新增的列名 */
  const [lastMergeNewColumns, setLastMergeNewColumns] = useState<string[]>([]);
  /** 静默审计：上次合并的冲突单元格，供「查看变更详情」按需高亮 */
  const [lastMergeConflictCells, setLastMergeConflictCells] = useState<Array<{ rowIndex: number; colKey: string }>>([]);
  /** 用户点击「查看变更详情」时临时高亮的单元格，null 表示不高亮 */
  const [highlightedConflictCells, setHighlightedConflictCells] = useState<Array<{ rowIndex: number; colKey: string }> | null>(null);
  /** 数据体检：画布预览新表并高亮异常（行淡红+报错格红框） */
  const [healthCheckPreview, setHealthCheckPreview] = useState<{
    rows: Record<string, string | null>[];
    dirtyCells: Array<{ rowIndex: number; colKey: string }>;
    identityGapCells: Array<{ rowIndex: number; colKey: string }>;
    emptyCells: Array<{ rowIndex: number; colKey: string }>;
    /** 有审计错误的行索引，整行淡红背景 */
    auditErrorRowIndices: number[];
  } | null>(null);

  /** Agent 合并完成：更新画布，并清除 baseline */
  const handleAgentMergeComplete = useCallback((rows: Record<string, string | null>[], meta?: { newColumns?: string[]; conflictCells?: Array<{ rowIndex: number; colKey: string }> }) => {
    setFixerRows(rows);
    setBaselineRows(null);
    setLastMergeNewColumns(meta?.newColumns ?? []);
    setLastMergeConflictCells(meta?.conflictCells ?? []);
    setHighlightedConflictCells(null);
    setCurrentStep('canvas');
    setConflictRowIndex(null);
    setNewRows([]);
    setCleanedExtraData(null);
    setPendingFiles(null);
    setHeaderReport(null);
  }, []);

  /** 变更提醒：MAPPING 确认后、PREVIEW 前捕获 baseline 快照 */
  const handleBaselineCapture = useCallback((rows: Record<string, string | null>[]) => {
    setBaselineRows(JSON.parse(JSON.stringify(rows)));
  }, []);

  /** 数据体检：展示/关闭画布异常高亮 */
  const handleHealthCheckDisplay = useCallback((
    rows: Record<string, string | null>[] | null,
    dirtyCells: Array<{ rowIndex: number; colKey: string }>,
    identityGapCells: Array<{ rowIndex: number; colKey: string }>,
    emptyCells: Array<{ rowIndex: number; colKey: string }>
  ) => {
    if (rows == null) {
      setHealthCheckPreview(null);
      return;
    }
    const rowSet = new Set<number>();
    (dirtyCells ?? []).forEach((c) => rowSet.add(c.rowIndex));
    (identityGapCells ?? []).forEach((c) => rowSet.add(c.rowIndex));
    (emptyCells ?? []).forEach((c) => rowSet.add(c.rowIndex));
    setHealthCheckPreview({
      rows,
      dirtyCells: dirtyCells ?? [],
      identityGapCells: identityGapCells ?? [],
      emptyCells: emptyCells ?? [],
      auditErrorRowIndices: [...rowSet],
    });
  }, []);

  /** 数据体检：用户选择「我去修改文件」，清空上传状态以便重新上传 */
  const handleRequestReUpload = useCallback(() => {
    setPendingFiles(null);
    setNewRows([]);
    setCleanedExtraData(null);
    setHeaderReport(null);
    setHealthCheckPreview(null);
    setCurrentAgentTask('IDLE');
  }, []);

  /** 数据体检：纠错后同步更新 newRows 与 cleanedExtraData，合并时强制使用 cleanedExtraData */
  const handleHealthCheckFix = useCallback((fixedNewRows: Record<string, string | null>[]) => {
    setNewRows(fixedNewRows);
    setCleanedExtraData(fixedNewRows);
  }, []);

  /** 结构确认后：拉取专业规则（propose-rules）并进入规则确认步骤，不触发 merge-and-scan */
  const handleConfirmStructure = useCallback(async (params: StructureConfirmParams) => {
    if (!params.baseline_columns?.length) return;
    setStructureParams(params);
    setConfirmMergeError(null);
    setConfirmAlignLoading(true);
    try {
      const res = await fetch(`${FINAL_API_URL}/propose-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_columns: params.baseline_columns }),
      });
      if (!res.ok) throw new Error('获取规则失败');
      const data = (await res.json()) as ProposeRulesResult;
      setProposeResult(data);
      setScanRules(data.basic);
      setCurrentStep('rules');
      setCurrentAgentTask('IDLE');
    } catch (e) {
      setConfirmMergeError(e instanceof Error ? e.message : '获取诊断规则失败，请重试');
    } finally {
      setConfirmAlignLoading(false);
    }
  }, []);

  /** 确认规则并开始扫描；优先传 cache_key 使用内存缓存 */
  const handleStartScan = useCallback(async () => {
    if (!pendingFiles?.length && !headerReport?.cache_key) return;
    setConfirmMergeError(null);
    setConfirmMergeLoading(true);
    try {
      const form = new FormData();
      if (headerReport?.cache_key) {
        form.append('cache_key', headerReport.cache_key);
      } else {
        pendingFiles?.forEach((f) => form.append('files', f));
      }
      if (headerReport?.base_columns?.length) {
        form.append('merge_strategy', 'template');
        form.append('baseline_columns', JSON.stringify(headerReport.base_columns));
        form.append('primary_key_columns', JSON.stringify(headerReport.suggested_primary_key ?? []));
        form.append('template_incremental', alignExtendExtra ? 'true' : 'false');
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
      const res = await fetch(`${FINAL_API_URL}/merge-and-scan`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        const contentType = res.headers.get('content-type') || '';
        const isJson = contentType.includes('application/json');
        const body = isJson ? await res.json() : await res.text();
        const msg = isJson && body?.detail ? (Array.isArray(body.detail) ? body.detail[0]?.msg : body.detail) : (typeof body === 'string' ? body : '请求失败');
        throw new Error(typeof msg === 'string' ? msg : '合并失败');
      }
      const result = (await res.json()) as MergeScanResult;
      handleMergeScanResult(result);
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.name === 'AbortError'
            ? '请求超时，请重试'
            : e.message.toLowerCase().includes('fetch') || e.message.toLowerCase().includes('econnrefused')
              ? `无法连接后端，请确认后端服务已启动 ${isProd ? '(云端)' : '(端口 5001)'}`
              : e.message
          : '合并与扫描失败';
      setConfirmMergeError(msg);
    } finally {
      setConfirmMergeLoading(false);
    }
  }, [pendingFiles, headerReport?.cache_key, headerReport?.base_columns, headerReport?.suggested_primary_key, alignExtendExtra, handleMergeScanResult]);

  /** 策略选择后开始合并：优先传 cache_key 使用内存缓存，携带 strategy / baseline_columns / primary_key_columns / template_incremental */
  const handleStartMerge = useCallback(
    async (params: {
      strategy: MergeStrategy;
      baseline_columns: string[];
      primary_key_columns: string[];
      template_incremental?: boolean;
    }) => {
      if (!pendingFiles?.length && !headerReport?.cache_key) return;
      setConfirmMergeError(null);
      setConfirmMergeLoading(true);
      try {
        const form = new FormData();
        if (headerReport?.cache_key) {
          form.append('cache_key', headerReport.cache_key);
        } else {
          pendingFiles?.forEach((f) => form.append('files', f));
        }
        form.append('merge_strategy', params.strategy);
        form.append('baseline_columns', JSON.stringify(params.baseline_columns));
        form.append('primary_key_columns', JSON.stringify(params.primary_key_columns));
        form.append('template_incremental', params.template_incremental ? 'true' : 'false');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
        const res = await fetch(`${FINAL_API_URL}/merge-and-scan`, {
          method: 'POST',
          body: form,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!res.ok) {
          const contentType = res.headers.get('content-type') || '';
          const isJson = contentType.includes('application/json');
          const body = isJson ? await res.json() : await res.text();
          const msg = isJson && body?.detail ? (Array.isArray(body.detail) ? body.detail[0]?.msg : body.detail) : (typeof body === 'string' ? body : '请求失败');
          throw new Error(typeof msg === 'string' ? msg : '合并失败');
        }
        const result = (await res.json()) as MergeScanResult;
        handleMergeScanResult(result);
      } catch (e) {
        const msg =
          e instanceof Error
            ? e.name === 'AbortError'
              ? '请求超时，请重试'
              : e.message.toLowerCase().includes('fetch') || e.message.toLowerCase().includes('econnrefused')
                ? `无法连接后端，请确认后端服务已启动 ${isProd ? '(云端)' : '(端口 5001)'}`
                : e.message
            : '合并与扫描失败';
        setConfirmMergeError(msg);
      } finally {
        setConfirmMergeLoading(false);
      }
    },
    [pendingFiles, headerReport?.cache_key, handleMergeScanResult]
  );

  /** 规则确认后执行合并：若来自结构确认则带策略/主键/增量模板调用 merge-and-scan，否则无参数调用 */
  const handleConfirmRulesAndMerge = useCallback(async () => {
    if (structureParams) {
      await handleStartMerge({
        strategy: structureParams.strategy,
        baseline_columns: structureParams.baseline_columns,
        primary_key_columns: structureParams.primary_key_columns,
        template_incremental: structureParams.template_incremental ?? false,
      });
    } else {
      await handleStartScan();
    }
  }, [structureParams, handleStartMerge, handleStartScan]);

  useEffect(() => {
    if (currentStep !== 'merging') return;
    const t = setTimeout(() => setCurrentStep('fixing'), 800);
    return () => clearTimeout(t);
  }, [currentStep]);

  /** 10 秒一次轮询 /api/check-status，对比指纹；不一致时显示「源文档已更新」 */
  useEffect(() => {
    if (lastFingerprint == null) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${FINAL_API_URL}/check-status`);
        if (!res.ok) return;
        const data = (await res.json()) as { fingerprint?: string | null };
        if (data.fingerprint != null && data.fingerprint !== lastFingerprint) {
          setSourceUpdated(true);
        }
      } catch {
        // 忽略网络错误，下次轮询再试
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [lastFingerprint]);

  /** 同步更新：静默调用 merge-and-scan，保留忽略列表，完成后跳转 AnalysisPlanner 并提示 */
  const handleSilentSync = useCallback(async () => {
    if (!pendingFiles?.length) return;
    setConfirmMergeError(null);
    setConfirmMergeLoading(true);
    setSourceUpdated(false);
    try {
      const form = new FormData();
      pendingFiles.forEach((f) => form.append('files', f));
      if (structureParams) {
        form.append('merge_strategy', structureParams.strategy);
        form.append('baseline_columns', JSON.stringify(structureParams.baseline_columns));
        form.append('primary_key_columns', JSON.stringify(structureParams.primary_key_columns));
        form.append('template_incremental', structureParams.template_incremental ? 'true' : 'false');
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
      const res = await fetch(`${FINAL_API_URL}/merge-and-scan`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        const contentType = res.headers.get('content-type') || '';
        const isJson = contentType.includes('application/json');
        const body = isJson ? await res.json() : await res.text();
        const msg = isJson && body?.detail ? (Array.isArray(body.detail) ? body.detail[0]?.msg : body.detail) : (typeof body === 'string' ? body : '请求失败');
        throw new Error(typeof msg === 'string' ? msg : '同步失败');
      }
      const result = (await res.json()) as MergeScanResult;
      const rows = result.merged_data ?? result.merged?.rows ?? [];
      setMergeResult(result);
      setFixerRows(rows);
      setLastFingerprint(result.fingerprint ?? null);
      setSyncJustDone(true);
      setCurrentStep('analysis');
    } catch (e) {
      setConfirmMergeError(
        e instanceof Error
          ? e.name === 'AbortError'
            ? '请求超时，请重试'
            : e.message
          : '同步更新失败'
      );
    } finally {
      setConfirmMergeLoading(false);
    }
  }, [pendingFiles, structureParams, handleMergeScanResult]);

  const bannerStep: FlowStep = currentStep === 'dashboard' ? 'done' : currentStep === 'canvas' ? 'idle' : currentStep;

  return (
    <div className="flex flex-row w-screen h-screen overflow-hidden bg-gray-50">
      {/* 左侧画布区：flex-1 min-w-0 防止表格撑爆 */}
      <div className="flex-1 h-full min-w-0 overflow-hidden">
        <DataCanvas
          rowData={healthCheckPreview ? healthCheckPreview.rows : fixerRows}
          onDataChange={healthCheckPreview ? undefined : setFixerRows}
          highlightedColumn={highlightedColumn}
          conflictRowIndex={conflictRowIndex}
          newColumns={lastMergeNewColumns}
          highlightedConflictCells={highlightedConflictCells}
          highlightedDirtyCells={healthCheckPreview?.dirtyCells ?? null}
          highlightedIdentityGapCells={healthCheckPreview?.identityGapCells ?? null}
          highlightedEmptyCells={healthCheckPreview?.emptyCells ?? null}
          auditErrorRowIndices={healthCheckPreview?.auditErrorRowIndices ?? null}
        />
      </div>

      {/* 右侧 AI 助手侧边栏：固定宽度 w-[400px] */}
      <aside className="w-[400px] flex-shrink-0 h-full bg-white border-l shadow-xl z-10 overflow-y-auto flex flex-col">
        <div className="flex-shrink-0 px-4 py-3 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-800">AI 助手：任务模式</h2>
          <span className="text-xs text-gray-500">微步骤引导</span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        {!['idle', 'canvas', 'structure_confirm', 'preview', 'rules'].includes(currentStep) && (
          <AIChatBanner
            step={bannerStep}
            activeError={currentStep === 'fixing' ? activeError : null}
            schemaReport={schemaReport}
            healthManifest={healthManifest}
            headerReport={headerReport}
            scanRules={scanRules}
            proposeResult={proposeResult}
            isAnalyzingHeaders={isAnalyzingHeaders}
            remainingErrorCount={remainingErrorCount}
            mergedRowCount={fixerRows.length}
            mergedColumns={columns}
            sourceUpdated={sourceUpdated}
            onSyncUpdate={handleSilentSync}
            syncJustDone={syncJustDone}
            onSyncJustDoneDismiss={() => setSyncJustDone(false)}
            isSyncing={confirmMergeLoading}
          />
        )}

        <AnimatePresence mode="wait">
          {currentStep === 'merging' && hasData && (
            <motion.div key="merging" {...stepTransition} className="flex flex-col gap-4 items-center justify-center py-16">
              <p className="text-[var(--text-secondary)] text-sm">合并完成，正在进入修复视图…</p>
              <div className="h-8 w-8 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" aria-hidden />
            </motion.div>
          )}

          {['idle', 'canvas', 'structure_confirm', 'preview', 'rules'].includes(currentStep) && (
            <motion.div key="agent" {...stepTransition} className="flex flex-col gap-4">
              {confirmMergeError && (
                <p className="text-sm text-red-400">{confirmMergeError}</p>
              )}
              {currentStep === 'canvas' && (lastMergeNewColumns.length > 0 || lastMergeConflictCells.length > 0) && (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50/80 p-4">
                  <p className="text-sm font-semibold text-indigo-800 mb-2">✨ 合并报告</p>
                  <p className="text-sm text-indigo-700 mb-2">
                    检测到 <strong>{lastMergeConflictCells.length}</strong> 处冲突
                    {lastMergeNewColumns.length > 0 ? (
                      <>，成功为您新增了 <strong>[{lastMergeNewColumns.join('、')}]</strong> 等 <strong>{lastMergeNewColumns.length}</strong> 个新维度。</>
                    ) : (
                      <>。</>
                    )}
                  </p>
                  {lastMergeConflictCells.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setHighlightedConflictCells(highlightedConflictCells ? null : lastMergeConflictCells)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-50"
                    >
                      {highlightedConflictCells ? '关闭高亮' : '查看变更详情'}
                    </button>
                  )}
                </div>
              )}
              <AgentSidebar
                task={
                  ['structure_confirm', 'preview', 'canvas'].includes(currentStep)
                    ? currentAgentTask
                    : 'IDLE'
                }
                onTaskChange={setCurrentAgentTask}
                isAnalyzingHeaders={isAnalyzingHeaders}
                headerReport={headerReport}
                onHeaderResult={handleHeaderResult}
                onAnalyzingHeaders={() => setIsAnalyzingHeaders(true)}
                onAnalyzeError={() => setIsAnalyzingHeaders(false)}
                baseRows={fixerRows}
                newRows={newRows}
                mergeSourceRows={cleanedExtraData ?? newRows}
                onMergeComplete={handleAgentMergeComplete}
                baselineRows={baselineRows ?? undefined}
                onBaselineCapture={handleBaselineCapture}
                onRequestReUpload={handleRequestReUpload}
                onHealthCheckDisplay={handleHealthCheckDisplay}
                onHealthCheckFix={handleHealthCheckFix}
                highlightedColumn={highlightedColumn}
                onHighlightColumn={setHighlightedColumn}
                conflictRowIndex={conflictRowIndex}
                onConflictRowIndex={setConflictRowIndex}
                onSyncToProduct={(productName, _newCols) => {
                  if (productName == null) setConflictRowIndex(null);
                }}
                savedSkills={savedSkills}
                onDeleteSkill={handleDeleteSkill}
                onSaveSkill={handleSaveSkill}
                matchedSkill={matchedSkill}
                onSkillMatchDetected={setMatchedSkill}
                onSkipSkillApply={() => setMatchedSkill(null)}
              />
            </motion.div>
          )}

          {currentStep === 'fixing' && hasData && (
            <motion.div key="fixing" {...stepTransition} className="flex flex-col gap-4 flex-1 min-h-0">
              <div
                className="min-h-[480px] rounded-[var(--radius-lg)] border border-[var(--border)] overflow-hidden"
                style={{ background: 'var(--bg-card)', boxShadow: 'var(--shadow)' }}
              >
                <DataFixer
                  data={data}
                  healthManifest={healthManifest}
                  onDataChange={setFixerRows}
                  onStandardizationComplete={() => setCurrentStep('done')}
                  onProgress={setRemainingErrorCount}
                  onActiveErrorChange={setActiveError}
                  onIgnoredAdd={(item) => setIgnoredSignatures((prev) => [...prev, item])}
                  initialIgnoredSignatures={ignoredSignatures}
                />
              </div>
            </motion.div>
          )}

          {currentStep === 'done' && (
            <motion.div key="done" {...stepTransition} className="flex flex-col gap-4">
              <div
                className="rounded-[var(--radius-lg)] border border-[var(--border)] p-6"
                style={{ background: 'var(--bg-card)', boxShadow: 'var(--shadow)' }}
              >
                <p className="mb-4 text-sm text-[var(--text-secondary)]">
                  合表与清洗已完成，请确认。确认后可进入分析工作台、查看看板或导出 Excel。
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setFixerRows((prev) => (prev.length ? [...prev] : prev));
                      setCurrentStep('canvas');
                    }}
                    className="btn-primary flex items-center gap-2 rounded-[var(--radius)] border-0 px-4 py-2 text-sm font-medium"
                    style={{ background: 'var(--accent)', color: '#fff', boxShadow: 'var(--shadow)' }}
                  >
                    返回画布
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentStep('analysis')}
                    className="btn-primary flex items-center gap-2 rounded-[var(--radius)] border-0 px-4 py-2 text-sm font-medium"
                    style={{ background: 'var(--accent)', color: '#fff', boxShadow: 'var(--shadow)' }}
                  >
                    进入分析工作台
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentStep('dashboard')}
                    className="btn-primary flex items-center gap-2 rounded-[var(--radius)] border-0 px-4 py-2 text-sm font-medium"
                    style={{ background: 'var(--accent)', color: '#fff', boxShadow: 'var(--shadow)' }}
                  >
                    <LayoutDashboard className="h-4 w-4" aria-hidden />
                    查看看板
                  </button>
                  <ExportModule
                    rows={fixerRows}
                    referenceColumns={schemaReport?.reference_columns ?? columns}
                    defaultFilename="标准数据"
                    disabled={false}
                  />
                </div>
              </div>
            </motion.div>
          )}

          {currentStep === 'analysis' && hasData && (
            <motion.div key="analysis" {...stepTransition} className="flex flex-col gap-4 flex-1 min-h-0">
              <div
                className="min-h-[480px] rounded-[var(--radius-lg)] border border-[var(--border)] overflow-hidden"
                style={{ background: 'var(--bg-card)', boxShadow: 'var(--shadow)' }}
              >
                <AnalysisPlanner
                  columns={columns}
                  rows={fixerRows}
                  onBack={() => setCurrentStep('done')}
                />
              </div>
            </motion.div>
          )}

          {currentStep === 'dashboard' && (
            <motion.div key="dashboard" {...stepTransition} className="flex flex-col gap-4 flex-1 min-h-0">
              <div
                className="flex-1 min-h-[480px] rounded-[var(--radius-lg)] border border-[var(--border)] overflow-auto"
                style={{ background: 'var(--bg-card)', boxShadow: 'var(--shadow)' }}
              >
                <Dashboard
                  columns={columns}
                  rows={fixerRows}
                  onDataChange={setFixerRows}
                  healthManifest={healthManifest}
                  schemaReport={schemaReport}
                  onProgress={setRemainingErrorCount}
                  onConfirmAndGoToAnalysis={() => setCurrentStep('analysis')}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setFixerRows((prev) => (prev.length ? [...prev] : prev));
                    setCurrentStep('canvas');
                  }}
                  className="rounded-[var(--radius)] border-0 px-4 py-2 text-sm font-medium"
                  style={{ background: 'var(--accent)', color: '#fff', boxShadow: 'var(--shadow)' }}
                >
                  返回画布
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentStep('done')}
                  className="rounded-[var(--radius)] border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  返回完成页
                </button>
                <ExportModule
                  rows={fixerRows}
                  referenceColumns={schemaReport?.reference_columns ?? columns}
                  defaultFilename="标准数据"
                  disabled={false}
                />
                <button
                  type="button"
                  onClick={() => setCurrentStep('analysis')}
                  className="rounded-[var(--radius)] border-0 px-4 py-2 text-sm font-medium"
                  style={{ background: 'var(--accent)', color: '#fff', boxShadow: 'var(--shadow)' }}
                >
                  进入分析工作台
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      </aside>
    </div>
  );
}

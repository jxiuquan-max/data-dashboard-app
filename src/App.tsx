/**
 * 全透明、决策驱动的 AI 合并引导流：
 * 上传 -> 结构确认（MergeDecisionCenter）-> 规则确认（RuleReview）-> 执行修复 -> 看板/导出。
 * 每个确认环节均有 AI 详细解释（AIChatBanner + generateAIMessage）。
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LayoutDashboard } from 'lucide-react';
import { FileDropzone, type MergeScanResult } from './components/FileDropzone';
import { MergeDecisionCenter, type StructureConfirmParams } from './components/MergeDecisionCenter';
import { HeaderPreview } from './components/HeaderPreview';
import { BackendStatus } from './components/BackendStatus';
import { DataFixer } from './DataFixer';
import { Dashboard } from './pages/Dashboard';
import { ExportModule } from './components/ExportModule';
import { AIChatBanner, type FlowStep } from './components/AIChatBanner';
import type { HealthManifest, MergedData, HealthError } from './DataFixer';
import type { HeaderAnalyzeResult, ScanRules, ProposeRulesResult, MergeStrategy } from './types/schemaReport';
import { RuleReview, type MergeSummary } from './components/RuleReview';
import { AnalysisPlanner } from './components/AnalysisPlanner';
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
  const [currentStep, setCurrentStep] = useState<FlowStep | 'dashboard'>('idle');
  const [mergeResult, setMergeResult] = useState<MergeScanResult | null>(null);
  const [fixerRows, setFixerRows] = useState<Record<string, string | null>[]>([]);
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
  const [alignExtendExtra, setAlignExtendExtra] = useState(false);
  /** 上次合并返回的指纹，用于 check-status 轮询对比 */
  const [lastFingerprint, setLastFingerprint] = useState<string | null>(null);
  /** 轮询发现后端指纹与本地不一致时置为 true，AIChatBanner 显示「源文档已更新」 */
  const [sourceUpdated, setSourceUpdated] = useState(false);
  /** DataFixer 中用户忽略的 (col_name, value)，同步更新后尝试应用到新数据 */
  const [ignoredSignatures, setIgnoredSignatures] = useState<Array<{ col_name: string; value: string | null }>>([]);
  /** 同步更新完成后在 AnalysisPlanner 显示一次「数据已刷新」提示 */
  const [syncJustDone, setSyncJustDone] = useState(false);

  /** 规则步展示的合并效果小结：新增列数、保持行数（由 headerReport + structureParams/alignExtendExtra 计算） */
  const rulesMergeSummary = useMemo((): MergeSummary | null => {
    if (!headerReport?.files?.length) return null;
    const keptRows = headerReport.files[0]?.row_count ?? 0;
    const templateIncremental = structureParams?.template_incremental ?? alignExtendExtra;
    if (!templateIncremental) {
      return { newColumns: 0, keptRows };
    }
    const extraSet = new Set<string>();
    headerReport.files.slice(1).forEach((f) => (f.extra_columns ?? []).forEach((c) => extraSet.add(c)));
    return { newColumns: extraSet.size, keptRows };
  }, [headerReport, structureParams?.template_incremental, alignExtendExtra]);

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

  const handleMergeScanResult = useCallback((result: MergeScanResult) => {
    setMergeResult(result);
    setFixerRows(result.merged.rows);
    setLastFingerprint(result.fingerprint ?? null);
    setCurrentStep('merging');
  }, []);

  const handleHeaderResult = useCallback((report: HeaderAnalyzeResult, files: File[]) => {
    setHeaderReport(report);
    setPendingFiles(files);
    setIsAnalyzingHeaders(false);
    setStructureParams(null);
    setCurrentStep('structure_confirm');
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
    } catch (e) {
      setConfirmMergeError(e instanceof Error ? e.message : '获取诊断规则失败，请重试');
    } finally {
      setConfirmAlignLoading(false);
    }
  }, []);

  /** 确认对齐（旧流程 preview）：拉取专业规则并进入规则确认步骤 */
  const handleConfirmAlign = useCallback(async () => {
    if (!headerReport?.base_columns?.length) return;
    setConfirmMergeError(null);
    setConfirmAlignLoading(true);
    try {
      const res = await fetch(`${FINAL_API_URL}/propose-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_columns: headerReport.base_columns }),
      });
      if (!res.ok) throw new Error('获取规则失败');
      const data = (await res.json()) as ProposeRulesResult;
      setProposeResult(data);
      setScanRules(data.basic);
      setCurrentStep('rules');
    } catch (e) {
      setConfirmMergeError(e instanceof Error ? e.message : '获取诊断规则失败，请重试');
    } finally {
      setConfirmAlignLoading(false);
    }
  }, [headerReport?.base_columns]);

  /** 确认规则并开始扫描（旧流程：preview → rules 后调用）；优先传 cache_key 使用内存缓存 */
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
      setMergeResult(result);
      setFixerRows(result.merged.rows);
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

  const bannerStep: FlowStep = currentStep === 'dashboard' ? 'done' : currentStep;

  return (
    <div className="app" style={{ background: 'var(--bg-page)', color: 'var(--text-primary)', minHeight: '100vh' }}>
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-6 flex items-center gap-3">
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            AI 数据协作舱
          </h1>
          <span className="rounded-full bg-[var(--accent)]/20 px-2.5 py-0.5 text-xs font-medium text-[var(--accent)]">
            线性对话流
          </span>
        </div>

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

        <AnimatePresence mode="wait">
          {currentStep === 'merging' && hasData && (
            <motion.div key="merging" {...stepTransition} className="flex flex-col gap-4 items-center justify-center py-16">
              <p className="text-[var(--text-secondary)] text-sm">合并完成，正在进入修复视图…</p>
              <div className="h-8 w-8 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" aria-hidden />
            </motion.div>
          )}

          {currentStep === 'idle' && (
            <motion.div key="idle" {...stepTransition} className="flex flex-col gap-4">
              <FileDropzone
                onHeaderResult={handleHeaderResult}
                onAnalyzingHeaders={() => setIsAnalyzingHeaders(true)}
                onAnalyzeError={() => setIsAnalyzingHeaders(false)}
                disabled={false}
              />
              <BackendStatus />
            </motion.div>
          )}

          {currentStep === 'structure_confirm' && headerReport && (
            <motion.div key="structure_confirm" {...stepTransition} className="flex flex-col gap-4">
              {confirmMergeError && (
                <p className="text-sm text-red-400">{confirmMergeError}</p>
              )}
              <MergeDecisionCenter
                report={headerReport}
                onConfirmStructure={handleConfirmStructure}
                loading={confirmAlignLoading}
              />
              {confirmAlignLoading && (
                <div className="flex items-center justify-center gap-2 text-[var(--text-secondary)] text-sm">
                  <div className="h-5 w-5 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" aria-hidden />
                  <span>正在获取诊断规则…</span>
                </div>
              )}
            </motion.div>
          )}

          {currentStep === 'preview' && headerReport && (
            <motion.div key="preview" {...stepTransition} className="flex flex-col gap-4">
              {confirmMergeError && (
                <p className="text-sm text-red-400">{confirmMergeError}</p>
              )}
              <HeaderPreview
                report={headerReport}
                onConfirm={(params) => {
                  if (params?.extend_extra != null) setAlignExtendExtra(params.extend_extra);
                  handleConfirmAlign();
                }}
                confirmDisabled={confirmAlignLoading}
              />
              {confirmAlignLoading && (
                <div className="flex items-center justify-center gap-2 text-[var(--text-secondary)] text-sm">
                  <div className="h-5 w-5 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" aria-hidden />
                  <span>正在获取诊断规则…</span>
                </div>
              )}
            </motion.div>
          )}

          {currentStep === 'rules' && proposeResult && (
            <motion.div key="rules" {...stepTransition} className="flex flex-col gap-4">
              {confirmMergeError && (
                <p className="text-sm text-red-400">{confirmMergeError}</p>
              )}
              <RuleReview
                result={proposeResult}
                onConfirm={handleConfirmRulesAndMerge}
                confirmDisabled={confirmMergeLoading}
                mergeSummary={rulesMergeSummary}
              />
              {confirmMergeLoading && (
                <div className="flex items-center justify-center gap-2 text-[var(--text-secondary)] text-sm">
                  <div className="h-5 w-5 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" aria-hidden />
                  <span>正在合并与健康扫描…</span>
                </div>
              )}
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
    </div>
  );
}

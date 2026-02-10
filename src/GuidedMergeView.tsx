import { useState, useRef, useEffect } from 'react';
import type { TableData, MergeType } from './types';
import { applyStep, cloneTable, tableDataFingerprint } from './types';
import { evaluateAllFormulas } from './formulaEval';
import type { UploadedTable, ChatMessage, PendingAction, CleanSuggestion } from './guidedTypes';
import { parseTableFile } from './parseTableFile';
import { analyzeForMerge, analyzeQuality, suggestCleanSteps, doUnion, formatQualityReportSummary } from './guidedAnalysis';
import { mergeTables } from './types';
import { DataTable } from './DataTable';
import './GuidedMergeView.css';

/** 源文件更新提醒：哪些表需要重新加载 */
export interface SourceUpdateReminder {
  updated: { id: string; name: string; newData: TableData }[];
}

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function GuidedMergeView() {
  const [uploadedTables, setUploadedTables] = useState<UploadedTable[]>([]);
  const [currentTable, setCurrentTable] = useState<TableData | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [uploadError, setUploadError] = useState('');
  const [fillNullValue, setFillNullValue] = useState('');
  const [joinLeftKey, setJoinLeftKey] = useState('');
  const [joinRightKey, setJoinRightKey] = useState('');
  const [sourceUpdateReminder, setSourceUpdateReminder] = useState<SourceUpdateReminder | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const sourceFilesRef = useRef<Map<string, File>>(new Map());
  const uploadedTablesRef = useRef<UploadedTable[]>([]);

  useEffect(() => {
    uploadedTablesRef.current = uploadedTables;
  }, [uploadedTables]);

  useEffect(() => {
    if (pendingAction) {
      setTimeout(() => pendingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, pendingAction]);

  // 表格数据更新后自动滚动到预览区，便于实时查看效果
  useEffect(() => {
    if (!currentTable || !previewRef.current) return;
    const id = setTimeout(() => {
      previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
    return () => clearTimeout(id);
  }, [currentTable]);

  // 当前问题与预览区聚焦：步骤切换时滚动到预览区，并将相关列滚入视口并高亮
  const previewFocusedColumns: string[] | null =
    pendingAction?.type === 'single_step'
      ? pendingAction.step.type === 'fill_null' && pendingAction.step.params?.column
        ? [pendingAction.step.params.column as string]
        : pendingAction.step.type === 'trim' && pendingAction.step.params?.columns
          ? (pendingAction.step.params.columns as string[])
          : (pendingAction.step.type === 'normalize_type' && pendingAction.step.params?.column)
            ? [pendingAction.step.params.column as string]
            : pendingAction.step.type === 'merge_redundant_columns' && pendingAction.step.params?.columns
              ? (pendingAction.step.params.columns as string[])
              : null
      : pendingAction?.type === 'fill_null_input'
        ? [pendingAction.column]
        : null;

  useEffect(() => {
    if (pendingAction?.type !== 'single_step' && pendingAction?.type !== 'fill_null_input') return;
    const id = setTimeout(() => {
      previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => clearTimeout(id);
  }, [pendingAction]);

  useEffect(() => {
    if (!previewFocusedColumns?.length || !tableScrollRef.current) return;
    const col = previewFocusedColumns[0];
    const id = setTimeout(() => {
      const el = tableScrollRef.current?.querySelector(`[data-col="${CSS.escape(col)}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }, 150);
    return () => clearTimeout(id);
  }, [previewFocusedColumns?.join(',') ?? '']);

  /** 检查源文件是否已变更（重读 File 并比较内容） */
  const checkSourceUpdates = async () => {
    const tables = uploadedTablesRef.current;
    if (tables.length === 0) return;
    setCheckingUpdate(true);
    const updated: { id: string; name: string; newData: TableData }[] = [];
    for (const t of tables) {
      const file = sourceFilesRef.current.get(t.id);
      if (!file) continue;
      try {
        const result = await parseTableFile(file);
        if (!result.ok || result.data.columns.length === 0) continue;
        if (tableDataFingerprint(t.data) !== tableDataFingerprint(result.data)) {
          updated.push({ id: t.id, name: t.name, newData: result.data });
        }
      } catch {
        // 文件可能已被移除或不可读，跳过
      }
    }
    setCheckingUpdate(false);
    if (updated.length > 0) setSourceUpdateReminder({ updated });
  };

  /** 确认重新加载：用新数据替换源表并重新进入合并引导 */
  const handleReloadSource = () => {
    if (!sourceUpdateReminder) return;
    const newTables = uploadedTablesRef.current.map((t) => {
      const u = sourceUpdateReminder.updated.find((x) => x.id === t.id);
      if (u) return { ...t, data: u.newData };
      return t;
    });
    setUploadedTables(newTables);
    setCurrentTable(null);
    setPendingAction(null);
    setSourceUpdateReminder(null);
    const names = sourceUpdateReminder.updated.map((x) => x.name).join('、');
    const analysis = analyzeForMerge(newTables.map((t) => ({ name: t.name, data: t.data })));
    const tableSummary = newTables.map((t) => ({ name: t.name, rows: t.data.rows.length, columns: t.data.columns.length, columnNames: t.data.columns }));
    pushAI(`已重新加载源文件：${names}。${analysis.reason} 请重新确认合并方式。`, {
      tableSummary,
      mergeSuggestion: { suggested: analysis.suggested, reason: analysis.reason },
    });
    if (analysis.mergeWarnings?.length) {
      pushAI('⚠️ 合并前提示：' + analysis.mergeWarnings.join(' '), { mergeWarnings: analysis.mergeWarnings });
    }
    const mergeOptions =
      newTables.length === 1
        ? [{ label: '继续，进入数据质量检测', value: 'union' as const }]
        : [
            { label: '纵向合并（Union）', value: 'union' as const },
            { label: '左连接（需选键列）', value: 'left_join' as const },
            { label: '内连接（需选键列）', value: 'inner_join' as const },
          ];
    setPendingAction({
      type: 'confirm_merge',
      message: newTables.length === 1 ? '当前仅一张表，将直接进行数据质量检测。' : '请确认合并方式：',
      options: mergeOptions,
    });
  };

  useEffect(() => {
    if (uploadedTables.length === 0) return;
    const interval = setInterval(checkSourceUpdates, 30000);
    return () => clearInterval(interval);
  }, [uploadedTables.length]);

  const pushAI = (content: string, meta?: ChatMessage['meta']) => {
    setMessages((m) => [...m, { id: genId(), role: 'ai', content, createdAt: Date.now(), meta }]);
  };

  const pushUser = (content: string) => {
    setMessages((m) => [...m, { id: genId(), role: 'user', content, createdAt: Date.now() }]);
  };

  const handleMultiUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setUploadError('');
    const added: UploadedTable[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const result = await parseTableFile(file);
      if (result.ok && result.data.columns.length > 0) {
        const id = genId();
        added.push({ id, name: result.fileName, data: result.data });
        sourceFilesRef.current.set(id, file);
      } else {
        setUploadError(result.ok ? '' : (result as { error: string }).error);
        if (!result.ok) break;
      }
    }
    if (added.length > 0) {
      setUploadedTables((prev) => [...prev, ...added]);
      const summary = added.map((t) => `「${t.name}」${t.data.rows.length} 行 × ${t.data.columns.length} 列`).join('；');
      pushAI(`已收到 ${added.length} 个文件：${summary}。正在分析表结构…`);
      const all = [...uploadedTables, ...added];
      const analysis = analyzeForMerge(all.map((t) => ({ name: t.name, data: t.data })));
      pushAI(analysis.reason, {
        tableSummary: all.map((t) => ({ name: t.name, rows: t.data.rows.length, columns: t.data.columns.length, columnNames: t.data.columns })),
        mergeSuggestion: { suggested: analysis.suggested, reason: analysis.reason },
      });
      if (analysis.mergeWarnings?.length) {
        pushAI('⚠️ 合并前提示：' + analysis.mergeWarnings.join(' '), { mergeWarnings: analysis.mergeWarnings });
      }
      const mergeOptions =
        all.length === 1
          ? [{ label: '继续，进入数据质量检测', value: 'union' as const }]
          : [
              { label: '纵向合并（Union）', value: 'union' as const },
              { label: '左连接（需选键列）', value: 'left_join' as const },
              { label: '内连接（需选键列）', value: 'inner_join' as const },
            ];
      setPendingAction({
        type: 'confirm_merge',
        message: all.length === 1 ? '当前仅一张表，将直接进行数据质量检测。' : '请确认合并方式：',
        options: mergeOptions,
      });
    }
    e.target.value = '';
  };

  const handleConfirmMerge = (value: MergeType | 'union') => {
    if (!uploadedTables.length) return;
    const mergeType = value as MergeType;
    if (mergeType === 'union' || uploadedTables.length !== 2) {
      const merged = doUnion(uploadedTables.map((t) => t.data));
      setCurrentTable(merged);
      pushUser('按纵向合并(Union)');
      pushAI(`合并完成，当前表共 **${merged.rows.length}** 行、**${merged.columns.length}** 列。正在检测数据质量…`);
      runQualityAndSuggest(merged);
      /* 不 setPendingAction(null)：runQualityAndSuggest 会调用 showSingleStepCard 设置逐项引导卡片 */
    } else {
      pushUser(`选择 ${mergeType}，需选择键列`);
      const [left, right] = uploadedTables;
      setPendingAction({
        type: 'choose_join_key',
        message: '请选择左右表的连接键列（两列含义需一致）：',
        leftColumns: left.data.columns,
        rightColumns: right.data.columns,
        onConfirm: (leftKey, rightKey) => {
          const merged = mergeTables(left.data, mergeType, right.data, { leftKeys: [leftKey], rightKeys: [rightKey] });
          setCurrentTable(merged);
          pushUser(`按「${leftKey}」=「${rightKey}」${mergeType}`);
          pushAI(`合并完成，当前表共 ${merged.rows.length} 行、${merged.columns.length} 列。正在检测数据质量…`);
          runQualityAndSuggest(merged);
          /* 不 setPendingAction(null)：runQualityAndSuggest 会设置逐项引导卡片 */
        },
      });
      setJoinLeftKey(left.data.columns[0] ?? '');
      setJoinRightKey(right.data.columns[0] ?? '');
    }
  };

  function runQualityAndSuggest(table: TableData) {
    const report = analyzeQuality(table);
    const steps = suggestCleanSteps(report, table.columns);
    const summaryLines = formatQualityReportSummary(report);
    if (steps.length === 0) {
      pushAI('当前表未检测到明显问题，可直接使用。如需进一步操作，可切换到「清洗演示」页手动执行。', { qualityReport: report });
      setPendingAction({
        type: 'confirm_clean',
        message: '未发现需清洗项',
        options: [{ label: '确定，使用当前表', value: 'skip' as const }],
        steps: [],
        report,
      });
      return;
    }
    pushAI('合并后检测到以下问题，将逐项引导您处理：\n' + summaryLines.map((line, i) => `${i + 1}. ${line}`).join('\n'), { qualityReport: report });
    pushAI(`共 ${steps.length} 项可执行操作，下面逐项引导（您可执行建议或跳过）。`, { qualityReport: report });
    showSingleStepCard(steps, 0, table);
  }

  const handleConfirmClean = (value: 'all' | 'step' | 'skip') => {
    if (value === 'skip') {
      pushUser('暂不清洗');
      pushAI('已跳过。您可随时在下方查看当前表，或切换到「清洗演示」页手动操作。');
      setPendingAction(null);
      return;
    }
    const action = pendingAction;
    if (action?.type !== 'confirm_clean' || !currentTable) return;
    pushUser(value === 'all' ? '一键执行全部建议' : '逐步确认每步（逐条引导）');
    if (value === 'all') {
      let t = cloneTable(currentTable);
      for (const step of action.steps) {
        t = applyCleanStep(t, step);
      }
      setCurrentTable(t);
      pushAI(`已执行 ${action.steps.length} 项清洗，当前表共 ${t.rows.length} 行。`);
      setPendingAction(null);
    } else {
      showSingleStepCard(action.steps, 0, currentTable);
    }
  };

  function getStepGuidance(step: CleanSuggestion): string {
    if (step.type === 'fill_null')
      return `请在下方向意填写该列空值的替换内容（如留空则用「—」），然后点击「执行建议」。`;
    if (step.type === 'remove_duplicates') return `将按全部列判断重复行，保留第一次出现的行。点击「执行建议」应用。`;
    if (step.type === 'trim') return `将去除这些列的首尾空格及连续空格。点击「执行建议」应用。`;
    if (step.type === 'drop_empty_rows') return `将删除整行均为空的行。点击「执行建议」应用。`;
    if (step.type === 'normalize_type') return `该列存在数字与文本混用，将统一转为文本以便一致处理。点击「执行建议」应用。`;
    if (step.type === 'merge_redundant_columns') return `将多列合并为一列（每行取第一个非空值），合并后保留一列。点击「执行建议」应用。`;
    return '';
  }

  function showSingleStepCard(steps: CleanSuggestion[], index: number, table: TableData) {
    if (index >= steps.length) {
      setPendingAction(null);
      pushAI('全部步骤已处理完毕。');
      return;
    }
    const step = steps[index];
    const guidance = getStepGuidance(step);
    const remaining = steps.length - index;
    setPendingAction({
      type: 'single_step',
      step,
      stepIndex: index,
      totalSteps: steps.length,
      guidance,
      onExecute: () => {
        if (step.type === 'fill_null' && step.params?.column) {
          setPendingAction({
            type: 'fill_null_input',
            message: `列「${step.params.column}」的空值将填充为：`,
            column: step.params.column as string,
            onConfirm: (value) => {
              const val = value.trim() || '—';
              let t = cloneTable(table);
              t = applyStep(t, {
                id: genId(),
                type: 'FILL_NULL',
                params: { FILL_NULL: { column: step.params!.column as string, value: val } },
                description: `填充「${step.params!.column}」空值为「${val}」`,
                rowCountBefore: t.rows.length,
                rowCountAfter: t.rows.length,
                timestamp: Date.now(),
              }, { formulaEvaluator: evaluateAllFormulas });
              setCurrentTable(t);
              pushUser(`填充「${step.params!.column}」= ${val}`);
              pushAI('已执行。');
              showSingleStepCard(steps, index + 1, t);
            },
          });
          setFillNullValue('');
        } else {
          const t = applyCleanStep(table, step);
          setCurrentTable(t);
          pushUser(step.description);
          pushAI('已执行。');
          showSingleStepCard(steps, index + 1, t);
        }
      },
      onSkip: () => {
        pushUser(`跳过：${step.description}`);
        pushAI('已跳过此项。');
        showSingleStepCard(steps, index + 1, table);
      },
      onExecuteAll: () => {
        let t = cloneTable(table);
        for (let i = index; i < steps.length; i++) {
          t = applyCleanStep(t, steps[i]);
        }
        setCurrentTable(t);
        setPendingAction(null);
        pushUser(`一键执行剩余 ${remaining} 项`);
        pushAI(`已执行 ${remaining} 项清洗，当前表共 ${t.rows.length} 行。`);
      },
      onSkipAll: () => {
        setPendingAction(null);
        pushUser('暂不清洗');
        pushAI('已跳过。您可随时在下方查看当前表，或切换到「清洗演示」页手动操作。');
      },
    });
  }

  function runNextCleanStep(steps: CleanSuggestion[], index: number, tableOverride?: TableData) {
    const table = tableOverride ?? currentTable;
    if (!table || index >= steps.length) {
      setPendingAction(null);
      if (table && index > 0) pushAI('全部步骤已执行完毕。');
      return;
    }
    const step = steps[index];
    if (step.type === 'fill_null' && step.params?.column) {
      setPendingAction({
        type: 'fill_null_input',
        message: `请填写列「${step.params.column}」的空值填充内容：`,
        column: step.params.column as string,
        onConfirm: (value) => {
          let t = cloneTable(table);
          t = applyStep(t, {
            id: genId(),
            type: 'FILL_NULL',
            params: { FILL_NULL: { column: step.params!.column as string, value } },
            description: `填充「${step.params!.column}」空值为「${value}」`,
            rowCountBefore: t.rows.length,
            rowCountAfter: t.rows.length,
            timestamp: Date.now(),
          }, { formulaEvaluator: evaluateAllFormulas });
          setCurrentTable(t);
          pushUser(`填充「${step.params!.column}」= ${value}`);
          pushAI('已执行。');
          runNextCleanStep(steps, index + 1, t);
        },
      });
      setFillNullValue('');
      return;
    }
    const t = applyCleanStep(table, step);
    setCurrentTable(t);
    pushUser(step.description);
    pushAI('已执行。');
    runNextCleanStep(steps, index + 1, t);
  }

  function applyCleanStep(data: TableData, suggestion: CleanSuggestion): TableData {
    const col = suggestion.params?.column as string | undefined;
    let step: { id: string; type: string; params: Record<string, unknown>; description: string; rowCountBefore: number; rowCountAfter: number; timestamp: number };
    if (suggestion.type === 'fill_null') {
      step = { id: genId(), type: 'FILL_NULL', params: { FILL_NULL: { column: col ?? data.columns[0], value: '—' } }, description: suggestion.description, rowCountBefore: data.rows.length, rowCountAfter: data.rows.length, timestamp: Date.now() };
    } else if (suggestion.type === 'remove_duplicates') {
      step = { id: genId(), type: 'REMOVE_DUPLICATES', params: { REMOVE_DUPLICATES: { columns: data.columns } }, description: suggestion.description, rowCountBefore: data.rows.length, rowCountAfter: data.rows.length, timestamp: Date.now() };
    } else if (suggestion.type === 'trim') {
      step = { id: genId(), type: 'TRIM_WHITESPACE', params: { TRIM_WHITESPACE: { columns: suggestion.params!.columns as string[] } }, description: suggestion.description, rowCountBefore: data.rows.length, rowCountAfter: data.rows.length, timestamp: Date.now() };
    } else if (suggestion.type === 'drop_empty_rows') {
      step = { id: genId(), type: 'DROP_EMPTY_ROWS', params: { DROP_EMPTY_ROWS: {} }, description: suggestion.description, rowCountBefore: data.rows.length, rowCountAfter: data.rows.length, timestamp: Date.now() };
    } else if (suggestion.type === 'normalize_type') {
      const targetType = (suggestion.params?.targetType as 'string' | 'number') ?? 'string';
      step = { id: genId(), type: 'CONVERT_TYPE', params: { CONVERT_TYPE: { column: col!, targetType } }, description: suggestion.description, rowCountBefore: data.rows.length, rowCountAfter: data.rows.length, timestamp: Date.now() };
    } else if (suggestion.type === 'merge_redundant_columns') {
      const cols = (suggestion.params?.columns as string[]) ?? [];
      const newName = (suggestion.params?.newColumnName as string) ?? (cols[0] ?? '');
      step = { id: genId(), type: 'COALESCE_COLUMNS', params: { COALESCE_COLUMNS: { columns: cols, newColumnName: newName } }, description: suggestion.description, rowCountBefore: data.rows.length, rowCountAfter: data.rows.length, timestamp: Date.now() };
    } else {
      step = { id: genId(), type: 'DROP_EMPTY_ROWS', params: { DROP_EMPTY_ROWS: {} }, description: suggestion.description, rowCountBefore: data.rows.length, rowCountAfter: data.rows.length, timestamp: Date.now() };
    }
    return applyStep(data, step as Parameters<typeof applyStep>[1], { formulaEvaluator: evaluateAllFormulas });
  }

  const handleRemoveUploaded = (id: string) => {
    sourceFilesRef.current.delete(id);
    setUploadedTables((prev) => prev.filter((t) => t.id !== id));
    setPendingAction(null);
  };

  const displayTable = currentTable ?? (uploadedTables.length === 1 ? uploadedTables[0].data : null);

  return (
    <div className="guided-merge-view">
      <aside className="guided-left">
        <section className="guided-upload-section">
          <h3>上传多表（用于合并）</h3>
          <div className="guided-upload-zone">
            <label className="guided-upload-btn">
              <input type="file" accept=".csv,.xlsx,.xls" multiple onChange={handleMultiUpload} />
              选择多个文件
            </label>
            {uploadedTables.length > 0 && (
              <>
                <ul className="guided-upload-list">
                  {uploadedTables.map((t) => (
                    <li key={t.id}>
                      <span>{t.name}</span> <span className="meta">{t.data.rows.length} 行 × {t.data.columns.length} 列</span>
                      <button type="button" onClick={() => handleRemoveUploaded(t.id)}>移除</button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="guided-check-update-btn"
                  onClick={checkSourceUpdates}
                  disabled={checkingUpdate}
                >
                  {checkingUpdate ? '检查中…' : '检查源文件更新'}
                </button>
              </>
            )}
          </div>
          {uploadError && <p className="guided-upload-error">{uploadError}</p>}
        </section>

        {sourceUpdateReminder && (
          <section className="guided-source-update-reminder" role="alert">
            <h4 className="guided-source-update-title">源文件已更新</h4>
            <p className="guided-source-update-desc">
              检测到以下源文件已变更，是否重新加载并重新确认合并方式？
            </p>
            <ul className="guided-source-update-list">
              {sourceUpdateReminder.updated.map((u) => (
                <li key={u.id}>{u.name}</li>
              ))}
            </ul>
            <div className="guided-source-update-actions">
              <button type="button" className="guided-btn-action primary" onClick={handleReloadSource}>
                重新加载
              </button>
              <button type="button" className="guided-btn-action" onClick={() => setSourceUpdateReminder(null)}>
                暂不
              </button>
            </div>
          </section>
        )}

        <section className="guided-conversation-section">
          <h3>AI 引导</h3>
          <div className="guided-messages">
            {messages.length === 0 && (
              <p className="guided-placeholder">上传表格后，AI 将根据表结构引导您完成合并与清洗，并在关键步骤征求您的确认。</p>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className={`guided-msg guided-msg-${msg.role}`}>
                <div className="guided-msg-avatar">{msg.role === 'ai' ? 'AI' : '我'}</div>
                <div className="guided-msg-content">
                  <div className="guided-msg-text">{msg.content}</div>
                  {msg.meta?.tableSummary && (
                    <div className="guided-msg-meta">
                      {msg.meta.tableSummary.map((s) => (
                        <div key={s.name}>{s.name}：{s.rows} 行 × {s.columns} 列，列：[{s.columnNames.join(', ')}]</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          {pendingAction && (
            <div ref={pendingRef} className="guided-pending guided-pending-sticky" role="region" aria-label="操作引导">
              <p className="guided-pending-label">
                {pendingAction.type === 'single_step' || pendingAction.type === 'fill_null_input'
                  ? '请在此处操作'
                  : '请选择操作'}
              </p>
              {pendingAction.type === 'confirm_merge' && (
                <div className="guided-confirm-card">
                  <p>{pendingAction.message}</p>
                  <div className="guided-confirm-actions">
                    {pendingAction.options.map((opt) => (
                      <button key={opt.value} type="button" onClick={() => handleConfirmMerge(opt.value)}>{opt.label}</button>
                    ))}
                  </div>
                </div>
              )}
              {pendingAction.type === 'choose_join_key' && (
                <div className="guided-confirm-card">
                  <p>{pendingAction.message}</p>
                  <div className="guided-join-row">
                    <label>左表键列</label>
                    <select value={joinLeftKey} onChange={(e) => setJoinLeftKey(e.target.value)}>
                      {pendingAction.leftColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <label>右表键列</label>
                    <select value={joinRightKey} onChange={(e) => setJoinRightKey(e.target.value)}>
                      {pendingAction.rightColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button type="button" onClick={() => pendingAction.onConfirm(joinLeftKey, joinRightKey)}>确认合并</button>
                  </div>
                </div>
              )}
              {pendingAction.type === 'confirm_clean' && (
                <div className="guided-confirm-card guided-confirm-clean">
                  <h4 className="guided-confirm-title">{pendingAction.message}</h4>
                  {pendingAction.steps.length > 0 && (
                    <ol className="guided-issue-list">
                      {pendingAction.steps.map((s, i) => (
                        <li key={s.id}>{s.description}</li>
                      ))}
                    </ol>
                  )}
                  <p className="guided-confirm-hint">请选择下方一种操作：</p>
                  <div className="guided-confirm-actions">
                    {pendingAction.options.map((opt) => (
                      <button key={opt.value} type="button" className="guided-btn-action" onClick={() => handleConfirmClean(opt.value)}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {pendingAction.type === 'single_step' && (
                <div className="guided-confirm-card guided-single-step">
                  <h4 className="guided-confirm-title">
                    第 {pendingAction.stepIndex + 1} / {pendingAction.totalSteps} 项
                  </h4>
                  <p className="guided-issue-desc">{pendingAction.step.description}</p>
                  <p className="guided-guidance">{pendingAction.guidance}</p>
                  <div className="guided-confirm-actions guided-confirm-primary" role="group" aria-label="主操作">
                    <button type="button" className="guided-btn-action primary" onClick={pendingAction.onExecute} aria-label="执行当前建议">
                      执行建议
                    </button>
                    <button type="button" className="guided-btn-action" onClick={pendingAction.onSkip} aria-label="跳过当前项">
                      跳过此项
                    </button>
                  </div>
                  <div className="guided-confirm-secondary" role="group" aria-label="其他操作">
                    <button type="button" className="guided-btn-link" onClick={pendingAction.onExecuteAll}>
                      一键执行剩余全部
                    </button>
                    <span className="guided-confirm-sep">|</span>
                    <button type="button" className="guided-btn-link" onClick={pendingAction.onSkipAll}>
                      暂不清洗
                    </button>
                  </div>
                </div>
              )}
              {pendingAction.type === 'fill_null_input' && (
                <div className="guided-confirm-card guided-fill-card">
                  <h4 className="guided-confirm-title">{pendingAction.message}</h4>
                  <p className="guided-confirm-hint">填写后点击「确认」执行；留空则使用「—」。</p>
                  <div className="guided-fill-row">
                    <input value={fillNullValue} onChange={(e) => setFillNullValue(e.target.value)} placeholder="填充值" />
                    <button type="button" className="guided-btn-action primary" onClick={() => pendingAction.onConfirm(fillNullValue.trim() || '—')}>
                      确认
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </aside>

      <main ref={previewRef} className="guided-right" tabIndex={-1} aria-label="当前表格预览">
        <section className="guided-table-section">
          <h3>当前表格预览</h3>
          {displayTable ? (
            <>
              <div className="guided-table-meta">{displayTable.rows.length} 行 × {displayTable.columns.length} 列</div>
              <div ref={tableScrollRef} className="guided-table-scroll">
                <DataTable data={displayTable} highlightedColumns={previewFocusedColumns} />
              </div>
            </>
          ) : (
            <p className="guided-preview-placeholder">上传并合并表格后，此处将显示当前表预览。</p>
          )}
        </section>
      </main>
    </div>
  );
}


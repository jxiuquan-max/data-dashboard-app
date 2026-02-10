/**
 * DataFixer：基于合并后的 DataFrame + health_manifest 的交互式预览与修复
 * - Demo 使用普通滚动表格（万行虚拟滚动已暂停，数据量不大时更简单）
 * - 表格高亮（structural 红 + 图标，business 黄）
 * - 智能引导侧边栏 + 单元格气泡（忽略、填值、删除该行）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Info, Trash2, X } from 'lucide-react';

const ROW_HEIGHT = 40;
const TABLE_MIN_HEIGHT = 400;
const COL_MIN_WIDTH = 100;
const ROW_NUM_WIDTH = 40;

export interface HealthError {
  row_index: number;
  col_name: string;
  error_type: string;
  severity: 'structural' | 'business';
  message?: string;
}

export interface HealthManifest {
  errors: HealthError[];
  summary: string;
  counts?: Record<string, number>;
}

export interface MergedData {
  columns: string[];
  rows: Record<string, string | null>[];
}

export interface DataFixerProps {
  data: MergedData;
  healthManifest: HealthManifest;
  onDataChange?: (rows: Record<string, string | null>[]) => void;
  /** 当未忽略且未修复的错误数降为 0 时触发 */
  onStandardizationComplete?: () => void;
  /** 实时回传未忽略且未修复的错误剩余数（用于进度展示 / AI 文案） */
  onProgress?: (remaining: number) => void;
  /** 当前高亮的错误项变化时回传，供 AIChatBanner 绑定引导文案 */
  onActiveErrorChange?: (error: HealthError | null) => void;
  /** 用户点击「忽略」时回传 (col_name, value)，供同步更新后应用到新数据 */
  onIgnoredAdd?: (item: { col_name: string; value: string | null }) => void;
  /** 同步更新后传入的旧忽略列表（按 col_name + value 匹配），尝试应用到新 errors */
  initialIgnoredSignatures?: Array<{ col_name: string; value: string | null }>;
}

/** 供 AIChatBanner 等使用：根据当前错误生成引导文案（含专业规则深度文案） */
export function getGuideCopy(error: HealthError): string {
  const { error_type, col_name, severity, message } = error;
  if (error_type === 'null_structural') {
    return `哎呀，这几行数据在合并时发现原始文件缺少了「${col_name}」列，需要手动核实吗？`;
  }
  if (error_type === 'null_business') {
    return `这里「${col_name}」是空的，要填一个值还是先忽略？`;
  }
  if (error_type === 'type_inconsistent') {
    return `「${col_name}」列本应是数字，这里填了别的，要改成数字吗？`;
  }
  if (error_type === 'duplicate') {
    return `这条和前面的「${col_name}」重复啦，要删掉这条还是保留？`;
  }
  if (error_type === 'outlier') {
    return `这个数值远超该列的平均水平（异常值），您确认它是正确的吗？可忽略或修正。`;
  }
  if (error_type === 'pattern_mismatch') {
    return `「${col_name}」格式不符合预期（如日期、邮箱等），请统一格式或忽略。`;
  }
  if (error_type === 'constraint_violation') {
    return `此处列间逻辑不满足约束（${col_name}），请核对或忽略。`;
  }
  return severity === 'structural' ? `此处为结构性异常（${col_name}），建议检查。` : (message || `此处需要处理：${col_name}。`);
}

function isCellFilled(val: string | null | undefined): boolean {
  return val != null && String(val).trim() !== '';
}
function isNumeric(val: string | null | undefined): boolean {
  if (!isCellFilled(val)) return false;
  const n = Number(String(val).trim());
  return Number.isFinite(n);
}

function sigKey(col: string, val: string | null): string {
  return `${col}\t${val ?? ''}`;
}

export function DataFixer({ data, healthManifest, onDataChange, onStandardizationComplete, onProgress, onActiveErrorChange, onIgnoredAdd, initialIgnoredSignatures }: DataFixerProps) {
  const { columns, rows } = data;
  const { errors, summary } = healthManifest;
  const [currentErrorIndex, setCurrentErrorIndex] = useState(0);
  const [selectedCell, setSelectedCell] = useState<{ rowIndex: number; colName: string } | null>(null);
  const [popoverAnchor, setPopoverAnchor] = useState<{ x: number; y: number } | null>(null);
  const [ignoredSet, setIgnoredSet] = useState<Set<string>>(new Set());
  const errorKey = (r: number, c: string) => `${r}-${c}`;

  const prevSignaturesRef = useRef<Array<{ col_name: string; value: string | null }> | undefined>(undefined);
  const initialSet = useMemo(() => {
    if (!initialIgnoredSignatures?.length) return new Set<string>();
    const sigSet = new Set(initialIgnoredSignatures.map((s) => sigKey(s.col_name, s.value)));
    const toAdd = new Set<string>();
    errors.forEach((e) => {
      const val = rows[e.row_index]?.[e.col_name] ?? null;
      if (sigSet.has(sigKey(e.col_name, val))) toAdd.add(errorKey(e.row_index, e.col_name));
    });
    return toAdd;
  }, [errors, rows, initialIgnoredSignatures]);
  useEffect(() => {
    if (initialIgnoredSignatures === prevSignaturesRef.current) return;
    prevSignaturesRef.current = initialIgnoredSignatures;
    if (initialSet.size > 0) setIgnoredSet((s) => new Set([...s, ...initialSet]));
  }, [initialIgnoredSignatures, initialSet]);
  const [fillValue, setFillValue] = useState('');
  const tableBodyRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const tableTotalWidth = ROW_NUM_WIDTH + columns.length * COL_MIN_WIDTH;
  const errorMap = useMemo(() => {
    const m = new Map<string, HealthError>();
    errors.forEach((e) => m.set(errorKey(e.row_index, e.col_name), e));
    return m;
  }, [errors]);

  const visibleErrors = useMemo(
    () => errors.filter((e) => !ignoredSet.has(errorKey(e.row_index, e.col_name))),
    [errors, ignoredSet]
  );

  /** 未忽略且未修复的错误：忽略的不算；行已删除的不算；空值已填、类型已改为数字的不算；outlier/pattern/constraint 仅忽略后不算 */
  const remainingErrorCount = useMemo(() => {
    return errors.filter((e) => {
      if (ignoredSet.has(errorKey(e.row_index, e.col_name))) return false;
      if (e.row_index >= rows.length) return false;
      const row = rows[e.row_index];
      const val = row?.[e.col_name];
      if (e.error_type === 'null_structural' || e.error_type === 'null_business')
        return !isCellFilled(val);
      if (e.error_type === 'type_inconsistent') return isCellFilled(val) && !isNumeric(val);
      if (e.error_type === 'duplicate') return true;
      if (e.error_type === 'outlier' || e.error_type === 'pattern_mismatch' || e.error_type === 'constraint_violation') return true;
      return true;
    }).length;
  }, [errors, ignoredSet, rows]);

  useEffect(() => {
    onProgress?.(remainingErrorCount);
  }, [remainingErrorCount, onProgress]);

  useEffect(() => {
    if (remainingErrorCount === 0 && onStandardizationComplete) onStandardizationComplete();
  }, [remainingErrorCount, onStandardizationComplete]);

  const currentError = visibleErrors[currentErrorIndex] ?? null;

  useEffect(() => {
    onActiveErrorChange?.(currentError ?? null);
  }, [currentError, onActiveErrorChange]);

  const scrollToCell = useCallback((rowIndex: number, colName: string) => {
    const rowEl = tableBodyRef.current?.querySelector(
      `[data-row-index="${rowIndex}"]`
    ) as HTMLElement | null;
    if (rowEl) {
      rowEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    const tryFocus = () => {
      const cellEl = document.querySelector(
        `[data-cell="${rowIndex}-${CSS.escape(colName)}"]`
      ) as HTMLElement | null;
      if (!cellEl) return;
      const container = scrollContainerRef.current;
      if (container) {
        const cellRect = cellEl.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        let nextScrollLeft = container.scrollLeft;
        if (cellRect.left < containerRect.left) {
          nextScrollLeft -= containerRect.left - cellRect.left;
        } else if (cellRect.right > containerRect.right) {
          nextScrollLeft += cellRect.right - containerRect.right;
        }
        container.scrollLeft = Math.max(0, Math.min(nextScrollLeft, container.scrollWidth - container.clientWidth));
      }
      cellEl.focus({ preventScroll: true });
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setTimeout(tryFocus, 80));
    });
  }, []);

  const handleFixNext = useCallback(() => {
    if (currentErrorIndex < visibleErrors.length - 1) {
      const next = visibleErrors[currentErrorIndex + 1];
      setCurrentErrorIndex((i) => i + 1);
      scrollToCell(next.row_index, next.col_name);
    } else if (visibleErrors.length > 0) {
      setCurrentErrorIndex(0);
      const first = visibleErrors[0];
      scrollToCell(first.row_index, first.col_name);
    }
  }, [currentErrorIndex, visibleErrors, scrollToCell]);

  const handleCellClick = useCallback(
    (rowIndex: number, colName: string, e: React.MouseEvent) => {
      setSelectedCell({ rowIndex, colName });
      setPopoverAnchor({ x: e.clientX, y: e.clientY });
      setFillValue(String(rows[rowIndex]?.[colName] ?? '').trim());
    },
    [rows]
  );

  const handleIgnore = useCallback(() => {
    if (selectedCell) {
      setIgnoredSet((s) => new Set(s).add(errorKey(selectedCell.rowIndex, selectedCell.colName)));
      onIgnoredAdd?.({
        col_name: selectedCell.colName,
        value: rows[selectedCell.rowIndex]?.[selectedCell.colName] ?? null,
      });
    }
    setSelectedCell(null);
    setPopoverAnchor(null);
  }, [selectedCell, rows, onIgnoredAdd]);

  const handleFill = useCallback(() => {
    if (selectedCell == null || onDataChange == null) {
      setPopoverAnchor(null);
      return;
    }
    const next = rows.map((row, i) =>
      i === selectedCell.rowIndex
        ? { ...row, [selectedCell.colName]: fillValue || null }
        : row
    );
    onDataChange(next);
    setIgnoredSet((s) => new Set(s).add(errorKey(selectedCell.rowIndex, selectedCell.colName)));
    onIgnoredAdd?.({ col_name: selectedCell.colName, value: fillValue || null });
    setSelectedCell(null);
    setPopoverAnchor(null);
  }, [selectedCell, fillValue, rows, onDataChange, onIgnoredAdd]);

  const handleDeleteRow = useCallback(() => {
    if (selectedCell == null || onDataChange == null) return;
    const next = rows.filter((_, i) => i !== selectedCell.rowIndex);
    onDataChange(next);
    setSelectedCell(null);
    setPopoverAnchor(null);
  }, [selectedCell, rows, onDataChange]);

  const gridCols = useMemo(
    () => `${ROW_NUM_WIDTH}px repeat(${columns.length}, ${COL_MIN_WIDTH}px)`,
    [columns.length]
  );

  const renderRow = useCallback(
    (index: number) => {
      const row = rows[index];
      if (!row) return null;
      return (
        <div
          key={index}
          data-row-index={index}
          style={{ display: 'grid', gridTemplateColumns: gridCols, height: ROW_HEIGHT, minHeight: ROW_HEIGHT }}
        >
          <div
            className="flex items-center border-b border-r border-[var(--border)] bg-[var(--bg-card)] px-2 text-[var(--text-muted)] shrink-0"
            style={{ width: ROW_NUM_WIDTH, minWidth: ROW_NUM_WIDTH }}
          >
            {index + 1}
          </div>
          {columns.map((col) => {
            const key = errorKey(index, col);
            const err = errorMap.get(key);
            const isStructural = err?.severity === 'structural';
            const isBusiness = err?.severity === 'business';
            const isHighlight =
              currentError?.row_index === index && currentError?.col_name === col;
            return (
              <div
                key={col}
                role="gridcell"
                tabIndex={0}
                data-cell={`${index}-${col}`}
                onClick={(e) => handleCellClick(index, col, e)}
                className={`flex shrink-0 items-center gap-1 truncate border-b border-r border-[var(--border)] px-2 ${
                  isStructural
                    ? 'bg-red-500/20'
                    : isBusiness
                      ? 'bg-amber-500/20'
                      : 'bg-[var(--bg-card)]'
                } ${isHighlight ? 'ring-2 ring-inset ring-[var(--accent)]' : ''} hover:bg-[var(--bg-hover)] cursor-pointer`}
              >
                {isStructural && (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" aria-hidden />
                )}
                <span className="truncate">{row[col] ?? '—'}</span>
              </div>
            );
          })}
        </div>
      );
    },
    [rows, columns, errorMap, currentError, gridCols, handleCellClick]
  );

  return (
    <div className="flex h-full gap-4 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
      {/* 引导侧边栏 */}
      <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-header)] p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--accent)]">
          <Info className="h-4 w-4" />
          修复向导
        </h3>
        <p className="text-xs text-[var(--text-secondary)]">{summary}</p>
        {currentError && (
          <div className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] p-3 text-sm">
            <p className="mb-2 font-medium text-[var(--text-primary)]">
              第 {currentErrorIndex + 1} / {visibleErrors.length} 项
            </p>
            <p className="text-[var(--text-secondary)]">
              {getGuideCopy(currentError)}
            </p>
            <button
              type="button"
              onClick={() => scrollToCell(currentError.row_index, currentError.col_name)}
              className="mt-2 w-full rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
            >
              定位到该单元格
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={handleFixNext}
          disabled={visibleErrors.length === 0}
          className="rounded bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          修复下一项
        </button>
      </aside>

      {/* 普通滚动表格（Demo 数据量不大，万行虚拟滚动已暂停） */}
      <div
        ref={containerRef}
        className="flex min-h-[400px] min-w-0 flex-1 flex-col overflow-hidden"
      >
        <div
          ref={scrollContainerRef}
          className="overflow-auto flex flex-col min-h-0"
          style={{ flex: 1, minHeight: 0 }}
        >
          <div style={{ width: tableTotalWidth, minWidth: tableTotalWidth }}>
            <div
              className="grid shrink-0 border-b border-[var(--border)] bg-[var(--bg-header)]"
              style={{ gridTemplateColumns: gridCols, width: tableTotalWidth }}
            >
              <div
                className="flex h-10 items-center border-r border-[var(--border)] px-2 text-sm font-semibold text-[var(--text-secondary)] shrink-0"
                style={{ width: ROW_NUM_WIDTH, minWidth: ROW_NUM_WIDTH }}
              >
                #
              </div>
              {columns.map((col) => (
                <div
                  key={col}
                  className="flex h-10 shrink-0 items-center truncate border-r border-[var(--border)] px-2 text-sm font-semibold text-[var(--text-secondary)]"
                  style={{ width: COL_MIN_WIDTH, minWidth: COL_MIN_WIDTH }}
                >
                  {col}
                </div>
              ))}
            </div>
            <div
              ref={tableBodyRef}
              style={{ width: tableTotalWidth, minWidth: tableTotalWidth }}
            >
              {rows.map((_, index) => renderRow(index))}
            </div>
          </div>
        </div>
      </div>

      {/* 单元格气泡 */}
      {popoverAnchor && selectedCell && (
        <>
          <div
            className="fixed inset-0 z-40"
            aria-hidden
            onClick={() => {
              setSelectedCell(null);
              setPopoverAnchor(null);
            }}
          />
          <div
            className="fixed z-50 w-56 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3 shadow-lg"
            style={{
              left: Math.min(popoverAnchor.x, window.innerWidth - 240),
              top: Math.min(popoverAnchor.y + 8, window.innerHeight - 180),
            }}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--text-secondary)]">
                第 {selectedCell.rowIndex + 1} 行 · {selectedCell.colName}
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelectedCell(null);
                  setPopoverAnchor(null);
                }}
                className="rounded p-1 hover:bg-[var(--bg-hover)]"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex gap-1">
                <input
                  type="text"
                  value={fillValue}
                  onChange={(e) => setFillValue(e.target.value)}
                  placeholder="手动填值"
                  className="w-full rounded border border-[var(--border)] bg-[var(--bg-page)] px-2 py-1 text-sm text-[var(--text-primary)]"
                />
                <button
                  type="button"
                  onClick={handleFill}
                  className="shrink-0 rounded bg-[var(--accent)] px-2 py-1 text-xs text-white"
                >
                  填值
                </button>
              </div>
              <button
                type="button"
                onClick={handleIgnore}
                className="rounded border border-[var(--border)] px-2 py-1 text-left text-xs hover:bg-[var(--bg-hover)]"
              >
                忽略
              </button>
              {onDataChange && (
                <button
                  type="button"
                  onClick={handleDeleteRow}
                  className="flex items-center gap-1 rounded border border-red-500/50 px-2 py-1 text-left text-xs text-red-400 hover:bg-red-500/10"
                >
                  <Trash2 className="h-3 w-3" />
                  删除该行
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

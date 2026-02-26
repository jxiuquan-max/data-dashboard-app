/**
 * 数据画布：ag-grid 全屏表格，右键 AI 菜单、影子数据与一键确认
 * AI 交互入口统一在右侧侧边栏
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AgGridProvider } from 'ag-grid-react';
import { AllCommunityModule } from 'ag-grid-community';
import type { ColDef, CellContextMenuEvent, CellClickedEvent, CellValueChangedEvent } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';

// 部署基因：生产用 VITE_API_BASE_URL，本地用 5001（不带 /api 前缀）
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const isProd = import.meta.env.PROD;
const FINAL_API_URL = isProd ? API_BASE : 'http://127.0.0.1:5001';

export type AITaskType = 'format_fix' | 'fill_missing' | 'summary_translate' | 'scan_all';

export interface DataCanvasProps {
  rowData: Record<string, string | null>[] | any[];
  onDataChange?: (rows: any[]) => void;
  /** 左侧联动：Agent 处理某列时高亮 */
  highlightedColumn?: string | null;
  /** 冲突行索引：画布滚动到该行 */
  conflictRowIndex?: number | null;
  /** 维度增强：本次合并新增的列名，表头浅蓝 + 新增维度标签 */
  newColumns?: string[];
  /** 用户点击「查看变更详情」时临时高亮的单元格，null 表示不高亮 */
  highlightedConflictCells?: Array<{ rowIndex: number; colKey: string }> | null;
  /** 数据体检：乱码单元格，红色背景 */
  highlightedDirtyCells?: Array<{ rowIndex: number; colKey: string }> | null;
  /** 数据体检：名称微差单元格，黄色边框闪烁 */
  highlightedIdentityGapCells?: Array<{ rowIndex: number; colKey: string }> | null;
  /** 数据体检：空值单元格，浅橙背景 */
  highlightedEmptyCells?: Array<{ rowIndex: number; colKey: string }> | null;
  /** 审计错误行索引，整行淡红背景 */
  auditErrorRowIndices?: number[] | null;
}

interface PendingChange {
  suggestedValue: string;
  task: AITaskType;
}

const modules = [AllCommunityModule];

/** 空白画布：26 列 A-Z，100 行占位数据 */
const PLACEHOLDER_COLUMNS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
const PLACEHOLDER_ROWS: Record<string, string>[] = Array.from({ length: 100 }, () =>
  Object.fromEntries(PLACEHOLDER_COLUMNS.map((c) => [c, '']))
);

const AI_MENU_ITEMS: { key: AITaskType; label: string }[] = [
  { key: 'format_fix', label: '✨ AI 格式纠错' },
  { key: 'fill_missing', label: '🔍 AI 补全缺失值' },
  { key: 'summary_translate', label: '📊 AI 摘要/翻译' },
];

/** 纯数值列黑名单：不在这些列上显示橙色警告三角，防止误报 */
const NUMERIC_COL_BLACKLIST = new Set([
  '销售数量', '成本价', '售价', '销售总额', '商品总成本', '销售利润',
]);

/** 变更提醒：不展示为列的元数据字段 */
const DIFF_META_KEYS = new Set(['_diffStatus', '_diffChangedCols']);

/** 行号列：模拟 Excel 左侧边栏 */
const ROW_NUM_COL_DEF: ColDef = {
  headerName: '',
  colId: '__rowNum',
  width: 48,
  minWidth: 48,
  maxWidth: 48,
  pinned: 'left',
  sortable: false,
  filter: false,
  editable: false,
  suppressMovable: true,
  cellStyle: { backgroundColor: '#f8fafc', color: '#64748b', fontWeight: 500 },
  headerClass: 'ag-row-num-header',
  valueGetter: (params) => (params.node?.rowIndex ?? 0) + 1,
};

interface CellContext {
  pendingChanges: Map<string, PendingChange>;
}

function PendingIndicatorCellRenderer(props: {
  value: string | null;
  node?: { rowIndex?: number };
  colDef?: { field?: string };
  data?: Record<string, unknown>;
  context?: CellContext;
}) {
  const { value, node, colDef, data, context } = props;
  const rowIndex = node?.rowIndex ?? 0;
  const colKey = colDef?.field ?? '';
  const displayValue = value ?? data?.[colKey] ?? '';
  const pendingChanges = context?.pendingChanges ?? new Map();
  const key = `${rowIndex}-${colKey}`;
  const pending = pendingChanges.get(key);
  if (!pending || NUMERIC_COL_BLACKLIST.has(colKey)) {
    return <span className="block truncate w-full">{String(displayValue ?? '')}</span>;
  }
  return (
    <div className="relative w-full h-full min-h-[1.5em]">
      <span className="block truncate pr-3 w-full" style={{ lineHeight: '1.5em' }}>
        {String(displayValue ?? '')}
      </span>
      <span
        className="absolute top-0 right-0 w-0 h-0 pointer-events-none"
        style={{
          borderLeft: '8px solid transparent',
          borderTop: '8px solid #ea580c',
        }}
        title="点击单元格确认 AI 建议"
      />
    </div>
  );
}

export default function DataCanvas({ rowData, onDataChange, highlightedColumn, conflictRowIndex, newColumns = [], highlightedConflictCells = null, highlightedDirtyCells = null, highlightedIdentityGapCells = null, highlightedEmptyCells = null, auditErrorRowIndices = null }: DataCanvasProps) {
  const gridRef = useRef<AgGridReact>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    rowIndex: number;
    colKey: string;
    value: string | null;
    row: any;
  } | null>(null);
  const [pendingChanges, setPendingChanges] = useState<Map<string, PendingChange>>(new Map());
  const [aiLoading, setAiLoading] = useState<string | null>(null);

  const rows = useMemo(() => (Array.isArray(rowData) ? rowData : []), [rowData]);
  /** 无真实数据时显示空白画布，有数据时无缝替换 */
  const displayRows = useMemo(
    () => (rows.length > 0 ? rows : PLACEHOLDER_ROWS),
    [rows]
  );
  const isPlaceholder = rows.length === 0;

  /** 冲突行变化时滚动到该行 */
  useEffect(() => {
    if (conflictRowIndex == null || conflictRowIndex < 0) return;
    const api = gridRef.current?.api;
    if (!api) return;
    api.ensureIndexVisible(conflictRowIndex, 'middle');
  }, [conflictRowIndex]);

  useEffect(() => {
    if (rows.length === 0) return;
    const url = `${FINAL_API_URL}/ai-task`;
    console.log('[DataCanvas] Auto-Scan: 开始全表体检', { url, rowCount: rows.length });
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'scan_all', rows }),
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data: { issues?: Array<{ rowIndex: number; colKey: string; suggested_value: string }> }) => {
        const issues = data?.issues ?? [];
        const filtered = issues.filter((it) => !NUMERIC_COL_BLACKLIST.has(it.colKey));
        console.log('[DataCanvas] Auto-Scan: 完成', { issueCount: issues.length, filteredCount: filtered.length });
        if (filtered.length > 0) {
          setPendingChanges((prev) => {
            const next = new Map(prev);
            for (const it of filtered) {
              next.set(`${it.rowIndex}-${it.colKey}`, {
                suggestedValue: it.suggested_value,
                task: 'format_fix',
              });
            }
            return next;
          });
          setTimeout(() => gridRef.current?.api?.refreshCells({ force: true }), 0);
        }
      })
      .catch((e) => {
        console.warn('[DataCanvas] Auto-Scan: 失败', e);
      });
  }, [rows]);

  const handleCellContextMenu = useCallback((event: CellContextMenuEvent) => {
    event.event?.preventDefault();
    const col = event.column?.getColId();
    if (!col || col === '_empty' || col === '__rowNum') return;
    const rowIndex = event.rowIndex ?? -1;
    const row = event.data;
    const value = event.value ?? row?.[col] ?? null;
    setContextMenu({
      x: event.event?.clientX ?? 0,
      y: event.event?.clientY ?? 0,
      rowIndex,
      colKey: col,
      value: value != null ? String(value) : null,
      row: row ?? {},
    });
  }, []);

  const runAITask = useCallback(
    async (task: AITaskType) => {
      if (!contextMenu) return;
      const { rowIndex, colKey, value, row } = contextMenu;
      setAiLoading(task);
      setContextMenu(null);
      const url = `${FINAL_API_URL}/ai-task`;
      const body = JSON.stringify({ task, rowIndex, colKey, value, row });
      console.log('[DataCanvas] AI 任务请求', { url, task, rowIndex, colKey });
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        console.log('[DataCanvas] AI 任务响应', { status: res.status, ok: res.ok });
        if (!res.ok) {
          const errText = await res.text();
          const msg = res.status === 404 ? '接口不存在 (404)，请确认后端已启动' : errText || `请求失败 (${res.status})`;
          throw new Error(msg);
        }
        const data = (await res.json()) as { suggested_value?: string };
        const suggested = data?.suggested_value;
        if (suggested != null && suggested !== String(value ?? '') && !NUMERIC_COL_BLACKLIST.has(colKey)) {
          setPendingChanges((prev) => {
            const next = new Map(prev);
            next.set(`${rowIndex}-${colKey}`, { suggestedValue: suggested, task });
            return next;
          });
          gridRef.current?.api?.refreshCells({ force: true });
        }
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        const msg = err.name === 'TypeError' && err.message.includes('fetch')
          ? '网络错误，请确认后端服务已启动 (端口 5001)'
          : err.message;
        window.alert(`AI 任务失败：${msg}`);
        console.error('[DataCanvas] AI task failed:', err);
      } finally {
        setAiLoading(null);
      }
    },
    [contextMenu]
  );

  const handleCellClicked = useCallback(
    (event: CellClickedEvent) => {
      const col = event.column?.getColId();
      if (!col || col === '_empty' || col === '__rowNum') return;
      const rowIndex = event.rowIndex ?? -1;
      const key = `${rowIndex}-${col}`;
      const pending = pendingChanges.get(key);
      if (!pending) return;
      const ok = window.confirm(`AI 建议将此值改为 ${pending.suggestedValue}，是否接受？`);
      if (ok && onDataChange) {
        const nextRows = displayRows.map((r, i) => {
          if (i !== rowIndex) return r;
          return { ...r, [col]: pending.suggestedValue };
        });
        onDataChange(nextRows);
        setPendingChanges((prev) => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
        gridRef.current?.api?.refreshCells({ force: true });
      } else if (!ok) {
        setPendingChanges((prev) => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
        gridRef.current?.api?.refreshCells({ force: true });
      }
    },
    [pendingChanges, displayRows, onDataChange]
  );

  const handleCellValueChanged = useCallback(
    (event: CellValueChangedEvent) => {
      if (!onDataChange) return;
      const rowIndex = event.rowIndex ?? -1;
      const col = event.column?.getColId();
      if (col == null || rowIndex < 0 || col === '__rowNum') return;
      const newValue = event.newValue;
      const nextRows = displayRows.map((r, i) => {
        if (i !== rowIndex) return r;
        return { ...r, [col]: newValue };
      });
      onDataChange(nextRows);
    },
    [displayRows, onDataChange]
  );

  const columnDefs = useMemo<ColDef[]>(() => {
    const highlightClass = highlightedColumn ? 'ag-column-highlight' : '';
    const dataCols: ColDef[] = isPlaceholder
      ? PLACEHOLDER_COLUMNS.map((field) => ({
          field,
          headerName: field,
          flex: 1,
          minWidth: 80,
          sortable: true,
          filter: true,
          editable: true,
          cellRenderer: PendingIndicatorCellRenderer,
          cellRendererParams: {},
          headerClass: field === highlightedColumn ? highlightClass : '',
          cellClass: field === highlightedColumn ? highlightClass : '',
        }))
      : (() => {
          const first = rows[0];
          const keys =
            typeof first === 'object' && first !== null
              ? Object.keys(first).filter((k) => !DIFF_META_KEYS.has(k))
              : [];
          const newColSet = new Set(newColumns);
          return keys.map((field) => {
            const isNewCol = newColSet.has(field);
            const headerClasses = [
              field === highlightedColumn ? highlightClass : '',
              isNewCol ? 'ag-header-new-column' : '',
            ].filter(Boolean);
            return {
              field,
              headerName: isNewCol ? `${field} ✨ 新增维度` : field,
              flex: 1,
              minWidth: 100,
              sortable: true,
              filter: true,
              editable: true,
              cellRenderer: field === '_empty' ? undefined : PendingIndicatorCellRenderer,
              cellRendererParams: {},
              headerClass: headerClasses.join(' ') || undefined,
              cellClass: field === highlightedColumn ? highlightClass : '',
              cellClassRules: {
                /** 仅用户点击「查看变更详情」时，对 highlightedConflictCells 中的单元格临时标红 */
                'ag-cell-price-changed': (params: {
                  node?: { rowIndex?: number };
                  colDef?: { field?: string };
                }) => {
                  if (!highlightedConflictCells?.length) return false;
                  const rowIndex = params.node?.rowIndex ?? -1;
                  const colKey = params.colDef?.field ?? '';
                  return highlightedConflictCells.some((c) => c.rowIndex === rowIndex && c.colKey === colKey);
                },
                /** 审计：报错格子红色加粗边框 */
                'ag-cell-audit-error': (params: {
                  node?: { rowIndex?: number };
                  colDef?: { field?: string };
                }) => {
                  const rowIndex = params.node?.rowIndex ?? -1;
                  const colKey = params.colDef?.field ?? '';
                  const isDirty = highlightedDirtyCells?.some((c) => c.rowIndex === rowIndex && c.colKey === colKey);
                  const isGap = highlightedIdentityGapCells?.some((c) => c.rowIndex === rowIndex && c.colKey === colKey);
                  const isEmpty = highlightedEmptyCells?.some((c) => c.rowIndex === rowIndex && c.colKey === colKey);
                  return !!(isDirty || isGap || isEmpty);
                },
              },
            };
          });
        })();
    return [ROW_NUM_COL_DEF, ...dataCols];
  }, [rows, isPlaceholder, pendingChanges, highlightedColumn, newColumns, highlightedConflictCells, highlightedDirtyCells, highlightedIdentityGapCells, highlightedEmptyCells]);

  const defaultColDef = useMemo<ColDef>(
    () => ({
      resizable: true,
      editable: true,
    }),
    []
  );

  return (
    <AgGridProvider modules={modules}>
      <div className="flex h-full flex-col relative">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            数据画布
          </h2>
        </div>
        <div
          className="ag-theme-alpine w-full h-[calc(100vh-80px)]"
          style={{
            '--ag-font-family': 'inherit',
            '--ag-border-color': 'var(--border)',
            '--ag-header-background-color': 'var(--bg-header)',
            '--ag-odd-row-background-color': 'var(--bg-card)',
            '--ag-row-hover-color': 'var(--bg-hover)',
          } as React.CSSProperties}
        >
          <AgGridReact
            ref={gridRef}
            rowData={displayRows}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            domLayout="normal"
            animateRows
            suppressContextMenu
            suppressNoRowsOverlay
            getRowClass={(params) => {
              if (!auditErrorRowIndices?.length) return undefined;
              const idx = params.node?.rowIndex ?? -1;
              return auditErrorRowIndices.includes(idx) ? 'ag-row-audit-error' : undefined;
            }}
            onCellContextMenu={handleCellContextMenu}
            onCellClicked={handleCellClicked}
            onCellValueChanged={handleCellValueChanged}
            context={{ pendingChanges }}
          />
        </div>

        {contextMenu && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setContextMenu(null)}
              onContextMenu={(e) => e.preventDefault()}
              aria-hidden
            />
            <div
              className="fixed z-50 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] py-1 shadow-lg"
              style={{
                left: contextMenu.x,
                top: contextMenu.y,
                minWidth: 180,
              }}
            >
              {AI_MENU_ITEMS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => runAITask(key)}
                  disabled={!!aiLoading}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  {aiLoading === key ? '处理中…' : label}
                </button>
              ))}
            </div>
          </>
        )}

      </div>
    </AgGridProvider>
  );
}

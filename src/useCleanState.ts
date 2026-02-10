import { useState, useCallback } from 'react';
import type { TableData, CleanStep, CleanOpType, CleanOpParams, MergeType } from './types';
import { applyStep, cloneTable } from './types';
import { evaluateAllFormulas } from './formulaEval';
import { sampleDirtyTable } from './sampleData';

const formulaEvaluator = evaluateAllFormulas;

/** 生成步骤描述（用于 AI 还原展示） */
export function stepDescription(type: CleanOpType, params: CleanOpParams): string {
  switch (type) {
    case 'DELETE_ROW':
      return `删除第 ${(params.DELETE_ROW!.rowIndex + 1)} 行`;
    case 'FILL_NULL':
      return `将列「${params.FILL_NULL!.column}」的空值填充为「${params.FILL_NULL!.value}」`;
    case 'REMOVE_DUPLICATES':
      return `按列 [${params.REMOVE_DUPLICATES!.columns.join(', ')}] 去重`;
    case 'RENAME_COLUMN':
      return `将列「${params.RENAME_COLUMN!.oldName}」重命名为「${params.RENAME_COLUMN!.newName}」`;
    case 'TRIM_WHITESPACE':
      return `去除列 [${params.TRIM_WHITESPACE!.columns.join(', ')}] 的首尾空格`;
    case 'DROP_COLUMN':
      return `删除列「${params.DROP_COLUMN!.column}」`;
    case 'FILTER_ROWS': {
      const p = params.FILTER_ROWS!;
      const opLabels: Record<string, string> = {
        not_empty: '保留非空',
        empty: '保留空',
        eq: `等于 ${p.value ?? ''}`,
        ne: `不等于 ${p.value ?? ''}`,
        contains: `包含 ${p.value ?? ''}`,
        gt: `大于 ${p.value ?? ''}`,
        gte: `大于等于 ${p.value ?? ''}`,
        lt: `小于 ${p.value ?? ''}`,
        lte: `小于等于 ${p.value ?? ''}`,
        regex: `匹配正则 ${p.value ?? ''}`,
      };
      const opText = opLabels[p.operator] ?? `${p.operator} ${p.value ?? ''}`;
      return `按列「${p.column}」过滤：${opText}`;
    }
    case 'NORMALIZE_CASE':
      return `将列「${params.NORMALIZE_CASE!.column}」统一为${params.NORMALIZE_CASE!.mode === 'upper' ? '大写' : '小写'}`;
    case 'REPLACE_VALUE':
      return `将列「${params.REPLACE_VALUE!.column}」中的「${params.REPLACE_VALUE!.from}」替换为「${params.REPLACE_VALUE!.to}」`;
    case 'MERGE_TABLES': {
      const p = params.MERGE_TABLES!;
      const name = p.rightTableName ?? '右表';
      const mergeLabels: Record<MergeType, string> = {
        union: '纵向合并(Union)',
        inner_join: '内连接(Inner Join)',
        left_join: '左连接(Left Join)',
        right_join: '右连接(Right Join)',
        full_join: '全外连接(Full Join)',
      };
      const label = mergeLabels[p.mergeType];
      if (p.mergeType === 'union') return `与「${name}」${label}`;
      const keys =
        p.leftKeys?.length && p.rightKeys?.length
          ? ` 按 [${p.leftKeys.join(', ')}] = [${p.rightKeys.join(', ')}]`
          : '';
      return `与「${name}」${label}${keys}`;
    }
    case 'CONVERT_TYPE':
      return `将列「${params.CONVERT_TYPE!.column}」转为${params.CONVERT_TYPE!.targetType === 'string' ? '字符串' : params.CONVERT_TYPE!.targetType === 'number' ? '数字' : '布尔'}`;
    case 'SPLIT_COLUMN': {
      const p = params.SPLIT_COLUMN!;
      return `将列「${p.column}」按「${p.separator}」拆分为 [${p.newColumnNames.join(', ')}]`;
    }
    case 'CONCAT_COLUMNS': {
      const p = params.CONCAT_COLUMNS!;
      return `将列 [${p.columns.join(', ')}] 合并为「${p.newColumn}」${p.separator ? `（分隔符: ${p.separator}）` : ''}`;
    }
    case 'SORT_ROWS': {
      const by = params.SORT_ROWS!.by;
      return `按 [${by.map((b) => `${b.column} ${b.order === 'desc' ? '降序' : '升序'}`).join(', ')}] 排序`;
    }
    case 'ADD_COLUMN':
      return `添加列「${params.ADD_COLUMN!.column}」= ${params.ADD_COLUMN!.value}`;
    case 'MAP_VALUES': {
      const p = params.MAP_VALUES!;
      const entries = Object.entries(p.mapping).slice(0, 3).map(([k, v]) => `${k}→${v}`);
      const more = Object.keys(p.mapping).length > 3 ? '…' : '';
      return `列「${p.column}」值映射：${entries.join(', ')}${more}`;
    }
    case 'SLICE_ROWS': {
      const p = params.SLICE_ROWS!;
      return p.mode === 'head' ? `保留前 ${p.count} 行` : `保留后 ${p.count} 行`;
    }
    case 'SAMPLE_ROWS':
      return `随机抽样 ${params.SAMPLE_ROWS!.count} 行`;
    case 'COLLAPSE_WHITESPACE':
      return `将列 [${params.COLLAPSE_WHITESPACE!.columns.join(', ')}] 中连续空格压成单个`;
    case 'DROP_EMPTY_ROWS': {
      const cols = params.DROP_EMPTY_ROWS!.columns;
      return cols?.length ? `删除列 [${cols.join(', ')}] 全为空的行` : '删除整行为空的行';
    }
    case 'REORDER_COLUMNS':
      return `调整列顺序为 [${params.REORDER_COLUMNS!.columnOrder.join(', ')}]`;
    case 'EVALUATE_FORMULAS': {
      const cols = params.EVALUATE_FORMULAS!.columns;
      return cols?.length ? `对列 [${cols.join(', ')}] 公式求值` : '对全部公式求值';
    }
    case 'REMOVE_FORMULAS': {
      const p = params.REMOVE_FORMULAS!;
      const placeholder = p.placeholder != null ? `替换为「${p.placeholder}」` : '替换为空';
      return p.columns?.length ? `移除列 [${p.columns.join(', ')}] 的公式（${placeholder}）` : `移除全部公式（${placeholder}）`;
    }
    case 'FORMULA_AUDIT':
      return `公式审计：新增列「${params.FORMULA_AUDIT!.outputColumn ?? '含公式'}」标记含公式的行`;
    default:
      return String(type);
  }
}

function genId(): string {
  return `step_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function useCleanState(initialTable: TableData = sampleDirtyTable) {
  const [table, setTable] = useState<TableData>(cloneTable(initialTable));
  const [history, setHistory] = useState<CleanStep[]>([]);
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [replayLog, setReplayLog] = useState<string[]>([]);

  const addStep = useCallback((type: CleanOpType, params: CleanOpParams) => {
    const rowCountBefore = table.rows.length;
    const step: CleanStep = {
      id: genId(),
      type,
      params,
      description: stepDescription(type, params),
      rowCountBefore,
      rowCountAfter: rowCountBefore,
      timestamp: Date.now(),
    };
    const nextTable = applyStep(table, step, { formulaEvaluator });
    step.rowCountAfter = nextTable.rows.length;
    setTable(nextTable);
    setHistory((h) => [...h, step]);
    setReplayIndex(null);
    setReplayLog([]);
  }, [table]);

  const reset = useCallback(() => {
    setTable(cloneTable(initialTable));
    setHistory([]);
    setReplayIndex(null);
    setReplayLog([]);
  }, [initialTable]);

  /** 加载上传的表格数据（替换当前表并清空历史） */
  const loadTable = useCallback((data: TableData) => {
    setTable(cloneTable(data));
    setHistory([]);
    setReplayIndex(null);
    setReplayLog([]);
  }, []);

  /** AI 还原：从初始数据按历史步骤逐步回放 */
  const startReplay = useCallback(() => {
    if (history.length === 0) return;
    setTable(cloneTable(initialTable));
    setReplayIndex(0);
    setReplayLog(['AI 开始还原用户的清洗流程…']);
  }, [history.length, initialTable]);

  const replayNext = useCallback(() => {
    if (replayIndex == null || replayIndex >= history.length) {
      setReplayIndex(null);
      setReplayLog((log) => [...log, 'AI 还原完成。']);
      return;
    }
    const step = history[replayIndex];
    setReplayLog((log) => [...log, `执行：${step.description}`]);
    setTable((t) => applyStep(t, step, { formulaEvaluator }));
    setReplayIndex((i) => (i! + 1 >= history.length ? null : i! + 1));
  }, [history, replayIndex]);

  const replayAll = useCallback(() => {
    if (history.length === 0) return;
    setTable(cloneTable(initialTable));
    setReplayLog(['AI 开始一次性还原全部步骤…']);
    let t = cloneTable(initialTable);
    const logs: string[] = [];
    for (const step of history) {
      logs.push(`执行：${step.description}`);
      t = applyStep(t, step, { formulaEvaluator });
    }
    setTable(t);
    setReplayIndex(null);
    setReplayLog(logs);
  }, [history, initialTable]);

  return {
    table,
    history,
    replayIndex,
    replayLog,
    addStep,
    reset,
    loadTable,
    startReplay,
    replayNext,
    replayAll,
  };
}

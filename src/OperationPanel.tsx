import { useState, useMemo, useEffect } from 'react';
import type { CleanOpType, TableData, MergeType, FilterOperator } from './types';
import { cloneTable } from './types';
import './OperationPanel.css';

export interface MergeTableOption {
  id: string;
  name: string;
  data: TableData;
}

interface OperationPanelProps {
  columns: string[];
  rowCount: number;
  onAddStep: (type: CleanOpType, params: Record<string, unknown>) => void;
  /** 可选的“其他表格”列表，用于复杂合并 */
  mergeTableOptions?: MergeTableOption[];
  disabled?: boolean;
}

const MERGE_TYPES: { value: MergeType; label: string }[] = [
  { value: 'union', label: '纵向合并 (Union)' },
  { value: 'inner_join', label: '内连接 (Inner Join)' },
  { value: 'left_join', label: '左连接 (Left Join)' },
  { value: 'right_join', label: '右连接 (Right Join)' },
  { value: 'full_join', label: '全外连接 (Full Join)' },
];

export function OperationPanel({
  columns,
  rowCount,
  onAddStep,
  mergeTableOptions = [],
  disabled,
}: OperationPanelProps) {
  const [deleteRowIndex, setDeleteRowIndex] = useState(1);
  const [fillColumn, setFillColumn] = useState(columns[0] ?? '');
  const [fillValue, setFillValue] = useState('');
  const [renameOld, setRenameOld] = useState(columns[0] ?? '');
  const [renameNew, setRenameNew] = useState('');
  const [dropColumn, setDropColumn] = useState(columns[0] ?? '');
  const [filterColumn, setFilterColumn] = useState(columns[0] ?? '');
  const [replaceColumn, setReplaceColumn] = useState(columns[0] ?? '');
  const [replaceFrom, setReplaceFrom] = useState('');
  const [replaceTo, setReplaceTo] = useState('');
  const [caseColumn, setCaseColumn] = useState(columns[0] ?? '');
  const [caseMode, setCaseMode] = useState<'upper' | 'lower'>('upper');

  const [mergeTableId, setMergeTableId] = useState('');
  const [mergeType, setMergeType] = useState<MergeType>('union');
  const [mergeLeftKey, setMergeLeftKey] = useState(columns[0] ?? '');
  const [mergeRightKey, setMergeRightKey] = useState('');

  const [filterOperator, setFilterOperator] = useState<FilterOperator>('not_empty');
  const [filterValue, setFilterValue] = useState('');
  const [convertColumn, setConvertColumn] = useState(columns[0] ?? '');
  const [convertType, setConvertType] = useState<'string' | 'number' | 'boolean'>('string');
  const [splitColumn, setSplitColumn] = useState(columns[0] ?? '');
  const [splitSeparator, setSplitSeparator] = useState(',');
  const [splitNewNames, setSplitNewNames] = useState('');
  const [concatColumnsStr, setConcatColumnsStr] = useState('');
  const [concatNewColumn, setConcatNewColumn] = useState('');
  const [concatSeparator, setConcatSeparator] = useState('');
  const [sortColumn, setSortColumn] = useState(columns[0] ?? '');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [addColName, setAddColName] = useState('');
  const [addColValue, setAddColValue] = useState('');
  const [mapCol, setMapCol] = useState(columns[0] ?? '');
  const [mapPairsStr, setMapPairsStr] = useState('');
  const [sliceMode, setSliceMode] = useState<'head' | 'tail'>('head');
  const [sliceCount, setSliceCount] = useState(10);
  const [sampleCount, setSampleCount] = useState(10);
  const [reorderStr, setReorderStr] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [formulaPlaceholder, setFormulaPlaceholder] = useState('');
  const [formulaAuditCol, setFormulaAuditCol] = useState('含公式');

  const selectedMergeTable = useMemo(
    () => mergeTableOptions.find((t) => t.id === mergeTableId),
    [mergeTableOptions, mergeTableId]
  );
  const rightColumns = selectedMergeTable?.data.columns ?? [];
  const isJoin = mergeType !== 'union';
  const canMerge =
    selectedMergeTable &&
    (mergeType === 'union' || (mergeLeftKey && mergeRightKey && rightColumns.includes(mergeRightKey)));

  useEffect(() => {
    if (rightColumns.length > 0 && !rightColumns.includes(mergeRightKey)) {
      setMergeRightKey(rightColumns[0]);
    }
  }, [selectedMergeTable?.id, rightColumns, mergeRightKey]);

  useEffect(() => {
    if (columns.length > 0 && !columns.includes(mergeLeftKey)) {
      setMergeLeftKey(columns[0]);
    }
  }, [columns, mergeLeftKey]);

  useEffect(() => {
    if (columns.length > 0) {
      if (!columns.includes(convertColumn)) setConvertColumn(columns[0]);
      if (!columns.includes(splitColumn)) setSplitColumn(columns[0]);
      if (!columns.includes(sortColumn)) setSortColumn(columns[0]);
      if (!columns.includes(mapCol)) setMapCol(columns[0]);
    }
  }, [columns]);

  return (
    <div className="operation-panel">
      <h3 className="panel-title">清洗操作</h3>

      <section className="op-group">
        <label>删除行</label>
        <div className="op-row">
          <input
            type="number"
            min={1}
            max={rowCount}
            value={deleteRowIndex}
            onChange={(e) => setDeleteRowIndex(Number(e.target.value) || 1)}
            disabled={disabled}
          />
          <button
            type="button"
            onClick={() =>
              onAddStep('DELETE_ROW', { DELETE_ROW: { rowIndex: deleteRowIndex - 1 } })
            }
            disabled={disabled || rowCount === 0}
          >
            删除第 {deleteRowIndex} 行
          </button>
        </div>
      </section>

      <section className="op-group">
        <label>填充空值</label>
        <div className="op-row">
          <select
            value={fillColumn}
            onChange={(e) => setFillColumn(e.target.value)}
            disabled={disabled}
          >
            {columns.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input
            placeholder="填充值"
            value={fillValue}
            onChange={(e) => setFillValue(e.target.value)}
            disabled={disabled}
          />
          <button
            type="button"
            onClick={() =>
              onAddStep('FILL_NULL', { FILL_NULL: { column: fillColumn, value: fillValue } })
            }
            disabled={disabled}
          >
            填充
          </button>
        </div>
      </section>

      <section className="op-group">
        <label>去重</label>
        <div className="op-row">
          <button
            type="button"
            onClick={() =>
              onAddStep('REMOVE_DUPLICATES', { REMOVE_DUPLICATES: { columns } })
            }
            disabled={disabled}
          >
            按全部列去重
          </button>
        </div>
      </section>

      <section className="op-group">
        <label>去除首尾空格</label>
        <div className="op-row">
          <button
            type="button"
            onClick={() =>
              onAddStep('TRIM_WHITESPACE', { TRIM_WHITESPACE: { columns } })
            }
            disabled={disabled}
          >
            全部列 Trim
          </button>
        </div>
      </section>

      <section className="op-group">
        <label>重命名列</label>
        <div className="op-row">
          <select
            value={renameOld}
            onChange={(e) => setRenameOld(e.target.value)}
            disabled={disabled}
          >
            {columns.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input
            placeholder="新列名"
            value={renameNew}
            onChange={(e) => setRenameNew(e.target.value)}
            disabled={disabled}
          />
          <button
            type="button"
            onClick={() =>
              onAddStep('RENAME_COLUMN', {
                RENAME_COLUMN: { oldName: renameOld, newName: renameNew || renameOld },
              })
            }
            disabled={disabled || !renameNew.trim()}
          >
            重命名
          </button>
        </div>
      </section>

      <section className="op-group">
        <label>删除列</label>
        <div className="op-row">
          <select
            value={dropColumn}
            onChange={(e) => setDropColumn(e.target.value)}
            disabled={disabled}
          >
            {columns.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() =>
              onAddStep('DROP_COLUMN', { DROP_COLUMN: { column: dropColumn } })
            }
            disabled={disabled}
          >
            删除列
          </button>
        </div>
      </section>

      <section className="op-group">
        <label>过滤行</label>
        <div className="op-row">
          <select
            value={filterColumn}
            onChange={(e) => setFilterColumn(e.target.value)}
            disabled={disabled}
          >
            {columns.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            value={filterOperator}
            onChange={(e) => setFilterOperator(e.target.value as FilterOperator)}
            disabled={disabled}
          >
            <option value="not_empty">保留非空</option>
            <option value="empty">保留空</option>
            <option value="eq">等于</option>
            <option value="ne">不等于</option>
            <option value="contains">包含</option>
            <option value="gt">大于</option>
            <option value="gte">大于等于</option>
            <option value="lt">小于</option>
            <option value="lte">小于等于</option>
            <option value="regex">正则匹配</option>
          </select>
          {!['empty', 'not_empty'].includes(filterOperator) && (
            <input
              placeholder="比较值"
              value={filterValue}
              onChange={(e) => setFilterValue(e.target.value)}
              disabled={disabled}
              style={{ minWidth: 80 }}
            />
          )}
          <button
            type="button"
            onClick={() =>
              onAddStep('FILTER_ROWS', {
                FILTER_ROWS: {
                  column: filterColumn,
                  operator: filterOperator,
                  value: ['empty', 'not_empty'].includes(filterOperator) ? undefined : filterValue,
                },
              })
            }
            disabled={disabled || (!['empty', 'not_empty'].includes(filterOperator) && !filterValue.trim())}
          >
            应用过滤
          </button>
        </div>
      </section>

      <section className="op-group">
        <label>统一大小写</label>
        <div className="op-row">
          <select
            value={caseColumn}
            onChange={(e) => setCaseColumn(e.target.value)}
            disabled={disabled}
          >
            {columns.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            value={caseMode}
            onChange={(e) => setCaseMode(e.target.value as 'upper' | 'lower')}
            disabled={disabled}
          >
            <option value="upper">大写</option>
            <option value="lower">小写</option>
          </select>
          <button
            type="button"
            onClick={() =>
              onAddStep('NORMALIZE_CASE', {
                NORMALIZE_CASE: { column: caseColumn, mode: caseMode },
              })
            }
            disabled={disabled}
          >
            应用
          </button>
        </div>
      </section>

      <section className="op-group">
        <label>替换值</label>
        <div className="op-row">
          <select
            value={replaceColumn}
            onChange={(e) => setReplaceColumn(e.target.value)}
            disabled={disabled}
          >
            {columns.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input
            placeholder="原值"
            value={replaceFrom}
            onChange={(e) => setReplaceFrom(e.target.value)}
            disabled={disabled}
          />
          <input
            placeholder="新值"
            value={replaceTo}
            onChange={(e) => setReplaceTo(e.target.value)}
            disabled={disabled}
          />
          <button
            type="button"
            onClick={() =>
              onAddStep('REPLACE_VALUE', {
                REPLACE_VALUE: {
                  column: replaceColumn,
                  from: replaceFrom,
                  to: replaceTo,
                },
              })
            }
            disabled={disabled || !replaceFrom}
          >
            替换
          </button>
        </div>
      </section>

      <section className="op-group formula-section">
        <label>公式处理（合并表内公式清洗）</label>
        <div className="op-row">
          <button
            type="button"
            onClick={() => onAddStep('EVALUATE_FORMULAS', { EVALUATE_FORMULAS: {} })}
            disabled={disabled}
            title="将公式单元格替换为计算结果，支持 A1 引用、四则运算、SUM/AVERAGE/IF"
          >
            公式求值
          </button>
        </div>
        <div className="op-row">
          <input
            placeholder="移除后占位符（空则留空）"
            value={formulaPlaceholder}
            onChange={(e) => setFormulaPlaceholder(e.target.value)}
            disabled={disabled}
            style={{ minWidth: 120 }}
          />
          <button
            type="button"
            onClick={() =>
              onAddStep('REMOVE_FORMULAS', {
                REMOVE_FORMULAS: { placeholder: formulaPlaceholder || undefined },
              })
            }
            disabled={disabled}
            title="将公式单元格替换为占位符或空"
          >
            移除公式
          </button>
        </div>
        <div className="op-row">
          <input
            placeholder="审计列名（默认：含公式）"
            value={formulaAuditCol}
            onChange={(e) => setFormulaAuditCol(e.target.value)}
            disabled={disabled}
            style={{ width: 100 }}
          />
          <button
            type="button"
            onClick={() =>
              onAddStep('FORMULA_AUDIT', {
                FORMULA_AUDIT: { outputColumn: formulaAuditCol.trim() || undefined },
              })
            }
            disabled={disabled}
            title="新增一列标记该行是否含公式"
          >
            公式审计
          </button>
        </div>
      </section>

      <section className="op-group more-ops-toggle">
        <button
          type="button"
          className="btn-toggle"
          onClick={() => setMoreOpen((o) => !o)}
        >
          {moreOpen ? '▼ 收起更多操作' : '▶ 更多操作（类型/排序/抽样/列顺序等）'}
        </button>
      </section>

      {moreOpen && (
        <>
          <section className="op-group">
            <label>类型转换</label>
            <div className="op-row">
              <select value={convertColumn} onChange={(e) => setConvertColumn(e.target.value)} disabled={disabled}>
                {columns.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={convertType} onChange={(e) => setConvertType(e.target.value as 'string' | 'number' | 'boolean')} disabled={disabled}>
                <option value="string">字符串</option>
                <option value="number">数字</option>
                <option value="boolean">布尔</option>
              </select>
              <button type="button" onClick={() => onAddStep('CONVERT_TYPE', { CONVERT_TYPE: { column: convertColumn, targetType: convertType } })} disabled={disabled}>应用</button>
            </div>
          </section>
          <section className="op-group">
            <label>拆分列</label>
            <div className="op-row">
              <select value={splitColumn} onChange={(e) => setSplitColumn(e.target.value)} disabled={disabled}>
                {columns.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input placeholder="分隔符" value={splitSeparator} onChange={(e) => setSplitSeparator(e.target.value)} disabled={disabled} style={{ width: 60 }} />
              <input placeholder="新列名，逗号分隔" value={splitNewNames} onChange={(e) => setSplitNewNames(e.target.value)} disabled={disabled} style={{ minWidth: 120 }} />
              <button type="button" onClick={() => onAddStep('SPLIT_COLUMN', { SPLIT_COLUMN: { column: splitColumn, separator: splitSeparator, newColumnNames: splitNewNames.split(/[,，]/).map((s) => s.trim()).filter(Boolean) } })} disabled={disabled || !splitNewNames.trim()}>拆分</button>
            </div>
          </section>
          <section className="op-group">
            <label>合并列</label>
            <div className="op-row">
              <input placeholder="列名，逗号分隔" value={concatColumnsStr} onChange={(e) => setConcatColumnsStr(e.target.value)} disabled={disabled} style={{ minWidth: 100 }} />
              <input placeholder="分隔符" value={concatSeparator} onChange={(e) => setConcatSeparator(e.target.value)} disabled={disabled} style={{ width: 50 }} />
              <input placeholder="新列名" value={concatNewColumn} onChange={(e) => setConcatNewColumn(e.target.value)} disabled={disabled} style={{ width: 80 }} />
              <button type="button" onClick={() => onAddStep('CONCAT_COLUMNS', { CONCAT_COLUMNS: { columns: concatColumnsStr.split(/[,，]/).map((s) => s.trim()).filter(Boolean), newColumn: concatNewColumn, separator: concatSeparator } })} disabled={disabled || !concatColumnsStr.trim() || !concatNewColumn.trim()}>合并</button>
            </div>
          </section>
          <section className="op-group">
            <label>排序</label>
            <div className="op-row">
              <select value={sortColumn} onChange={(e) => setSortColumn(e.target.value)} disabled={disabled}>
                {columns.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')} disabled={disabled}>
                <option value="asc">升序</option>
                <option value="desc">降序</option>
              </select>
              <button type="button" onClick={() => onAddStep('SORT_ROWS', { SORT_ROWS: { by: [{ column: sortColumn, order: sortOrder }] } })} disabled={disabled}>排序</button>
            </div>
          </section>
          <section className="op-group">
            <label>添加列</label>
            <div className="op-row">
              <input placeholder="列名" value={addColName} onChange={(e) => setAddColName(e.target.value)} disabled={disabled} />
              <input placeholder="值" value={addColValue} onChange={(e) => setAddColValue(e.target.value)} disabled={disabled} />
              <button type="button" onClick={() => onAddStep('ADD_COLUMN', { ADD_COLUMN: { column: addColName, value: /^\d+$/.test(addColValue) ? Number(addColValue) : addColValue } })} disabled={disabled || !addColName.trim()}>添加</button>
            </div>
          </section>
          <section className="op-group">
            <label>值映射</label>
            <div className="op-row">
              <select value={mapCol} onChange={(e) => setMapCol(e.target.value)} disabled={disabled}>
                {columns.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input placeholder="原值:新值, 原值2:新值2" value={mapPairsStr} onChange={(e) => setMapPairsStr(e.target.value)} disabled={disabled} style={{ minWidth: 160 }} />
              <button
                type="button"
                onClick={() => {
                  const mapping: Record<string, string | number> = {};
                  mapPairsStr.split(/[,，]/).forEach((pair) => {
                    const [k, v] = pair.split(/[:：]/).map((s) => s.trim());
                    if (k && v !== undefined) mapping[k] = /^\d+$/.test(v) ? Number(v) : v;
                  });
                  onAddStep('MAP_VALUES', { MAP_VALUES: { column: mapCol, mapping } });
                }}
                disabled={disabled || !mapPairsStr.trim()}
              >
                应用映射
              </button>
            </div>
          </section>
          <section className="op-group">
            <label>保留行</label>
            <div className="op-row">
              <select value={sliceMode} onChange={(e) => setSliceMode(e.target.value as 'head' | 'tail')} disabled={disabled}>
                <option value="head">前 N 行</option>
                <option value="tail">后 N 行</option>
              </select>
              <input type="number" min={1} value={sliceCount} onChange={(e) => setSliceCount(Number(e.target.value) || 1)} disabled={disabled} style={{ width: 56 }} />
              <button type="button" onClick={() => onAddStep('SLICE_ROWS', { SLICE_ROWS: { mode: sliceMode, count: sliceCount } })} disabled={disabled}>应用</button>
            </div>
          </section>
          <section className="op-group">
            <label>随机抽样</label>
            <div className="op-row">
              <input type="number" min={1} value={sampleCount} onChange={(e) => setSampleCount(Number(e.target.value) || 1)} disabled={disabled} style={{ width: 56 }} />
              <span>行</span>
              <button type="button" onClick={() => onAddStep('SAMPLE_ROWS', { SAMPLE_ROWS: { count: sampleCount } })} disabled={disabled}>抽样</button>
            </div>
          </section>
          <section className="op-group">
            <label>连续空格压成单个</label>
            <div className="op-row">
              <button type="button" onClick={() => onAddStep('COLLAPSE_WHITESPACE', { COLLAPSE_WHITESPACE: { columns } })} disabled={disabled}>全部列</button>
            </div>
          </section>
          <section className="op-group">
            <label>删除空行</label>
            <div className="op-row">
              <button type="button" onClick={() => onAddStep('DROP_EMPTY_ROWS', { DROP_EMPTY_ROWS: {} })} disabled={disabled}>删除整行为空的行</button>
            </div>
          </section>
          <section className="op-group">
            <label>列顺序</label>
            <div className="op-row">
              <input placeholder="列名，逗号分隔" value={reorderStr} onChange={(e) => setReorderStr(e.target.value)} disabled={disabled} style={{ minWidth: 160 }} />
              <button type="button" onClick={() => onAddStep('REORDER_COLUMNS', { REORDER_COLUMNS: { columnOrder: reorderStr.split(/[,，]/).map((s) => s.trim()).filter(Boolean) } })} disabled={disabled || !reorderStr.trim()}>应用顺序</button>
            </div>
          </section>
        </>
      )}

      {mergeTableOptions.length > 0 && (
        <section className="op-group merge-section">
          <label>合并表格</label>
          <div className="op-row">
            <select
              value={mergeTableId}
              onChange={(e) => setMergeTableId(e.target.value)}
              disabled={disabled}
            >
              <option value="">选择要合并的表</option>
              {mergeTableOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.data.rows.length} 行)
                </option>
              ))}
            </select>
          </div>
          <div className="op-row">
            <select
              value={mergeType}
              onChange={(e) => setMergeType(e.target.value as MergeType)}
              disabled={disabled}
            >
              {MERGE_TYPES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          {isJoin && selectedMergeTable && (
            <>
              <div className="op-row">
                <span className="op-label">左表键列</span>
                <select
                  value={mergeLeftKey}
                  onChange={(e) => setMergeLeftKey(e.target.value)}
                  disabled={disabled}
                >
                  {columns.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="op-row">
                <span className="op-label">右表键列</span>
                <select
                  value={mergeRightKey}
                  onChange={(e) => setMergeRightKey(e.target.value)}
                  disabled={disabled}
                >
                  {rightColumns.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div className="op-row">
            <button
              type="button"
              onClick={() => {
                if (!selectedMergeTable || !canMerge) return;
                onAddStep('MERGE_TABLES', {
                  MERGE_TABLES: {
                    mergeType,
                    rightTable: cloneTable(selectedMergeTable.data),
                    rightTableName: selectedMergeTable.name,
                    leftKeys: isJoin ? [mergeLeftKey] : undefined,
                    rightKeys: isJoin ? [mergeRightKey] : undefined,
                  },
                });
              }}
              disabled={disabled || !canMerge}
              className="btn-merge"
            >
              执行合并
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

import type { TableData } from './types';
import { isFormulaCell, getCellValue } from './types';
import './DataTable.css';

interface DataTableProps {
  data: TableData;
  maxRows?: number;
  /** 与当前问题相关的列，在预览中高亮并便于聚焦 */
  highlightedColumns?: string[] | null;
}

export function DataTable({ data, maxRows, highlightedColumns }: DataTableProps) {
  const { columns, rows } = data;
  const showAll = maxRows == null;
  const displayRows = showAll ? rows : rows.slice(0, maxRows);
  const hasMore = !showAll && rows.length > (maxRows ?? 0);
  const highlightSet = highlightedColumns?.length ? new Set(highlightedColumns) : null;

  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th className="row-index">#</th>
            {columns.map((col) => (
              <th
                key={col}
                className={highlightSet?.has(col) ? 'col-focused' : ''}
                data-col={col}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, i) => (
            <tr key={i}>
              <td className="row-index">{i + 1}</td>
              {columns.map((col) => {
                const raw = row[col];
                const isFormula = isFormulaCell(raw);
                const v = getCellValue(raw);
                const display = isFormula ? (raw.expr.startsWith('=') ? raw.expr : `=${raw.expr}`) : (v ?? '');
                const isEmpty = !isFormula && (v == null || String(v).trim() === '');
                const isFocused = highlightSet?.has(col) ?? false;
                return (
                  <td
                    key={col}
                    className={`${isEmpty ? 'cell-empty' : isFormula ? 'cell-formula' : ''} ${isFocused ? 'col-focused' : ''}`}
                    title={isFormula ? raw.expr : String(v ?? '')}
                  >
                    {isEmpty && !isFormula ? '—' : display}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {hasMore && maxRows != null && (
        <div className="data-table-footer">
          仅显示前 {maxRows} 行，共 {rows.length} 行
        </div>
      )}
    </div>
  );
}

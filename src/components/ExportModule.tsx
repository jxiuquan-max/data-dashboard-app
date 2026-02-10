/**
 * ExportModule：将当前修复后的 fixerRows 导出为 Excel，
 * 列顺序严格遵守 schema_report.reference_columns 基准列序。
 */

import { useCallback } from 'react';
import { Download } from 'lucide-react';
import * as XLSX from 'xlsx';

export interface ExportModuleProps {
  /** 当前修复后的行数据 */
  rows: Record<string, string | null>[];
  /** 基准列序（来自 schema_report.reference_columns），缺省时用 rows 首行键或空） */
  referenceColumns: string[];
  /** 默认文件名（不含扩展名） */
  defaultFilename?: string;
  disabled?: boolean;
}

export function ExportModule({
  rows,
  referenceColumns,
  defaultFilename = '标准数据',
  disabled = false,
}: ExportModuleProps) {
  const exportToExcel = useCallback(() => {
    const cols = referenceColumns.length > 0 ? referenceColumns : (rows[0] ? Object.keys(rows[0]) : []);
    const orderedRows = rows.map((row) => {
      const o: Record<string, string> = {};
      for (const col of cols) {
        const v = row[col];
        o[col] = v == null ? '' : String(v);
      }
      return o;
    });

    const ws = XLSX.utils.json_to_sheet(orderedRows, { header: cols });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const name = `${defaultFilename.replace(/\.xlsx$/i, '')}.xlsx`;
    XLSX.writeFile(wb, name);
  }, [rows, referenceColumns, defaultFilename]);

  return (
    <button
      type="button"
      onClick={exportToExcel}
      disabled={disabled || rows.length === 0}
      className="btn-primary flex items-center gap-2 rounded-[var(--radius)] border-0 px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50"
      style={{
        background: 'var(--accent)',
        color: '#fff',
        boxShadow: 'var(--shadow)',
      }}
    >
      <Download className="h-4 w-4" aria-hidden />
      导出 Excel
    </button>
  );
}

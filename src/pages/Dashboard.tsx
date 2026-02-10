/**
 * Dashboard：数据表查看与修复 + 导出
 * 仅保留数据清洗相关，统计图表已移除
 */

import { useMemo } from 'react';
import { DataFixer } from '../DataFixer';
import type { HealthManifest } from '../DataFixer';
import { ExportModule } from '../components/ExportModule';
import type { SchemaReport } from '../types/schemaReport';

export interface DashboardProps {
  columns: string[];
  rows: Record<string, string | null>[];
  onDataChange: (rows: Record<string, string | null>[]) => void;
  healthManifest: HealthManifest;
  schemaReport?: SchemaReport | null;
  onStandardizationComplete?: () => void;
  onProgress?: (remaining: number) => void;
  /** 用户确认数据无误后，点击进入分析工作台 */
  onConfirmAndGoToAnalysis?: () => void;
}

export function Dashboard({
  columns,
  rows,
  onDataChange,
  healthManifest,
  schemaReport = null,
  onStandardizationComplete,
  onProgress,
  onConfirmAndGoToAnalysis,
}: DashboardProps) {
  const data = useMemo(() => ({ columns, rows }), [columns, rows]);
  const referenceColumns = schemaReport?.reference_columns?.length ? schemaReport.reference_columns : columns;

  return (
    <div
      className="dashboard"
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '60vh',
      }}
    >
      <section
        className="dashboard-fixer"
        style={{
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-card)',
          borderRadius: '8px',
          border: '1px solid var(--border)',
          overflow: 'hidden',
        }}
      >
        <div
          className="flex items-center justify-between gap-2 px-4 py-2 border-b"
          style={{
            borderColor: 'var(--border)',
            color: 'var(--text-primary)',
            fontSize: '14px',
          }}
        >
          <span>数据表 · 修复与导出</span>
          <ExportModule
            rows={rows}
            referenceColumns={referenceColumns}
            defaultFilename="标准数据"
            disabled={rows.length === 0}
          />
        </div>
        <div className="flex-1 min-h-0">
          <DataFixer
            data={data}
            healthManifest={healthManifest}
            onDataChange={onDataChange}
            onStandardizationComplete={onStandardizationComplete}
            onProgress={onProgress}
          />
        </div>
      </section>

      {onConfirmAndGoToAnalysis && (
        <div
          className="mt-4 rounded-lg border p-4"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--bg-card)',
          }}
        >
          <p className="mb-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
            请确认数据看板内的数据没有问题或已全部处理正确后，再进入分析工作台。
          </p>
          <button
            type="button"
            onClick={onConfirmAndGoToAnalysis}
            className="btn-primary rounded-lg border-0 px-4 py-2 text-sm font-medium"
            style={{ background: 'var(--accent)', color: '#fff', boxShadow: 'var(--shadow)' }}
          >
            确认数据无误，进入分析工作台
          </button>
        </div>
      )}
    </div>
  );
}

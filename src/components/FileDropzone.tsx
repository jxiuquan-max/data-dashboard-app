/**
 * FileDropzone：支持拖入或点击多选 CSV。
 * 先调用 /api/analyze-headers 做表头预审，通过 onHeaderResult 回传；合并与健康扫描由父组件在用户点击「确认对齐」后调用。
 */

import { useCallback, useRef, useState } from 'react';
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import type { HeaderAnalyzeResult } from '../types/schemaReport';
import type { HealthManifest } from '../DataFixer';
import type { MergedData } from '../DataFixer';
import type { SchemaReport } from '../types/schemaReport';

const UPLOAD_TIMEOUT_MS = 60000;

export interface MergeScanResult {
  schema_report: SchemaReport;
  health_manifest: HealthManifest;
  merged: MergedData;
  /** 合并后后端返回的指纹，供 check-status 轮询对比 */
  fingerprint?: string | null;
}

export interface FileDropzoneProps {
  /** 表头分析完成后回调（预审工作台）；父组件在用户确认后再调用 merge-and-scan */
  onHeaderResult: (report: HeaderAnalyzeResult, files: File[]) => void;
  /** 开始分析表头时回调，用于展示「AI 思考中」等 */
  onAnalyzingHeaders?: () => void;
  /** 表头分析失败时回调，用于重置「AI 思考中」状态并展示引导 */
  onAnalyzeError?: () => void;
  /** 仅接受 .csv */
  accept?: string;
  disabled?: boolean;
}

// 1. 获取环境变量
const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const isProd = import.meta.env.PROD;

// 2. 确定最终地址
const FINAL_API_URL = isProd ? API_BASE : "http://127.0.0.1:5001";

export function FileDropzone({
  onHeaderResult,
  onAnalyzingHeaders,
  onAnalyzeError,
  accept = '.csv',
  disabled = false,
}: FileDropzoneProps) {
  const [drag, setDrag] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      const csvs = list.filter((f) => f.name.toLowerCase().endsWith('.csv'));
      if (csvs.length === 0) {
        setError('请至少选择一个 CSV 文件');
        return;
      }
      setError(null);
      setLoading(true);
      onAnalyzingHeaders?.();
      try {
        const form = new FormData();
        csvs.forEach((f) => form.append('files', f));
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
        // 1. 换成 FINAL_API_URL (确保本地/云端都能自动识别)
        // 2. 删掉 /api (因为你的 Python 后端没写这个前缀，这就是导致 404 的原因)
        const res = await fetch(`${FINAL_API_URL}/analyze-headers`, {
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
          throw new Error(typeof msg === 'string' ? msg : '请求参数错误');
        }
        const data = (await res.json()) as HeaderAnalyzeResult;
        if (!data || !Array.isArray(data.base_columns) || !Array.isArray(data.files)) {
          throw new Error('后端返回格式异常，请重试');
        }
        onHeaderResult(data, csvs);
      } catch (e) {
        onAnalyzeError?.();
        const msg =
          e instanceof Error
            ? e.name === 'AbortError'
              ? '请求超时，请检查文件大小或网络后重试'
              : e.message.toLowerCase().includes('fetch') ||
                  e.message.toLowerCase().includes('failed') ||
                  e.message.toLowerCase().includes('network') ||
                  e.message.toLowerCase().includes('econnrefused')
                  ? `无法连接后端。请确认后端服务已启动 ${isProd ? '(云端)' : '(端口 5001)'}，然后刷新本页或点击上传区域重试`
                : e.message
            : '表头分析失败，请重试';
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [onHeaderResult, onAnalyzingHeaders, onAnalyzeError]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDrag(false);
      if (disabled || loading) return;
      upload(e.dataTransfer.files);
    },
    [disabled, loading, upload]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDrag(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDrag(false);
  }, []);

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files?.length) upload(files);
      e.target.value = '';
    },
    [upload]
  );

  return (
    <>
      <input
        ref={inputRef}
        id="file-dropzone-input"
        type="file"
        accept={accept}
        multiple
        className="sr-only"
        aria-label="选择 CSV 文件"
        disabled={disabled || loading}
        onChange={onInputChange}
      />
      <label
        htmlFor="file-dropzone-input"
        className="file-dropzone block cursor-pointer"
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        style={{
        border: `2px dashed ${drag ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-lg)',
        padding: '1.5rem 2rem',
        background: drag ? 'rgba(var(--accent-rgb), 0.08)' : 'var(--bg-card)',
        color: 'var(--text-primary)',
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        transition: 'border-color 0.2s, background 0.2s',
        boxShadow: 'var(--shadow)',
      }}
      >
      {loading ? (
        <div className="flex items-center justify-center gap-2 text-[var(--text-secondary)]">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          <span>正在扫描表头… 正在对比差异…</span>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-1 text-red-400">
          <span>{error}</span>
          <span className="text-sm text-[var(--text-muted)]">请拖入多个 CSV 重试</span>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 text-center">
          <FileSpreadsheet className="h-10 w-10 text-[var(--accent)]" aria-hidden />
          <span className="text-[var(--text-primary)]">
            将多个 CSV 拖入此处或点击选择文件，先预审表头对齐，确认后再合并与健康扫描
          </span>
          <span className="flex items-center gap-1.5 text-sm text-[var(--text-muted)]">
            <Upload className="h-4 w-4" aria-hidden />
            仅支持 .csv，可多选
          </span>
        </div>
      )}
      </label>
    </>
  );
}

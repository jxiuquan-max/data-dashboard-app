import { useState, useRef } from 'react';
import type { TableData } from './types';
import { parseTableFile } from './parseTableFile';
import './UploadTable.css';

interface UploadTableProps {
  onLoad: (data: TableData) => void;
  disabled?: boolean;
}

const ACCEPT = '.csv,.xlsx,.xls';
const MAX_SIZE_MB = 10;

export function UploadTable({ onLoad, disabled }: UploadTableProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [fileName, setFileName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setFileName(file.name);
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setStatus('error');
      setMessage(`文件大小超过 ${MAX_SIZE_MB}MB 限制`);
      return;
    }
    setStatus('loading');
    setMessage('');
    const result = await parseTableFile(file);
    if (result.ok) {
      setStatus('success');
      const { data, sheetName } = result;
      const rowCol = `${data.rows.length} 行 · ${data.columns.length} 列`;
      setMessage(sheetName ? `已加载「${result.fileName}」${sheetName}，${rowCol}` : `已加载「${result.fileName}」，${rowCol}`);
      onLoad(result.data);
    } else {
      setStatus('error');
      setMessage(result.error);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    handleFile(file ?? null);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    handleFile(file ?? null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (disabled) return;
    e.dataTransfer.dropEffect = 'copy';
  };

  return (
    <div className="upload-table">
      <div
        className={`upload-table-zone ${status} ${disabled ? 'disabled' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => !disabled && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          onChange={handleChange}
          disabled={disabled}
          className="upload-table-input"
          aria-label="上传表格"
        />
        <span className="upload-table-label">
          {status === 'loading' ? '解析中…' : '点击或拖拽上传 .csv / .xlsx / .xls'}
        </span>
        <span className="upload-table-hint">最大 {MAX_SIZE_MB}MB</span>
      </div>
      {message && (
        <p className={`upload-table-message ${status === 'error' ? 'error' : 'success'}`} role="alert">
          {message}
        </p>
      )}
    </div>
  );
}

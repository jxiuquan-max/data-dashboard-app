/**
 * 录入步骤后端状态检测：请求 /api/health，显示是否已连接及正确启动命令（端口 5001）
 */

import { useEffect, useState } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const BACKEND_PORT = 5001;

export function BackendStatus() {
  const [status, setStatus] = useState<'checking' | 'ok' | 'fail'>('checking');

  useEffect(() => {
    let cancelled = false;
    setStatus('checking');
    fetch(`${API_BASE}/api/health`)
      .then((res) => {
        if (cancelled) return;
        setStatus(res.ok ? 'ok' : 'fail');
      })
      .catch(() => {
        if (!cancelled) setStatus('fail');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'checking') {
    return (
      <p className="text-xs text-[var(--text-muted)]">
        后端状态：检测中…
      </p>
    );
  }

  if (status === 'ok') {
    return (
      <p className="flex items-center gap-1.5 text-xs text-emerald-400">
        <CheckCircle className="h-3.5 w-3.5" aria-hidden />
        后端已连接（端口 {BACKEND_PORT}），可上传 CSV
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
      <p>
        若上传无响应，请先启动后端：在项目根目录执行{' '}
        <code className="rounded bg-[var(--bg-hover)] px-1 text-[var(--text-primary)]">
          uvicorn main:app --port {BACKEND_PORT}
        </code>
        ，然后刷新本页或点击上传区域重试。
      </p>
      <p>
        若端口被占用，可先杀掉旧进程：macOS/Linux 执行{' '}
        <code className="rounded bg-[var(--bg-hover)] px-1 text-[var(--text-primary)]">
          lsof -ti:{BACKEND_PORT} | xargs kill -9
        </code>
        。
      </p>
    </div>
  );
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

/** 捕获渲染阶段错误并安全展示（避免 XSS） */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[RootErrorBoundary]', error);
  }

  render() {
    if (this.state.error) {
      const msg = this.state.error.message;
      return (
        <div style={{ padding: '2rem', color: '#dc2626', whiteSpace: 'pre-wrap' }}>
          渲染失败：{msg}
        </div>
      );
    }
    return this.props.children;
  }
}

const rootEl = document.getElementById('root');
if (!rootEl) {
  console.error('[main] 未找到 #root 节点');
} else {
  try {
    if (import.meta.env.DEV) {
      console.info('[dev] 当前前端构建时间:', new Date().toISOString());
    }
    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <RootErrorBoundary>
          <App />
        </RootErrorBoundary>
      </React.StrictMode>
    );
  } catch (err) {
    console.error('[main] 渲染失败:', err);
    const msg = err instanceof Error ? err.message : String(err);
    const p = document.createElement('p');
    p.style.cssText = 'padding:2rem;color:#dc2626;white-space:pre-wrap';
    p.textContent = '渲染失败：' + msg;
    rootEl.appendChild(p);
  }
}

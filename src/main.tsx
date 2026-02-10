import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// 开发环境下便于确认是否加载到最新构建（控制台可见）
if (import.meta.env.DEV) {
  console.info('[dev] 当前前端构建时间:', new Date().toISOString());
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // 1. 确保 react() 插件放在最前面，这能解决 Preamble 报错
  plugins: [react(), tailwindcss()],
  server: {
    // 2. 保持你原来的代理配置
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
    // 3. 简单的 HMR 配置
    hmr: true,
  },
})
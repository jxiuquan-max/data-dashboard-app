import { defineConfig } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** 开发/预览时：每次请求首页都注入新时间戳到入口脚本 URL，避免浏览器用旧缓存 */
function noCachePlugin() {
  const noCacheHeaders = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
  }
  return {
    name: 'no-cache',
    apply: 'serve',
    configureServer(server) {
      // 所有响应都带 no-cache 头
      server.middlewares.use((_req, res, next) => {
        Object.entries(noCacheHeaders).forEach(([k, v]) => res.setHeader(k, v))
        next()
      })
      // 拦截首页：每次请求都读 index.html 并注入新的 ?t= 时间戳
      const indexInterceptor = (req, res, next) => {
        const url = req.url?.split('?')[0] || ''
        if (req.method !== 'GET' || (url !== '/' && url !== '/index.html')) {
          return next()
        }
        const root = server.config.root
        const htmlPath = path.join(root, 'index.html')
        if (!fs.existsSync(htmlPath)) return next()
        let html = fs.readFileSync(htmlPath, 'utf-8')
        const ts = Date.now()
        html = html.replace(
          /src="(\/src\/main\.tsx)"/,
          `src="$1?t=${ts}"`
        )
        if (!html.includes('@vite/client')) {
          html = html.replace('</head>', '<script type="module" src="/@vite/client"></script></head>')
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        Object.entries(noCacheHeaders).forEach(([k, v]) => res.setHeader(k, v))
        res.end(html)
      }
      server.middlewares.use(indexInterceptor)
      // 把「首页拦截」插到栈首，确保在 Vite 默认 index 处理之前执行（避免缓存）
      return () => {
        const s = server.middlewares.stack
        if (Array.isArray(s) && s.length > 0) {
          const last = s.pop()
          if (last && last.handle === indexInterceptor) {
            s.unshift(last)
          } else if (last) {
            s.push(last)
          }
        }
      }
    },
    configurePreviewServer(server) {
      server.middlewares.use((_req, res, next) => {
        Object.entries(noCacheHeaders).forEach(([k, v]) => res.setHeader(k, v))
        next()
      })
    },
  }
}


export default defineConfig({
  plugins: [noCachePlugin(), react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
    },
    hmr: true,
    watch: {
      usePolling: false,
    },
  },
})

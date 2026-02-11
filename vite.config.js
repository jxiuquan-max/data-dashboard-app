import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
/** 开发/预览时：每次请求首页都注入新时间戳到入口脚本 URL，避免浏览器用旧缓存 */
function noCachePlugin() {
    var noCacheHeaders = {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
    };
    return {
        name: 'no-cache',
        apply: 'serve',
        configureServer: function (server) {
            // 所有响应都带 no-cache 头
            server.middlewares.use(function (_req, res, next) {
                Object.entries(noCacheHeaders).forEach(function (_a) {
                    var k = _a[0], v = _a[1];
                    return res.setHeader(k, v);
                });
                next();
            });
            // 拦截首页：每次请求都读 index.html 并注入新的 ?t= 时间戳
            var indexInterceptor = function (req, res, next) {
                var _a;
                var url = ((_a = req.url) === null || _a === void 0 ? void 0 : _a.split('?')[0]) || '';
                if (req.method !== 'GET' || (url !== '/' && url !== '/index.html')) {
                    return next();
                }
                var root = server.config.root;
                var htmlPath = path.join(root, 'index.html');
                if (!fs.existsSync(htmlPath))
                    return next();
                var html = fs.readFileSync(htmlPath, 'utf-8');
                var ts = Date.now();
                html = html.replace(/src="(\/src\/main\.tsx)"/, "src=\"$1?t=".concat(ts, "\""));
                if (!html.includes('@vite/client')) {
                    html = html.replace('</head>', '<script type="module" src="/@vite/client"></script></head>');
                }
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                Object.entries(noCacheHeaders).forEach(function (_a) {
                    var k = _a[0], v = _a[1];
                    return res.setHeader(k, v);
                });
                res.end(html);
            };
            server.middlewares.use(indexInterceptor);
            // 把「首页拦截」插到栈首，确保在 Vite 默认 index 处理之前执行（避免缓存）
            return function () {
                var s = server.middlewares.stack;
                if (Array.isArray(s) && s.length > 0) {
                    var last = s.pop();
                    if (last && last.handle === indexInterceptor) {
                        s.unshift(last);
                    }
                    else if (last) {
                        s.push(last);
                    }
                }
            };
        },
        configurePreviewServer: function (server) {
            server.middlewares.use(function (_req, res, next) {
                Object.entries(noCacheHeaders).forEach(function (_a) {
                    var k = _a[0], v = _a[1];
                    return res.setHeader(k, v);
                });
                next();
            });
        },
    };
}
export default defineConfig({
    plugins: [noCachePlugin(), react(), tailwindcss()],
    server: {
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:5001',
                changeOrigin: true,
                rewrite: function (path) { return path.replace(/^\/api/, ''); },
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
});

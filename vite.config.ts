// C:\Projects\Scrolith\vite.config.ts
import { defineConfig, loadEnv, splitVendorChunkPlugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import getBackendTarget from './scripts/getBackendTarget'
import { resolveApiBaseForEnvironment, type ScrolithApiEnvironment } from './src/utils/apiBasePolicy'

// Chunk name suffix rotates after 2026-07-24 canary (immutable 404 cache poison).
const CHUNK_BUST = 'b24c'
const FRONTEND_CHUNK_RULES: Array<{ name: string; patterns: string[] }> = [
  {
    name: `react-core-${CHUNK_BUST}`,
    patterns: ['/node_modules/react/', '/node_modules/react-dom/', '/node_modules/scheduler/']
  },
  {
    name: `router-${CHUNK_BUST}`,
    patterns: ['/node_modules/react-router/', '/node_modules/react-router-dom/']
  },
  {
    name: `realtime-${CHUNK_BUST}`,
    patterns: ['/node_modules/socket.io-client/', '/node_modules/engine.io-client/']
  },
  {
    name: `charts-${CHUNK_BUST}`,
    patterns: ['/node_modules/recharts/', '/node_modules/d3-']
  },
  {
    name: `icons-${CHUNK_BUST}`,
    patterns: ['/node_modules/lucide-react/']
  },
  {
    name: `payments-${CHUNK_BUST}`,
    patterns: ['/node_modules/stripe/']
  },
  {
    name: `capacitor-${CHUNK_BUST}`,
    patterns: ['/node_modules/@capacitor/']
  }
]

const resolveManualChunk = (id: string) => {
  const normalized = id.replace(/\\/g, '/')

  for (const rule of FRONTEND_CHUNK_RULES) {
    if (rule.patterns.some((pattern) => normalized.includes(pattern))) {
      return rule.name
    }
  }

  if (!normalized.includes('/node_modules/')) return undefined

  return undefined
}

const PUBLIC_BROWSER_KEY_ALLOWLIST = new Set(['VITE_FIREBASE_API_KEY', 'VITE_GOOGLE_MAPS_API_KEY'])

const assertNoPrivateBrowserEnv = (mode: string) => {
  const env = loadEnv(mode, process.cwd(), '')
  const unsafeNames = Object.keys(env).filter((name) =>
    !PUBLIC_BROWSER_KEY_ALLOWLIST.has(name) &&
    /(?:SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY|OPENAI.*KEY|GEMINI.*KEY|DATABASE_URL|DB_URL|CONNECTION_STRING|CLIENT_SECRET|ACCESS_KEY|AUTHORIZATION)/i.test(name)
  )

  if (unsafeNames.length) {
    throw new Error(
      `Refusing to build with credential-like environment variables: ${unsafeNames.sort().join(', ')}. ` +
      'Frontend builds must not receive secrets; use a server-side secret and backend provider route.'
    )
  }
}

const assertSafeApiBuildTarget = (mode: string) => {
  const env = loadEnv(mode, process.cwd(), '')
  const configuredTarget = String(env.VITE_SCROLITH_ENV || '').trim().toLowerCase()
  const target = configuredTarget || (mode === 'development' ? 'development' : mode === 'production' ? 'production' : 'ci')
  if (!['development', 'staging', 'production', 'ci'].includes(target)) {
    throw new Error('Refusing to build: VITE_SCROLITH_ENV is not a supported target.')
  }

  const apiUrl = env.VITE_API_URL || env.VITE_API_BASE_URL || env.VITE_BACKEND_URL
  const resolved = resolveApiBaseForEnvironment(apiUrl, target as ScrolithApiEnvironment)
  if (!resolved) {
    throw new Error(`Refusing to build: API URL is missing or not allowed for the ${target} target.`)
  }
}

export default defineConfig(({ mode, command }) => {
  assertNoPrivateBrowserEnv(mode)
  if (command === 'build') assertSafeApiBuildTarget(mode)
  return {
  base: '/',
  plugins: [react(), splitVendorChunkPlugin()],
  server: (() => {
    const backendTarget = getBackendTarget();

    return {
    port: 3000,
    host: '127.0.0.1',
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path,
          configure: (proxy, _options) => {
            proxy.on('proxyReq', (proxyReq, req, _res) => {
              try {
                if (req && req.headers && req.headers.authorization) {
                  proxyReq.setHeader('authorization', req.headers.authorization)
                }
              } catch (e) {
                // ignore
              }
            })
          }
        },
        // Proxy only specific admin API paths (do NOT proxy '/admin' root otherwise
        // SPA admin routes will be forwarded to the backend and return "Route not found".
        '/admin/gigs-jobs': {
          target: backendTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path,
          configure: (proxy, _options) => {
            proxy.on('error', (err, _req, _res) => {
              console.log('Vite /admin/gigs-jobs proxy error:', err)
            })
            proxy.on('proxyReq', (proxyReq, req, _res) => {
              if (req && req.headers && req.headers.authorization) {
                proxyReq.setHeader('authorization', req.headers.authorization)
              }
            })
            proxy.on('proxyRes', (proxyRes, req, _res) => {
              console.log('/admin/gigs-jobs proxy response:', proxyRes.statusCode, req.url)
            })
          }
        },
        '/socket.io': {
          target: backendTarget,
          changeOrigin: true,
          ws: true,
          secure: false,
          rewrite: (path) => path,
          configure: (proxy, _options) => {
            proxy.on('error', (err, _req, _res) => {
              console.log('Vite proxy error:', err)
            })
            proxy.on('proxyReq', (proxyReq, req, _res) => {
              console.log('Proxy request:', req.method, req.url)
            })
            proxy.on('proxyRes', (proxyRes, req, _res) => {
              console.log('Proxy response:', proxyRes.statusCode, req.url)
            })
          }
        }
      },
      hmr: {
        clientPort: 3000,
        protocol: 'ws',
        host: 'localhost'
      }
    };
  })(),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'src': path.resolve(__dirname, './src'), // Add this line
    }
  },
  css: {
    postcss: './postcss.config.cjs',
  },
  build: {
    modulePreload: {
      polyfill: true,
      resolveDependencies: (_filename, deps) =>
        deps.filter(
          (dep) => !/(^|\/)(maps|capacitor|realtime)(-b24c)?-[^/]+\.js$/.test(dep)
        )
    },
    cssCodeSplit: true,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: resolveManualChunk
      }
    }
  }
  }
})

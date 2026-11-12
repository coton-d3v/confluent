import path from 'path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// ROADMAP E09.06: index.html tells search engines `noindex, nofollow` before any script, for every
// page. A workspace's public page its managers allowed to be indexed must not carry it (a search
// engine reading `noindex` there never runs the page): the build adds `public-page.html`, the same
// HTML without that tag, which the web server serves at `/w/<slug>` only (nginx.conf); the page then
// says itself whether it may be indexed (src/lib/robots.ts). The build fails rather than ship an
// index.html without the tag.
const ROBOTS_TAG = /\n?[ \t]*<meta name="robots" content="noindex, nofollow" \/>/

function publicPageHtml(): Plugin {
  return {
    name: 'confluent-public-page-html',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const index = bundle['index.html']
      const html = index?.type === 'asset' ? String(index.source) : ''
      if (!ROBOTS_TAG.test(html)) {
        this.error('index.html must tell search engines `noindex, nofollow` before any script.')
      }
      this.emitFile({
        type: 'asset',
        fileName: 'public-page.html',
        source: html.replace(ROBOTS_TAG, ''),
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const allowedHosts = env.VITE_ALLOWED_HOSTS
    ? env.VITE_ALLOWED_HOSTS.split(',').map((h) => h.trim()).filter(Boolean)
    : undefined
  const host = env.VITE_HOST === 'true' ? true : env.VITE_HOST || 'localhost'

  return {
    plugins: [tailwindcss(), react(), publicPageHtml()],
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.APP_VERSION ?? 'dev'),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      host,
      port: 5173,
      ...(allowedHosts ? { allowedHosts } : {}),
    },
  }
})

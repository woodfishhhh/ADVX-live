import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    // Workspace contracts are TypeScript source with extensionless internal imports.
    // Bundle them into Electron instead of asking Node's ESM loader to resolve them.
    plugins: [externalizeDepsPlugin({ exclude: ['@advx/contracts'] })],
    // electron-vite's dependency externalizer only configures Rollup. In dev,
    // Vite's SSR loader would otherwise hand the workspace package to Node,
    // which cannot resolve the extensionless imports under packages/contracts.
    ssr: {
      noExternal: ['@advx/contracts']
    },
    build: {
      rollupOptions: {
        input: resolve('src/main/index.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          control: resolve('src/preload/control.ts'),
          overlay: resolve('src/preload/overlay.ts'),
          'floating-chat': resolve('src/preload/floating-chat.ts'),
          capture: resolve('src/preload/capture.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve('src/renderers'),
    plugins: [tailwindcss(), react()],
    build: {
      rollupOptions: {
        input: {
          control: resolve('src/renderers/control/index.html'),
          overlay: resolve('src/renderers/overlay/index.html'),
          'floating-chat': resolve('src/renderers/floating-chat/index.html'),
          capture: resolve('src/renderers/capture/index.html')
        }
      }
    }
  }
})

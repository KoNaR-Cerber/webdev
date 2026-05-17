import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'], 
  },
  optimizeDeps: {
    include: ['react-grid-layout', 'roslib']
  },
  server: {
    proxy: {
      // Whenever the app requests /video/..., forward it to this target
      '/video': {
        target: 'http://10.13.13.1',
        changeOrigin: true,
        secure: false, 
      }
    }
  }
})

/* eslint-disable no-undef */

import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'FRONTEND_');

  return {
    plugins: [react()],
    envPrefix: 'FRONTEND_',
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
          target: `http://${env.FRONTEND_CAMERA_IP || '10.13.13.1'}`,
          changeOrigin: true,
          secure: false, 
        }
      }
    },
  };
});

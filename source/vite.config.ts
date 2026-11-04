import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:4000';

export default defineConfig({
    plugins: [react()],
    base: '/',
    server: {
        host: '127.0.0.1',
        port: 5173,
        strictPort: true,
        proxy: {
            '/api': {
                target: apiTarget,
                changeOrigin: true,
                secure: false,
            },
            '/socket.io': {
                target: apiTarget,
                changeOrigin: true,
                ws: true,
            },
        },
    },
    preview: {
        host: '127.0.0.1',
        port: 4173,
        strictPort: true,
    },
    build: {
        outDir: 'dist',
        sourcemap: false,
        rollupOptions: {
            maxParallelFileOps: 128,
        },
    },
});

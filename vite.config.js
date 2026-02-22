import { defineConfig } from 'vite';

export default defineConfig({
    base: '/drone-path-optimizer/',
    server: {
        host: true,
        allowedHosts: [
            'horn-staff-everything-nicole.trycloudflare.com',
            '.trycloudflare.com',
        ],
    },
});

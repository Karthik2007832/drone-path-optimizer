import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        host: true,
        allowedHosts: [
            'horn-staff-everything-nicole.trycloudflare.com',
            '.trycloudflare.com',
        ],
    },
});

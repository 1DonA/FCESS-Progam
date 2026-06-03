import axios from 'axios';

// Base URL is RELATIVE so the app works the same on localhost and through
// any public tunnel (ngrok/cloudflared/etc.). Vite's dev server proxies
// `/api/*` to `http://localhost:8000` (see vite.config.ts -> server.proxy).
const API_BASE =
    (import.meta.env.VITE_API_BASE as string | undefined) || '/api/v1';

export const apiClient = axios.create({
    baseURL: API_BASE,
    headers: {
        'Content-Type': 'application/json',
    },
});

apiClient.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

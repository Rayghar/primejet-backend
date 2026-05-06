// src/api/apiClient.js
import axios from 'axios';

const runtimeApiUrl = typeof window !== 'undefined' ? window.__PRIMEJET_API_URL__ : undefined;
const BASE_URL = process.env.REACT_APP_API_URL || runtimeApiUrl || 'http://localhost:3000';

const apiClient = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: Number(process.env.REACT_APP_API_TIMEOUT_MS || 30000),
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;

  const url = String(config.url || '');
  const isAbsolute = /^https?:\/\//i.test(url);
  if (!isAbsolute && url && !url.startsWith('/api/')) {
    config.url = `/api/v1${url.startsWith('/') ? '' : '/'}${url}`;
  }
  return config;
}, (error) => Promise.reject(error));

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/' && window.location.pathname !== '/login') {
        window.location.href = '/';
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
export { BASE_URL };

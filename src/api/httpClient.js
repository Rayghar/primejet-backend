// src/api/httpClient.js
import axios from 'axios';

const runtimeApiUrl = typeof window !== 'undefined' ? window.__PRIMEJET_API_URL__ : undefined;
const API_URL = process.env.REACT_APP_API_URL || runtimeApiUrl || 'http://localhost:3000';

const httpClient = axios.create({
  baseURL: `${API_URL.replace(/\/$/, '')}/api/v2`,
  headers: { 'Content-Type': 'application/json' },
  timeout: Number(process.env.REACT_APP_API_TIMEOUT_MS || 30000),
});

httpClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

httpClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/' && window.location.pathname !== '/login') window.location.href = '/';
    }
    return Promise.reject(error);
  }
);

export default httpClient;
export { API_URL };

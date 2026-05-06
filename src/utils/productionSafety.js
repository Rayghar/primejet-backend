// src/utils/productionSafety.js
const DEFAULT_DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:5173',
];

const splitList = (value) => String(value || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const unique = (values = []) => [...new Set(values.filter(Boolean))];

const isProduction = (env = process.env.NODE_ENV) => String(env || '').toLowerCase() === 'production';

const allowedOriginsFromEnv = () => unique([
  ...splitList(process.env.ALLOWED_ORIGINS),
  ...splitList(process.env.CORS_ORIGINS),
  process.env.FRONTEND_URL,
  process.env.ADMIN_FRONTEND_URL,
  process.env.CUSTOMER_WEB_URL,
  ...(isProduction() ? [] : DEFAULT_DEV_ORIGINS),
]);

const originAllowed = (origin, allowedOrigins = allowedOriginsFromEnv()) => {
  // Server-to-server, same-origin health checks and curl usually have no Origin header.
  if (!origin) return true;
  if (allowedOrigins.includes('*') && !isProduction()) return true;
  return allowedOrigins.includes(origin);
};

const buildCorsOptions = () => {
  const allowedOrigins = allowedOriginsFromEnv();
  return {
    origin(origin, callback) {
      if (originAllowed(origin, allowedOrigins)) return callback(null, true);
      return callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'X-Correlation-Id'],
    exposedHeaders: ['X-Correlation-Id', 'X-API-Version'],
    optionsSuccessStatus: 204,
  };
};

const redactConnectionString = (uri) => {
  const value = String(uri || '');
  if (!value) return '';
  return value.replace(/(mongodb(?:\+srv)?:\/\/)([^:@/]+):([^@/]+)@/i, '$1***:***@');
};

const requireProductionEnv = (config = {}) => {
  if (!isProduction(config.env)) return;
  const missing = [];
  if (!process.env.MONGO_URI) missing.push('MONGO_URI');
  if (!process.env.JWT_SECRET) missing.push('JWT_SECRET');
  if (!process.env.FRONTEND_URL && !process.env.ALLOWED_ORIGINS && !process.env.CORS_ORIGINS) {
    missing.push('FRONTEND_URL or ALLOWED_ORIGINS/CORS_ORIGINS');
  }
  const insecureSecret = !config?.jwt?.secret || /fallback|default|dev_only|please_change|your-default/i.test(String(config.jwt.secret));
  if (insecureSecret) missing.push('secure JWT_SECRET');
  if (missing.length) {
    throw new Error(`[CONFIG] Refusing to start production with missing/insecure config: ${missing.join(', ')}`);
  }
};

module.exports = {
  DEFAULT_DEV_ORIGINS,
  splitList,
  unique,
  isProduction,
  allowedOriginsFromEnv,
  originAllowed,
  buildCorsOptions,
  redactConnectionString,
  requireProductionEnv,
};

const NODE_ENV = process.env.NODE_ENV || 'development';

function requiredInProduction(name, fallback) {
  const value = process.env[name] || fallback;
  if (NODE_ENV === 'production' && !process.env[name]) {
    throw new Error(`${name} is required in production`);
  }
  return value;
}

module.exports = {
  NODE_ENV,
  PORT: Number(process.env.PORT) || 4000,
  JWT_SECRET: requiredInProduction('JWT_SECRET', 'api-pulse-dev-secret-change-me'),
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
};

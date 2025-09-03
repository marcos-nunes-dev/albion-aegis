import cors from 'cors';

/**
 * CORS configuration for the BFF API
 */
export const corsOptions: cors.CorsOptions = {
  origin: [
    // Development origins
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    
    // Production origins (add your actual domains)
    // 'https://yourdomain.com',
    // 'https://www.yourdomain.com',
  ],
  
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
  ],
  exposedHeaders: ['Content-Length', 'X-Total-Count'],
  maxAge: 86400, // 24 hours
};

/**
 * CORS middleware instance
 */
export const corsMiddleware = cors(corsOptions);

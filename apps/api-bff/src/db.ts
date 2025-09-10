import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

console.log('🗄️ Initializing Prisma client...');
console.log('🗄️ Database URL:', process.env.DATABASE_URL ? '[SET]' : '[NOT SET]');

// Configure Prisma for Supabase connection pooling
const databaseUrl = process.env.DATABASE_URL;
const isSupabase = databaseUrl?.includes('supabase.com');

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['query', 'error', 'warn'],
  datasources: {
    db: {
      url: isSupabase 
        ? `${databaseUrl}?pgbouncer=true&connection_limit=1&prepared_statements=false`
        : databaseUrl,
    },
  },
});

// Test database connection
prisma.$connect()
  .then(() => {
    console.log('✅ Database connection successful');
  })
  .catch((error) => {
    console.error('❌ Database connection failed:', error);
    console.error('❌ Database error details:', {
      code: (error as any).code,
      errno: (error as any).errno,
      syscall: (error as any).syscall,
      stack: error.stack
    });
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

console.log('🗄️ Initializing Prisma client...');
console.log('🗄️ Database URL:', process.env.DATABASE_URL ? '[SET]' : '[NOT SET]');

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['query', 'error', 'warn'],
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

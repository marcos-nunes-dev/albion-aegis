import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

async function testConnection() {
  try {
    console.log('🔌 Testing database connection...');
    console.log('📊 Host:', process.env.DATABASE_URL?.split('@')[1]?.split(':')[0]);
    
    // Set a timeout for the connection
    const timeout = setTimeout(() => {
      console.log('⏰ Connection timeout after 10 seconds');
      process.exit(1);
    }, 10000);
    
    await prisma.$connect();
    clearTimeout(timeout);
    console.log('✅ Database connection successful!');
    
    // Test a simple query
    const result = await prisma.$queryRaw`SELECT 1 as test`;
    console.log('✅ Query test successful:', result);
    
  } catch (error) {
    console.error('❌ Database connection failed:');
    console.error('Error:', error.message);
    console.error('Code:', error.code);
  } finally {
    await prisma.$disconnect();
  }
}

testConnection();

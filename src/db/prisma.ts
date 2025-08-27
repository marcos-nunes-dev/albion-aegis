import { getPrisma } from './database.js';

// Re-export the actual PrismaClient instance for backward compatibility
export const prisma = getPrisma();

// Re-export the database manager for new code
export { databaseManager } from './database.js';

// Default export for backward compatibility
export default prisma;

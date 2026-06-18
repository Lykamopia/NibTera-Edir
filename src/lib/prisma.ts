import { PrismaClient } from '@prisma/client'

function buildUrl() {
  const base = process.env.DATABASE_URL ?? ''
  // Append Prisma pool parameters if not already present.
  // connection_limit=5  — cap the pool per process so multiple Next.js workers
  //                       don't collectively exhaust PostgreSQL max_connections.
  // pool_timeout=20     — wait up to 20 s for a free slot before failing.
  // connect_timeout=10  — give TCP 10 s to establish a new connection.
  if (base.includes('connection_limit')) return base
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}connection_limit=5&pool_timeout=20&connect_timeout=10`
}

const prismaClientSingleton = () =>
  new PrismaClient({
    datasources: { db: { url: buildUrl() } },
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

type PrismaClientSingleton = ReturnType<typeof prismaClientSingleton>

const globalForPrisma = globalThis as unknown as { prisma: PrismaClientSingleton | undefined }

const prisma = globalForPrisma.prisma ?? prismaClientSingleton()

export default prisma

// In development, reuse the singleton across hot-reloads to avoid
// opening a new pool on every file save.
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

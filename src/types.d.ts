import { User } from '@prisma/client'

declare module 'fastify' {
  interface FastifyRequest {
    user?: User
  }
}

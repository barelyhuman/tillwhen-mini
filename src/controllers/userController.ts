import prisma from '../models/prismaClient.js'

export const getUserProfile = async (req: any, reply: any) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: { profile: true },
  })

  reply.send({ user })
}

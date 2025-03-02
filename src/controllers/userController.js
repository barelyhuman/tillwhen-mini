import prisma from '../models/prismaClient.js'

export const getUserProfile = async (req, reply) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: { profile: true },
  })

  reply.send({ user })
}

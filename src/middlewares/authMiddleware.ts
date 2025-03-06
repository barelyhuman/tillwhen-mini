import { verifyToken } from '../lib/access-token.js'
import prisma from '../models/prismaClient.js'

export const isLoggedIn = async req => {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1]
  if (!token) return false

  const accessToken = await prisma.accessToken.findUnique({
    where: { token },
    include: { user: true },
  })

  if (!accessToken || accessToken.expiresAt < new Date()) return false
  if (!verifyToken(token, accessToken.hash)) return false

  req.user = accessToken.user
  return true
}

export const allowLoggedIn = async (req, reply) => {
  if (req.url === '/login') return

  const loggedIn = await isLoggedIn(req, reply)
  if (!loggedIn) {
    const redirectUrl = encodeURIComponent(req.url)
    reply.redirect(`/login?redir_to=${redirectUrl}`)
  }
}

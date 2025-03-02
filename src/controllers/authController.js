import { generateToken } from '../lib/access-token.js'
import prisma from '../models/prismaClient.js'
import bcrypt from 'bcryptjs'

export const signup = async (req, reply) => {
  const { email, password, name, bio } = req.body

  const hashedPassword = await bcrypt.hash(password, 10)

  await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      profile: {
        create: {
          name,
          bio,
        },
      },
    },
  })

  reply.redirect('/login')
}

export const login = async (req, reply) => {
  const { email, password } = req.body

  const user = await prisma.user.findUnique({
    where: { email },
  })

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return reply.code(401).send({ error: 'Invalid email or password' })
  }

  const { token, hash } = generateToken()
  await prisma.accessToken.create({
    data: {
      token,
      hash,
      userId: user.id,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    },
  })

  reply.setCookie('token', token, {
    path: '/',
    secure: process.env.NODE_ENV !== 'development',
    httpOnly: true,
    sameSite: 'lax',
  })

  const redirectTo = req.query.redir_to
  if (redirectTo) {
    reply.redirect(decodeURIComponent(redirectTo))
  } else {
    reply.redirect('/login')
  }
}

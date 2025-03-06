import { generateToken } from '../lib/access-token.ts'
import prisma from '../models/prismaClient.ts'
import bcrypt from 'bcryptjs'
import { billing } from './billingController.ts'
import { isDev } from '../lib/is-dev.ts'

export const signup = async (req: any, reply: any) => {
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

export const login = async (req: any, reply: any) => {
  const { email, password } = req.body
  const user = await prisma.user.findUnique({
    where: { email },
  })

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return reply.code(401).send({ error: 'Invalid email or password' })
  }

  if (!user.lastLogin) {
    // first time login, create a billing account
    const customer = await billing.createCustomer(user.email)
    const customerSubscription = await billing.getActiveSubscription(
      customer.id
    )
    await prisma.billing.create({
      data: {
        customerId: customer.id,
        userId: user.id,
        planId: customerSubscription?.productId,
      },
    })
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
    secure: !isDev,
    httpOnly: true,
    sameSite: 'lax',
  })

  const redirectTo = req.query.redir_to
  if (redirectTo) {
    reply.redirect(decodeURIComponent(redirectTo))
  } else {
    reply.redirect('/login')
  }

  await prisma.user.update({
    where: { email },
    data: {
      lastLogin: new Date(),
    },
  })
}

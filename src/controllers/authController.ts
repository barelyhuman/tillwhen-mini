import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { generateToken } from '../lib/access-token.ts'
import { isDev } from '../lib/is-dev.ts'
import prisma from '../models/prismaClient.ts'
import { billing } from './billingController.ts'
import { zodToErrors } from '../lib/zodToErrors.ts'

const signupPayloadSchema = z.object({
  email: z.string().email().nonempty(),
  password: z.string().nonempty(),
})

export const signup = async (req: any, reply: any) => {
  try {
    const { email, password, name, bio } = req.body

    const parsed = await signupPayloadSchema.safeParse({
      email,
      password,
    })

    if (parsed.error) {
      const formattedErrors = parsed.error.format()
      req.flash(
        'error',
        formattedErrors.email?._errors.concat(
          formattedErrors.password?._errors ?? []
        )
      )
      return reply.redirect('/signup')
    }

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

    req.flash('success', 'Successfully Signed Up, please log in')
    reply.redirect('/login')
  } catch (err) {
    req.flash('error', 'Oops! Something went wrong')
    reply.redirect('/signup')
  }
}

const loginPayloadSchema = z.object({
  email: z.string().email().nonempty(),
  password: z.string().nonempty(),
})

export const login = async (req: any, reply: any) => {
  const { email, password } = req.body

  const parsed = await loginPayloadSchema.safeParse({
    email,
    password,
  })

  if (parsed.error) {
    req.flash('error', zodToErrors(parsed.error))
    return reply.redirect('/login')
  }

  const user = await prisma.user.findUnique({
    where: { email },
  })

  if (!user || !(await bcrypt.compare(password, user.password))) {
    req.flash('error', 'Invalid email or password')
    return reply.redirect('/login')
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

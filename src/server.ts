import { CustomerPortal } from '@polar-sh/fastify'
import bcrypt from 'bcryptjs'

import helmet from '@fastify/helmet'
import v8 from 'node:v8'
import Fastify, { FastifyReply } from 'fastify'
import { readFileSync } from 'node:fs'
import underPressure from '@fastify/under-pressure'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import nunjucks from 'nunjucks'
import { z } from 'zod'
import config from './config.ts'
import { billing } from './controllers/billingController.ts'
import { constructDateFromSplits } from './lib/date.ts'
import { inlineCSS } from './lib/inlineCSS.ts'
import { isDev } from './lib/is-dev.ts'
import { prettyMs } from './lib/pretty-ms.ts'
import { allowLoggedIn, isLoggedIn } from './middlewares/authMiddleware.ts'
import prisma from './models/prismaClient.ts'
import authRoutes from './routes/authRoutes.ts'
import { zodToErrors } from './lib/zodToErrors.ts'

const app = Fastify({ logger: true })
const __dirname = dirname(fileURLToPath(import.meta.url))

app.decorate('db', prisma)

app.register(import('@fastify/cookie'))
app.register(import('@fastify/formbody'))

await app.register(helmet, {
  strictTransportSecurity: false,
  contentSecurityPolicy:
    process.env.NODE_ENV !== 'production'
      ? false
      : {
          directives: {
            'script-src': ["'self'"],
          },
        },
})

app.register(import('@fastify/rate-limit'), {
  max: 1000,
  timeWindow: '1 minute',
})

app.register(underPressure, {
  maxEventLoopDelay: 1000,
  maxHeapUsedBytes: v8.getHeapStatistics().heap_size_limit,
  maxRssBytes: v8.getHeapStatistics().total_available_size,
  pressureHandler: (req, rep, type, value) => {
    if (type === underPressure.TYPE_HEAP_USED_BYTES) {
      app.log.warn(`too many heap bytes used: ${value}`)
    } else if (type === underPressure.TYPE_RSS_BYTES) {
      app.log.warn(`too many rss bytes used: ${value}`)
    }

    rep.send('Under Pressure, please try again in a bit')
  },
})

nunjucks.configure('views', {
  autoescape: true,
  watch: isDev,
  noCache: isDev,
  dev: isDev,
})

app.register(import('@fastify/static'), {
  root: join(__dirname, './public'),
  prefix: '/public/',
})

app.register(import('@fastify/secure-session'), {
  key: readFileSync(join(__dirname, '../keys', 'secret-key')),
  cookie: {
    secure: !isDev,
    sameSite: 'lax',
    httpOnly: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  },
  cookieName: 'session',
})

app.register(import('@fastify/csrf-protection'), {
  sessionPlugin: '@fastify/secure-session',
})

app.register(import('@fastify/flash'))

app.register(import('@fastify/view'), {
  engine: {
    nunjucks: nunjucks,
  },
  templates: join(__dirname, './views'),
})

app.decorateRequest('isLoggedIn', function (this: any) {
  return isLoggedIn(this)
})

const PORT = config.PORT

app.get('/', (req, reply) => {
  return reply.viewAsync('index.njk')
})

app.get('/login', async (req, reply) => {
  if (await req.isLoggedIn()) {
    return reply.redirect('/app')
  }
  return reply.viewAsync('login.njk', {
    flash: reply.flash(),
    csrfToken: reply.generateCsrf(),
  })
})

app.get('/signup', (req, reply) => {
  return reply.viewAsync('signup.njk', {
    flash: reply.flash(),
    csrfToken: reply.generateCsrf(),
  })
})

app.get('/app', { preHandler: allowLoggedIn }, async (r, reply) => {
  const currentUser = r.user!
  const logs = (
    await prisma.timeLog.findMany({
      where: {
        userId: currentUser.id,
      },
    })
  ).map((d: any) => {
    d.durationString = prettyMs(d.duration)
    return d
  })
  return reply.viewAsync('app.njk', {
    flash: reply.flash(),
    csrfToken: reply.generateCsrf(),
    logs,
  })
})

function readFlash(reply: FastifyReply) {
  const messages = reply.flash()
  Object.keys(messages).forEach(k => {
    reply.flash(k)
  })
  return messages
}

const validateDateTime = z
  .object({
    logTitle: z.string().nonempty(),
    fromDate: z.string().date().nonempty(),
    fromTime: z.string().optional().default('00:00'),
    toDate: z.string().date().nonempty(),
    toTime: z.string().optional().default('00:00'),
  })
  .transform(({ fromDate, fromTime, toDate, toTime, logTitle }) => {
    const fromDateTime = constructDateFromSplits(fromDate, fromTime)
    const toDateTime = constructDateFromSplits(toDate, toTime)
    return {
      logTitle,
      fromDateTime,
      toDateTime,
    }
  })
  .refine(
    ({ toDateTime }) => {
      if (toDateTime.getTime() > Date.now()) {
        return false
      }
      return true
    },
    {
      message: "To Date can't be in the future",
      path: ['toDate'],
    }
  )
  .refine(
    ({ fromDateTime }) => {
      if (fromDateTime.getTime() > Date.now()) {
        return false
      }
      return true
    },
    {
      message: "From Date can't be in the future",
      path: ['fromDate'],
    }
  )
  .refine(
    ({ fromDateTime, toDateTime }) => {
      if (fromDateTime.getTime() > toDateTime.getTime()) {
        return false
      }
      return true
    },
    {
      message: 'From Date must be before To Date',
      path: ['fromDate', 'toDate'],
    }
  )

app.post('/app', { preHandler: allowLoggedIn }, async (req, reply) => {
  try {
    const currentUser = req.user!
    const validate = validateDateTime.safeParse(req.body)

    if (!validate.success) {
      req.flash('error', zodToErrors(validate.error))
      return reply.redirect('/app')
    }

    const { fromDateTime, logTitle, toDateTime } = validate.data

    const diff = toDateTime.getTime() - fromDateTime.getTime()

    await prisma.timeLog.create({
      data: {
        title: logTitle,
        date: fromDateTime,
        duration: diff,
        user: {
          connect: {
            id: currentUser.id,
          },
        },
      },
    })

    req.flash('success', 'Time Log Created!')
    return reply.redirect('/app')
  } catch (err) {
    req.flash('error', 'Oops! Something went wrong')
    return reply.redirect('/app')
  }
})

app.post(
  '/account/password',
  { preHandler: allowLoggedIn },
  async (req: any, reply: any) => {
    try {
      const currentUser = req.user!
      const { currentPassword, newPassword, confirmPassword } = req.body

      if (!(await bcrypt.compare(currentPassword, currentUser.password))) {
        req.flash('error', 'Invalid password')
        return reply.redirect('/account')
      }

      if (newPassword !== confirmPassword) {
        req.flash('error', 'Invalid password')
        return reply.redirect('/account')
      }

      const hashedPassword = await bcrypt.hash(confirmPassword, 10)
      await prisma.user.update({
        data: {
          password: hashedPassword,
        },
        where: {
          id: currentUser.id,
        },
      })

      req.flash('success', 'Updated Password')
      return reply.redirect('/account')
    } catch (err) {
      app.log.error({ err }, 'Failed ot update password')
      req.flash('error', 'Oops! Something went wrong')
      return reply.redirect('/account')
    }
  }
)

const emailUpdateSchema = z.object({
  email: z.string().email().nonempty(),
})

app.post(
  '/account/email',
  { preHandler: allowLoggedIn },
  async (req, reply) => {
    try {
      const currentUser = req.user!

      const validated = emailUpdateSchema.safeParse(req.body)
      if (!validated.success) {
        req.flash('error', zodToErrors(validated.error))
        return reply.redirect('/account')
      }

      const { email } = validated.data

      await prisma.user.update({
        data: {
          email: email,
        },
        where: {
          id: currentUser.id,
        },
      })

      req.flash('success', 'Updated Email')
      return reply.redirect('/account')
    } catch (err) {
      app.log.error({ err }, 'Failed ot update email')
      req.flash('error', 'Oops! Something went wrong')
      return reply.redirect('/account')
    }
  }
)

app.get('/account', { preHandler: allowLoggedIn }, async (r, reply) => {
  const user = r.user!

  return reply.viewAsync('account.njk', {
    email: user.email,
    flash: readFlash(reply),
    csrfToken: reply.generateCsrf(),
  })
})

app.get(
  '/billing',
  { preHandler: allowLoggedIn },
  async (r: any, reply: any) => {
    try {
      let subscribed = false

      let subscribedPlan = {}
      let orders = []
      const billingInfo = await prisma.billing.findFirst({
        where: {
          userId: r.user.id,
          isActive: true,
        },
      })

      if (billingInfo) {
        const [_plans, _orders] = await Promise.all([
          billing.getUserSubscriptions(billingInfo.customerId),
          billing.getInvoices(billingInfo.customerId),
        ])

        if (_plans.length) {
          subscribed = true
          subscribedPlan = _plans[0]
        }

        orders = _orders
      }

      return inlineCSS(
        await reply.viewAsync('billing.njk', {
          subscribed,
          orders,
          plan: subscribedPlan,
        })
      )
    } catch (err) {
      console.error(err)
    }
  }
)

app.get(
  '/billing/cancel',
  { preHandler: allowLoggedIn },
  async (r: any, reply: any) => {}
)

// app.post(
//   '/polar/webhooks',
//   Webhooks({
//     webhookSecret: config.POLAR_WEBHOOK_SECRET,
//     onCheckoutCreated: async payload => {
//       payload.data.customerId
//     },
//   })
// )

app.get(
  '/billing/initial',
  { preHandler: allowLoggedIn },
  async (r: any, reply: any) => {
    const plans = await billing.getPaymentPlans()

    return inlineCSS(
      await reply.viewAsync('billing-initial.njk', {
        plans: plans.result.items.map((d: any) => {
          d.nameShort = d.name.replace(/tillwhen/i, '').trim()
          return d
        }),
      })
    )
  }
)

app.get('/signout', (req: any, reply: any) => {
  reply.clearCookie('token')
  reply.redirect('/login')
})

app.get(
  '/billing/success',
  { preHandler: allowLoggedIn },
  async (req: any, reply: any) => {
    const checkoutId = req.query.checkoutId
    const customerId = await billing.getCustomerId(checkoutId)
    const planId = await billing.getPlanId(checkoutId)
    const user = req.user

    await prisma.billing.updateMany({
      where: {
        customerId: customerId,
      },
      data: {
        planId,
        userId: user.id,
        isActive: true,
      },
    })
    return reply.redirect('/billing')
  }
)

app.get(
  '/billing/checkout',
  { preHandler: allowLoggedIn },
  async (req, reply) => {
    const user = req.user!
    const checkout = await billing.createCheckout(user.id)
    reply.redirect(checkout.url)
  }
)

app.get(
  '/billing/portal',
  {
    preHandler: allowLoggedIn,
  },
  CustomerPortal({
    accessToken: config.BILLING_API_KEY,
    async getCustomerId(event) {
      const userBilling = await prisma.billing.findFirst({
        where: {
          // @ts-expect-error TS(2339): Property 'user' does not exist on type 'FastifyReq... Remove this comment to see the full error message
          userId: event.user.id,
        },
      })
      return userBilling?.customerId!
    },
    server: isDev ? 'sandbox' : 'production',
  })
)

app.register(authRoutes)

app.listen({ port: PORT })

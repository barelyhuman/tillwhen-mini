import Fastify from 'fastify'
import nunjucks from 'nunjucks'

import { CustomerPortal } from '@polar-sh/fastify'
import bcrypt from 'bcryptjs'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import config from './config.ts'
import { billing } from './controllers/billingController.ts'
import { constructDateFromSplits } from './lib/date.ts'
import { inlineCSS } from './lib/inlineCSS.ts'
import { isDev } from './lib/is-dev.ts'
import { prettyMs } from './lib/pretty-ms.ts'
import { allowLoggedIn, isLoggedIn } from './middlewares/authMiddleware.ts'
import prisma from './models/prismaClient.ts'
import authRoutes from './routes/authRoutes.ts'

const app = Fastify({ logger: true })
const __dirname = dirname(fileURLToPath(import.meta.url))

app.decorate('db', prisma)

app.register(import('@fastify/cookie'))
app.register(import('@fastify/formbody'))

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
})

// @ts-expect-error overload for flash types missing
app.register(import('@fastify/flash'), {
  root: join(__dirname, './public'),
  prefix: '/public/',
})

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

app.get('/', (req: any, reply: any) => {
  return reply.viewAsync('index.njk')
})

app.get('/login', async (req: any, reply: any) => {
  if (await req.isLoggedIn()) {
    return reply.redirect('/app')
  }
  return reply.viewAsync('login.njk')
})

app.get('/signup', (req: any, reply: any) => {
  return reply.viewAsync('signup.njk')
})

app.get('/app', { preHandler: allowLoggedIn }, async (r: any, reply: any) => {
  const currentUser = r.user
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
    successMessages: reply.flash('success'),
    logs,
  })
})

// TODO: validate input types and string stamps for the form
app.post(
  '/app',
  { preHandler: allowLoggedIn },
  async (req: any, reply: any) => {
    const { fromDate, fromTime, logTitle, toDate, toTime } = req.body

    const currentUser = req.user
    const fromDateTime = constructDateFromSplits(fromDate, fromTime)
    const toDateTime = constructDateFromSplits(toDate, toTime)

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
  }
)

app.post(
  '/account/password',
  { preHandler: allowLoggedIn },
  async (req: any, reply: any) => {
    const { currentPassword, newPassword, confirmPassword } = req.body
    const currentUser = req.user

    if (!(await bcrypt.compare(currentPassword, currentUser.password))) {
      req.flash('error', 'Invalid password')
      return reply.redirect('/account')
    }

    if (newPassword === confirmPassword) {
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

    return reply.redirect('/account')
  }
)

app.post(
  '/account/email',
  { preHandler: allowLoggedIn },
  async (req: any, reply: any) => {
    const { email } = req.body
    const currentUser = req.user

    await prisma.user.update({
      data: {
        email: email,
      },
      where: {
        id: currentUser.id,
      },
    })

    return reply.redirect('/account')
  }
)

// app.get('/projects', { preHandler: allowLoggedIn }, (req: any, reply: any) => {
//   return reply.viewAsync('projects.njk', {})
// })

app.get('/account', { preHandler: allowLoggedIn }, (r: any, reply: any) => {
  const user = r.user
  const messages = reply.flash('error')
  return reply.viewAsync('account.njk', {
    email: user.email,
    errorMessages: messages,
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

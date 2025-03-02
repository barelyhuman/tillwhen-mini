import Fastify from 'fastify'
import nunjucks from 'nunjucks'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import prisma from './models/prismaClient.js'
import authRoutes from './routes/authRoutes.js'
import { allowLoggedIn, isLoggedIn } from './middlewares/authMiddleware.js'
import config from './config.js'
import { CustomerPortal, Checkout } from '@polar-sh/fastify'
import { billing } from './controllers/billingController.js'
import { isDev } from './lib/isDev.js'
import Beasties from 'beasties'
import { readFileSync } from 'node:fs'

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

app.register(import('@fastify/flash'), {
  root: join(__dirname, './public'),
  prefix: '/public/',
})

app.register(import('@fastify/view'), {
  engine: {
    nunjucks: nunjucks,
  },
  templates: './src/views',
})

app.decorateRequest('isLoggedIn', function () {
  return isLoggedIn(this)
})

const PORT = config.PORT || 8000

app.get('/', (req, reply) => {
  return reply.viewAsync('index.njk')
})

app.get('/login', async (req, reply) => {
  if (await req.isLoggedIn()) {
    return reply.redirect('/app')
  }
  return reply.viewAsync('login.njk')
})

app.get('/signup', (req, reply) => {
  return reply.viewAsync('signup.njk')
})

app.get('/app', { preHandler: allowLoggedIn }, (r, reply) => {
  return reply.viewAsync('app.njk')
})

app.get('/account', { preHandler: allowLoggedIn }, (r, reply) => {
  return reply.viewAsync('account.njk')
})

app.get('/billing', { preHandler: allowLoggedIn }, async (r, reply) => {
  // TODO: check if has an active billing plan and show links to the portal
  // and avoid showing the plan

  let subscribed = false

  let subscribedPlan = {}
  let orders = []
  const customerId = await prisma.billing.findFirst({
    where: {
      userId: r.user.id,
    },
  })

  if (customerId) {
    const _plans = await billing.getUserSubscriptions(customerId.externalId)
    if (_plans.length) {
      subscribed = true
      subscribedPlan = _plans[0]
    }
    orders = await billing.getInvoices(customerId.externalId)
  }

  return inlineCSS(
    await reply.viewAsync('billing.njk', {
      subscribed,
      orders,
      plan: subscribedPlan,
    })
  )
})

app.get('/billing/initial', { preHandler: allowLoggedIn }, async (r, reply) => {
  const plans = await billing.getPaymentPlans()

  return inlineCSS(
    await reply.viewAsync('billing-initial.njk', {
      plans: plans.result.items.map(d => {
        d.nameShort = d.name.replace(/tillwhen/i, '').trim()
        return d
      }),
    })
  )
})

app.get('/signout', (req, reply) => {
  reply.clearCookie('token')
  reply.redirect('/login')
})

app.get(
  '/billing/success',
  { preHandler: allowLoggedIn },
  async (req, reply) => {
    const checkoutId = req.query.checkoutId
    const customerId = await billing.getCustomerId(checkoutId)
    const planId = await billing.getPlanId(checkoutId)
    const user = req.user
    await prisma.billing.create({
      data: {
        planId,
        externalId: customerId,
        userId: user.id,
      },
    })
    return reply.redirect('/billing')
  }
)

app.get(
  '/billing/checkout',
  Checkout({
    accessToken: config.BILLING_API_KEY,
    successUrl: config.BILLING_SUCCESS_URL,
    server: isDev ? 'sandbox' : 'production',
  })
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
          userId: event.user.id,
        },
      })
      return userBilling.externalId
    },
    server: isDev ? 'sandbox' : 'production',
  })
)

app.register(authRoutes)

await app.listen({ port: PORT })

const beasties = new Beasties({
  path: './src/public',
  publicPath: '/public/',
})

async function inlineCSS(html) {
  const inlined = await beasties.process(html)
  return inlined
}

import { Polar } from '@polar-sh/sdk'
import config from '../config.js'
import { isDev } from '../lib/is-dev.js'
import prisma from '../models/prismaClient.js'

class BillingController {
  polarClient: Polar
  constructor() {
    this.polarClient = new Polar({
      accessToken: config.BILLING_API_KEY,
      server: isDev ? 'sandbox' : 'production',
    })
  }

  getPaymentPlans() {
    return this.polarClient.products.list({
      query: 'tillwhen',
    })
  }

  async getPaymentPlanIds() {
    const plans = await this.getPaymentPlans()
    return plans.result.items.map(d => d.id)
  }

  async createCustomer(email: any) {
    const existingCustomer = await this.polarClient.customers.list({
      email: email,
    })
    if (existingCustomer.result.items.length > 0) {
      return existingCustomer.result.items[0]
    }
    const customer = await this.polarClient.customers.create({
      email: email,
    })
    return customer
  }

  async getUserSubscriptions(customerId: any) {
    const result = await this.polarClient.subscriptions.list({
      customerId,
      active: true,
    })
    return result.result.items
  }

  async createCheckout(userId: string) {
    const userAndBilling = await prisma.user.findFirst({
      where: {
        id: userId,
      },
      include: {
        billing: true,
      },
    })

    const billing = userAndBilling?.billing!

    const checkoutSesssion = await this.polarClient.checkouts.create({
      customerId: billing.customerId,
      products: await this.getPaymentPlanIds(),
    })

    return checkoutSesssion
  }

  async getPlanId(checkoutId: any) {
    try {
      const result = await this.polarClient.checkouts.get({ id: checkoutId })
      return result.productId
    } catch (err) {
      console.error('failed to get customer id')
      throw err
    }
  }

  async getInvoices(customerId: any) {
    const orders = await this.polarClient.orders.list({
      customerId: customerId,
    })
    return Promise.all(
      orders.result.items.map(async (order: any) => {
        const response = await this.polarClient.orders.invoice({
          id: order.id,
        })
        order.invoiceURL = response.url
        return order
      })
    )
  }

  async getCustomerId(checkoutId: any) {
    try {
      const result = await this.polarClient.checkouts.get({ id: checkoutId })
      return result.customerId!
    } catch (err) {
      console.error('failed to get customer id')
      throw err
    }
  }

  async getActiveSubscription(customerId: any) {
    const orders = await this.polarClient.orders.list({
      customerId: customerId,
      sorting: ['-created_at'],
    })
    return orders.result.items.find(
      orderItem => orderItem.subscription?.status === 'active'
    )
  }
}

export const billing = new BillingController()

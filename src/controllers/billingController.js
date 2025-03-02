import { Polar } from '@polar-sh/sdk'
import config from '../config.js'
import { isDev } from '../lib/isDev.js'

class BillingController {
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

  async getUserSubscriptions(customerId) {
    const result = await this.polarClient.subscriptions.list({
      active: true,
      customerId,
    })
    return result.result.items
  }

  async createSubscription(userId, planId) {
    try {
      const subscription = await this.polarClient.subscriptions.create({
        userId,
        planId,
      })
      return subscription
    } catch (error) {
      console.error('Error creating subscription:', error)
      throw error
    }
  }

  async processPayment(amount, currency, paymentMethodId) {
    try {
      const payment = await this.polarClient.payments.create({
        amount,
        currency,
        paymentMethodId,
      })
      return payment
    } catch (error) {
      console.error('Error processing payment:', error)
      throw error
    }
  }

  async getPlanId(checkoutId) {
    try {
      const result = await this.polarClient.checkouts.get({ id: checkoutId })
      return result.productId
    } catch (err) {
      console.error('failed to get customer id')
      throw err
    }
  }

  async getInvoices(customerId) {
    const orders = await this.polarClient.orders.list({
      customerId: customerId,
    })
    return Promise.all(
      orders.result.items.map(async order => {
        const response = await this.polarClient.orders.invoice({
          id: order.id,
        })
        order.invoiceURL = response.url
        return order
      })
    )
  }

  async getCustomerId(checkoutId) {
    try {
      const result = await this.polarClient.checkouts.get({ id: checkoutId })
      return result.customerId
    } catch (err) {
      console.error('failed to get customer id')
      throw err
    }
  }

  async getSubscriptionStatus(subscriptionId) {
    try {
      const status = await this.polarClient.subscriptions.get(subscriptionId)
      return status
    } catch (error) {
      console.error('Error fetching subscription status:', error)
      throw error
    }
  }
}

export const billing = new BillingController()

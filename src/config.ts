import process from 'node:process'

const exists = <T, V>(val: T, then: (x: T) => V): V | undefined =>
  val != null ? then(val) : undefined

export default {
  PORT: exists(process.env.PORT, Number) ?? 8000,
  DB_URL: process.env.DB_URL,
  BILLING_API_KEY: process.env.BILLING_API_KEY,
  BILLING_SUCCESS_URL: process.env.BILLING_SUCCESS_URL,
  POLAR_WEBHOOK_SECRET: process.env.POLAR_WEBHOOK_SECRET,
}

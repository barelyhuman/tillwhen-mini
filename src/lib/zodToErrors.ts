import { z } from 'zod'

export function zodToErrors(zodError: z.ZodError) {
  return zodError.issues.map(d => {
    return `${d.message}`
  })
}

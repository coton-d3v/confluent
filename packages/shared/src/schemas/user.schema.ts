import { z } from 'zod'

export const userRoleSchema = z.enum(['entrepreneur', 'financeur', 'admin'])

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: userRoleSchema,
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type UserRole = z.infer<typeof userRoleSchema>
export type User = z.infer<typeof userSchema>

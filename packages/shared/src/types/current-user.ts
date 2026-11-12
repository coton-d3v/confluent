import type { UserRole } from '../schemas/user.schema.js'

export interface CurrentUser {
  id: string
  name: string
  firstName: string | null
  email: string
  role: UserRole
}

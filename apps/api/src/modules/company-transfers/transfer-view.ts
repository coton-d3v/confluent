import type { CompanyTransferStatus } from '@confluent/shared'
import { COMPANY_TRANSFER_STATUSES, COMPANY_TRANSFER_VALIDITY_DAYS } from '@confluent/shared'
import type { CompanyTransfer } from '@prisma/client'

// An invitation as the conseillers of its workspace and the company's holder read it
// (@confluent/shared `companyTransferInvitationSchema`).
export interface TransferInvitationView {
  id: string
  email: string
  status: CompanyTransferStatus
  invitedAt: Date
  expiresAt: Date
  decidedAt: Date | null
}

// The status as it stands now: a pending invitation past its validity can no longer be answered,
// whether or not a later write has recorded it. An unknown stored value reads as `cancelled`, the
// status that grants nothing (closed by default).
export function currentStatus(
  transfer: Pick<CompanyTransfer, 'status' | 'expiresAt'>,
  now: Date = new Date(),
): CompanyTransferStatus {
  if (!(COMPANY_TRANSFER_STATUSES as readonly string[]).includes(transfer.status))
    return 'cancelled'
  const status = transfer.status as CompanyTransferStatus
  if (status === 'pending' && transfer.expiresAt.getTime() <= now.getTime()) return 'expired'
  return status
}

export function isOpen(transfer: Pick<CompanyTransfer, 'status' | 'expiresAt'>, now = new Date()) {
  return currentStatus(transfer, now) === 'pending'
}

export function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + COMPANY_TRANSFER_VALIDITY_DAYS * 24 * 60 * 60 * 1000)
}

export function invitationView(
  transfer: CompanyTransfer,
  now = new Date(),
): TransferInvitationView {
  return {
    id: transfer.id,
    email: transfer.toEmail,
    status: currentStatus(transfer, now),
    invitedAt: transfer.createdAt,
    expiresAt: transfer.expiresAt,
    decidedAt: transfer.decidedAt,
  }
}

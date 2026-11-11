import type { Company, Dossier } from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

const companiesPath = '/v1/companies'

// The signed-in owner's companies, each with its financing requests (E05.04, E05.07).
export function listCompanies(): Promise<Company[]> {
  return apiRequest<Company[]>(companiesPath)
}

export function getCompany(id: string): Promise<Company> {
  return apiRequest<Company>(`${companiesPath}/${encodeURIComponent(id)}`)
}

// E05.07: another financing request of the company, presenting the same profile.
export function createCompanyDossier(companyId: string, input: { name: string }): Promise<Dossier> {
  return apiRequest<Dossier>(`${companiesPath}/${encodeURIComponent(companyId)}/dossiers`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

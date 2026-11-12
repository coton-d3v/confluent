import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'

// Errors of a workspace's public page (ROADMAP E09.01), with messages shown as is in the site.
export const WorkspacePageErrors = {
  // The same answer for an unknown slug and a page that is not published (R66): whether a workspace
  // exists under an address is never told by the page.
  notFound: () =>
    new NotFoundException({
      code: 'WORKSPACE_PAGE_NOT_FOUND',
      message: 'Aucune page publique à cette adresse.',
    }),
  logoUnavailable: () =>
    new ServiceUnavailableException({
      code: 'STORAGE_UNAVAILABLE',
      message: 'Le logo est momentanément indisponible.',
    }),
  changed: (current: number) =>
    new ConflictException({
      code: 'WORKSPACE_PAGE_CHANGED',
      message:
        'La page publique a été modifiée entre-temps : rechargez-la avant de la modifier à nouveau.',
      details: { currentVersion: current },
    }),
}

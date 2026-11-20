# Story 7.4: Document Upload

Status: done

## AC

1. A `StorageAdapter` interface at [apps/api/src/modules/documents/storage/storage.adapter.ts](../../../../../apps/api/src/modules/documents/storage/storage.adapter.ts) exposes `upload(key, buffer, mimetype)` / `getSignedUrl(key, ttlSeconds)` / `delete(key)`.
2. An S3-compatible implementation backed by the AWS SDK v3 — `S3StorageAdapter` — injected via `STORAGE_TOKEN` provider. Constructor reads `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` from `ConfigService`. For the no-infrastructure environment, a `STORAGE_DRIVER=memory` override picks an in-memory adapter that holds a Map<string, Buffer> (useful for tests). Driver choice reads `process.env.STORAGE_DRIVER` falling back to `s3`.
3. `POST /v1/dossiers/:id/documents` accepts `multipart/form-data`; the file part is consumed via `@UploadedFile()` (Nest's FileInterceptor). Validates: `file.size <= 20 * 1024 * 1024` → otherwise 413 `PAYLOAD_TOO_LARGE`. Enforces ownership via `DossiersService.getByIdForUser`.
4. A `Document` Prisma model holds the metadata: `{ id, dossierId, filename, mimetype, storageKey, version, createdAt }`. Versioning: uploading a document with the same `filename` for the same dossier creates a new row with `version = prev.version + 1`; the storage key is suffixed with `-v{n}`. Schema addition happens in this story (schema.prisma).
5. `GET /v1/dossiers/:id/documents` returns documents grouped by filename with `versions: [{ version, url, createdAt, mimetype }]` — signed URL TTL 15 minutes.
6. Unit tests cover `DocumentsService.upload` (first upload → v1; second upload same filename → v2), `listForDossier` (grouped shape), and the 20 MB limit. A light in-memory adapter implementation is reused.
7. Skip `multipart` e2e for this pass (supertest `.attach` is fine but the file interceptor + config + adapter interplay is easier to validate as unit tests against `DocumentsService` — the controller surface is trivial).

## Tasks

- [ ] Prisma `Document` model + regenerate
- [ ] Storage adapter interface + in-memory + S3 impl
- [ ] `DocumentsService` + `DocumentsController`
- [ ] Module wiring
- [ ] Tests + commit

## Dev Notes

- Using AWS SDK v3 modular imports (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`).
- In-memory adapter returns `url: data:...` for tests (not for production flow).

## File List

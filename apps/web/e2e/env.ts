// Where the smoke tests find the running stack; CI's addresses by default.
export const SMOKE = {
  web: process.env.SMOKE_WEB_URL ?? 'http://localhost:8080',
  api: process.env.SMOKE_API_URL ?? 'http://localhost:3000',
  // Mailpit catches the API's emails (SMTP) and lists them over HTTP.
  mailpit: process.env.SMOKE_MAILPIT_URL ?? 'http://localhost:8025',
  // The web app is served by the repository's nginx.conf, as in the production image: its headers
  // are checked too. Unset when it is served by `vite preview`.
  nginx: process.env.SMOKE_NGINX === '1',
}

// Rows of e2e/fixtures.sql.
export const FIXTURES = {
  admin: 'admin@smoke.test',
  entrepreneur: 'porteur@smoke.test',
  slug: 'smoke-ci',
  structure: 'Programme Smoke CI',
}

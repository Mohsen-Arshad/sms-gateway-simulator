# SMS Gateway Simulator

A development-only simulator for SMS delivery lifecycles, OTP flows, inbound events, and signed webhooks. It does not send real SMS and contains no telecom credentials.

## Quick start

```bash
npm ci
cp .env.example .env.local
# Set SIMULATOR_SECRET to a unique random value with at least 32 characters.
npm run dev
```

Open `http://localhost:3000`. The browser playground is available only in non-production environments without API-key authentication.

## Security configuration

Production deployments fail closed unless both `SIMULATOR_SECRET` and `SIMULATOR_API_KEY` are configured with independent random values of at least 32 characters. Send the key only from trusted server-side clients:

```http
Authorization: Bearer <SIMULATOR_API_KEY>
```

OTP debug codes are hidden by default. They can only be exposed by setting `SIMULATOR_EXPOSE_OTP=true` outside production. The simulator's stateless OTP tokens are not one-time credentials and must never authenticate real users.

For local Docker use, create a local `.env` from `.env.example`, set both secrets, then run:

```bash
docker compose up --build
```

The Compose service binds to `127.0.0.1:3000`, runs with a read-only filesystem and dropped Linux capabilities, and requires explicit secrets.

## Quality and security checks

```bash
npm ci
npm audit --audit-level=high
npm run lint
npm run typecheck
npm test
npm run build
docker build -t sms-gateway-simulator .
```

CI runs dependency auditing, lint, type checking, tests, production build, and Docker build. CodeQL runs on pushes, pull requests, and weekly. Dependabot checks npm packages and GitHub Actions weekly.

Process-local rate limits are defense-in-depth only. Any multi-instance public deployment must enforce distributed rate limits at its trusted reverse proxy/API gateway. Never share simulator secrets, API keys, or webhook signing keys with production services.

See [SECURITY.md](./SECURITY.md) and [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

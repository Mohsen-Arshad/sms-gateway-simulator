# Security Policy

## Scope and intended use

This repository is a development and integration-test simulator. It is not a real SMS gateway, an identity provider, or a production OTP service. Never use its generated OTPs to authenticate real users, and never share its secrets with the Roham application or any production provider.

## Required production configuration

A deployed instance runs with `NODE_ENV=production` and fails closed unless both of the following are set:

- `SIMULATOR_SECRET`: unique random value, at least 32 characters.
- `SIMULATOR_API_KEY`: a different unique random value, at least 32 characters.

`SIMULATOR_EXPOSE_OTP` is ignored in production. OTP debug codes are only returned when explicitly enabled in a non-production environment.

`SIMULATOR_WEBHOOK_SECRET` may be configured as a third independent random secret. If omitted, a purpose-derived key is used; it is never the AES encryption key itself.

Never commit real `.env` files. The Docker build excludes environment files and the Compose service binds to localhost by default.

## Runtime protections and limitations

- API keys are compared with a constant-time comparison.
- JSON requests have strict content-type checks and bounded streaming reads.
- API endpoints have process-local rate limits. These are defense-in-depth only: they are not a distributed quota and must be supplemented by an upstream gateway/WAF for multi-instance public deployments.
- Message and OTP tokens use AES-256-GCM with authenticated purpose prefixes and validated payload schemas.
- Webhook signatures use a separate purpose-derived HMAC-SHA256 key.
- Error responses do not disclose raw exception messages.
- Docker runs as a non-root user, read-only filesystem, dropped Linux capabilities, and no-new-privileges.

The stateless OTP design does not guarantee one-time use across serverless instances or restarts. The OTP endpoints are test fixtures only and must never be used as production authentication.

## Vulnerability reporting

Report suspected vulnerabilities privately to the repository owner. Do not publish exploit details in public issues.

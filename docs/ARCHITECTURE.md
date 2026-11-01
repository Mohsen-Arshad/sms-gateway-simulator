# Architecture

The simulator is intentionally stateless so it behaves predictably on local Node.js, Docker, and serverless platforms.

## Core idea

SMS and OTP simulation state is encrypted into opaque IDs using AES-256-GCM. Message status is derived from the encrypted creation timestamp and configured delays. The simulator has no database or background queue.

## Security boundaries

- Production mode fails closed unless independent `SIMULATOR_SECRET` and `SIMULATOR_API_KEY` values are configured (32+ characters each).
- API keys are compared with a constant-time comparison.
- AES and webhook HMAC keys are purpose-derived separately. Token purpose is authenticated as AES-GCM additional authenticated data.
- Decrypted SMS/OTP payloads are validated against strict schemas before use.
- JSON request bodies are read with explicit byte limits and require `application/json`.
- API routes apply process-local request limits and responses do not cache private data.
- OTP debug values are opt-in for non-production environments only.
- The browser playground is disabled for production and API-key-protected deployments so the key never enters client-side code.

## Deployment constraints

Process-local rate limits are per Node.js instance and reset on process restart. They are not a distributed quota. Public multi-instance deployments must apply rate limits at a trusted API gateway or reverse proxy and normalize client-IP headers there.

OTP tokens are stateless and can be replayed until expiry. This is acceptable only for an integration-test simulator; it is not a production authentication design. Do not use the generated OTPs to authenticate real users.

The Docker image uses a non-root runtime user. Compose binds to loopback, uses a read-only filesystem, drops Linux capabilities, and requires explicit secrets. Environment files are excluded from Docker build context.

## Why this is useful

- no database is required;
- no background queue is required;
- serverless cold starts do not lose simulation state;
- secret rotation invalidates previously issued simulator IDs;
- tests can force deterministic final states.

This pattern is suitable for a simulator. It should not be copied blindly into real SMS infrastructure where auditable persistence, one-time OTP semantics, and provider receipts are required.

# Later hosting checklist

Complete these items before replacing the loopback backend with a hosted service:

- Require authenticated users and authorize every definition request.
- Apply per-user, per-IP, and project-wide abuse limits before provider dispatch.
- Store provider secrets in the hosting platform's secret manager and rotate them after suspected exposure.
- Keep atomic monthly reservations and the 900-attempt project ceiling, with operator alerts before exhaustion.
- Use HTTPS only and allow requests from explicitly supported extension origins.
- Move SQLite behind the existing cache repository interface to durable managed storage.
- Back up canonical definitions and usage records; document restore and integrity checks.
- Define health checks, timeouts, structured redacted logs, provider-failure metrics, and an offline fallback.
- Test schema migration order, rollback, cache recovery, and provider-key revocation.
- Run security review, real preview verification, and explicit release approval for the exact artifact.

No hosting account, public endpoint, purchase, or deployment is part of this local delivery.

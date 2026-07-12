# Encrypted sync Worker

1. Create the D1 database with `npx wrangler d1 create ai-anim-rank-sync`, then replace the placeholder `database_id` in `wrangler.toml` with the returned ID.
2. Run `npm run worker:migrate` to apply `migrations/0001_create_vaults.sql`.
3. Set one exact published app origin before deployment: `npx wrangler secret put ALLOWED_ORIGIN`. Do not use `*`; an unset, malformed, or wildcard value denies CORS.
4. Deploy with `npm run worker:deploy`.

For local Wrangler development, copy `.dev.vars.example` to `.dev.vars` and set the local app origin. `.dev.vars` is intentionally untracked.

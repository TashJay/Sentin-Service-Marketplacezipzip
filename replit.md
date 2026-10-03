# Sentin Services

Sentin is a service marketplace with a ChatGPT/MCP concierge, real provider quotes and availability, participant messaging, and an auditable booking lifecycle.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm run test:marketplace` — run the database-backed marketplace lifecycle test against development
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required environment: `DATABASE_URL`; Replit-managed Clerk must be provisioned for web sign-in and authenticated requests.
- Clerk keys come from Replit's managed auth setup, not checked-in files or manually copied values. If setup rejects an archive-derived app name, rename the Repl to a short name such as `Sentin` before retrying.
- `SESSION_SECRET` is required for OAuth session signing and is managed through workspace Secrets.
- Payments intentionally remain `NOT_CONFIGURED` until a processor and merchant setup are approved; the app must not claim a payment was collected.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — API source of truth; generated hooks and schemas live in the workspace client packages.
- `lib/db/src/schema/` — PostgreSQL schema.
- `artifacts/api-server/src/lib/concierge.ts` — clarification and confirmed-detail intake for the ChatGPT concierge.
- `artifacts/api-server/src/lib/marketplace.ts` — provider matching, quotes, availability, bookings, and messages.
- `artifacts/api-server/src/lib/payments.ts` — provider-neutral payment interface and balanced ledger logic.
- `artifacts/api-server/src/lib/marketplace.e2e.test.ts` — integration test for the end-to-end marketplace lifecycle.
- `artifacts/sentin/src/pages/marketplace.tsx` — customer and provider web flows.
- `artifacts/api-server/src/lib/seed-dev.ts` — development service taxonomy only; it must not seed fictional providers or transactions.

## Architecture decisions

- Service requests use only user-confirmed details; the concierge asks for missing service or location information rather than guessing.
- Provider profiles, quotes, availability slots, booking transitions, and messages come from persisted marketplace records. No synthetic provider or payment facts are seeded.
- Quotes remain immutable history; a provider may submit a replacement only after its earlier quote is no longer active.
- Booking confirmation reserves a real provider slot transactionally. Cancellation releases the slot and reopens a provider-cancelled request.
- Payments are processor-neutral and remain unavailable until a real processor is configured; successful capture is the only event that may create ledger entries.

## Product

- ChatGPT can clarify a service request and create it through MCP tools.
- Customers can compare real provider quotes, message the provider, and track a booking.
- Providers can publish and block availability, submit quotes, message customers, and advance booking status.
- The standalone web interface supports these customer and provider workflows when Clerk is configured.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

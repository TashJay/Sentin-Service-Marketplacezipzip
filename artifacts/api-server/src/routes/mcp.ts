import { Router, type IRouter, type Request } from "express";
import { McpServer, createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import * as z from "zod/v4";
import {
  acceptQuote,
  createProviderAvailability,
  createJob,
  getBooking,
  getJob,
  getProvider,
  listJobMessages,
  listJobQuotes,
  listProviderAvailability,
  listProviderBookings,
  listPublicProviderAvailability,
  listServices,
  requestQuotes,
  searchProviders,
  sendJobMessage,
  updateBookingStatus,
  updateProviderAvailability,
} from "../lib/marketplace";
import { prepareServiceRequest } from "../lib/concierge";
import {
  bearerChallenge,
  publicOrigin,
  verifyOAuthAccessToken,
  type SentinAuthInfo,
} from "../lib/oauth";
import { rateLimit } from "../lib/rate-limit";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const MARKETPLACE_RESOURCE_URI = "ui://sentin/marketplace.html";
const providerSecurity = [{ type: "noauth" }];
const oauthSecurity = (scopes: string[]) => [{ type: "oauth2", scopes }];
const ProviderSearchInput = z.object({
  serviceSlug: z.coerce.string().optional(),
  location: z.coerce.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const ProviderInput = z.object({ providerId: z.string().uuid() });
const CreateJobInput = z.object({
  serviceSlug: z.string().min(2).max(80),
  description: z.string().min(5).max(3000),
  city: z.string().min(1).max(120),
  countryCode: z.string().min(2).max(2),
  urgency: z.enum(["unknown", "standard", "urgent", "emergency"]).default("unknown"),
  propertyType: z.enum(["unknown", "residential", "commercial"]).default("unknown"),
});
const JobInput = z.object({ jobId: z.string().uuid() });
const QuoteInput = z.object({ quoteId: z.string().uuid() });
const BookingInput = z.object({ bookingId: z.string().uuid() });
const ConciergeInput = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1).max(3000),
  serviceSlug: z.string().min(2).max(80).optional(),
  description: z.string().max(3000).optional(),
  city: z.string().max(120).optional(),
  countryCode: z.string().length(2).optional(),
  urgency: z.enum(["unknown", "standard", "urgent", "emergency"]).optional(),
  propertyType: z.enum(["unknown", "residential", "commercial"]).optional(),
});
const AvailabilityInput = z.object({
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
});
const AvailabilityUpdateInput = z.object({
  slotId: z.string().uuid(),
  status: z.enum(["OPEN", "BLOCKED"]),
});
const BookingStatusInput = z.object({
  bookingId: z.string().uuid(),
  status: z.enum(["CONFIRMED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "DISPUTED"]),
  availabilitySlotId: z.string().uuid().optional(),
});
const JobMessageInput = z.object({ jobId: z.string().uuid() });
const SendMessageInput = z.object({ jobId: z.string().uuid(), body: z.string().min(1).max(2000) });
const ProviderBookingsInput = z.object({});

type ToolContext = {
  http?: {
    authInfo?: AuthInfo;
  };
};

function textResult(value: unknown, options: { ui?: boolean; isError?: boolean } = {}) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
    ...(options.isError ? { isError: true } : {}),
    ...(options.ui ? { _meta: { ui: { resourceUri: MARKETPLACE_RESOURCE_URI } } } : {}),
  };
}

function authError(ctx: ToolContext, scopes: string[], origin: string) {
  const candidate = ctx.http?.authInfo;
  const auth = isSentinAuthInfo(candidate) ? candidate : null;
  const missingScopes = !auth || scopes.some((scope) => !auth.scopes.includes(scope));
  if (!missingScopes) return null;

  const metadataUrl = auth?.resourceMetadataUrl
    ?? `${origin}/.well-known/oauth-protected-resource/api/mcp`;
  const error = auth ? "insufficient_scope" : "invalid_token";
  const description = auth
    ? `This action requires: ${scopes.join(" ")}`
    : "Sign in to Sentin to access your account.";
  const safeDescription = description.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return {
    content: [{ type: "text" as const, text: description }],
    isError: true,
    _meta: {
      "mcp/www_authenticate": [
        `Bearer resource_metadata="${metadataUrl}", error="${error}", error_description="${safeDescription}"`,
      ],
    },
  };
}

function isSentinAuthInfo(info: unknown): info is SentinAuthInfo {
  return Boolean(
    info
    && typeof info === "object"
    && "userId" in info
    && typeof info.userId === "string"
    && "scopes" in info
    && Array.isArray(info.scopes),
  );
}

function registerMarketplaceTools(origin: string): McpServer {
  const server = new McpServer({ name: "Sentin Services", version: "1.0.0" });

  server.registerResource(
    "sentin-marketplace",
    MARKETPLACE_RESOURCE_URI,
    { description: "Interactive Sentin service marketplace cards" } as never,
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "text/html;profile=mcp-app",
        text: MARKETPLACE_WIDGET,
        _meta: { ui: { prefersBorder: true } },
      }],
    }),
  );

  server.registerTool(
    "sentin_list_services",
    {
      title: "List available services",
      description: "List service categories that can be searched in Sentin.",
      inputSchema: z.object({}),
      securitySchemes: providerSecurity,
      annotations: { readOnlyHint: true },
    } as any,
    async () => textResult({ services: await listServices() }),
  );

  server.registerTool(
    "sentin_concierge",
    {
      title: "Understand a service request",
      description: "Act as Sentin's local-services concierge. Extract only facts the customer supplied, ask one short question for the most important missing service or location detail, and create a private request only when the service, work description, city, and country are known. Never invent provider availability, pricing, reviews, quotes, or outcomes. Reuse conversationId on each follow-up and send the latest full issue summary as description.",
      inputSchema: ConciergeInput,
      securitySchemes: oauthSecurity(["sentin:jobs:write"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      _meta: { ui: { resourceUri: MARKETPLACE_RESOURCE_URI } },
    } as any,
    async (input: z.infer<typeof ConciergeInput>, ctx: ToolContext) => {
      const denied = authError(ctx, ["sentin:jobs:write"], origin);
      if (denied) return denied as never;
      const auth = ctx.http?.authInfo;
      if (!isSentinAuthInfo(auth)) return authError({}, ["sentin:jobs:write"], origin) as never;
      const result = await prepareServiceRequest(auth.userId, input);
      return "error" in result
        ? textResult({ error: result.error }, { isError: true })
        : textResult({ type: "concierge", ...result }, { ui: true });
    },
  );

  server.registerTool(
    "sentin_search_providers",
    {
      title: "Find service providers",
      description: "Search active service providers by service category and location. Provider listings, prices, and reviews come only from actual records. Synthetic development records are explicitly labeled.",
      inputSchema: ProviderSearchInput,
      securitySchemes: providerSecurity,
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: MARKETPLACE_RESOURCE_URI } },
    } as any,
    async (input: { serviceSlug?: string; location?: string; limit?: number }) => {
      const providers = await searchProviders(input);
      return textResult({ type: "providers", providers }, { ui: true });
    },
  );

  server.registerTool(
    "sentin_get_provider",
    {
      title: "Get provider details",
      description: "Retrieve the public profile for one active Sentin service provider.",
      inputSchema: ProviderInput,
      securitySchemes: providerSecurity,
      annotations: { readOnlyHint: true },
    } as any,
    async ({ providerId }: { providerId: string }) => {
      const provider = await getProvider(providerId);
      return provider
        ? textResult({ type: "provider", provider })
        : textResult({ error: "Provider not found" }, { isError: true });
    },
  );

  server.registerTool(
    "sentin_list_provider_availability",
    {
      title: "Check real provider availability",
      description: "List open appointment slots currently published by this real provider. Only these stored slots may be used to confirm a booking.",
      inputSchema: ProviderInput,
      securitySchemes: providerSecurity,
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: MARKETPLACE_RESOURCE_URI } },
    } as any,
    async ({ providerId }: { providerId: string }) => {
      const slots = await listPublicProviderAvailability(providerId);
      return slots
        ? textResult({ type: "availability", providerId, slots }, { ui: true })
        : textResult({ error: "Provider not found" }, { isError: true });
    },
  );

  server.registerTool(
    "sentin_create_job",
    {
      title: "Create a service request",
      description: "Create a private service request in the signed-in customer's account. The service must be real and the request is only reported as created after the database confirms it.",
      inputSchema: CreateJobInput,
      securitySchemes: oauthSecurity(["sentin:jobs:write"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    } as any,
    async (input: Record<string, unknown>, ctx: ToolContext) => {
      const denied = authError(ctx, ["sentin:jobs:write"], origin);
      if (denied) return denied as never;
      const auth = ctx.http?.authInfo;
      if (!isSentinAuthInfo(auth)) return authError({}, ["sentin:jobs:write"], origin) as never;

      const result = await createJob(auth.userId, input as unknown as Parameters<typeof createJob>[1]);
      if ("error" in result) return textResult({ error: result.error }, { isError: true });
      return textResult({ type: "job", job: result.job, created: result.created });
    },
  );

  server.registerTool(
    "sentin_get_job",
    {
      title: "Get service request status",
      description: "Retrieve a service request owned by the signed-in customer.",
      inputSchema: JobInput,
      securitySchemes: oauthSecurity(["sentin:jobs:read"]),
      annotations: { readOnlyHint: true },
    } as any,
    async ({ jobId }: { jobId: string }, ctx: ToolContext) => {
      const denied = authError(ctx, ["sentin:jobs:read"], origin);
      if (denied) return denied as never;
      const auth = ctx.http?.authInfo;
      if (!isSentinAuthInfo(auth)) return authError({}, ["sentin:jobs:read"], origin) as never;
      const job = await getJob(auth.userId, jobId);
      return job ? textResult({ type: "job", job }) : textResult({ error: "Request not found" }, { isError: true });
    },
  );

  server.registerTool(
    "sentin_get_job_messages",
    {
      title: "Read request messages",
      description: "Read the customer-provider conversation for a service request where the signed-in user is a participant.",
      inputSchema: JobMessageInput,
      securitySchemes: oauthSecurity(["sentin:messages:read"]),
      annotations: { readOnlyHint: true },
    } as any,
    async ({ jobId }: { jobId: string }, ctx: ToolContext) => {
      const denied = authError(ctx, ["sentin:messages:read"], origin);
      if (denied) return denied as never;
      const auth = ctx.http?.authInfo;
      if (!isSentinAuthInfo(auth)) return authError({}, ["sentin:messages:read"], origin) as never;
      const messages = await listJobMessages(auth.userId, jobId);
      return messages
        ? textResult({ jobId, messages })
        : textResult({ error: "Request not found or caller is not a participant" }, { isError: true });
    },
  );

  server.registerTool(
    "sentin_send_job_message",
    {
      title: "Send a request message",
      description: "Send the signed-in participant's message to the other participant in a service request. Use only when the customer or provider explicitly asked to send that message.",
      inputSchema: SendMessageInput,
      securitySchemes: oauthSecurity(["sentin:messages:write"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    } as any,
    async ({ jobId, body }: { jobId: string; body: string }, ctx: ToolContext) => {
      const denied = authError(ctx, ["sentin:messages:write"], origin);
      if (denied) return denied as never;
      const auth = ctx.http?.authInfo;
      if (!isSentinAuthInfo(auth)) return authError({}, ["sentin:messages:write"], origin) as never;
      const result = await sendJobMessage(auth.userId, jobId, body);
      return "error" in result
        ? textResult({ error: result.error }, { isError: true })
        : textResult({ message: result.message });
    },
  );

  server.registerTool(
    "sentin_request_quotes",
    {
      title: "Request provider quotes",
      description: "Send an existing service request to its matched providers. Only providers associated with that request can submit quotes.",
      inputSchema: JobInput,
      securitySchemes: oauthSecurity(["sentin:jobs:write"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    } as any,
    async ({ jobId }: { jobId: string }, ctx: ToolContext) => {
      const denied = authError(ctx, ["sentin:jobs:write"], origin);
      if (denied) return denied as never;
      const auth = ctx.http?.authInfo;
      if (!isSentinAuthInfo(auth)) return authError({}, ["sentin:jobs:write"], origin) as never;
      const result = await requestQuotes(auth.userId, jobId);
      return "error" in result
        ? textResult({ error: result.error }, { isError: true })
        : textResult({ type: "job", job: result.job });
    },
  );

  server.registerTool(
    "sentin_get_quotes",
    {
      title: "Compare quotes",
      description: "List real quotes received for a service request owned by the signed-in customer. Amounts and provider names are returned only when present in stored quotes.",
      inputSchema: JobInput,
      securitySchemes: oauthSecurity(["sentin:jobs:read"]),
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: MARKETPLACE_RESOURCE_URI } },
    } as any,
    async ({ jobId }: { jobId: string }, ctx: ToolContext) => {
      const denied = authError(ctx, ["sentin:jobs:read"], origin);
      if (denied) return denied as never;
      const auth = ctx.http?.authInfo;
      if (!isSentinAuthInfo(auth)) return authError({}, ["sentin:jobs:read"], origin) as never;
      const quotes = await listJobQuotes(auth.userId, jobId);
      return quotes
        ? textResult({ type: "quotes", jobId, quotes }, { ui: true })
        : textResult({ error: "Request not found" }, { isError: true });
    },
  );

  server.registerTool(
    "sentin_accept_quote",
    {
      title: "Accept a provider quote",
      description: "Accept one valid quote for a customer-owned request and atomically create a booking. Sentin confirms success only after the booking transaction completes.",
      inputSchema: QuoteInput,
      securitySchemes: oauthSecurity(["sentin:bookings:write"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    } as any,
    async ({ quoteId }: { quoteId: string }, ctx: ToolContext) => {
      const denied = authError(ctx, ["sentin:bookings:write"], origin);
      if (denied) return denied as never;
      const auth = ctx.http?.authInfo;
      if (!isSentinAuthInfo(auth)) return authError({}, ["sentin:bookings:write"], origin) as never;
      const result = await acceptQuote(auth.userId, quoteId);
      return "error" in result
        ? textResult({ error: result.error }, { isError: true })
        : textResult({ type: "booking", booking: result.booking }, { ui: true });
    },
  );

  server.registerTool(
    "sentin_get_booking_status",
    {
      title: "Get booking status",
      description: "Retrieve the status and change history for a booking where the signed-in user is the customer or provider. Payment status is reported separately and never inferred.",
      inputSchema: BookingInput,
      securitySchemes: oauthSecurity(["sentin:bookings:read"]),
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: MARKETPLACE_RESOURCE_URI } },
    } as any,
    async ({ bookingId }: { bookingId: string }, ctx: ToolContext) => {
      const denied = authError(ctx, ["sentin:bookings:read"], origin);
      if (denied) return denied as never;
      const auth = ctx.http?.authInfo;
      if (!isSentinAuthInfo(auth)) return authError({}, ["sentin:bookings:read"], origin) as never;
      const booking = await getBooking(auth.userId, bookingId);
      return booking
        ? textResult({ type: "booking", booking }, { ui: true })
        : textResult({ error: "Booking not found" }, { isError: true });
    },
  );

  server.registerTool(
    "sentin_list_my_provider_bookings",
    {
      title: "List provider bookings",
      description: "List booking requests and their real lifecycle status for the signed-in provider.",
      inputSchema: ProviderBookingsInput,
      securitySchemes: oauthSecurity(["sentin:bookings:read"]),
      annotations: { readOnlyHint: true },
    } as any,
    async (_input: Record<string, never>, ctx: ToolContext) => {
      const denied = authError(ctx, ["sentin:bookings:read"], origin);
      if (denied) return denied as never;
      const auth = ctx.http?.authInfo;
      if (!isSentinAuthInfo(auth)) return authError({}, ["sentin:bookings:read"], origin) as never;
      const bookings = await listProviderBookings(auth.userId);
      return bookings
        ? textResult({ bookings })
        : textResult({ error: "Provider profile required" }, { isError: true });
    },
  );

  server.registerTool(
    "sentin_update_booking_status",
    {
      title: "Update booking status",
      description: "Move a booking through its allowed lifecycle. Provider confirmation requires a currently open availabilitySlotId; customers may cancel eligible bookings. A quote acceptance alone remains REQUESTED and is not confirmed.",
      inputSchema: BookingStatusInput,
      securitySchemes: oauthSecurity(["sentin:bookings:write"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      _meta: { ui: { resourceUri: MARKETPLACE_RESOURCE_URI } },
    } as any,
    async (input: z.infer<typeof BookingStatusInput>, ctx: ToolContext) => {
      const denied = authError(ctx, ["sentin:bookings:write"], origin);
      if (denied) return denied as never;
      const auth = ctx.http?.authInfo;
      if (!isSentinAuthInfo(auth)) return authError({}, ["sentin:bookings:write"], origin) as never;
      const result = await updateBookingStatus(auth.userId, input.bookingId, input.status, input.availabilitySlotId);
      return "error" in result
        ? textResult({ error: result.error }, { isError: true })
        : textResult({ type: "booking", booking: result.booking }, { ui: true });
    },
  );

  server.registerTool(
    "sentin_list_my_provider_availability",
    {
      title: "List my availability",
      description: "Read future appointment slots owned by the signed-in provider.",
      inputSchema: ProviderBookingsInput,
      securitySchemes: oauthSecurity(["sentin:availability:read"]),
      annotations: { readOnlyHint: true },
    } as any,
    async (_input: Record<string, never>, ctx: ToolContext) => {
      const denied = authError(ctx, ["sentin:availability:read"], origin);
      if (denied) return denied as never;
      const auth = ctx.http?.authInfo;
      if (!isSentinAuthInfo(auth)) return authError({}, ["sentin:availability:read"], origin) as never;
      const slots = await listProviderAvailability(auth.userId);
      return slots
        ? textResult({ slots })
        : textResult({ error: "Provider profile required" }, { isError: true });
    },
  );

  server.registerTool(
    "sentin_create_provider_availability",
    {
      title: "Publish provider availability",
      description: "Publish one real future appointment slot in UTC. The start and end must not overlap another slot.",
      inputSchema: AvailabilityInput,
      securitySchemes: oauthSecurity(["sentin:availability:write"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    } as any,
    async (input: z.infer<typeof AvailabilityInput>, ctx: ToolContext) => {
      const denied = authError(ctx, ["sentin:availability:write"], origin);
      if (denied) return denied as never;
      const auth = ctx.http?.authInfo;
      if (!isSentinAuthInfo(auth)) return authError({}, ["sentin:availability:write"], origin) as never;
      const result = await createProviderAvailability(auth.userId, input);
      return "error" in result
        ? textResult({ error: result.error }, { isError: true })
        : textResult({ slot: result.slot });
    },
  );

  server.registerTool(
    "sentin_update_provider_availability",
    {
      title: "Block or reopen a provider slot",
      description: "Block an open slot or reopen a blocked slot. A reserved appointment cannot be changed.",
      inputSchema: AvailabilityUpdateInput,
      securitySchemes: oauthSecurity(["sentin:availability:write"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    } as any,
    async ({ slotId, status }: z.infer<typeof AvailabilityUpdateInput>, ctx: ToolContext) => {
      const denied = authError(ctx, ["sentin:availability:write"], origin);
      if (denied) return denied as never;
      const auth = ctx.http?.authInfo;
      if (!isSentinAuthInfo(auth)) return authError({}, ["sentin:availability:write"], origin) as never;
      const result = await updateProviderAvailability(auth.userId, slotId, status);
      return "error" in result
        ? textResult({ error: result.error }, { isError: true })
        : textResult({ slot: result.slot });
    },
  );

  return server;
}

const mcpHandlers = new Map<string, ReturnType<typeof toNodeHandler>>();
const mcpRateLimit = rateLimit({ windowMs: 60 * 1000, max: 120 });

router.all("/mcp", mcpRateLimit, async (req, res): Promise<void> => {
  let origin: string;
  try {
    origin = publicOrigin(req);
  } catch {
    res.status(400).json({ error: "Invalid public request host." });
    return;
  }
  let mcpHandler = mcpHandlers.get(origin);
  if (!mcpHandler) {
    mcpHandler = toNodeHandler(createMcpHandler(() => registerMarketplaceTools(origin)));
    mcpHandlers.set(origin, mcpHandler);
  }

  const authorization = req.get("authorization");
  if (authorization) {
    const match = /^Bearer\s+([A-Za-z0-9_-]+)$/i.exec(authorization);
    if (!match) {
      res.status(401).setHeader("WWW-Authenticate", 'Bearer error="invalid_token"').json({ error: "invalid_token" });
      return;
    }

    const resource = `${origin}/api/mcp`;
    const metadataUrl = `${origin}/.well-known/oauth-protected-resource/api/mcp`;
    const authInfo = await verifyOAuthAccessToken(match[1], resource, metadataUrl);
    if (!authInfo) {
      res.status(401)
        .setHeader("WWW-Authenticate", bearerChallenge(origin, "invalid_token", "Sign in to Sentin to continue."))
        .json({ error: "invalid_token" });
      return;
    }
    (req as Request & { auth?: SentinAuthInfo }).auth = authInfo;
  }

  try {
    await mcpHandler(req, res, req.body);
  } catch (error) {
    logger.error({ error }, "MCP request failed");
    if (!res.headersSent) res.status(500).json({ error: "MCP request failed" });
  }
});

const MARKETPLACE_WIDGET = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light;font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#17323b;background:#fff}
*{box-sizing:border-box}body{margin:0;padding:12px}.eyebrow{margin:0 0 10px;color:#607477;font:600 10px/1.3 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase}
.grid{display:grid;gap:10px}.card{padding:14px;border:1px solid #e0e5df;border-radius:13px;background:#fff}.head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
h2{margin:0;font-size:16px;letter-spacing:-.025em}p{margin:7px 0 0;color:#53666b}.meta{color:#667a7b;font-size:12px}.tag{white-space:nowrap;border-radius:999px;background:#eef4ef;padding:4px 8px;color:#2f685c;font-size:10px;font-weight:700}
.demo{background:#fff5dc;color:#74541a}.price{margin-top:12px;color:#17323b;font-weight:700}.empty{padding:18px;color:#637477;text-align:center;border:1px dashed #d8e0da;border-radius:12px}
button{margin-top:12px;padding:9px 12px;border:0;border-radius:9px;background:#1c5d57;color:white;font-weight:700;cursor:pointer}button:disabled{opacity:.55;cursor:wait}.notice{margin:10px 0;color:#8b392d;font-size:12px}
</style></head><body><div id="app"><p class="eyebrow">Sentin marketplace</p><div class="empty">Loading results…</div></div>
<script>
const app=document.getElementById("app"),pending=new Map();let nextId=0;
function safeText(value){return value==null?"":String(value)}
function node(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el}
function rpcNotify(method,params){window.parent.postMessage({jsonrpc:"2.0",method,params},"*")}
function rpc(method,params){return new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});window.parent.postMessage({jsonrpc:"2.0",id,method,params},"*")})}
function card(name,detail,tag,price){const el=node("article","card"),head=node("div","head"),titles=node("div","");titles.append(node("h2","",name));if(detail)titles.append(node("p","",detail));head.append(titles);if(tag)head.append(node("span","tag"+(tag==="DEMO DATA"?" demo":""),tag));el.append(head);if(price)el.append(node("p","price",price));return el}
function render(data){
 app.replaceChildren(node("p","eyebrow","Sentin marketplace"));
 const grid=node("div","grid");app.append(grid);
 if(!data){grid.append(node("div","empty","No result details were returned."));return}
 const type=data.type;
 if(type==="providers"){
   const providers=Array.isArray(data.providers)?data.providers:[];
   if(!providers.length){grid.append(node("div","empty","No providers matched this search."));return}
   for(const p of providers){const tag=p.isDemo?"DEMO DATA":(p.verificationStatus==="VERIFIED"?"VERIFIED":"UNVERIFIED");
     const price=p.minimumPrice==null&&p.maximumPrice==null?"Price not listed":(p.minimumPrice==null?"From "+p.currency+" "+p.maximumPrice:p.maximumPrice==null?"From "+p.currency+" "+p.minimumPrice:p.currency+" "+p.minimumPrice+"–"+p.maximumPrice);
     grid.append(card(safeText(p.companyName),[p.city,p.countryCode].filter(Boolean).join(", ")+ (p.description?" · "+p.description:""),tag,price));
   }
  }else if(type==="concierge"){
    if(data.safetyGuidance)grid.append(card("Safety note",safeText(data.safetyGuidance),"IMPORTANT",""));
    if(data.status==="NEEDS_CLARIFICATION")grid.append(card("One detail needed",safeText(data.clarifyingQuestion),""));
    else if(data.job)grid.append(card("Request created",safeText(data.job.serviceName)+" · "+safeText(data.job.city)+", "+safeText(data.job.countryCode),safeText(data.status),safeText(data.matchedProviderCount)+" matched providers"));
    else grid.append(node("div","empty","Sentin could not confirm a created request."));
  }else if(type==="availability"){
    const slots=Array.isArray(data.slots)?data.slots:[];
    if(!slots.length)grid.append(node("div","empty","No open appointment slots are currently published."));
    for(const slot of slots)grid.append(card("Available appointment",new Date(slot.startsAt).toLocaleString()+" – "+new Date(slot.endsAt).toLocaleTimeString(),safeText(slot.status),""));
 }else if(type==="quotes"){
   const quotes=Array.isArray(data.quotes)?data.quotes:[];
   if(!quotes.length){grid.append(node("div","empty","No provider quotes have arrived yet."));return}
   for(const q of quotes){const el=card(safeText(q.providerName),safeText(q.description),q.isDemo?"DEMO DATA":safeText(q.status),safeText(q.currency)+" "+safeText(q.amount));
     if(q.expiresAt)el.append(node("p","meta","Expires "+safeText(q.expiresAt)));
      if(q.status==="SENT"){const button=node("button","","Accept quote");button.type="button";button.onclick=async()=>{button.disabled=true;try{await bridgeReady;const result=await rpc("tools/call",{name:"sentin_accept_quote",arguments:{quoteId:q.id}});if(result?.structuredContent)render(result.structuredContent);else if(result?.content?.[0]?.text)app.append(node("p","notice",result.content[0].text));}catch{app.append(node("p","notice","The quote could not be accepted. Check the request status and try again."))}finally{button.disabled=false}};el.append(button)}
     grid.append(el);
   }
 }else if(type==="booking"){
   const b=data.booking;if(!b){grid.append(node("div","empty","Booking details are not available."));return}
    const el=card(safeText(b.providerName),"Booking "+safeText(b.id),safeText(b.status),b.scheduledAt?"Scheduled "+safeText(b.scheduledAt):"Schedule not set");el.append(node("p","meta",b.paymentStatus==="NOT_CONFIGURED"?"No online payment was collected.":"Payment status: "+safeText(b.paymentStatus)));grid.append(el);
 }else if(type==="provider"){
   const p=data.provider;if(!p){grid.append(node("div","empty","Provider details are not available."));return}
   grid.append(card(safeText(p.companyName),safeText(p.description),p.isDemo?"DEMO DATA":safeText(p.verificationStatus),""));
 }else{grid.append(node("div","empty","Sentin returned a result."))}
}
window.addEventListener("message",event=>{
 if(event.source!==window.parent)return;const msg=event.data;if(!msg||msg.jsonrpc!=="2.0")return;
 if(msg.id!==undefined&&pending.has(msg.id)){const p=pending.get(msg.id);pending.delete(msg.id);if(msg.error)p.reject(msg.error);else p.resolve(msg.result);return}
 if(msg.method==="ui/notifications/tool-result"){const data=msg.params?.structuredContent??msg.params?.result?.structuredContent;render(data)}
});
const bridgeReady=rpc("ui/initialize",{appInfo:{name:"sentin-marketplace",version:"1.0.0"},appCapabilities:{},protocolVersion:"2026-01-26"}).then(()=>rpcNotify("ui/notifications/initialized",{}));
</script></body></html>`;

export default router;
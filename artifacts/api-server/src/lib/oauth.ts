import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { db, oauthClientsTable, oauthCodesTable, oauthPendingTable, oauthTokensTable } from "@workspace/db";
import { logger } from "./logger";
import { rateLimit } from "./rate-limit";

export const OAUTH_SCOPES = [
  "sentin:jobs:read",
  "sentin:jobs:write",
  "sentin:bookings:read",
  "sentin:bookings:write",
] as const;

export type OAuthScope = (typeof OAUTH_SCOPES)[number];
export type SentinAuthInfo = AuthInfo & {
  userId: string;
  resourceMetadataUrl: string;
};

const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000;
const PENDING_CONSENT_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const router: IRouter = Router();

let lastPruneAt = 0;
async function pruneExpiredOAuthRecords(): Promise<void> {
  if (Date.now() - lastPruneAt < 60 * 60 * 1000) return;
  lastPruneAt = Date.now();
  const now = new Date();
  try {
    await db.delete(oauthPendingTable).where(lt(oauthPendingTable.expiresAt, now));
    await db.delete(oauthCodesTable).where(lt(oauthCodesTable.expiresAt, now));
    await db.delete(oauthTokensTable).where(
      and(lt(oauthTokensTable.expiresAt, now), isNull(oauthTokensTable.revokedAt)),
    );
  } catch (error) {
    logger.warn({ error }, "OAuth expiry cleanup failed");
  }
}

export function publicOrigin(req: Request): string {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = process.env.NODE_ENV === "production"
    ? "https"
    : (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)?.split(",")[0]?.trim() || req.protocol;
  const forwardedHost = req.headers["x-forwarded-host"];
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost)?.split(",")[0]?.trim()
    || req.get("host");
  if (!host || !["http", "https"].includes(protocol)) {
    throw new Error("Unable to determine the public request origin.");
  }

  const parsed = new URL(`${protocol}://${host}`);
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Invalid public request host.");
  }
  return parsed.origin;
}

export function authorizationServerMetadata(origin: string) {
  const issuer = `${origin}/api/oauth`;
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    revocation_endpoint: `${issuer}/revoke`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [...OAUTH_SCOPES],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: false,
  };
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [`${origin}/api/oauth`],
    bearer_methods_supported: ["header"],
    scopes_supported: [...OAUTH_SCOPES],
  };
}

export function protectedResourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource/api/mcp`;
}

export function bearerChallenge(origin: string, error: "invalid_token" | "insufficient_scope", description: string): string {
  const safeDescription = description.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", " ");
  return `Bearer resource_metadata="${protectedResourceMetadataUrl(origin)}", error="${error}", error_description="${safeDescription}"`;
}

export async function verifyOAuthAccessToken(
  token: string,
  resource: string,
  metadataUrl: string,
): Promise<SentinAuthInfo | null> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const [row] = await db.select().from(oauthTokensTable)
    .where(and(
      eq(oauthTokensTable.tokenHash, tokenHash),
      eq(oauthTokensTable.resource, resource),
      isNull(oauthTokensTable.revokedAt),
    ))
    .limit(1);
  if (!row || row.expiresAt.getTime() <= Date.now()) return null;
  return {
    token,
    clientId: row.clientId,
    scopes: row.scopes,
    expiresAt: Math.floor(row.expiresAt.getTime() / 1000),
    resource: new URL(row.resource),
    userId: row.userId,
    resourceMetadataUrl: metadataUrl,
  } as SentinAuthInfo;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function isAllowedRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    return ["http:", "https:"].includes(url.protocol);
  }
  if (url.protocol !== "https:") return false;
  if (!["chatgpt.com", "chat.openai.com"].includes(url.hostname)) return false;
  return url.pathname.startsWith("/connector/oauth")
    || url.pathname === "/connector_platform_oauth_redirect";
}

function scopesFromRequest(value: string | null): OAuthScope[] | null {
  const requested = value ? [...new Set(value.trim().split(/\s+/).filter(Boolean))] : [...OAUTH_SCOPES];
  if (!requested.every((scope): scope is OAuthScope => OAUTH_SCOPES.includes(scope as OAuthScope))) return null;
  return requested;
}

function noStore(res: Response): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
}

const registerRateLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 30 });
router.post("/register", registerRateLimit, async (req, res): Promise<void> => {
  await pruneExpiredOAuthRecords();
  const body = req.body as Record<string, unknown>;
  const clientName = asString(body.client_name)?.trim() || "MCP client";
  const redirects = body.redirect_uris;
  if (
    clientName.length > 120
    || !Array.isArray(redirects)
    || redirects.length < 1
    || redirects.length > 10
    || !redirects.every((uri) => typeof uri === "string" && isAllowedRedirectUri(uri))
  ) {
    res.status(400).json({
      error: "invalid_client_metadata",
      error_description: "Use a short client name and approved ChatGPT or localhost redirect URIs.",
    });
    return;
  }

  const grantTypes = body.grant_types;
  const responseTypes = body.response_types;
  const tokenAuthMethod = body.token_endpoint_auth_method;
  if (
    (grantTypes !== undefined && (!Array.isArray(grantTypes) || grantTypes.some((value) => value !== "authorization_code")))
    || (responseTypes !== undefined && (!Array.isArray(responseTypes) || responseTypes.some((value) => value !== "code")))
    || (tokenAuthMethod !== undefined && tokenAuthMethod !== "none")
  ) {
    res.status(400).json({ error: "invalid_client_metadata" });
    return;
  }

  const clientId = `sentin_${randomBytes(24).toString("base64url")}`;
  const redirectUris = redirects as string[];
  await db.insert(oauthClientsTable).values({
    clientId,
    clientName,
    redirectUris,
  });
  noStore(res);
  res.status(201).json({
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
});

const authorizeRateLimit = rateLimit({ windowMs: 60 * 1000, max: 60 });
router.get("/authorize", authorizeRateLimit, async (req, res): Promise<void> => {
  const query = req.query;
  const responseType = asString(query.response_type);
  const clientId = asString(query.client_id);
  const redirectUri = asString(query.redirect_uri);
  const state = asString(query.state);
  const challenge = asString(query.code_challenge);
  const challengeMethod = asString(query.code_challenge_method);
  const resource = asString(query.resource);
  const scopeString = asString(query.scope);
  const scopes = scopesFromRequest(scopeString);

  if (
    responseType !== "code"
    || !clientId
    || !redirectUri
    || !state
    || state.length > 512
    || !challenge
    || !/^[A-Za-z0-9_-]{43}$/.test(challenge)
    || challengeMethod !== "S256"
    || !scopes
  ) {
    res.status(400).send("Invalid OAuth authorization request.");
    return;
  }

  let origin: string;
  try {
    origin = publicOrigin(req);
  } catch {
    res.status(400).send("Invalid OAuth issuer host.");
    return;
  }
  if (resource !== `${origin}/api/mcp`) {
    res.status(400).send("The requested resource is not supported.");
    return;
  }

  const [client] = await db.select().from(oauthClientsTable)
    .where(eq(oauthClientsTable.clientId, clientId))
    .limit(1);
  if (!client || !client.redirectUris.includes(redirectUri) || !isAllowedRedirectUri(redirectUri)) {
    res.status(400).send("The OAuth client or redirect URI is not registered.");
    return;
  }

  const userId = getAuth(req).userId;
  if (!userId) {
    const callback = new URL(req.originalUrl, origin).toString();
    const signIn = new URL("/sign-in", origin);
    signIn.searchParams.set("redirect_url", callback);
    res.redirect(302, signIn.toString());
    return;
  }

  const [pending] = await db.insert(oauthPendingTable).values({
    userId,
    clientId,
    redirectUri,
    state,
    codeChallenge: challenge,
    scopes,
    resource,
    expiresAt: new Date(Date.now() + PENDING_CONSENT_TTL_MS),
  }).returning({ id: oauthPendingTable.id });
  noStore(res);
  const action = `${origin}/api/oauth/authorize/decision`;
  const scopeList = scopes.map((scope) => `<li>${escapeHtml(scope)}</li>`).join("");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Sentin</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f5f3ec;color:#17323b;font:16px/1.5 system-ui,sans-serif}
main{width:min(100%,480px);padding:32px;border:1px solid #d8ded7;border-radius:18px;background:#fff;box-shadow:0 16px 50px #17323b12}
h1{margin:0 0 8px;font-size:26px;letter-spacing:-.04em}p{color:#53666b}ul{padding:16px 20px;background:#f5f8f4;border-radius:12px;font-size:14px}
.actions{display:flex;gap:12px;margin-top:24px}.actions button{flex:1;padding:12px;border:0;border-radius:10px;font-weight:700;cursor:pointer}
.allow{background:#1c5d57;color:#fff}.deny{background:#edf0ec;color:#17323b}
</style></head><body><main><p style="margin:0 0 4px;color:#1c5d57;font-weight:700">sentin.</p>
<h1>Connect your account</h1><p><strong>${escapeHtml(client.clientName)}</strong> is requesting access to your Sentin account.</p>
<p>It will be able to:</p><ul>${scopeList}</ul><p>You can revoke this access later from your account settings.</p>
<form method="post" action="${escapeHtml(action)}"><input type="hidden" name="pending_id" value="${escapeHtml(pending.id)}">
<div class="actions"><button class="deny" type="submit" name="decision" value="deny">Cancel</button>
<button class="allow" type="submit" name="decision" value="allow">Allow access</button></div></form></main></body></html>`);
});

const decisionRateLimit = rateLimit({ windowMs: 60 * 1000, max: 20 });
router.post("/authorize/decision", decisionRateLimit, async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;
  const pendingId = asString(req.body?.pending_id);
  const decision = asString(req.body?.decision);
  if (!userId || !pendingId || !["allow", "deny"].includes(decision || "")) {
    res.status(400).send("Invalid consent request.");
    return;
  }

  const code = decision === "allow" ? randomBytes(32).toString("base64url") : null;
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [pending] = await tx.select().from(oauthPendingTable)
      .where(and(
        eq(oauthPendingTable.id, pendingId),
        eq(oauthPendingTable.userId, userId),
        gt(oauthPendingTable.expiresAt, now),
      ))
      .for("update")
      .limit(1);
    if (!pending || pending.expiresAt.getTime() <= now.getTime()) return null;
    await tx.delete(oauthPendingTable).where(eq(oauthPendingTable.id, pending.id));
    if (code) {
      await tx.insert(oauthCodesTable).values({
        codeHash: hash(code),
        userId,
        clientId: pending.clientId,
        redirectUri: pending.redirectUri,
        codeChallenge: pending.codeChallenge,
        scopes: pending.scopes,
        resource: pending.resource,
        expiresAt: new Date(now.getTime() + AUTHORIZATION_CODE_TTL_MS),
      });
    }
    return pending;
  });

  if (!result) {
    res.status(410).send("This authorization request expired. Return to ChatGPT and try again.");
    return;
  }
  const redirect = new URL(result.redirectUri);
  if (code) {
    redirect.searchParams.set("code", code);
  } else {
    redirect.searchParams.set("error", "access_denied");
    redirect.searchParams.set("error_description", "The Sentin account connection was not approved.");
  }
  redirect.searchParams.set("state", result.state);
  redirect.searchParams.set("iss", `${publicOrigin(req)}/api/oauth`);
  res.redirect(302, redirect.toString());
});

const tokenRateLimit = rateLimit({ windowMs: 60 * 1000, max: 60 });
router.post("/token", tokenRateLimit, async (req, res): Promise<void> => {
  await pruneExpiredOAuthRecords();
  const grantType = asString(req.body?.grant_type);
  const code = asString(req.body?.code);
  const clientId = asString(req.body?.client_id);
  const redirectUri = asString(req.body?.redirect_uri);
  const verifier = asString(req.body?.code_verifier);
  const resource = asString(req.body?.resource);
  if (
    grantType !== "authorization_code"
    || !code
    || !clientId
    || !redirectUri
    || !verifier
    || verifier.length < 43
    || verifier.length > 128
    || !/^[A-Za-z0-9._~-]+$/.test(verifier)
    || !resource
  ) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  let origin: string;
  try {
    origin = publicOrigin(req);
  } catch {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  if (resource !== `${origin}/api/mcp`) {
    res.status(400).json({ error: "invalid_target" });
    return;
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);
  const exchanged = await db.transaction(async (tx) => {
    const [authorizationCode] = await tx.select().from(oauthCodesTable)
      .where(and(
        eq(oauthCodesTable.codeHash, hash(code)),
        eq(oauthCodesTable.clientId, clientId),
        eq(oauthCodesTable.redirectUri, redirectUri),
        eq(oauthCodesTable.resource, resource),
        isNull(oauthCodesTable.consumedAt),
        gt(oauthCodesTable.expiresAt, new Date()),
      ))
      .for("update")
      .limit(1);
    if (!authorizationCode || authorizationCode.expiresAt.getTime() <= Date.now()) return null;
    if (!safeEqual(pkceChallenge(verifier), authorizationCode.codeChallenge)) return null;

    const [consumed] = await tx.update(oauthCodesTable)
      .set({ consumedAt: new Date() })
      .where(and(
        eq(oauthCodesTable.codeHash, authorizationCode.codeHash),
        isNull(oauthCodesTable.consumedAt),
      ))
      .returning({ codeHash: oauthCodesTable.codeHash });
    if (!consumed) return null;
    await tx.insert(oauthTokensTable).values({
      tokenHash: hash(token),
      userId: authorizationCode.userId,
      clientId,
      scopes: authorizationCode.scopes,
      resource,
      expiresAt,
    });
    return authorizationCode;
  });

  if (!exchanged) {
    res.status(400).json({ error: "invalid_grant" });
    return;
  }
  noStore(res);
  res.json({
    access_token: token,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    scope: exchanged.scopes.join(" "),
    resource,
  });
});

router.post("/revoke", rateLimit({ windowMs: 60 * 1000, max: 60 }), async (req, res): Promise<void> => {
  const token = asString(req.body?.token);
  const clientId = asString(req.body?.client_id);
  if (token && clientId) {
    await db.update(oauthTokensTable)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(oauthTokensTable.tokenHash, hash(token)),
        eq(oauthTokensTable.clientId, clientId),
        isNull(oauthTokensTable.revokedAt),
      ));
  }
  noStore(res);
  res.status(200).end();
});

export default router;
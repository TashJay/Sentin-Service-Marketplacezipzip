import { createInsertSchema } from "drizzle-zod";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const oauthClientsTable = pgTable("oauth_clients", {
  clientId: text("client_id").primaryKey(),
  clientName: text("client_name").notNull(),
  redirectUris: text("redirect_uris").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const oauthPendingTable = pgTable(
  "oauth_pending",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    clientId: text("client_id").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    state: text("state").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    scopes: text("scopes").array().notNull(),
    resource: text("resource").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("oauth_pending_expires_idx").on(table.expiresAt)],
);

export const oauthCodesTable = pgTable(
  "oauth_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    userId: text("user_id").notNull(),
    clientId: text("client_id").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    scopes: text("scopes").array().notNull(),
    resource: text("resource").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("oauth_codes_expires_idx").on(table.expiresAt)],
);

export const oauthTokensTable = pgTable(
  "oauth_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id").notNull(),
    clientId: text("client_id").notNull(),
    scopes: text("scopes").array().notNull(),
    resource: text("resource").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("oauth_tokens_user_idx").on(table.userId, table.expiresAt)],
);

export const insertOauthClientSchema = createInsertSchema(oauthClientsTable);
export const insertOauthPendingSchema = createInsertSchema(oauthPendingTable).omit({
  id: true,
  createdAt: true,
});
export const insertOauthCodeSchema = createInsertSchema(oauthCodesTable).omit({
  createdAt: true,
});
export const insertOauthTokenSchema = createInsertSchema(oauthTokensTable).omit({
  createdAt: true,
});
export type OauthClientInput = z.infer<typeof insertOauthClientSchema>;
export type OauthPendingInput = z.infer<typeof insertOauthPendingSchema>;
export type OauthCodeInput = z.infer<typeof insertOauthCodeSchema>;
export type OauthTokenInput = z.infer<typeof insertOauthTokenSchema>;
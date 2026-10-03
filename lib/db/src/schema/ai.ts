import { createInsertSchema } from "drizzle-zod";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { jobsTable } from "./jobs";

export const aiConversationsTable = pgTable(
  "ai_conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    jobId: uuid("job_id").references(() => jobsTable.id, { onDelete: "set null" }),
    extractedRequirements: jsonb("extracted_requirements").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ai_conversations_user_updated_idx").on(table.userId, table.updatedAt)],
);

export const aiActionsTable = pgTable(
  "ai_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id").notNull().references(() => aiConversationsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    toolName: text("tool_name").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    output: jsonb("output").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ai_actions_conversation_created_idx").on(table.conversationId, table.createdAt)],
);

export const insertAiConversationSchema = createInsertSchema(aiConversationsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export const insertAiActionSchema = createInsertSchema(aiActionsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAiConversation = z.infer<typeof insertAiConversationSchema>;
export type InsertAiAction = z.infer<typeof insertAiActionSchema>;
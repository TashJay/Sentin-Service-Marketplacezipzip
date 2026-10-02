import { createInsertSchema } from "drizzle-zod";
import { index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { jobsTable } from "./jobs";
import { providersTable } from "./providers";

export const quotesTable = pgTable(
  "quotes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id").notNull().references(() => jobsTable.id, { onDelete: "cascade" }),
    providerId: uuid("provider_id").notNull().references(() => providersTable.id),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull(),
    description: text("description").notNull(),
    durationMinutes: integer("duration_minutes"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: text("status").notNull().default("SENT"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("quotes_job_provider_unique").on(table.jobId, table.providerId),
    index("quotes_job_status_idx").on(table.jobId, table.status),
  ],
);

export const insertQuoteSchema = createInsertSchema(quotesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertQuote = z.infer<typeof insertQuoteSchema>;
export type QuoteRecord = typeof quotesTable.$inferSelect;
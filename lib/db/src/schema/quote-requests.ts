import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { jobsTable } from "./jobs";
import { providersTable } from "./providers";

export const quoteRequestsTable = pgTable(
  "quote_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id").notNull().references(() => jobsTable.id, { onDelete: "cascade" }),
    providerId: uuid("provider_id").notNull().references(() => providersTable.id),
    status: text("status").notNull().default("REQUESTED"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("quote_requests_job_provider_unique").on(table.jobId, table.providerId),
    index("quote_requests_provider_status_idx").on(table.providerId, table.status),
  ],
);

export const insertQuoteRequestSchema = createInsertSchema(quoteRequestsTable).omit({
  id: true,
  requestedAt: true,
});
export type InsertQuoteRequest = z.infer<typeof insertQuoteRequestSchema>;
export type QuoteRequestRecord = typeof quoteRequestsTable.$inferSelect;
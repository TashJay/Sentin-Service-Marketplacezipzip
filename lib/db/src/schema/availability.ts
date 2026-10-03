import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { providersTable } from "./providers";

export const providerAvailabilityTable = pgTable(
  "provider_availability",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerId: uuid("provider_id").notNull().references(() => providersTable.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("OPEN"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("provider_availability_provider_start_unique").on(table.providerId, table.startsAt),
    index("provider_availability_provider_status_start_idx").on(table.providerId, table.status, table.startsAt),
  ],
);

export const insertProviderAvailabilitySchema = createInsertSchema(providerAvailabilityTable).omit({
  id: true,
  createdAt: true,
});
export type InsertProviderAvailability = z.infer<typeof insertProviderAvailabilitySchema>;
export type ProviderAvailabilityRecord = typeof providerAvailabilityTable.$inferSelect;
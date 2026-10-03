import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { jobsTable } from "./jobs";
import { providersTable } from "./providers";
import { quotesTable } from "./quotes";
import { providerAvailabilityTable } from "./availability";

export const bookingsTable = pgTable(
  "bookings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id").notNull().references(() => jobsTable.id),
    quoteId: uuid("quote_id").notNull().references(() => quotesTable.id),
    providerId: uuid("provider_id").notNull().references(() => providersTable.id),
    availabilitySlotId: uuid("availability_slot_id").references(() => providerAvailabilityTable.id),
    customerUserId: text("customer_user_id").notNull(),
    status: text("status").notNull().default("REQUESTED"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("bookings_quote_unique").on(table.quoteId),
    uniqueIndex("bookings_availability_slot_unique").on(table.availabilitySlotId),
    index("bookings_customer_created_idx").on(table.customerUserId, table.createdAt),
    index("bookings_provider_status_idx").on(table.providerId, table.status),
  ],
);

export const insertBookingSchema = createInsertSchema(bookingsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type BookingRecord = typeof bookingsTable.$inferSelect;
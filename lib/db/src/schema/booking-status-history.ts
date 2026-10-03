import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { bookingsTable } from "./bookings";

export const bookingStatusHistoryTable = pgTable(
  "booking_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookingId: uuid("booking_id").notNull().references(() => bookingsTable.id, { onDelete: "cascade" }),
    actorId: text("actor_id").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("booking_status_history_booking_created_idx").on(table.bookingId, table.createdAt)],
);

export const insertBookingStatusHistorySchema = createInsertSchema(bookingStatusHistoryTable).omit({
  id: true,
  createdAt: true,
});
export type InsertBookingStatusHistory = z.infer<typeof insertBookingStatusHistorySchema>;
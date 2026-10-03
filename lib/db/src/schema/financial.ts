import { createInsertSchema } from "drizzle-zod";
import { bigint, index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { bookingsTable } from "./bookings";

export const paymentsTable = pgTable(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookingId: uuid("booking_id").notNull().references(() => bookingsTable.id),
    customerUserId: text("customer_user_id").notNull(),
    provider: text("provider").notNull().default("UNCONFIGURED"),
    status: text("status").notNull().default("NOT_CONFIGURED"),
    amount: numeric("amount", { precision: 18, scale: 6 }).notNull(),
    currency: text("currency").notNull(),
    externalPaymentId: text("external_payment_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payments_booking_unique").on(table.bookingId),
    uniqueIndex("payments_idempotency_unique").on(table.idempotencyKey),
    index("payments_customer_created_idx").on(table.customerUserId, table.createdAt),
  ],
);

export const paymentAttemptsTable = pgTable(
  "payment_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paymentId: uuid("payment_id").notNull().references(() => paymentsTable.id),
    provider: text("provider").notNull(),
    status: text("status").notNull(),
    externalReference: text("external_reference"),
    failureCode: text("failure_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("payment_attempts_payment_created_idx").on(table.paymentId, table.createdAt)],
);

export const ledgerEntriesTable = pgTable(
  "ledger_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    transactionId: uuid("transaction_id").notNull(),
    bookingId: uuid("booking_id").references(() => bookingsTable.id),
    paymentId: uuid("payment_id").references(() => paymentsTable.id),
    eventType: text("event_type").notNull(),
    accountCode: text("account_code").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    reference: text("reference"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ledger_entries_idempotency_unique").on(table.idempotencyKey),
    index("ledger_entries_transaction_idx").on(table.transactionId),
    index("ledger_entries_booking_created_idx").on(table.bookingId, table.createdAt),
  ],
);

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertPaymentAttemptSchema = createInsertSchema(paymentAttemptsTable).omit({
  id: true,
  createdAt: true,
});
export const insertLedgerEntrySchema = createInsertSchema(ledgerEntriesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type InsertPaymentAttempt = z.infer<typeof insertPaymentAttemptSchema>;
export type InsertLedgerEntry = z.infer<typeof insertLedgerEntrySchema>;
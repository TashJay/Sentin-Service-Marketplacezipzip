import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { servicesTable } from "./services";

export const jobsTable = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerUserId: text("customer_user_id").notNull(),
    serviceSlug: text("service_slug").notNull().references(() => servicesTable.slug),
    description: text("description").notNull(),
    city: text("city").notNull(),
    countryCode: text("country_code").notNull(),
    urgency: text("urgency").notNull().default("unknown"),
    propertyType: text("property_type").notNull().default("unknown"),
    status: text("status").notNull().default("OPEN"),
    matchedProviderCount: integer("matched_provider_count").notNull().default(0),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("jobs_customer_created_idx").on(table.customerUserId, table.createdAt),
    uniqueIndex("jobs_customer_idempotency_unique")
      .on(table.customerUserId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
  ],
);

export const insertJobSchema = createInsertSchema(jobsTable).omit({
  id: true,
  matchedProviderCount: true,
  createdAt: true,
});
export type InsertJob = z.infer<typeof insertJobSchema>;
export type JobRecord = typeof jobsTable.$inferSelect;
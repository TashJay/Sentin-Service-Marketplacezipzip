import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const providersTable = pgTable(
  "providers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: text("owner_id"),
    companyName: text("company_name").notNull(),
    description: text("description").notNull(),
    serviceSlugs: text("service_slugs").array().notNull(),
    city: text("city").notNull(),
    countryCode: text("country_code").notNull(),
    verificationStatus: text("verification_status").notNull().default("UNVERIFIED"),
    averageRating: numeric("average_rating", { precision: 3, scale: 2 }),
    reviewCount: integer("review_count").notNull().default(0),
    minimumPrice: numeric("minimum_price", { precision: 12, scale: 2 }),
    maximumPrice: numeric("maximum_price", { precision: 12, scale: 2 }),
    currency: text("currency").notNull().default("USD"),
    isDemo: boolean("is_demo").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("providers_owner_id_unique").on(table.ownerId).where(sql`${table.ownerId} is not null`),
    index("providers_city_country_idx").on(table.city, table.countryCode),
    index("providers_service_slugs_gin_idx").using("gin", table.serviceSlugs),
  ],
);

export const insertProviderSchema = createInsertSchema(providersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertProvider = z.infer<typeof insertProviderSchema>;
export type ProviderRecord = typeof providersTable.$inferSelect;
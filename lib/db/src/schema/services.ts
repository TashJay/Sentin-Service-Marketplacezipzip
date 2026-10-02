import { createInsertSchema } from "drizzle-zod";
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const servicesTable = pgTable("services", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertServiceSchema = createInsertSchema(servicesTable).omit({
  createdAt: true,
});
export type InsertService = z.infer<typeof insertServiceSchema>;
export type ServiceRecord = typeof servicesTable.$inferSelect;
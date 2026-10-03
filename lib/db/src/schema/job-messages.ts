import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { jobsTable } from "./jobs";

export const jobMessagesTable = pgTable(
  "job_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id").notNull().references(() => jobsTable.id, { onDelete: "cascade" }),
    senderUserId: text("sender_user_id").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("job_messages_job_created_idx").on(table.jobId, table.createdAt)],
);

export const insertJobMessageSchema = createInsertSchema(jobMessagesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertJobMessage = z.infer<typeof insertJobMessageSchema>;
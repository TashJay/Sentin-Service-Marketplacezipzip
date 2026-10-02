import {
  and,
  arrayContains,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  auditLogsTable,
  bookingsTable,
  db,
  jobsTable,
  providersTable,
  quoteRequestsTable,
  quotesTable,
  servicesTable,
} from "@workspace/db";
import type { JobInput, ProviderProfileInput, QuoteInput } from "@workspace/api-zod";

const isProduction = process.env.NODE_ENV === "production";

type ProviderSearch = { serviceSlug?: string; location?: string; limit?: number };

const visibleProviderFilters = () => [
  eq(providersTable.active, true),
  ne(providersTable.verificationStatus, "SUSPENDED"),
  ne(providersTable.verificationStatus, "REJECTED"),
  ...(isProduction ? [eq(providersTable.isDemo, false)] : []),
];

export function toProvider(row: typeof providersTable.$inferSelect) {
  return {
    id: row.id,
    companyName: row.companyName,
    description: row.description,
    serviceSlugs: row.serviceSlugs,
    city: row.city,
    countryCode: row.countryCode,
    verificationStatus: row.verificationStatus,
    averageRating: row.averageRating === null ? null : Number(row.averageRating),
    reviewCount: row.reviewCount,
    minimumPrice: row.minimumPrice === null ? null : Number(row.minimumPrice),
    maximumPrice: row.maximumPrice === null ? null : Number(row.maximumPrice),
    currency: row.currency,
    isDemo: row.isDemo,
  };
}

async function toJob(row: typeof jobsTable.$inferSelect) {
  const [service] = await db
    .select({ name: servicesTable.name })
    .from(servicesTable)
    .where(eq(servicesTable.slug, row.serviceSlug))
    .limit(1);
  return {
    id: row.id,
    serviceSlug: row.serviceSlug,
    serviceName: service?.name ?? row.serviceSlug,
    description: row.description,
    city: row.city,
    countryCode: row.countryCode,
    urgency: row.urgency,
    propertyType: row.propertyType,
    status: row.status,
    matchedProviderCount: row.matchedProviderCount,
    createdAt: row.createdAt.toISOString(),
  };
}

async function toQuote(row: typeof quotesTable.$inferSelect) {
  const [provider] = await db
    .select({ companyName: providersTable.companyName, isDemo: providersTable.isDemo })
    .from(providersTable)
    .where(eq(providersTable.id, row.providerId))
    .limit(1);
  return {
    id: row.id,
    jobId: row.jobId,
    providerId: row.providerId,
    providerName: provider?.companyName ?? "Provider",
    amount: Number(row.amount),
    currency: row.currency,
    description: row.description,
    durationMinutes: row.durationMinutes,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    status: row.status,
    isDemo: provider?.isDemo ?? false,
    createdAt: row.createdAt.toISOString(),
  };
}

async function toBooking(row: typeof bookingsTable.$inferSelect) {
  const [provider] = await db
    .select({ companyName: providersTable.companyName })
    .from(providersTable)
    .where(eq(providersTable.id, row.providerId))
    .limit(1);
  return {
    id: row.id,
    jobId: row.jobId,
    quoteId: row.quoteId,
    providerId: row.providerId,
    providerName: provider?.companyName ?? "Provider",
    status: row.status,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listServices() {
  return db.select({
    slug: servicesTable.slug,
    name: servicesTable.name,
    category: servicesTable.category,
  }).from(servicesTable).where(eq(servicesTable.active, true)).orderBy(asc(servicesTable.category), asc(servicesTable.name));
}

export async function searchProviders({ serviceSlug, location, limit = 20 }: ProviderSearch) {
  const filters = visibleProviderFilters();
  if (serviceSlug) filters.push(arrayContains(providersTable.serviceSlugs, [serviceSlug]));
  if (location?.trim()) {
    const pattern = `%${location.trim().replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    filters.push(or(ilike(providersTable.city, pattern), ilike(providersTable.countryCode, pattern))!);
  }
  const rows = await db.select().from(providersTable)
    .where(and(...filters))
    .orderBy(desc(sql`case when ${providersTable.verificationStatus} = 'VERIFIED' then 1 else 0 end`), asc(providersTable.companyName))
    .limit(Math.max(1, Math.min(limit, 50)));
  return rows.map(toProvider);
}

export async function getProvider(providerId: string) {
  const [row] = await db.select().from(providersTable)
    .where(and(eq(providersTable.id, providerId), ...visibleProviderFilters()))
    .limit(1);
  return row ? toProvider(row) : null;
}

export async function listMyJobs(userId: string) {
  const rows = await db.select().from(jobsTable)
    .where(eq(jobsTable.customerUserId, userId))
    .orderBy(desc(jobsTable.createdAt));
  return Promise.all(rows.map(toJob));
}

export async function getJob(userId: string, jobId: string) {
  const [row] = await db.select().from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.customerUserId, userId)))
    .limit(1);
  return row ? toJob(row) : null;
}

export async function createJob(userId: string, input: JobInput, idempotencyKey?: string) {
  const [service] = await db.select().from(servicesTable)
    .where(and(eq(servicesTable.slug, input.serviceSlug), eq(servicesTable.active, true)))
    .limit(1);
  if (!service) return { error: "SERVICE_NOT_FOUND" as const };

  if (idempotencyKey) {
    const [existing] = await db.select().from(jobsTable)
      .where(and(eq(jobsTable.customerUserId, userId), eq(jobsTable.idempotencyKey, idempotencyKey)))
      .limit(1);
    if (existing) return { job: await toJob(existing), created: false };
  }

  const matches = await db.select({ id: providersTable.id }).from(providersTable)
    .where(and(
      ...visibleProviderFilters(),
      arrayContains(providersTable.serviceSlugs, [input.serviceSlug]),
      ilike(providersTable.city, input.city),
      eq(providersTable.countryCode, input.countryCode.toUpperCase()),
    ));

  const job = await db.transaction(async (tx) => {
    const [created] = await tx.insert(jobsTable).values({
      customerUserId: userId,
      serviceSlug: input.serviceSlug,
      description: input.description.trim(),
      city: input.city.trim(),
      countryCode: input.countryCode.toUpperCase(),
      urgency: input.urgency ?? "unknown",
      propertyType: input.propertyType ?? "unknown",
      matchedProviderCount: matches.length,
      idempotencyKey: idempotencyKey ?? null,
    }).returning();
    if (matches.length) {
      await tx.insert(quoteRequestsTable).values(
        matches.map(({ id }) => ({ jobId: created.id, providerId: id })),
      ).onConflictDoNothing();
    }
    await tx.insert(auditLogsTable).values({
      actorId: userId,
      action: "job.created",
      entityType: "job",
      entityId: created.id,
      metadata: { serviceSlug: input.serviceSlug },
    });
    return created;
  });
  return { job: await toJob(job), created: true };
}

export async function requestQuotes(userId: string, jobId: string) {
  const [job] = await db.select().from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.customerUserId, userId)))
    .limit(1);
  if (!job) return { error: "NOT_FOUND" as const };
  if (job.status === "BOOKED" || job.status === "CANCELLED") return { error: "INVALID_STATE" as const };
  await db.transaction(async (tx) => {
    await tx.update(quoteRequestsTable)
      .set({ status: "OPEN" })
      .where(eq(quoteRequestsTable.jobId, jobId));
    await tx.insert(auditLogsTable).values({
      actorId: userId,
      action: "job.quotes_requested",
      entityType: "job",
      entityId: jobId,
      metadata: { matchedProviderCount: job.matchedProviderCount },
    });
  });
  return { job: await toJob(job) };
}

export async function listJobQuotes(userId: string, jobId: string) {
  const [job] = await db.select({ id: jobsTable.id }).from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.customerUserId, userId)))
    .limit(1);
  if (!job) return null;
  const rows = await db.select().from(quotesTable)
    .where(eq(quotesTable.jobId, jobId))
    .orderBy(desc(quotesTable.createdAt));
  return Promise.all(rows.map(toQuote));
}

export async function createProviderProfile(userId: string, input: ProviderProfileInput) {
  const services = await db.select({ slug: servicesTable.slug }).from(servicesTable)
    .where(and(inArray(servicesTable.slug, input.serviceSlugs), eq(servicesTable.active, true)));
  if (services.length !== input.serviceSlugs.length) return { error: "INVALID_SERVICE" as const };
  const [existing] = await db.select().from(providersTable).where(eq(providersTable.ownerId, userId)).limit(1);
  if (existing) return { error: "PROFILE_EXISTS" as const };
  const [row] = await db.insert(providersTable).values({
    ownerId: userId,
    companyName: input.companyName.trim(),
    description: input.description.trim(),
    serviceSlugs: input.serviceSlugs,
    city: input.city.trim(),
    countryCode: input.countryCode.toUpperCase(),
    currency: input.currency.toUpperCase(),
    minimumPrice: input.minimumPrice == null ? null : String(input.minimumPrice),
    maximumPrice: input.maximumPrice == null ? null : String(input.maximumPrice),
    verificationStatus: "UNVERIFIED",
  }).returning();
  await db.insert(auditLogsTable).values({
    actorId: userId,
    action: "provider.profile_created",
    entityType: "provider",
    entityId: row.id,
    metadata: { serviceCount: input.serviceSlugs.length },
  });
  return { provider: toProvider(row) };
}

export async function listProviderRequests(userId: string) {
  const [provider] = await db.select().from(providersTable)
    .where(and(eq(providersTable.ownerId, userId), eq(providersTable.active, true)))
    .limit(1);
  if (!provider) return null;
  const rows = await db.select({ job: jobsTable }).from(quoteRequestsTable)
    .innerJoin(jobsTable, eq(quoteRequestsTable.jobId, jobsTable.id))
    .where(and(
      eq(quoteRequestsTable.providerId, provider.id),
      eq(quoteRequestsTable.status, "OPEN"),
      eq(jobsTable.status, "OPEN"),
    ))
    .orderBy(desc(jobsTable.createdAt));
  return Promise.all(rows.map(({ job }) => toJob(job)));
}

export async function submitQuote(userId: string, jobId: string, input: QuoteInput) {
  const [provider] = await db.select().from(providersTable)
    .where(and(eq(providersTable.ownerId, userId), eq(providersTable.active, true)))
    .limit(1);
  if (!provider) return { error: "PROVIDER_PROFILE_REQUIRED" as const };
  const [match] = await db.select().from(quoteRequestsTable)
    .where(and(eq(quoteRequestsTable.jobId, jobId), eq(quoteRequestsTable.providerId, provider.id)))
    .limit(1);
  if (!match || !["OPEN", "QUOTED"].includes(match.status)) return { error: "NOT_MATCHED" as const };
  const [job] = await db.select().from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.status, "OPEN")))
    .limit(1);
  if (!job) return { error: "JOB_CLOSED" as const };
  const [existing] = await db.select({ id: quotesTable.id }).from(quotesTable)
    .where(and(eq(quotesTable.jobId, jobId), eq(quotesTable.providerId, provider.id)))
    .limit(1);
  if (existing) return { error: "QUOTE_EXISTS" as const };

  const quote = await db.transaction(async (tx) => {
    const [created] = await tx.insert(quotesTable).values({
      jobId,
      providerId: provider.id,
      amount: String(input.amount),
      currency: input.currency.toUpperCase(),
      description: input.description.trim(),
      durationMinutes: input.durationMinutes ?? null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    }).returning();
    await tx.update(quoteRequestsTable)
      .set({ status: "QUOTED" })
      .where(eq(quoteRequestsTable.id, match.id));
    await tx.update(jobsTable).set({ status: "QUOTED" }).where(eq(jobsTable.id, jobId));
    await tx.insert(auditLogsTable).values({
      actorId: userId,
      action: "quote.submitted",
      entityType: "quote",
      entityId: created.id,
      metadata: { jobId, currency: created.currency },
    });
    return created;
  });
  return { quote: await toQuote(quote) };
}

export async function acceptQuote(userId: string, quoteId: string) {
  return db.transaction(async (tx) => {
    const [initialQuote] = await tx.select().from(quotesTable)
      .where(eq(quotesTable.id, quoteId)).limit(1);
    if (!initialQuote) return { error: "NOT_FOUND" as const };
    const [job] = await tx.select().from(jobsTable)
      .where(eq(jobsTable.id, initialQuote.jobId))
      .for("update")
      .limit(1);
    if (!job || job.customerUserId !== userId) return { error: "NOT_FOUND" as const };
    const [quote] = await tx.select().from(quotesTable)
      .where(and(eq(quotesTable.id, quoteId), eq(quotesTable.jobId, job.id)))
      .for("update")
      .limit(1);
    if (!quote || quote.status !== "SENT" || job.status === "BOOKED" || job.status === "CANCELLED") {
      return { error: "INVALID_STATE" as const };
    }
    if (quote.expiresAt && quote.expiresAt.getTime() <= Date.now()) {
      await tx.update(quotesTable).set({ status: "EXPIRED" }).where(eq(quotesTable.id, quote.id));
      return { error: "EXPIRED" as const };
    }
    const [booking] = await tx.insert(bookingsTable).values({
      jobId: job.id,
      quoteId: quote.id,
      providerId: quote.providerId,
      customerUserId: userId,
      status: "REQUESTED",
    }).returning();
    await tx.update(quotesTable)
      .set({ status: "ACCEPTED" })
      .where(eq(quotesTable.id, quote.id));
    await tx.update(quotesTable)
      .set({ status: "REJECTED" })
      .where(and(eq(quotesTable.jobId, job.id), ne(quotesTable.id, quote.id), eq(quotesTable.status, "SENT")));
    await tx.update(jobsTable).set({ status: "BOOKED" }).where(eq(jobsTable.id, job.id));
    await tx.insert(auditLogsTable).values({
      actorId: userId,
      action: "quote.accepted",
      entityType: "booking",
      entityId: booking.id,
      metadata: { quoteId, jobId: job.id },
    });
    return { booking: await toBooking(booking) };
  });
}

export async function getBooking(userId: string, bookingId: string) {
  const [row] = await db.select().from(bookingsTable)
    .where(and(eq(bookingsTable.id, bookingId), eq(bookingsTable.customerUserId, userId)))
    .limit(1);
  return row ? toBooking(row) : null;
}

export async function listMyBookings(userId: string) {
  const rows = await db.select().from(bookingsTable)
    .where(eq(bookingsTable.customerUserId, userId))
    .orderBy(desc(bookingsTable.createdAt));
  return Promise.all(rows.map(toBooking));
}

export async function getDashboardSummary(userId: string) {
  const [openJobs] = await db.select({ value: count() }).from(jobsTable)
    .where(and(eq(jobsTable.customerUserId, userId), inArray(jobsTable.status, ["OPEN", "QUOTED"])));
  const [quotesReceived] = await db.select({ value: count() }).from(quotesTable)
    .innerJoin(jobsTable, eq(quotesTable.jobId, jobsTable.id))
    .where(eq(jobsTable.customerUserId, userId));
  const [activeBookings] = await db.select({ value: count() }).from(bookingsTable)
    .where(and(
      eq(bookingsTable.customerUserId, userId),
      inArray(bookingsTable.status, ["REQUESTED", "PENDING_PROVIDER", "CONFIRMED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"]),
    ));
  const [completedBookings] = await db.select({ value: count() }).from(bookingsTable)
    .where(and(eq(bookingsTable.customerUserId, userId), eq(bookingsTable.status, "COMPLETED")));
  return {
    openJobs: openJobs.value,
    quotesReceived: quotesReceived.value,
    activeBookings: activeBookings.value,
    completedBookings: completedBookings.value,
  };
}
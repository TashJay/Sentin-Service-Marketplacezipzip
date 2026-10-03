import {
  and,
  arrayContains,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  sql,
  lt,
} from "drizzle-orm";
import {
  auditLogsTable,
  bookingsTable,
  bookingStatusHistoryTable,
  db,
  jobsTable,
  jobMessagesTable,
  paymentsTable,
  providerAvailabilityTable,
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
  const [[provider], [payment]] = await Promise.all([
    db.select({ companyName: providersTable.companyName })
    .from(providersTable)
    .where(eq(providersTable.id, row.providerId))
    .limit(1),
    db.select({ status: paymentsTable.status })
      .from(paymentsTable)
      .where(eq(paymentsTable.bookingId, row.id))
      .limit(1),
  ]);
  return {
    id: row.id,
    jobId: row.jobId,
    quoteId: row.quoteId,
    providerId: row.providerId,
    providerName: provider?.companyName ?? "Provider",
    status: row.status,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    availabilitySlotId: row.availabilitySlotId,
    paymentStatus: payment?.status ?? "NOT_CONFIGURED",
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
      inArray(jobsTable.status, ["OPEN", "QUOTED"]),
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
    .where(and(eq(jobsTable.id, jobId), inArray(jobsTable.status, ["OPEN", "QUOTED"])))
    .limit(1);
  if (!job) return { error: "JOB_CLOSED" as const };
  const [existing] = await db.select({ id: quotesTable.id }).from(quotesTable)
    .where(and(
      eq(quotesTable.jobId, jobId),
      eq(quotesTable.providerId, provider.id),
      inArray(quotesTable.status, ["SENT", "ACCEPTED"]),
    ))
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
    await tx.insert(bookingStatusHistoryTable).values({
      bookingId: booking.id,
      actorId: userId,
      fromStatus: null,
      toStatus: "REQUESTED",
      note: "Customer accepted a provider quote; provider confirmation is still required.",
    });
    await tx.insert(paymentsTable).values({
      bookingId: booking.id,
      customerUserId: userId,
      amount: quote.amount,
      currency: quote.currency,
      provider: "UNCONFIGURED",
      status: "NOT_CONFIGURED",
      idempotencyKey: `booking:${booking.id}:payment`,
    });
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
      metadata: { quoteId, jobId: job.id, paymentStatus: "NOT_CONFIGURED" },
    });
    return { booking: await toBooking(booking) };
  });
}

export async function getBooking(userId: string, bookingId: string) {
  const [row] = await db.select({ booking: bookingsTable }).from(bookingsTable)
    .innerJoin(providersTable, eq(bookingsTable.providerId, providersTable.id))
    .where(and(
      eq(bookingsTable.id, bookingId),
      or(eq(bookingsTable.customerUserId, userId), eq(providersTable.ownerId, userId)),
    ))
    .limit(1);
  if (!row) return null;
  const [booking, history] = await Promise.all([
    toBooking(row.booking),
    listBookingStatusHistory(row.booking.id),
  ]);
  return { ...booking, statusHistory: history };
}

export async function listMyBookings(userId: string) {
  const rows = await db.select().from(bookingsTable)
    .where(eq(bookingsTable.customerUserId, userId))
    .orderBy(desc(bookingsTable.createdAt));
  return Promise.all(rows.map(toBooking));
}

async function listBookingStatusHistory(bookingId: string) {
  const rows = await db.select().from(bookingStatusHistoryTable)
    .where(eq(bookingStatusHistoryTable.bookingId, bookingId))
    .orderBy(asc(bookingStatusHistoryTable.createdAt));
  return rows.map((row) => ({
    id: row.id,
    actorId: row.actorId,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function listProviderBookings(userId: string) {
  const rows = await db.select({ booking: bookingsTable })
    .from(bookingsTable)
    .innerJoin(providersTable, eq(bookingsTable.providerId, providersTable.id))
    .where(eq(providersTable.ownerId, userId))
    .orderBy(desc(bookingsTable.createdAt));
  return Promise.all(rows.map(({ booking }) => toBooking(booking)));
}

export async function listProviderAvailability(userId: string) {
  const [provider] = await db.select({ id: providersTable.id }).from(providersTable)
    .where(and(eq(providersTable.ownerId, userId), eq(providersTable.active, true)))
    .limit(1);
  if (!provider) return null;
  const rows = await db.select().from(providerAvailabilityTable)
    .where(and(eq(providerAvailabilityTable.providerId, provider.id), gte(providerAvailabilityTable.endsAt, new Date())))
    .orderBy(asc(providerAvailabilityTable.startsAt))
    .limit(200);
  return rows.map(toAvailability);
}

function toAvailability(row: typeof providerAvailabilityTable.$inferSelect) {
  return {
    id: row.id,
    providerId: row.providerId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    status: row.status,
  };
}

export async function listPublicProviderAvailability(
  providerId: string,
  from = new Date(),
  to = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
) {
  const [provider] = await db.select({ id: providersTable.id }).from(providersTable)
    .where(and(eq(providersTable.id, providerId), ...visibleProviderFilters()))
    .limit(1);
  if (!provider) return null;
  const rows = await db.select().from(providerAvailabilityTable)
    .where(and(
      eq(providerAvailabilityTable.providerId, providerId),
      eq(providerAvailabilityTable.status, "OPEN"),
      gte(providerAvailabilityTable.startsAt, from),
      lt(providerAvailabilityTable.startsAt, to),
      gt(providerAvailabilityTable.endsAt, new Date()),
    ))
    .orderBy(asc(providerAvailabilityTable.startsAt))
    .limit(100);
  return rows.map(toAvailability);
}

export async function createProviderAvailability(
  userId: string,
  input: { startsAt: string; endsAt: string },
) {
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (
    !Number.isFinite(startsAt.getTime())
    || !Number.isFinite(endsAt.getTime())
    || startsAt.getTime() <= Date.now()
    || endsAt.getTime() <= startsAt.getTime()
    || endsAt.getTime() - startsAt.getTime() > 12 * 60 * 60 * 1000
  ) return { error: "INVALID_SLOT" as const };

  return db.transaction(async (tx) => {
    const [provider] = await tx.select().from(providersTable)
      .where(and(eq(providersTable.ownerId, userId), eq(providersTable.active, true)))
      .for("update")
      .limit(1);
    if (!provider) return { error: "PROVIDER_PROFILE_REQUIRED" as const };
    const [overlap] = await tx.select({ id: providerAvailabilityTable.id })
      .from(providerAvailabilityTable)
      .where(and(
        eq(providerAvailabilityTable.providerId, provider.id),
        lt(providerAvailabilityTable.startsAt, endsAt),
        gt(providerAvailabilityTable.endsAt, startsAt),
      ))
      .limit(1);
    if (overlap) return { error: "AVAILABILITY_CONFLICT" as const };
    const [slot] = await tx.insert(providerAvailabilityTable).values({
      providerId: provider.id,
      startsAt,
      endsAt,
      status: "OPEN",
    }).returning();
    await tx.insert(auditLogsTable).values({
      actorId: userId,
      action: "provider.availability_created",
      entityType: "provider_availability",
      entityId: slot.id,
      metadata: { startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString() },
    });
    return { slot: toAvailability(slot) };
  });
}

export async function updateProviderAvailability(
  userId: string,
  slotId: string,
  status: "OPEN" | "BLOCKED",
) {
  return db.transaction(async (tx) => {
    const [slot] = await tx.select({ availability: providerAvailabilityTable, ownerId: providersTable.ownerId })
      .from(providerAvailabilityTable)
      .innerJoin(providersTable, eq(providerAvailabilityTable.providerId, providersTable.id))
      .where(eq(providerAvailabilityTable.id, slotId))
      .for("update")
      .limit(1);
    if (!slot || slot.ownerId !== userId) return { error: "NOT_FOUND" as const };
    if (slot.availability.status === "RESERVED") return { error: "SLOT_RESERVED" as const };
    const [updated] = await tx.update(providerAvailabilityTable)
      .set({ status })
      .where(eq(providerAvailabilityTable.id, slotId))
      .returning();
    await tx.insert(auditLogsTable).values({
      actorId: userId,
      action: "provider.availability_updated",
      entityType: "provider_availability",
      entityId: slotId,
      metadata: { status },
    });
    return { slot: toAvailability(updated) };
  });
}

export async function updateBookingStatus(
  userId: string,
  bookingId: string,
  nextStatus: string,
  availabilitySlotId?: string,
) {
  const result = await db.transaction(async (tx) => {
    const [booking] = await tx.select().from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId))
      .for("update")
      .limit(1);
    if (!booking) return { error: "NOT_FOUND" as const };
    const [provider] = await tx.select().from(providersTable)
      .where(eq(providersTable.id, booking.providerId))
      .limit(1);
    const isCustomer = booking.customerUserId === userId;
    const isProvider = provider?.ownerId === userId;
    if (!isCustomer && !isProvider) return { error: "NOT_FOUND" as const };

    const transitions: Record<string, string[]> = {
      REQUESTED: ["CONFIRMED", "CANCELLED"],
      PENDING_PROVIDER: ["CONFIRMED", "CANCELLED"],
      CONFIRMED: ["EN_ROUTE", "CANCELLED"],
      EN_ROUTE: ["ARRIVED", "CANCELLED"],
      ARRIVED: ["IN_PROGRESS"],
      IN_PROGRESS: ["COMPLETED", "DISPUTED"],
      COMPLETED: ["DISPUTED"],
    };
    if (!(transitions[booking.status] ?? []).includes(nextStatus)) {
      return { error: "INVALID_TRANSITION" as const };
    }
    if (isCustomer && nextStatus !== "CANCELLED" && nextStatus !== "DISPUTED") {
      return { error: "FORBIDDEN" as const };
    }
    if (isProvider && nextStatus === "DISPUTED") return { error: "FORBIDDEN" as const };
    if (nextStatus === "CONFIRMED" && (!isProvider || !availabilitySlotId)) {
      return { error: "AVAILABILITY_REQUIRED" as const };
    }

    let scheduledAt: Date | null = booking.scheduledAt;
    if (nextStatus === "CONFIRMED") {
      const [slot] = await tx.select().from(providerAvailabilityTable)
        .where(and(
          eq(providerAvailabilityTable.id, availabilitySlotId!),
          eq(providerAvailabilityTable.providerId, booking.providerId),
          eq(providerAvailabilityTable.status, "OPEN"),
          gt(providerAvailabilityTable.startsAt, new Date()),
        ))
        .for("update")
        .limit(1);
      if (!slot) return { error: "SLOT_UNAVAILABLE" as const };
      const [quote] = await tx.select().from(quotesTable)
        .where(eq(quotesTable.id, booking.quoteId))
        .limit(1);
      if (quote?.durationMinutes && slot.endsAt.getTime() - slot.startsAt.getTime() < quote.durationMinutes * 60_000) {
        return { error: "SLOT_TOO_SHORT" as const };
      }
      const [reserved] = await tx.update(providerAvailabilityTable)
        .set({ status: "RESERVED" })
        .where(and(
          eq(providerAvailabilityTable.id, slot.id),
          eq(providerAvailabilityTable.status, "OPEN"),
        ))
        .returning({ id: providerAvailabilityTable.id });
      if (!reserved) return { error: "SLOT_UNAVAILABLE" as const };
      scheduledAt = slot.startsAt;
    }

    if (nextStatus === "CANCELLED" && booking.availabilitySlotId) {
      await tx.update(providerAvailabilityTable)
        .set({ status: "OPEN" })
        .where(and(
          eq(providerAvailabilityTable.id, booking.availabilitySlotId),
          eq(providerAvailabilityTable.status, "RESERVED"),
        ));
    }
    const [updated] = await tx.update(bookingsTable)
      .set({
        status: nextStatus,
        ...(nextStatus === "CONFIRMED" ? { availabilitySlotId, scheduledAt } : {}),
        ...(nextStatus === "CANCELLED" ? { availabilitySlotId: null, scheduledAt: null } : {}),
      })
      .where(eq(bookingsTable.id, bookingId))
      .returning();
    await tx.insert(bookingStatusHistoryTable).values({
      bookingId,
      actorId: userId,
      fromStatus: booking.status,
      toStatus: nextStatus,
      note: nextStatus === "CONFIRMED"
        ? `Provider reserved availability slot ${availabilitySlotId}.`
        : null,
    });
    if (nextStatus === "CANCELLED") {
      await tx.update(quotesTable)
        .set({ status: "WITHDRAWN" })
        .where(eq(quotesTable.id, booking.quoteId));
      await tx.update(jobsTable)
        .set({ status: isProvider ? "OPEN" : "CANCELLED" })
        .where(eq(jobsTable.id, booking.jobId));
      if (isProvider) {
        await tx.update(quoteRequestsTable)
          .set({ status: "OPEN" })
          .where(eq(quoteRequestsTable.jobId, booking.jobId));
      }
    } else if (nextStatus === "COMPLETED") {
      await tx.update(jobsTable).set({ status: "COMPLETED" }).where(eq(jobsTable.id, booking.jobId));
    }
    await tx.insert(auditLogsTable).values({
      actorId: userId,
      action: "booking.status_changed",
      entityType: "booking",
      entityId: bookingId,
      metadata: { fromStatus: booking.status, toStatus: nextStatus, availabilitySlotId: availabilitySlotId ?? null },
    });
    return { booking: updated };
  });
  if ("error" in result) return result;
  return { booking: await toBooking(result.booking) };
}

async function canAccessJobMessages(userId: string, jobId: string) {
  const [owned] = await db.select({ id: jobsTable.id }).from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.customerUserId, userId)))
    .limit(1);
  if (owned) return true;
  const [matched] = await db.select({ id: quoteRequestsTable.id })
    .from(quoteRequestsTable)
    .innerJoin(providersTable, eq(quoteRequestsTable.providerId, providersTable.id))
    .where(and(
      eq(quoteRequestsTable.jobId, jobId),
      eq(providersTable.ownerId, userId),
    ))
    .limit(1);
  return Boolean(matched);
}

export async function listJobMessages(userId: string, jobId: string) {
  if (!(await canAccessJobMessages(userId, jobId))) return null;
  const rows = await db.select().from(jobMessagesTable)
    .where(eq(jobMessagesTable.jobId, jobId))
    .orderBy(asc(jobMessagesTable.createdAt))
    .limit(200);
  return rows.map((row) => ({
    id: row.id,
    jobId: row.jobId,
    senderUserId: row.senderUserId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function sendJobMessage(userId: string, jobId: string, body: string) {
  const content = body.trim();
  if (content.length < 1 || content.length > 2000) return { error: "INVALID_MESSAGE" as const };
  if (!(await canAccessJobMessages(userId, jobId))) return { error: "NOT_FOUND" as const };
  const [message] = await db.insert(jobMessagesTable).values({
    jobId,
    senderUserId: userId,
    body: content,
  }).returning();
  await db.insert(auditLogsTable).values({
    actorId: userId,
    action: "job.message_sent",
    entityType: "job_message",
    entityId: message.id,
    metadata: { jobId, bodyLength: content.length },
  });
  return {
    message: {
      id: message.id,
      jobId: message.jobId,
      senderUserId: message.senderUserId,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
    },
  };
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
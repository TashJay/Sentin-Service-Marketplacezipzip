import { randomUUID } from "node:crypto";
import { and, arrayContains, eq, ilike, ne, or } from "drizzle-orm";
import {
  aiActionsTable,
  aiConversationsTable,
  auditLogsTable,
  db,
  jobsTable,
  providersTable,
  quoteRequestsTable,
  servicesTable,
} from "@workspace/db";
import { getJob } from "./marketplace";

type IntakeInput = {
  conversationId?: string;
  message: string;
  serviceSlug?: string;
  description?: string;
  city?: string;
  countryCode?: string;
  urgency?: "unknown" | "standard" | "urgent" | "emergency";
  propertyType?: "unknown" | "residential" | "commercial";
};

type Requirements = {
  serviceSlug?: string;
  description?: string;
  city?: string;
  countryCode?: string;
  urgency?: "unknown" | "standard" | "urgent" | "emergency";
  propertyType?: "unknown" | "residential" | "commercial";
};

const serviceAliases: Record<string, string[]> = {
  plumbing: ["plumb", "pipe", "tap", "drain", "toilet", "water heater", "boiler"],
  electrical: ["electric", "wiring", "socket", "power outage"],
  "appliance-repair": ["washing machine", "washer", "fridge", "refrigerator", "dishwasher", "oven", "appliance"],
  cleaning: ["cleaner", "cleaning", "deep clean"],
  hvac: ["air conditioning", "aircon", "ac repair", "heating", "hvac"],
  locksmith: ["locksmith", "locked out", "lock repair", "key replacement"],
  mechanic: ["mechanic", "car repair", "vehicle repair", "car won't start"],
  towing: ["towing", "tow truck", "breakdown recovery"],
  photography: ["photographer", "photography", "photo shoot"],
  "pest-control": ["pest", "termites", "rodent", "mice", "rats", "insects"],
};

function inferServiceSlug(message: string, serviceSlugs: Set<string>): string | undefined {
  const normalized = message.toLowerCase();
  for (const [slug, aliases] of Object.entries(serviceAliases)) {
    if (serviceSlugs.has(slug) && aliases.some((alias) => normalized.includes(alias))) return slug;
  }
  return undefined;
}

function getMissingFields(requirements: Requirements): string[] {
  const missing: string[] = [];
  if (!requirements.serviceSlug) missing.push("service");
  if (!requirements.description?.trim()) missing.push("serviceDetails");
  if (!requirements.city?.trim() || !requirements.countryCode) missing.push("location");
  return missing;
}

function makeClarifyingQuestion(missing: string[]): string {
  if (missing.includes("service")) return "What kind of service do you need?";
  if (missing.includes("location")) return "Which city or area and country is the work in?";
  if (missing.includes("serviceDetails")) return "What needs attention or what work would you like done?";
  return "What detail should I update?";
}

function safetyGuidance(message: string): string | undefined {
  if (/\b(gas leak|smell gas|gas smell|fire|smoke|sparking|live wire|carbon monoxide)\b/i.test(message)) {
    return "This may be an immediate safety issue. Move away from danger and contact local emergency services or a qualified professional. Sentin cannot assess or make the situation safe remotely.";
  }
  return undefined;
}

/**
 * ChatGPT supplies the language understanding; this endpoint keeps only
 * user-confirmed fields, asks for essential gaps, and owns job creation.
 */
export async function prepareServiceRequest(userId: string, input: IntakeInput) {
  const conversationId = input.conversationId ?? randomUUID();
  const services = await db.select({
    slug: servicesTable.slug,
    name: servicesTable.name,
    category: servicesTable.category,
  }).from(servicesTable).where(eq(servicesTable.active, true));
  const serviceSlugs = new Set(services.map(({ slug }) => slug));
  const explicitService = input.serviceSlug?.trim();
  const serviceSlug = explicitService && serviceSlugs.has(explicitService)
    ? explicitService
    : inferServiceSlug(input.message, serviceSlugs);
  const safety = safetyGuidance(input.message);

  const outcome = await db.transaction(async (tx) => {
    const [existingConversation] = await tx.select().from(aiConversationsTable)
      .where(eq(aiConversationsTable.id, conversationId))
      .for("update")
      .limit(1);
    if (existingConversation && existingConversation.userId !== userId) {
      return { error: "CONVERSATION_NOT_FOUND" as const };
    }

    const previous = (existingConversation?.extractedRequirements ?? {}) as Requirements;
    const requirements: Requirements = {
      serviceSlug: serviceSlug ?? previous.serviceSlug,
      description: input.description?.trim() || previous.description || input.message.trim(),
      city: input.city?.trim() || previous.city,
      countryCode: input.countryCode?.trim().toUpperCase() || previous.countryCode,
      urgency: input.urgency ?? previous.urgency ?? "unknown",
      propertyType: input.propertyType ?? previous.propertyType ?? "unknown",
    };
    if (requirements.countryCode && !/^[A-Z]{2}$/.test(requirements.countryCode)) {
      requirements.countryCode = undefined;
    }

    const missing = getMissingFields(requirements);
    const clarificationQuestion = missing.length ? makeClarifyingQuestion(missing) : null;
    let createdJobId: string | null = existingConversation?.jobId ?? null;
    let matchedProviderCount = 0;
    let resultJobId = createdJobId;

    if (!missing.length && !createdJobId) {
      const cityPattern = requirements.city!.replaceAll("%", "\\%").replaceAll("_", "\\_");
      const matches = await tx.select({ id: providersTable.id }).from(providersTable)
        .where(and(
          eq(providersTable.active, true),
          ne(providersTable.verificationStatus, "SUSPENDED"),
          ne(providersTable.verificationStatus, "REJECTED"),
          ...(process.env.NODE_ENV === "production" ? [eq(providersTable.isDemo, false)] : []),
          arrayContains(providersTable.serviceSlugs, [requirements.serviceSlug!]),
          ilike(providersTable.city, cityPattern),
          eq(providersTable.countryCode, requirements.countryCode!),
        ));
      matchedProviderCount = matches.length;

      const idempotencyKey = `concierge:${conversationId}`;
      const [existingJob] = await tx.select().from(jobsTable)
        .where(and(eq(jobsTable.customerUserId, userId), eq(jobsTable.idempotencyKey, idempotencyKey)))
        .limit(1);
      if (existingJob) {
        resultJobId = existingJob.id;
      } else {
        const [job] = await tx.insert(jobsTable).values({
          customerUserId: userId,
          serviceSlug: requirements.serviceSlug!,
          description: requirements.description!,
          city: requirements.city!,
          countryCode: requirements.countryCode!,
          urgency: requirements.urgency ?? "unknown",
          propertyType: requirements.propertyType ?? "unknown",
          matchedProviderCount: matches.length,
          idempotencyKey,
        }).returning();
        resultJobId = job.id;
        if (matches.length) {
          await tx.insert(quoteRequestsTable).values(matches.map(({ id }) => ({
            jobId: job.id,
            providerId: id,
          }))).onConflictDoNothing();
        }
        await tx.insert(auditLogsTable).values({
          actorId: userId,
          action: "job.created_from_concierge",
          entityType: "job",
          entityId: job.id,
          metadata: { serviceSlug: requirements.serviceSlug, matchedProviderCount: matches.length },
        });
      }
    }

    if (!existingConversation) {
      await tx.insert(aiConversationsTable).values({
        id: conversationId,
        userId,
        jobId: resultJobId,
        extractedRequirements: requirements,
      });
    } else {
      await tx.update(aiConversationsTable)
        .set({
          jobId: resultJobId,
          extractedRequirements: requirements,
          updatedAt: new Date(),
        })
        .where(eq(aiConversationsTable.id, conversationId));
    }

    const output: Record<string, unknown> = missing.length
      ? {
          status: "NEEDS_CLARIFICATION",
          conversationId,
          missingFields: missing,
          clarifyingQuestion: clarificationQuestion,
          ...(safety ? { safetyGuidance: safety } : {}),
        }
      : {
          status: "JOB_CREATED",
          conversationId,
          jobId: resultJobId,
          matchedProviderCount,
          ...(matchedProviderCount === 0
            ? { availabilityMessage: "I couldn't find matching providers in that area. No provider or availability has been assumed." }
            : {}),
          ...(safety ? { safetyGuidance: safety } : {}),
        };
    await tx.insert(aiActionsTable).values({
      conversationId,
      userId,
      toolName: "sentin_concierge",
      input: {
        serviceSlug: requirements.serviceSlug ?? null,
        city: requirements.city ?? null,
        countryCode: requirements.countryCode ?? null,
        urgency: requirements.urgency,
        propertyType: requirements.propertyType,
      },
      output,
      status: missing.length ? "NEEDS_CLARIFICATION" : "JOB_CREATED",
    });
    return { output, jobId: resultJobId };
  });

  if ("error" in outcome) return outcome;
  if (!outcome.jobId) return outcome.output;
  const job = await getJob(userId, outcome.jobId);
  return job
    ? { ...outcome.output, job }
    : { error: "SERVICE_REQUEST_NOT_FOUND" };
}
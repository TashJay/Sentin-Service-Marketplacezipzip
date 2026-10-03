import { getAuth } from "@clerk/express";
import { Router, type IRouter } from "express";
import {
  AcceptQuoteParams,
  AcceptQuoteResponse,
  CreateJobBody,
  CreateJobResponse,
  CreateProviderAvailabilityBody,
  CreateProviderAvailabilityResponse,
  CreateProviderProfileBody,
  CreateProviderProfileResponse,
  GetBookingParams,
  GetBookingResponse,
  GetDashboardSummaryResponse,
  GetJobParams,
  GetJobResponse,
  GetProviderParams,
  GetProviderResponse,
  ListJobQuotesParams,
  ListJobQuotesResponse,
  ListMyBookingsResponse,
  ListMyJobsResponse,
  ListProviderRequestsResponse,
  ListProviderBookingsResponse,
  ListProviderAvailabilityResponse,
  ListPublicProviderAvailabilityParams,
  ListPublicProviderAvailabilityResponse,
  ListServicesResponse,
  ListJobMessagesParams,
  ListJobMessagesResponse,
  SendJobMessageBody,
  SendJobMessageParams,
  SendJobMessageResponse,
  PrepareServiceRequestBody,
  PrepareServiceRequestResponse,
  UpdateBookingStatusBody,
  UpdateBookingStatusParams,
  UpdateBookingStatusResponse,
  UpdateProviderAvailabilityBody,
  UpdateProviderAvailabilityParams,
  UpdateProviderAvailabilityResponse,
  SearchProvidersQueryParams,
  SearchProvidersResponse,
  SubmitQuoteBody,
  SubmitQuoteParams,
  SubmitQuoteResponse,
} from "@workspace/api-zod";
import {
  acceptQuote,
  createProviderAvailability,
  createJob,
  createProviderProfile,
  getBooking,
  getDashboardSummary,
  getJob,
  getProvider,
  listJobQuotes,
  listMyBookings,
  listMyJobs,
  listProviderRequests,
  listProviderBookings,
  listProviderAvailability,
  listPublicProviderAvailability,
  listJobMessages,
  listServices,
  requestQuotes,
  searchProviders,
  sendJobMessage,
  submitQuote,
  updateBookingStatus,
  updateProviderAvailability,
} from "../lib/marketplace";
import { prepareServiceRequest } from "../lib/concierge";
import { rateLimit } from "../lib/rate-limit";

const router: IRouter = Router();
router.use(rateLimit({ windowMs: 60 * 1000, max: 120 }));

function currentUserId(req: Parameters<Parameters<typeof router.get>[1]>[0]): string | null {
  const auth = getAuth(req);
  return auth.userId ?? null;
}

function unauthorized(res: Parameters<Parameters<typeof router.get>[1]>[1]): void {
  res.status(401).json({ error: "Authentication required" });
}

router.get("/services", async (_req, res): Promise<void> => {
  res.json(ListServicesResponse.parse(await listServices()));
});

router.get("/providers", async (req, res): Promise<void> => {
  const parsed = SearchProvidersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.json(SearchProvidersResponse.parse(await searchProviders(parsed.data)));
});

router.get("/providers/:providerId", async (req, res): Promise<void> => {
  const parsed = GetProviderParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const provider = await getProvider(parsed.data.providerId);
  if (!provider) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }
  res.json(GetProviderResponse.parse(provider));
});

router.get("/providers/:providerId/availability", async (req, res): Promise<void> => {
  const parsed = ListPublicProviderAvailabilityParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const slots = await listPublicProviderAvailability(parsed.data.providerId);
  if (!slots) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }
  res.json(ListPublicProviderAvailabilityResponse.parse(slots));
});

router.post("/jobs", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    unauthorized(res);
    return;
  }
  const parsed = CreateJobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const rawKey = req.get("Idempotency-Key");
  if (rawKey && (rawKey.length > 200 || /[\u0000-\u001f]/.test(rawKey))) {
    res.status(400).json({ error: "Invalid Idempotency-Key" });
    return;
  }
  const result = await createJob(userId, parsed.data, rawKey);
  if ("error" in result) {
    res.status(400).json({ error: "Unknown or inactive service category" });
    return;
  }
  res.status(201).json(CreateJobResponse.parse(result.job));
});

router.get("/my/jobs", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    unauthorized(res);
    return;
  }
  res.json(ListMyJobsResponse.parse(await listMyJobs(userId)));
});

router.get("/jobs/:jobId", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    unauthorized(res);
    return;
  }
  const parsed = GetJobParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const job = await getJob(userId, parsed.data.jobId);
  if (!job) {
    res.status(404).json({ error: "Service request not found" });
    return;
  }
  res.json(GetJobResponse.parse(job));
});

router.post("/concierge/prepare", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    unauthorized(res);
    return;
  }
  const parsed = PrepareServiceRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const result = await prepareServiceRequest(userId, parsed.data);
  if ("error" in result) {
    res.status(result.error === "CONVERSATION_NOT_FOUND" ? 404 : 500).json({ error: result.error });
    return;
  }
  res.json(PrepareServiceRequestResponse.parse(result));
});

router.post("/jobs/:jobId/quote-requests", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    unauthorized(res);
    return;
  }
  const parsed = GetJobParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const result = await requestQuotes(userId, parsed.data.jobId);
  if ("error" in result) {
    res.status(result.error === "NOT_FOUND" ? 404 : 400).json({ error: result.error });
    return;
  }
  res.json(GetJobResponse.parse(result.job));
});

router.get("/jobs/:jobId/quotes", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    unauthorized(res);
    return;
  }
  const parsed = ListJobQuotesParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const quotes = await listJobQuotes(userId, parsed.data.jobId);
  if (!quotes) {
    res.status(404).json({ error: "Service request not found" });
    return;
  }
  res.json(ListJobQuotesResponse.parse(quotes));
});

router.get("/jobs/:jobId/messages", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    unauthorized(res);
    return;
  }
  const parsed = ListJobMessagesParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const messages = await listJobMessages(userId, parsed.data.jobId);
  if (!messages) {
    res.status(404).json({ error: "Request not found or caller is not a participant" });
    return;
  }
  res.json(ListJobMessagesResponse.parse(messages));
});

router.post("/jobs/:jobId/messages", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    unauthorized(res);
    return;
  }
  const params = SendJobMessageParams.safeParse(req.params);
  const body = SendJobMessageBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const result = await sendJobMessage(userId, params.data.jobId, body.data.body);
  if ("error" in result) {
    res.status(result.error === "NOT_FOUND" ? 404 : 400).json({ error: result.error });
    return;
  }
  res.status(201).json(SendJobMessageResponse.parse(result.message));
});

router.post("/provider/profile", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    unauthorized(res);
    return;
  }
  const parsed = CreateProviderProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const result = await createProviderProfile(userId, parsed.data);
  if ("error" in result) {
    res.status(result.error === "PROFILE_EXISTS" ? 409 : 400).json({ error: result.error });
    return;
  }
  res.status(201).json(CreateProviderProfileResponse.parse(result.provider));
});

router.get("/provider/requests", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    unauthorized(res);
    return;
  }
  const requests = await listProviderRequests(userId);
  if (!requests) {
    res.status(404).json({ error: "Provider profile required" });
    return;
  }
  res.json(ListProviderRequestsResponse.parse(requests));
});

router.get("/provider/availability", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    unauthorized(res);
    return;
  }
  const slots = await listProviderAvailability(userId);
  if (!slots) {
    res.status(404).json({ error: "Provider profile required" });
    return;
  }
  res.json(ListProviderAvailabilityResponse.parse(slots));
});

router.post("/provider/availability", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    unauthorized(res);
    return;
  }
  const parsed = CreateProviderAvailabilityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const result = await createProviderAvailability(userId, {
    startsAt: parsed.data.startsAt.toISOString(),
    endsAt: parsed.data.endsAt.toISOString(),
  });
  if ("error" in result) {
    const status = result.error === "PROVIDER_PROFILE_REQUIRED" ? 404 : result.error === "AVAILABILITY_CONFLICT" ? 409 : 400;
    res.status(status).json({ error: result.error });
    return;
  }
  res.status(201).json(CreateProviderAvailabilityResponse.parse(result.slot));
});

router.patch("/provider/availability/:slotId", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    unauthorized(res);
    return;
  }
  const params = UpdateProviderAvailabilityParams.safeParse(req.params);
  const body = UpdateProviderAvailabilityBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const result = await updateProviderAvailability(userId, params.data.slotId, body.data.status);
  if ("error" in result) {
    const status = result.error === "NOT_FOUND" ? 404 : 409;
    res.status(status).json({ error: result.error });
    return;
  }
  res.json(UpdateProviderAvailabilityResponse.parse(result.slot));
});

router.get("/provider/bookings", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    unauthorized(res);
    return;
  }
  const bookings = await listProviderBookings(userId);
  if (!bookings) {
    res.status(404).json({ error: "Provider profile required" });
    return;
  }
  res.json(ListProviderBookingsResponse.parse(bookings));
});

router.post("/provider/jobs/:jobId/quotes", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    unauthorized(res);
    return;
  }
  const params = SubmitQuoteParams.safeParse(req.params);
  const body = SubmitQuoteBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const result = await submitQuote(userId, params.data.jobId, body.data);
  if ("error" in result) {
    const status = result.error === "QUOTE_EXISTS" ? 409 : result.error === "PROVIDER_PROFILE_REQUIRED" ? 403 : 400;
    res.status(status).json({ error: result.error });
    return;
  }
  res.status(201).json(SubmitQuoteResponse.parse(result.quote));
});

router.post("/quotes/:quoteId/accept", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    unauthorized(res);
    return;
  }
  const parsed = AcceptQuoteParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const result = await acceptQuote(userId, parsed.data.quoteId);
  if ("error" in result) {
    const status = result.error === "NOT_FOUND" ? 404 : 400;
    res.status(status).json({ error: result.error });
    return;
  }
  res.status(201).json(AcceptQuoteResponse.parse(result.booking));
});

router.get("/bookings/:bookingId", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    unauthorized(res);
    return;
  }
  const parsed = GetBookingParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const booking = await getBooking(userId, parsed.data.bookingId);
  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  res.json(GetBookingResponse.parse(booking));
});

router.post("/bookings/:bookingId/status", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    unauthorized(res);
    return;
  }
  const params = UpdateBookingStatusParams.safeParse(req.params);
  const body = UpdateBookingStatusBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const result = await updateBookingStatus(
    userId,
    params.data.bookingId,
    body.data.status,
    body.data.availabilitySlotId,
  );
  if ("error" in result) {
    const status = result.error === "NOT_FOUND" ? 404
      : result.error === "FORBIDDEN" ? 403
      : result.error === "SLOT_UNAVAILABLE" || result.error === "SLOT_TOO_SHORT" ? 409
      : 400;
    res.status(status).json({ error: result.error });
    return;
  }
  res.json(UpdateBookingStatusResponse.parse(result.booking));
});

router.get("/my/bookings", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    unauthorized(res);
    return;
  }
  res.json(ListMyBookingsResponse.parse(await listMyBookings(userId)));
});

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) {
    unauthorized(res);
    return;
  }
  res.json(GetDashboardSummaryResponse.parse(await getDashboardSummary(userId)));
});

export default router;
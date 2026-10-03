import { getAuth } from "@clerk/express";
import { Router, type IRouter } from "express";
import {
  AcceptQuoteParams,
  AcceptQuoteResponse,
  CreateJobBody,
  CreateJobResponse,
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
  ListServicesResponse,
  SearchProvidersQueryParams,
  SearchProvidersResponse,
  SubmitQuoteBody,
  SubmitQuoteParams,
  SubmitQuoteResponse,
} from "@workspace/api-zod";
import {
  acceptQuote,
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
  listServices,
  requestQuotes,
  searchProviders,
  submitQuote,
} from "../lib/marketplace";
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
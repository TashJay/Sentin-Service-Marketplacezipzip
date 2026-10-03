import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { pool } from "@workspace/db";
import { prepareServiceRequest } from "./concierge";
import {
  acceptQuote,
  createProviderAvailability,
  createProviderProfile,
  getBooking,
  listJobMessages,
  listProviderAvailability,
  requestQuotes,
  sendJobMessage,
  submitQuote,
  updateBookingStatus,
  updateProviderAvailability,
} from "./marketplace";
import { buildCaptureLedgerEntries, recordCapturedPayment } from "./payments";

const suffix = randomUUID().slice(0, 8).toUpperCase();
const providerUserId = `sentin-e2e-provider-${suffix}`;
const customerOneId = `sentin-e2e-customer-one-${suffix}`;
const customerTwoId = `sentin-e2e-customer-two-${suffix}`;
const outsiderId = `sentin-e2e-outsider-${suffix}`;
const userIds = [providerUserId, customerOneId, customerTwoId, outsiderId];
const jobIds: string[] = [];
const city = `QA-${suffix}`;
let serviceCreatedByTest = false;

if (process.env.NODE_ENV === "production") {
  throw new Error("Marketplace lifecycle tests must never run against production.");
}

after(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM ai_actions AS action
       USING ai_conversations AS conversation
       WHERE action.conversation_id = conversation.id
         AND conversation.user_id = ANY($1::text[])`,
      [userIds],
    );
    await client.query(
      "DELETE FROM ai_conversations WHERE user_id = ANY($1::text[])",
      [userIds],
    );
    await client.query(
      `DELETE FROM payment_attempts
       WHERE payment_id IN (
         SELECT id FROM payments
         WHERE booking_id IN (
           SELECT id FROM bookings WHERE job_id = ANY($1::uuid[])
         )
       )`,
      [jobIds],
    );
    await client.query(
      `DELETE FROM ledger_entries
       WHERE booking_id IN (SELECT id FROM bookings WHERE job_id = ANY($1::uuid[]))
          OR payment_id IN (SELECT id FROM payments WHERE booking_id IN (
            SELECT id FROM bookings WHERE job_id = ANY($1::uuid[])
          ))`,
      [jobIds],
    );
    await client.query(
      `DELETE FROM payments
       WHERE booking_id IN (SELECT id FROM bookings WHERE job_id = ANY($1::uuid[]))`,
      [jobIds],
    );
    await client.query(
      `DELETE FROM booking_status_history
       WHERE booking_id IN (SELECT id FROM bookings WHERE job_id = ANY($1::uuid[]))`,
      [jobIds],
    );
    await client.query("DELETE FROM bookings WHERE job_id = ANY($1::uuid[])", [jobIds]);
    await client.query("DELETE FROM job_messages WHERE job_id = ANY($1::uuid[])", [jobIds]);
    await client.query("DELETE FROM quote_requests WHERE job_id = ANY($1::uuid[])", [jobIds]);
    await client.query("DELETE FROM quotes WHERE job_id = ANY($1::uuid[])", [jobIds]);
    await client.query("DELETE FROM jobs WHERE id = ANY($1::uuid[])", [jobIds]);
    await client.query(
      `DELETE FROM provider_availability
       WHERE provider_id IN (SELECT id FROM providers WHERE owner_id = ANY($1::text[]))`,
      [userIds],
    );
    await client.query("DELETE FROM providers WHERE owner_id = ANY($1::text[])", [userIds]);
    await client.query("DELETE FROM audit_logs WHERE actor_id = ANY($1::text[])", [userIds]);
    if (serviceCreatedByTest) {
      await client.query("DELETE FROM services WHERE slug = 'plumbing'");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
});

test("concierge request → quote versions → messages → one-slot booking lifecycle", async () => {
  const serviceSeed = await pool.query(
    `INSERT INTO services (slug, name, category, active)
     VALUES ('plumbing', 'Plumbing', 'home', true)
     ON CONFLICT (slug) DO NOTHING
     RETURNING slug`,
  );
  serviceCreatedByTest = serviceSeed.rowCount === 1;

  const profileResult = await createProviderProfile(providerUserId, {
    companyName: `Sentin E2E ${suffix}`,
    description: "Temporary integration-test provider for the marketplace lifecycle.",
    serviceSlugs: ["plumbing"],
    city,
    countryCode: "KE",
    currency: "USD",
    minimumPrice: null,
    maximumPrice: null,
  });
  if ("error" in profileResult) assert.fail(`Provider profile setup failed: ${profileResult.error}`);

  const clarification = await prepareServiceRequest(customerOneId, {
    message: "A plumber is needed to fix a leaking kitchen tap.",
  }) as { status?: string; conversationId?: string; missingFields?: string[] };
  assert.equal(clarification.status, "NEEDS_CLARIFICATION");
  assert.ok(clarification.missingFields?.includes("location"));
  assert.ok(clarification.conversationId);

  const firstRequest = await prepareServiceRequest(customerOneId, {
    conversationId: clarification.conversationId,
    message: `The work is in ${city}, Kenya.`,
    city,
    countryCode: "KE",
  }) as { status?: string; job?: { id: string }; matchedProviderCount?: number };
  assert.equal(firstRequest.status, "JOB_CREATED");
  assert.equal(firstRequest.matchedProviderCount, 1);
  assert.ok(firstRequest.job?.id);
  const firstJobId = firstRequest.job.id;
  jobIds.push(firstJobId);

  const secondRequest = await prepareServiceRequest(customerTwoId, {
    message: "Please repair a leaking bathroom tap.",
    serviceSlug: "plumbing",
    description: "Repair a leaking bathroom tap.",
    city,
    countryCode: "KE",
  }) as { status?: string; job?: { id: string }; matchedProviderCount?: number };
  assert.equal(secondRequest.status, "JOB_CREATED");
  assert.equal(secondRequest.matchedProviderCount, 1);
  assert.ok(secondRequest.job?.id);
  const secondJobId = secondRequest.job.id;
  jobIds.push(secondJobId);

  const quoteInput = {
    amount: 125,
    currency: "USD",
    description: "E2E first-version quote; temporary test value, not a customer offer.",
    durationMinutes: 30,
  };
  const requested = await requestQuotes(customerOneId, firstJobId);
  assert.ok(!("error" in requested));
  const firstQuoteResult = await submitQuote(providerUserId, firstJobId, quoteInput);
  if ("error" in firstQuoteResult) assert.fail(`First quote failed: ${firstQuoteResult.error}`);
  const firstQuoteId = firstQuoteResult.quote.id;
  const firstAcceptance = await acceptQuote(customerOneId, firstQuoteId);
  if ("error" in firstAcceptance) assert.fail(`First quote acceptance failed: ${firstAcceptance.error}`);
  const firstBookingId = firstAcceptance.booking.id;
  assert.equal(firstAcceptance.booking.paymentStatus, "NOT_CONFIGURED");

  const startsAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
  startsAt.setSeconds(0, 0);
  const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
  const slotResult = await createProviderAvailability(providerUserId, {
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
  });
  if ("error" in slotResult) assert.fail(`Availability setup failed: ${slotResult.error}`);
  const slotId = slotResult.slot.id;
  const overlap = await createProviderAvailability(providerUserId, {
    startsAt: new Date(startsAt.getTime() + 15 * 60 * 1000).toISOString(),
    endsAt: new Date(endsAt.getTime() + 15 * 60 * 1000).toISOString(),
  });
  assert.ok("error" in overlap && overlap.error === "AVAILABILITY_CONFLICT");

  const blocked = await updateProviderAvailability(providerUserId, slotId, "BLOCKED");
  if ("error" in blocked) assert.fail(`Blocking an open slot failed: ${blocked.error}`);
  assert.equal(blocked.slot.status, "BLOCKED");
  const reopened = await updateProviderAvailability(providerUserId, slotId, "OPEN");
  if ("error" in reopened) assert.fail(`Reopening an available slot failed: ${reopened.error}`);
  assert.equal(reopened.slot.status, "OPEN");

  const customerMessage = await sendJobMessage(customerOneId, firstJobId, "Could you confirm what access is needed?");
  if ("error" in customerMessage) assert.fail(`Customer message failed: ${customerMessage.error}`);
  const providerMessage = await sendJobMessage(providerUserId, firstJobId, "Please make sure the kitchen tap is accessible.");
  if ("error" in providerMessage) assert.fail(`Provider message failed: ${providerMessage.error}`);
  const unauthorizedMessage = await sendJobMessage(outsiderId, firstJobId, "This user is not a participant.");
  assert.ok("error" in unauthorizedMessage && unauthorizedMessage.error === "NOT_FOUND");
  const messages = await listJobMessages(customerOneId, firstJobId);
  assert.ok(messages?.some(message => message.id === customerMessage.message.id));
  assert.ok(messages?.some(message => message.id === providerMessage.message.id));

  const firstConfirmation = await updateBookingStatus(providerUserId, firstBookingId, "CONFIRMED", slotId);
  if ("error" in firstConfirmation) assert.fail(`First booking confirmation failed: ${firstConfirmation.error}`);
  assert.equal(firstConfirmation.booking.availabilitySlotId, slotId);
  assert.ok(firstConfirmation.booking.scheduledAt);
  const reservedSlots = await listProviderAvailability(providerUserId);
  assert.ok(reservedSlots?.some(slot => slot.id === slotId && slot.status === "RESERVED"));
  const blockedReservedSlot = await updateProviderAvailability(providerUserId, slotId, "OPEN");
  assert.ok("error" in blockedReservedSlot && blockedReservedSlot.error === "SLOT_RESERVED");

  const providerCancellation = await updateBookingStatus(providerUserId, firstBookingId, "CANCELLED");
  if ("error" in providerCancellation) assert.fail(`Provider cancellation failed: ${providerCancellation.error}`);
  assert.equal(providerCancellation.booking.status, "CANCELLED");
  const releasedSlots = await listProviderAvailability(providerUserId);
  assert.ok(releasedSlots?.some(slot => slot.id === slotId && slot.status === "OPEN"));
  const afterCancel = await submitQuote(providerUserId, firstJobId, {
    ...quoteInput,
    amount: 140,
    description: "E2E replacement quote after withdrawal; temporary test value.",
  });
  if ("error" in afterCancel) assert.fail(`Replacement quote failed: ${afterCancel.error}`);
  const replacementQuoteId = afterCancel.quote.id;
  assert.notEqual(replacementQuoteId, firstQuoteId);
  const quoteVersions = await pool.query(
    "SELECT id, status, description FROM quotes WHERE job_id = $1 ORDER BY created_at",
    [firstJobId],
  );
  const withdrawnVersion = quoteVersions.rows.find(row => row.id === firstQuoteId);
  assert.equal(withdrawnVersion?.status, "WITHDRAWN");
  assert.equal(withdrawnVersion?.description, quoteInput.description);

  const secondAcceptance = await acceptQuote(customerOneId, replacementQuoteId);
  if ("error" in secondAcceptance) assert.fail(`Replacement quote acceptance failed: ${secondAcceptance.error}`);
  const secondBookingId = secondAcceptance.booking.id;
  assert.equal(secondAcceptance.booking.paymentStatus, "NOT_CONFIGURED");

  const secondJobRequest = await requestQuotes(customerTwoId, secondJobId);
  assert.ok(!("error" in secondJobRequest));
  const competingQuote = await submitQuote(providerUserId, secondJobId, {
    ...quoteInput,
    amount: 175,
    description: "E2E competing quote; temporary test value.",
  });
  if ("error" in competingQuote) assert.fail(`Competing quote failed: ${competingQuote.error}`);
  const competingAcceptance = await acceptQuote(customerTwoId, competingQuote.quote.id);
  if ("error" in competingAcceptance) assert.fail(`Competing quote acceptance failed: ${competingAcceptance.error}`);

  const [confirmFirst, confirmSecond] = await Promise.all([
    updateBookingStatus(providerUserId, secondBookingId, "CONFIRMED", slotId),
    updateBookingStatus(providerUserId, competingAcceptance.booking.id, "CONFIRMED", slotId),
  ]);
  const firstWon = !("error" in confirmFirst);
  const secondWon = !("error" in confirmSecond);
  assert.notEqual(firstWon, secondWon, "exactly one booking must reserve a slot when confirmations race");
  const winningBookingId = firstWon ? secondBookingId : competingAcceptance.booking.id;
  const losingBookingId = firstWon ? competingAcceptance.booking.id : secondBookingId;
  const losingCustomerId = firstWon ? customerTwoId : customerOneId;
  const losingCancellation = await updateBookingStatus(losingCustomerId, losingBookingId, "CANCELLED");
  if ("error" in losingCancellation) assert.fail(`Customer cancellation failed: ${losingCancellation.error}`);

  for (const status of ["EN_ROUTE", "ARRIVED", "IN_PROGRESS", "COMPLETED"] as const) {
    const transition = await updateBookingStatus(providerUserId, winningBookingId, status);
    if ("error" in transition) assert.fail(`Booking transition to ${status} failed: ${transition.error}`);
    assert.equal(transition.booking.status, status);
  }
  const completedBooking = await getBooking(providerUserId, winningBookingId);
  assert.equal(completedBooking?.status, "COMPLETED");
  assert.ok(completedBooking?.statusHistory?.some(item => item.toStatus === "COMPLETED"));

  const paymentRow = await pool.query(
    "SELECT id FROM payments WHERE booking_id = $1",
    [winningBookingId],
  );
  assert.ok(paymentRow.rows[0]?.id);
  const capture = await recordCapturedPayment({
    paymentId: paymentRow.rows[0].id,
    providerReference: `e2e-${suffix}`,
    amountMinor: 17_500,
  });
  assert.deepEqual(capture, { error: "PAYMENTS_NOT_CONFIGURED" });

  const ledger = buildCaptureLedgerEntries({
    transactionId: randomUUID(),
    bookingId: winningBookingId,
    paymentId: paymentRow.rows[0].id,
    amountMinor: 12_345,
    currency: "usd",
    commissionBasisPoints: 1_500,
  });
  assert.equal(ledger.reduce((sum, entry) => sum + entry.amountMinor, 0), 0);
  assert.equal(ledger.find(entry => entry.accountCode === "SENTIN_COMMISSION")?.amountMinor, 1_852);
  assert.equal(ledger.find(entry => entry.accountCode === "PROVIDER_PAYABLE")?.amountMinor, 10_493);
});
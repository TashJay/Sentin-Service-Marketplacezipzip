import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, ledgerEntriesTable, paymentsTable, paymentAttemptsTable } from "@workspace/db";

export type PaymentOperation =
  | { ok: true; providerReference: string }
  | { ok: false; code: "PAYMENTS_NOT_CONFIGURED" | "PAYMENT_FAILED" };

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: { amount: string; currency: string; idempotencyKey: string }): Promise<PaymentOperation>;
  authorize(providerReference: string): Promise<PaymentOperation>;
  capture(providerReference: string): Promise<PaymentOperation>;
  refund(providerReference: string, amount: string): Promise<PaymentOperation>;
  getPaymentStatus(providerReference: string): Promise<string>;
  verifyWebhook(rawBody: Uint8Array, signature: string): Promise<boolean>;
}

/**
 * Sentin intentionally has no active processor. Service checkout is not
 * advertised until the ChatGPT commerce rules and a PSP integration allow it.
 */
export const unavailablePaymentProvider: PaymentProvider = {
  name: "UNCONFIGURED",
  async createPayment() { return { ok: false, code: "PAYMENTS_NOT_CONFIGURED" }; },
  async authorize() { return { ok: false, code: "PAYMENTS_NOT_CONFIGURED" }; },
  async capture() { return { ok: false, code: "PAYMENTS_NOT_CONFIGURED" }; },
  async refund() { return { ok: false, code: "PAYMENTS_NOT_CONFIGURED" }; },
  async getPaymentStatus() { return "NOT_CONFIGURED"; },
  async verifyWebhook() { return false; },
};

export function getCommissionBasisPoints(): number {
  const raw = process.env.PLATFORM_COMMISSION_BPS;
  if (raw === undefined || raw.trim() === "") return 0;
  if (!/^\d+$/.test(raw)) throw new Error("PLATFORM_COMMISSION_BPS must be an integer from 0 through 10000.");
  const basisPoints = Number(raw);
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
    throw new Error("PLATFORM_COMMISSION_BPS must be an integer from 0 through 10000.");
  }
  return basisPoints;
}

export function buildCaptureLedgerEntries(input: {
  transactionId: string;
  bookingId: string;
  paymentId: string;
  amountMinor: number;
  currency: string;
  commissionBasisPoints: number;
}) {
  const { amountMinor, commissionBasisPoints } = input;
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error("Payment amount must be positive minor units.");
  if (!Number.isInteger(commissionBasisPoints) || commissionBasisPoints < 0 || commissionBasisPoints > 10_000) {
    throw new Error("Commission basis points must be between 0 and 10000.");
  }
  const commissionMinor = Math.floor((amountMinor * commissionBasisPoints + 5_000) / 10_000);
  const entries = [
    { accountCode: "CUSTOMER_CLEARING", amountMinor: -amountMinor, eventType: "CUSTOMER_PAYMENT" },
    { accountCode: "PROVIDER_PAYABLE", amountMinor: amountMinor - commissionMinor, eventType: "PROVIDER_AMOUNT" },
    { accountCode: "SENTIN_COMMISSION", amountMinor: commissionMinor, eventType: "PLATFORM_COMMISSION" },
  ];
  if (entries.reduce((sum, entry) => sum + entry.amountMinor, 0) !== 0) {
    throw new Error("Ledger transaction is not balanced.");
  }
  return entries.map((entry) => ({
    ...entry,
    transactionId: input.transactionId,
    bookingId: input.bookingId,
    paymentId: input.paymentId,
    currency: input.currency.toUpperCase(),
    idempotencyKey: `${input.transactionId}:${entry.eventType}`,
  }));
}

/**
 * Append balanced journal entries only after a payment provider confirms
 * capture. Existing ledger rows are never updated or deleted.
 */
export async function recordCapturedPayment(input: {
  paymentId: string;
  providerReference: string;
  amountMinor: number;
}) {
  return db.transaction(async (tx) => {
    const [payment] = await tx.select().from(paymentsTable)
      .where(eq(paymentsTable.id, input.paymentId))
      .for("update")
      .limit(1);
    if (!payment) return { error: "PAYMENT_NOT_FOUND" as const };
    if (payment.provider === "UNCONFIGURED" || payment.status === "NOT_CONFIGURED") {
      return { error: "PAYMENTS_NOT_CONFIGURED" as const };
    }
    if (payment.status === "CAPTURED") {
      return { error: "ALREADY_CAPTURED" as const };
    }
    const transactionId = randomUUID();
    const entries = buildCaptureLedgerEntries({
      transactionId,
      bookingId: payment.bookingId,
      paymentId: payment.id,
      amountMinor: input.amountMinor,
      currency: payment.currency,
      commissionBasisPoints: getCommissionBasisPoints(),
    });
    await tx.insert(ledgerEntriesTable).values(entries);
    await tx.insert(paymentAttemptsTable).values({
      paymentId: payment.id,
      provider: payment.provider,
      status: "CAPTURED",
      externalReference: input.providerReference,
    });
    await tx.update(paymentsTable)
      .set({
        status: "CAPTURED",
        externalPaymentId: input.providerReference,
        updatedAt: new Date(),
      })
      .where(and(eq(paymentsTable.id, payment.id), eq(paymentsTable.status, "PENDING")));
    return { paymentId: payment.id, transactionId, status: "CAPTURED" as const };
  });
}
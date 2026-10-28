import type { ActivationCheckoutRequest, CheckoutRequest, CheckoutSession, OrderCheckoutRequest, PaymentEvent, PaymentProcessor, RefundRequest } from "./payment-processor.port";
import { WebhookSignatureError } from "./payment-processor.port";

export class SandboxProcessor implements PaymentProcessor {
  readonly name = "SANDBOX";

  constructor(private readonly webOrigin: string) {}

  createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    return Promise.resolve({ providerReference: `sandbox_${request.topUpId}`, redirectUrl: `${this.webOrigin}/wallet/sandbox-checkout?topUp=${encodeURIComponent(request.topUpId)}` });
  }

  createOrderCheckout(request: OrderCheckoutRequest): Promise<CheckoutSession> {
    return Promise.resolve({
      providerReference: `sandbox_${request.orderId}`,
      redirectUrl: `${this.webOrigin}/${request.kind === "SHOPPING" ? "shopping" : "checkout"}/sandbox?order=${encodeURIComponent(request.reference)}&id=${encodeURIComponent(request.orderId)}`,
    });
  }

  createActivationCheckout(request: ActivationCheckoutRequest): Promise<CheckoutSession> {
    return Promise.resolve({ providerReference: `sandbox_${request.paymentId}`, redirectUrl: `${this.webOrigin}/verification/sandbox-checkout?payment=${encodeURIComponent(request.paymentId)}` });
  }

  refund(request: RefundRequest): Promise<string> {
    return Promise.resolve(`sandbox_refund_${request.idempotencyKey}`);
  }

  parseWebhook(): PaymentEvent & { type: string; payload: unknown } {
    throw new WebhookSignatureError();
  }
}

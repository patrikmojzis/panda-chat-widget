export type PublicWriteRateLimitRoute = 'visitor_session_create' | 'conversation_create' | 'message_create';

export type PublicWriteRateLimitInput = {
  route: PublicWriteRateLimitRoute;
  publicKey: string;
  visitorKey?: string;
  visitorSessionId?: string;
  conversationId?: string;
  clientMessageId?: string;
};

export type PublicWriteRateLimitDecision =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      reason: 'too_many_requests';
    };

export type RateLimitErrorResponse = {
  error: 'rate_limited';
  reason: 'too_many_requests';
};

export type PublicWriteRateLimitHook = (
  input: PublicWriteRateLimitInput,
) => PublicWriteRateLimitDecision | Promise<PublicWriteRateLimitDecision>;

export const allowAllPublicWriteRateLimit: PublicWriteRateLimitHook = () => ({ allowed: true });

export function toRateLimitErrorResponse(
  decision: Extract<PublicWriteRateLimitDecision, { allowed: false }>,
): RateLimitErrorResponse {
  return { error: 'rate_limited', reason: decision.reason };
}

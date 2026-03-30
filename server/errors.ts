import { RateLimitError } from "@/server/rateLimit";

export type PublicError = {
  status: number;
  code: string;
  message: string;
  request_id: string;
  retry_after_seconds?: number;
};

export function toPublicError(error: unknown, requestId: string): PublicError {
  if (error instanceof RateLimitError) {
    return {
      status: 429,
      code: error.code,
      message: `Rate limit exceeded. Retry in ${error.retryAfterSeconds}s.`,
      request_id: requestId,
      retry_after_seconds: error.retryAfterSeconds,
    };
  }

  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "Something went wrong. Please try again.",
    request_id: requestId,
  };
}

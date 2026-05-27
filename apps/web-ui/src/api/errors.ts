export type ApiErrorBody = {
  error?: string;
  message?: string;
  details?: string[];
  guidance?: string[];
  limit?: number;
  scanLimit?: number;
  diagnostics?: {
    scannedRows?: number;
    scanLimit?: number;
    matchedRows?: number;
    requestedLimit?: number;
    appliedFilterHash?: string;
    classificationStrategy?: string;
    futureClassificationStrategy?: string;
    classificationIndexAvailable?: boolean;
  };
};

export const directoryAccessDeniedMessage = "Access denied. Your user is not enabled for this gateway.";

export async function readApiErrorPayload(response: Response): Promise<{ text: string; body?: ApiErrorBody }> {
  const text = await response.text();
  let body: ApiErrorBody | undefined;
  try {
    body = text ? JSON.parse(text) as ApiErrorBody : undefined;
  } catch {
    body = undefined;
  }
  return { text, body };
}

export function isDirectoryAccessDenied(body: ApiErrorBody | undefined): boolean {
  return body?.error === "user_directory_access_denied" || body?.message === directoryAccessDeniedMessage;
}

export function apiErrorMessage(payload: { text: string; body?: ApiErrorBody }, status: number, fallback: string): string {
  const { text, body } = payload;
  if (status === 429 || body?.error === "Too many requests") {
    return "Too many requests. Wait a minute and try again.";
  }
  if (body?.error === "Session required") {
    return "Your browser session expired. Refresh the page and try again.";
  }
  if (status === 403 && isDirectoryAccessDenied(body) && body?.message) {
    return body.message;
  }
  if (body?.error) {
    return `${fallback}: ${body.error}`;
  }
  return text ? `${fallback}: ${text}` : `${fallback} (${status})`;
}

export async function friendlyApiError(response: Response, fallback: string): Promise<string> {
  return apiErrorMessage(await readApiErrorPayload(response), response.status, fallback);
}

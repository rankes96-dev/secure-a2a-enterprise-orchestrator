const CSRF_COOKIE_NAME = "ogen_csrf";
const CSRF_HEADER_NAME = "x-ogen-csrf-token";

let rememberedCsrfToken: string | undefined;

export function rememberCsrfToken(value: unknown): void {
  if (typeof value === "string" && value.trim()) {
    rememberedCsrfToken = value;
  }
}

function csrfTokenFromCookie(): string | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }

  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.trim().split("=");
    if (name === CSRF_COOKIE_NAME) {
      return decodeURIComponent(valueParts.join("="));
    }
  }

  return undefined;
}

export function csrfHeaders(): Record<string, string> {
  const token = csrfTokenFromCookie() ?? rememberedCsrfToken;
  return token ? { [CSRF_HEADER_NAME]: token } : {};
}

/** Re-throw Next.js navigation redirects that surface as thrown errors. */
export function isNextRedirectError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const digest = "digest" in error ? String((error as { digest: unknown }).digest) : "";
  return digest.startsWith("NEXT_REDIRECT");
}

export function jsonRequest(method: string, url: string, body?: unknown, headers?: HeadersInit) {
  return new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as Record<string, unknown>;
}

export function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

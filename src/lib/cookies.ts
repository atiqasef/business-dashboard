import { cookies } from "next/headers";

export async function parseCookieHeader() {
  const store = await cookies();
  const result = new Headers();

  for (const cookie of store.getAll()) {
    result.append("cookie", `${cookie.name}=${cookie.value}`);
  }

  return result;
}

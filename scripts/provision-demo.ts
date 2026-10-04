function assertSafeLocalTarget() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Demo provisioning is disabled in production");
  }

  if (process.argv[2] !== "--local") {
    throw new Error("Demo provisioning requires the explicit --local argument");
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) return;

  let hostname = "";
  try {
    hostname = new URL(uri).hostname;
  } catch {
    throw new Error("Demo provisioning requires a verifiable local MongoDB target");
  }

  if (!["127.0.0.1", "localhost", "::1"].includes(hostname)) {
    throw new Error("Demo provisioning accepts local MongoDB targets only");
  }
}

async function main() {
  assertSafeLocalTarget();
  const { connectMongo } = await import("@/lib/db");
  const { provisionDemo } = await import("@/server/demo/provision");
  await connectMongo();
  await provisionDemo();
}

main().catch(() => {
  process.exitCode = 1;
});
function assertSafeProvisionTarget() {
  const args = new Set(process.argv.slice(2));
  const allowProduction =
    args.has("--production") && process.env.ALLOW_PRODUCTION_DEMO_PROVISION === "1";

  if (args.has("--local")) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Local demo provisioning cannot run with NODE_ENV=production");
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
      throw new Error("Local demo provisioning accepts local MongoDB targets only");
    }

    return;
  }

  if (allowProduction) {
    if (!process.env.MONGODB_URI) {
      throw new Error("Production demo provisioning requires MONGODB_URI");
    }
    return;
  }

  throw new Error(
    "Demo provisioning requires either `--local` or `--production` with ALLOW_PRODUCTION_DEMO_PROVISION=1",
  );
}

async function main() {
  assertSafeProvisionTarget();
  const { connectMongo } = await import("@/lib/db");
  const { provisionDemo } = await import("@/server/demo/provision");
  await connectMongo();
  await provisionDemo();
  console.log("Demo account provisioned successfully.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Demo provisioning failed");
  process.exitCode = 1;
});

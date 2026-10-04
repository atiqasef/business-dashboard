import type { PlanFeature, PlanLimitResource } from "@/server/entitlements/plans";

export class EntitlementError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;

  constructor(message: string, status: number, code: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "EntitlementError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function planFeatureDeniedError(feature: PlanFeature) {
  return new EntitlementError(`Your current plan does not include ${feature}.`, 403, "PLAN_FEATURE_DENIED", {
    feature,
  });
}

export function planLimitReachedError(resource: PlanLimitResource, limit: number, current: number) {
  return new EntitlementError(`Plan limit reached for ${resource}.`, 403, "PLAN_LIMIT_REACHED", {
    resource,
    limit,
    current,
  });
}

export function organizationSuspendedError() {
  return new EntitlementError("Organization is suspended.", 403, "ORGANIZATION_SUSPENDED");
}

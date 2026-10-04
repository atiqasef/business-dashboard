import type { OrganizationDocument } from "@/server/db/models/organization";
import {
  buildOrganizationEntitlements,
  toPublicOrganizationEntitlements,
  type OrganizationEntitlements,
} from "@/server/entitlements/service";
import { ensureOrganizationForUser } from "@/server/organizations/provision";

export type ResolvedOrganizationContext = {
  /** Same value as existing business-document `ownerId`. Not for client exposure. */
  ownerUserId: string;
  organization: OrganizationDocument;
  entitlements: OrganizationEntitlements;
};

/**
 * Session user → organization → plan → entitlements.
 * Never accepts browser-supplied organizationId / planId.
 */
export async function resolveOrganizationForUser(
  ownerUserId: string,
  options?: { displayName?: string },
): Promise<ResolvedOrganizationContext> {
  const organization = await ensureOrganizationForUser(ownerUserId, options);
  const entitlements = buildOrganizationEntitlements(organization);
  return { ownerUserId, organization, entitlements };
}

export function toPublicOrganizationResponse(context: ResolvedOrganizationContext) {
  return toPublicOrganizationEntitlements(context.organization, context.entitlements);
}

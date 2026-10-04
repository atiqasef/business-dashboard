import {
  ensureBusinessProfileIndexes,
  getBusinessProfilesCollection,
  toBusinessProfileResponse,
  type BusinessAddress,
  type BusinessProfileDocument,
  type BusinessProfileResponse,
} from "@/server/db/models/business-profile";

const LIMITS = {
  businessName: 120,
  legalName: 160,
  email: 254,
  phone: 40,
  website: 2048,
  addressField: 120,
  taxId: 80,
  logoUrl: 2048,
  invoiceNotes: 2000,
} as const;

export type BusinessProfileInput = {
  businessName?: unknown;
  legalName?: unknown;
  email?: unknown;
  phone?: unknown;
  website?: unknown;
  address?: unknown;
  taxId?: unknown;
  logoUrl?: unknown;
  invoiceNotes?: unknown;
};

export class BusinessProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessProfileValidationError";
  }
}

function textValue(value: unknown, field: string, options: { required?: boolean; max: number }) {
  if (value === undefined || value === null) {
    if (options.required) throw new BusinessProfileValidationError(`${field} is required`);
    return undefined;
  }

  if (typeof value !== "string") throw new BusinessProfileValidationError(`${field} must be a string`);
  const result = value.trim();
  if (options.required && !result) throw new BusinessProfileValidationError(`${field} is required`);
  if (result.length > options.max) throw new BusinessProfileValidationError(`${field} is too long`);
  return result || undefined;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseHttpsUrl(value: string, field: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BusinessProfileValidationError(`${field} is invalid`);
  }

  if (url.protocol !== "https:") {
    throw new BusinessProfileValidationError(`${field} must be an https URL`);
  }
  if (url.username || url.password) {
    throw new BusinessProfileValidationError(`${field} is invalid`);
  }
  if (!url.hostname || url.hostname === "localhost" || url.hostname.endsWith(".local")) {
    throw new BusinessProfileValidationError(`${field} is invalid`);
  }

  return url.toString();
}

function parseAddress(value: unknown): BusinessAddress | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new BusinessProfileValidationError("address must be an object");
  }

  const input = value as Record<string, unknown>;
  const address: BusinessAddress = {
    street: textValue(input.street, "address.street", { max: LIMITS.addressField }),
    city: textValue(input.city, "address.city", { max: LIMITS.addressField }),
    state: textValue(input.state, "address.state", { max: LIMITS.addressField }),
    postalCode: textValue(input.postalCode, "address.postalCode", { max: LIMITS.addressField }),
    country: textValue(input.country, "address.country", { max: LIMITS.addressField }),
  };

  const hasValue = Object.values(address).some(Boolean);
  return hasValue ? address : undefined;
}

export function parseBusinessProfileInput(input: BusinessProfileInput) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BusinessProfileValidationError("Request body is invalid");
  }

  const businessName = textValue(input.businessName, "businessName", {
    required: true,
    max: LIMITS.businessName,
  })!;

  const emailRaw = textValue(input.email, "email", { max: LIMITS.email });
  const email = emailRaw?.toLowerCase();
  if (email && !isValidEmail(email)) throw new BusinessProfileValidationError("email is invalid");

  const websiteRaw = textValue(input.website, "website", { max: LIMITS.website });
  const website = websiteRaw ? parseHttpsUrl(websiteRaw, "website") : undefined;

  const logoUrlRaw = textValue(input.logoUrl, "logoUrl", { max: LIMITS.logoUrl });
  const logoUrl = logoUrlRaw ? parseHttpsUrl(logoUrlRaw, "logoUrl") : undefined;

  return {
    businessName,
    legalName: textValue(input.legalName, "legalName", { max: LIMITS.legalName }),
    email,
    phone: textValue(input.phone, "phone", { max: LIMITS.phone }),
    website,
    address: parseAddress(input.address),
    taxId: textValue(input.taxId, "taxId", { max: LIMITS.taxId }),
    logoUrl,
    invoiceNotes: textValue(input.invoiceNotes, "invoiceNotes", { max: LIMITS.invoiceNotes }),
  };
}

export async function getBusinessProfile(ownerId: string): Promise<BusinessProfileResponse> {
  if (!ownerId || typeof ownerId !== "string") {
    throw new Error("ownerId is required");
  }

  await ensureBusinessProfileIndexes();
  const profile = await getBusinessProfilesCollection().findOne({ ownerId });
  return toBusinessProfileResponse(profile);
}

export async function upsertBusinessProfile(
  ownerId: string,
  input: BusinessProfileInput,
): Promise<BusinessProfileResponse> {
  if (!ownerId || typeof ownerId !== "string") {
    throw new Error("ownerId is required");
  }

  const parsed = parseBusinessProfileInput(input);
  const now = new Date();
  await ensureBusinessProfileIndexes();

  const unsetFields: Record<string, ""> = {};
  const setFields: Partial<BusinessProfileDocument> = {
    businessName: parsed.businessName,
    updatedAt: now,
  };

  const optionalKeys = [
    "legalName",
    "email",
    "phone",
    "website",
    "address",
    "taxId",
    "logoUrl",
    "invoiceNotes",
  ] as const;

  for (const key of optionalKeys) {
    const value = parsed[key];
    if (value === undefined) unsetFields[key] = "";
    else setFields[key] = value as never;
  }

  const update: Record<string, unknown> = {
    $set: setFields,
    $setOnInsert: { ownerId, createdAt: now },
  };
  if (Object.keys(unsetFields).length > 0) {
    update.$unset = unsetFields;
  }

  const result = await getBusinessProfilesCollection().findOneAndUpdate({ ownerId }, update, {
    upsert: true,
    returnDocument: "after",
  });

  if (!result) {
    throw new Error("Unable to save business profile");
  }

  return toBusinessProfileResponse(result);
}

/** Branding payload for invoice PDF/email — falls back to Ledger defaults when missing. */
export type InvoiceBusinessBranding = {
  businessName: string;
  legalName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: {
    street: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
  };
  invoiceNotes: string | null;
  logoUrl: string | null;
};

export async function getInvoiceBusinessBranding(ownerId: string): Promise<InvoiceBusinessBranding> {
  const profile = await getBusinessProfile(ownerId);
  if (!profile.exists || !profile.businessName.trim()) {
    return {
      businessName: "Ledger",
      legalName: null,
      email: null,
      phone: null,
      website: null,
      address: {
        street: null,
        city: null,
        state: null,
        postalCode: null,
        country: null,
      },
      invoiceNotes: null,
      logoUrl: null,
    };
  }

  return {
    businessName: profile.businessName.trim(),
    legalName: profile.legalName,
    email: profile.email,
    phone: profile.phone,
    website: profile.website,
    address: profile.address,
    invoiceNotes: profile.invoiceNotes,
    logoUrl: profile.logoUrl,
  };
}

import { ObjectId, type Collection } from "mongodb";
import { db } from "@/lib/db";

export type BusinessAddress = {
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
};

export interface BusinessProfileDocument {
  _id?: ObjectId;
  ownerId: string;
  businessName: string;
  legalName?: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: BusinessAddress;
  taxId?: string;
  logoUrl?: string;
  invoiceNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

let indexesPromise: Promise<void> | null = null;

export function getBusinessProfilesCollection(): Collection<BusinessProfileDocument> {
  return db.collection<BusinessProfileDocument>("business-profiles");
}

export async function ensureBusinessProfileIndexes() {
  if (!indexesPromise) {
    indexesPromise = getBusinessProfilesCollection()
      .createIndexes([{ key: { ownerId: 1 }, name: "owner_id_unique", unique: true }])
      .then(() => undefined);
  }

  return indexesPromise;
}

export function toBusinessProfileResponse(profile: BusinessProfileDocument | null) {
  if (!profile) {
    return {
      id: null as string | null,
      exists: false,
      businessName: "",
      legalName: null as string | null,
      email: null as string | null,
      phone: null as string | null,
      website: null as string | null,
      address: {
        street: null as string | null,
        city: null as string | null,
        state: null as string | null,
        postalCode: null as string | null,
        country: null as string | null,
      },
      taxId: null as string | null,
      logoUrl: null as string | null,
      invoiceNotes: null as string | null,
      createdAt: null as string | null,
      updatedAt: null as string | null,
    };
  }

  return {
    id: profile._id?.toString() ?? null,
    exists: true,
    businessName: profile.businessName,
    legalName: profile.legalName ?? null,
    email: profile.email ?? null,
    phone: profile.phone ?? null,
    website: profile.website ?? null,
    address: {
      street: profile.address?.street ?? null,
      city: profile.address?.city ?? null,
      state: profile.address?.state ?? null,
      postalCode: profile.address?.postalCode ?? null,
      country: profile.address?.country ?? null,
    },
    taxId: profile.taxId ?? null,
    logoUrl: profile.logoUrl ?? null,
    invoiceNotes: profile.invoiceNotes ?? null,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export type BusinessProfileResponse = ReturnType<typeof toBusinessProfileResponse>;

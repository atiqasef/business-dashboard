"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { BusinessProfileResponse } from "@/server/db/models/business-profile";

type FormState = {
  businessName: string;
  legalName: string;
  email: string;
  phone: string;
  website: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  taxId: string;
  invoiceNotes: string;
  logoUrl: string;
};

type FieldErrors = Partial<Record<keyof FormState, string>>;

function profileToForm(profile: BusinessProfileResponse | null): FormState {
  return {
    businessName: profile?.businessName ?? "",
    legalName: profile?.legalName ?? "",
    email: profile?.email ?? "",
    phone: profile?.phone ?? "",
    website: profile?.website ?? "",
    street: profile?.address.street ?? "",
    city: profile?.address.city ?? "",
    state: profile?.address.state ?? "",
    postalCode: profile?.address.postalCode ?? "",
    country: profile?.address.country ?? "",
    taxId: profile?.taxId ?? "",
    invoiceNotes: profile?.invoiceNotes ?? "",
    logoUrl: profile?.logoUrl ?? "",
  };
}

function isSafeHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function validateClient(form: FormState): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.businessName.trim()) errors.businessName = "Business name is required.";
  if (form.businessName.trim().length > 120) errors.businessName = "Business name is too long.";
  if (form.legalName.trim().length > 160) errors.legalName = "Legal name is too long.";
  if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errors.email = "Enter a valid email address.";
  }
  if (form.phone.trim().length > 40) errors.phone = "Phone number is too long.";
  if (form.website.trim() && !isSafeHttpsUrl(form.website.trim())) {
    errors.website = "Website must be a valid https URL.";
  }
  if (form.logoUrl.trim() && !isSafeHttpsUrl(form.logoUrl.trim())) {
    errors.logoUrl = "Logo URL must be a valid https URL.";
  }
  if (form.invoiceNotes.trim().length > 2000) errors.invoiceNotes = "Invoice notes are too long.";
  for (const key of ["street", "city", "state", "postalCode", "country"] as const) {
    if (form[key].trim().length > 120) errors[key] = "This field is too long.";
  }
  if (form.taxId.trim().length > 80) errors.taxId = "Tax ID is too long.";
  return errors;
}

function Field({
  id,
  label,
  required,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-[var(--ink)]">
        {label}
        {required ? <span className="text-[var(--accent)]"> *</span> : null}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs font-medium text-[var(--warning)]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SettingsPage({
  readOnlyDemo,
  initialProfile,
}: {
  readOnlyDemo: boolean;
  initialProfile: BusinessProfileResponse | null;
}) {
  const [form, setForm] = useState<FormState>(() => profileToForm(initialProfile));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loadError, setLoadError] = useState<string | null>(initialProfile ? null : "Unable to load business profile.");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [exists, setExists] = useState(Boolean(initialProfile?.exists));

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setSuccess(null);
    setServerError(null);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (readOnlyDemo || saving) return;

    const nextErrors = validateClient(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    setSuccess(null);
    setServerError(null);

    try {
      const response = await fetch("/api/settings/business-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: form.businessName,
          legalName: form.legalName || null,
          email: form.email || null,
          phone: form.phone || null,
          website: form.website || null,
          address: {
            street: form.street || null,
            city: form.city || null,
            state: form.state || null,
            postalCode: form.postalCode || null,
            country: form.country || null,
          },
          taxId: form.taxId || null,
          logoUrl: form.logoUrl || null,
          invoiceNotes: form.invoiceNotes || null,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { data?: BusinessProfileResponse; error?: string }
        | null;

      if (!response.ok) {
        const message = payload?.error || "Unable to save business profile.";
        if (message.includes("businessName")) setErrors((current) => ({ ...current, businessName: message }));
        else if (message.includes("email")) setErrors((current) => ({ ...current, email: message }));
        else if (message.includes("website")) setErrors((current) => ({ ...current, website: message }));
        else if (message.includes("logoUrl")) setErrors((current) => ({ ...current, logoUrl: message }));
        else if (message.includes("invoiceNotes")) setErrors((current) => ({ ...current, invoiceNotes: message }));
        setServerError(message);
        return;
      }

      if (!payload?.data) {
        setServerError("Unable to save business profile.");
        return;
      }

      setForm(profileToForm(payload.data));
      setExists(payload.data.exists);
      setErrors({});
      setSuccess("Business profile saved.");
      setLoadError(null);
    } catch {
      setServerError("Unable to save business profile.");
    } finally {
      setSaving(false);
    }
  }

  const logoPreview = form.logoUrl.trim() && isSafeHttpsUrl(form.logoUrl.trim()) ? form.logoUrl.trim() : null;
  const disabled = readOnlyDemo || saving || Boolean(loadError);

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-bold tracking-[0.18em] text-[var(--accent)] uppercase">Workspace / Settings</p>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Settings</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Manage your business identity used on invoices and customer emails.
          </p>
        </div>
        {readOnlyDemo ? <Badge tone="accent">Read-only demo</Badge> : null}
      </div>

      {loadError ? (
        <Card>
          <h2 className="text-lg font-semibold">Unable to load settings</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">{loadError}</p>
        </Card>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          {readOnlyDemo ? (
            <p className="rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] px-4 py-3 text-sm text-[var(--muted)]">
              Demo account settings are view-only. Changes cannot be saved.
            </p>
          ) : null}

          {!exists && !readOnlyDemo ? (
            <p className="text-sm text-[var(--muted)]">
              No business profile yet. Add your details below — they will appear on invoice PDFs and emails.
            </p>
          ) : null}

          <Card>
            <CardHeading>
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.02em]">Business information</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">Primary identity for invoices and emails</p>
              </div>
            </CardHeading>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field id="businessName" label="Business name" required error={errors.businessName}>
                <Input
                  id="businessName"
                  value={form.businessName}
                  onChange={(event) => updateField("businessName", event.target.value)}
                  disabled={disabled}
                  required
                  autoComplete="organization"
                />
              </Field>
              <Field id="legalName" label="Legal name" error={errors.legalName}>
                <Input
                  id="legalName"
                  value={form.legalName}
                  onChange={(event) => updateField("legalName", event.target.value)}
                  disabled={disabled}
                />
              </Field>
              <Field id="email" label="Email" error={errors.email}>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(event) => updateField("email", event.target.value)}
                  disabled={disabled}
                  autoComplete="email"
                />
              </Field>
              <Field id="phone" label="Phone" error={errors.phone}>
                <Input
                  id="phone"
                  type="tel"
                  value={form.phone}
                  onChange={(event) => updateField("phone", event.target.value)}
                  disabled={disabled}
                  autoComplete="tel"
                />
              </Field>
              <Field id="website" label="Website" error={errors.website}>
                <Input
                  id="website"
                  type="url"
                  placeholder="https://"
                  value={form.website}
                  onChange={(event) => updateField("website", event.target.value)}
                  disabled={disabled}
                  className="sm:col-span-2"
                />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeading>
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.02em]">Business address</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">Shown on invoice documents when provided</p>
              </div>
            </CardHeading>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field id="street" label="Street" error={errors.street}>
                <Input
                  id="street"
                  value={form.street}
                  onChange={(event) => updateField("street", event.target.value)}
                  disabled={disabled}
                  autoComplete="street-address"
                />
              </Field>
              <Field id="city" label="City" error={errors.city}>
                <Input
                  id="city"
                  value={form.city}
                  onChange={(event) => updateField("city", event.target.value)}
                  disabled={disabled}
                  autoComplete="address-level2"
                />
              </Field>
              <Field id="state" label="State / Province" error={errors.state}>
                <Input
                  id="state"
                  value={form.state}
                  onChange={(event) => updateField("state", event.target.value)}
                  disabled={disabled}
                  autoComplete="address-level1"
                />
              </Field>
              <Field id="postalCode" label="Postal code" error={errors.postalCode}>
                <Input
                  id="postalCode"
                  value={form.postalCode}
                  onChange={(event) => updateField("postalCode", event.target.value)}
                  disabled={disabled}
                  autoComplete="postal-code"
                />
              </Field>
              <Field id="country" label="Country" error={errors.country}>
                <Input
                  id="country"
                  value={form.country}
                  onChange={(event) => updateField("country", event.target.value)}
                  disabled={disabled}
                  autoComplete="country-name"
                />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeading>
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.02em]">Tax & invoicing</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">Optional defaults for invoice documents</p>
              </div>
            </CardHeading>
            <div className="mt-5 grid gap-4">
              <Field id="taxId" label="Tax ID" error={errors.taxId}>
                <Input
                  id="taxId"
                  value={form.taxId}
                  onChange={(event) => updateField("taxId", event.target.value)}
                  disabled={disabled}
                />
              </Field>
              <Field id="invoiceNotes" label="Default invoice notes" error={errors.invoiceNotes}>
                <textarea
                  id="invoiceNotes"
                  value={form.invoiceNotes}
                  onChange={(event) => updateField("invoiceNotes", event.target.value)}
                  disabled={disabled}
                  rows={4}
                  className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 py-2.5 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] disabled:opacity-60"
                />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeading>
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.02em]">Branding</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">HTTPS logo URL only for this phase</p>
              </div>
            </CardHeading>
            <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
              <Field id="logoUrl" label="Logo URL" error={errors.logoUrl}>
                <Input
                  id="logoUrl"
                  type="url"
                  placeholder="https://"
                  value={form.logoUrl}
                  onChange={(event) => updateField("logoUrl", event.target.value)}
                  disabled={disabled}
                />
              </Field>
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-3 sm:mt-7">
                {logoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- remote user-supplied HTTPS URL preview
                  <img
                    src={logoPreview}
                    alt="Business logo preview"
                    className="h-16 w-auto max-w-[180px] object-contain"
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <p className="text-xs text-[var(--muted)]">No logo preview</p>
                )}
              </div>
            </div>
          </Card>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div aria-live="polite" className="min-h-5 text-sm">
              {success ? <p className="font-medium text-[var(--positive)]">{success}</p> : null}
              {serverError ? (
                <p className="font-medium text-[var(--warning)]" role="alert">
                  {serverError}
                </p>
              ) : null}
            </div>
            <Button type="submit" variant="primary" disabled={disabled} aria-busy={saving}>
              {saving ? "Saving…" : "Save business profile"}
            </Button>
          </div>
        </form>
      )}
    </main>
  );
}

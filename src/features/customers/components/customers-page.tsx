"use client";

import { useEffect, useState } from "react";
import { Search, Plus, MoreHorizontal, Pencil, Trash2, Eye, ChevronLeft, ChevronRight, X, Loader2, Users, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type CustomerStatus = "active" | "inactive";
type Customer = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  status: CustomerStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type CustomerForm = Omit<Customer, "id" | "createdAt" | "updatedAt">;
type FormErrors = Partial<Record<keyof CustomerForm, string>> & { form?: string };

const emptyForm: CustomerForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  company: "",
  address: "",
  city: "",
  country: "",
  status: "active",
  notes: "",
};

function customerName(customer: Customer) {
  return `${customer.firstName} ${customer.lastName}`.trim();
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function initials(customer: Customer) {
  return `${customer.firstName[0] ?? ""}${customer.lastName[0] ?? ""}`.toUpperCase();
}

function statusTone(status: CustomerStatus) {
  return status === "active" ? "positive" as const : "neutral" as const;
}

export function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | CustomerStatus>("all");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"create" | "edit" | "details" | null>(null);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [form, setForm] = useState<CustomerForm>(emptyForm);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [searchDraft]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadCustomers() {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: "10" });
        if (search) params.set("search", search);
        if (status !== "all") params.set("status", status);
        const response = await fetch(`/api/customers?${params}`, { signal: controller.signal, credentials: "include" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load customers.");
        setCustomers(payload.data);
        setPagination(payload.pagination);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load customers.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    loadCustomers();
    return () => controller.abort();
  }, [page, search, status]);

  function openCreate() {
    setSelected(null);
    setForm(emptyForm);
    setFormErrors({});
    setModal("create");
  }

  function openEdit(customer: Customer) {
    setSelected(customer);
    setForm({
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email ?? "",
      phone: customer.phone ?? "",
      company: customer.company ?? "",
      address: customer.address ?? "",
      city: customer.city ?? "",
      country: customer.country ?? "",
      status: customer.status,
      notes: customer.notes ?? "",
    });
    setFormErrors({});
    setModal("edit");
  }

  function openDetails(customer: Customer) {
    setSelected(customer);
    setModal("details");
  }

  function updateForm(field: keyof CustomerForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setFormErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  }

  function validateForm() {
    const nextErrors: FormErrors = {};
    if (!form.firstName.trim()) nextErrors.firstName = "First name is required.";
    if (!form.lastName.trim()) nextErrors.lastName = "Last name is required.";
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) nextErrors.email = "Enter a valid email address.";
    setFormErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function saveCustomer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateForm()) return;
    setSaving(true);
    setFormErrors({});
    const endpoint = selected ? `/api/customers/${selected.id}` : "/api/customers";
    try {
      const response = await fetch(endpoint, {
        method: selected ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save customer.");
      setModal(null);
      setFeedback(selected ? "Customer updated successfully." : "Customer added successfully.");
      setPage(1);
      setSearch(search);
    } catch (saveError) {
      setFormErrors({ form: saveError instanceof Error ? saveError.message : "Unable to save customer." });
    } finally {
      setSaving(false);
    }
  }

  async function deleteCustomer(customer: Customer) {
    if (!window.confirm(`Delete ${customerName(customer)}? This action cannot be undone.`)) return;
    setDeletingId(customer.id);
    setFeedback("");
    try {
      const response = await fetch(`/api/customers/${customer.id}`, { method: "DELETE", credentials: "include" });
      const payload = response.status === 204 ? null : await response.json();
      if (!response.ok) throw new Error(payload?.error || "Unable to delete customer.");
      setFeedback("Customer deleted successfully.");
      if (customers.length === 1 && page > 1) setPage(page - 1);
      else setCustomers((current) => current.filter((item) => item.id !== customer.id));
      setPagination((current) => ({ ...current, total: Math.max(current.total - 1, 0) }));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete customer.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-xs font-bold tracking-[0.18em] text-[var(--accent)] uppercase">Workspace / Customers</p>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Customers</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">Keep every customer relationship organized in one place.</p>
        </div>
        <Button variant="primary" className="self-start sm:self-auto" onClick={openCreate}><Plus className="size-4" aria-hidden="true" /> Add customer</Button>
      </div>

      {feedback ? <div className="mb-5 rounded-xl border border-[var(--positive)]/20 bg-[var(--positive-soft)] px-4 py-3 text-sm font-medium text-[var(--positive)]" role="status">{feedback}</div> : null}
      <Card padding="none">
        <div className="flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
          <div><p className="text-sm text-[var(--muted)]">Total customers</p><p className="mt-1 text-2xl font-semibold tracking-[-0.03em]">{pagination.total}</p></div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input aria-label="Search customers" placeholder="Search customers..." type="search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} className="h-10 min-w-0 sm:w-64" />
            <label className="flex h-10 items-center rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 text-sm text-[var(--muted)]">
              <span className="sr-only">Filter by status</span>
              <select aria-label="Filter by status" value={status} onChange={(event) => { setStatus(event.target.value as "all" | CustomerStatus); setPage(1); }} className="bg-transparent pr-5 text-sm font-medium text-[var(--ink)] outline-none">
                <option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
              </select>
            </label>
          </div>
        </div>

        {error ? <div className="mx-5 mb-5 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:mx-6"><span>{error}</span><Button variant="ghost" className="h-8 px-2 text-red-700" onClick={() => { setError(""); setPage(page); }}><RefreshCw className="size-4" aria-hidden="true" /> Retry</Button></div> : null}
        {loading ? <div className="space-y-3 p-5 sm:p-6" aria-label="Loading customers" aria-busy="true">{[1, 2, 3, 4].map((item) => <div key={item} className="h-14 animate-pulse rounded-xl bg-[var(--surface-soft)]" />)}</div> : customers.length === 0 ? <div className="flex flex-col items-center justify-center px-6 py-20 text-center"><span className="grid size-14 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-strong)]"><Users className="size-7" aria-hidden="true" /></span><h2 className="mt-5 text-lg font-semibold">{search || status !== "all" ? "No customers match these filters" : "No customers yet"}</h2><p className="mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">{search || status !== "all" ? "Try another search or clear the status filter." : "Add your first customer to start building your customer directory."}</p>{!search && status === "all" ? <Button variant="secondary" className="mt-5" onClick={openCreate}><Plus className="size-4" aria-hidden="true" /> Add customer</Button> : null}</div> : <>
          <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[760px] text-left"><thead className="border-y border-[var(--line)] bg-[var(--surface-soft)] text-[11px] font-bold tracking-[0.12em] text-[var(--muted)] uppercase"><tr><th className="px-5 py-3 font-semibold">Name</th><th className="px-5 py-3 font-semibold">Email</th><th className="px-5 py-3 font-semibold">Phone</th><th className="px-5 py-3 font-semibold">Company</th><th className="px-5 py-3 font-semibold">Status</th><th className="px-5 py-3 font-semibold">Created</th><th className="px-5 py-3 font-semibold"><span className="sr-only">Actions</span></th></tr></thead><tbody className="divide-y divide-[var(--line)]">{customers.map((customer) => <CustomerRow key={customer.id} customer={customer} deleting={deletingId === customer.id} onView={() => openDetails(customer)} onEdit={() => openEdit(customer)} onDelete={() => deleteCustomer(customer)} />)}</tbody></table></div>
          <div className="divide-y divide-[var(--line)] md:hidden">{customers.map((customer) => <CustomerMobileCard key={customer.id} customer={customer} deleting={deletingId === customer.id} onView={() => openDetails(customer)} onEdit={() => openEdit(customer)} onDelete={() => deleteCustomer(customer)} />)}</div>
          <div className="flex flex-col gap-3 border-t border-[var(--line)] p-4 text-sm text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between"><p>Showing {((page - 1) * pagination.pageSize) + 1}-{Math.min(page * pagination.pageSize, pagination.total)} of {pagination.total}</p><div className="flex items-center gap-2"><Button variant="secondary" className="h-9 px-3" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft className="size-4" aria-hidden="true" /> Previous</Button><span className="px-2 text-xs font-semibold text-[var(--ink)]">Page {page} of {Math.max(pagination.totalPages, 1)}</span><Button variant="secondary" className="h-9 px-3" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)}>Next <ChevronRight className="size-4" aria-hidden="true" /></Button></div></div>
        </>}
      </Card>

      {modal === "details" && selected ? <DetailsModal customer={selected} onClose={() => setModal(null)} onEdit={() => openEdit(selected)} /> : null}
      {modal === "create" || modal === "edit" ? <CustomerFormModal mode={modal} form={form} errors={formErrors} saving={saving} onChange={updateForm} onSubmit={saveCustomer} onClose={() => setModal(null)} /> : null}
    </main>
  );
}

function CustomerRow({ customer, deleting, onView, onEdit, onDelete }: { customer: Customer; deleting: boolean; onView: () => void; onEdit: () => void; onDelete: () => void }) {
  return <tr className="text-sm"><td className="px-5 py-4"><button className="flex items-center gap-3 text-left" onClick={onView}><span className="grid size-9 place-items-center rounded-xl bg-[var(--accent-soft)] text-xs font-bold text-[var(--accent-strong)]">{initials(customer)}</span><span className="font-semibold hover:text-[var(--accent-strong)]">{customerName(customer)}</span></button></td><td className="px-5 py-4 text-[var(--muted)]">{customer.email || "—"}</td><td className="px-5 py-4 text-[var(--muted)]">{customer.phone || "—"}</td><td className="px-5 py-4 text-[var(--muted)]">{customer.company || "—"}</td><td className="px-5 py-4"><Badge tone={statusTone(customer.status)}>{customer.status}</Badge></td><td className="px-5 py-4 text-[var(--muted)]">{formatDate(customer.createdAt)}</td><td className="px-5 py-4"><ActionMenu deleting={deleting} onView={onView} onEdit={onEdit} onDelete={onDelete} /></td></tr>;
}

function CustomerMobileCard({ customer, deleting, onView, onEdit, onDelete }: { customer: Customer; deleting: boolean; onView: () => void; onEdit: () => void; onDelete: () => void }) {
  return <div className="p-4"><div className="flex items-start justify-between gap-3"><button className="flex min-w-0 items-center gap-3 text-left" onClick={onView}><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-xs font-bold text-[var(--accent-strong)]">{initials(customer)}</span><span className="min-w-0"><span className="block truncate font-semibold">{customerName(customer)}</span><span className="mt-1 block truncate text-xs text-[var(--muted)]">{customer.email || "No email provided"}</span></span></button><ActionMenu deleting={deleting} onView={onView} onEdit={onEdit} onDelete={onDelete} /></div><div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div><p className="text-[var(--muted)]">Company</p><p className="mt-1 font-medium">{customer.company || "—"}</p></div><div><p className="text-[var(--muted)]">Status</p><div className="mt-1"><Badge tone={statusTone(customer.status)}>{customer.status}</Badge></div></div></div></div>;
}

function ActionMenu({ deleting, onView, onEdit, onDelete }: { deleting: boolean; onView: () => void; onEdit: () => void; onDelete: () => void }) {
  return <div className="flex items-center gap-1"><Button variant="icon" className="size-8" aria-label="View customer" onClick={onView}><Eye className="size-4" aria-hidden="true" /></Button><Button variant="icon" className="size-8" aria-label="Edit customer" onClick={onEdit}><Pencil className="size-4" aria-hidden="true" /></Button><Button variant="icon" className="size-8 text-red-500 hover:text-red-600" aria-label="Delete customer" onClick={onDelete} disabled={deleting}>{deleting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}</Button></div>;
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[var(--ink)]/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={title}><button className="absolute inset-0 cursor-default" aria-label="Close dialog" onClick={onClose} /><div className="relative z-10 my-auto max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] shadow-2xl"><div className="sticky top-0 flex items-center justify-between border-b border-[var(--line)] bg-[var(--surface-raised)] px-5 py-4 sm:px-6"><h2 className="text-lg font-semibold">{title}</h2><Button variant="icon" className="size-8" aria-label="Close dialog" onClick={onClose}><X className="size-5" aria-hidden="true" /></Button></div>{children}</div></div>;
}

function DetailsModal({ customer, onClose, onEdit }: { customer: Customer; onClose: () => void; onEdit: () => void }) {
  const fields = [["Email", customer.email], ["Phone", customer.phone], ["Company", customer.company], ["Address", customer.address], ["City", customer.city], ["Country", customer.country]];
  return <Modal title="Customer details" onClose={onClose}><div className="p-5 sm:p-6"><div className="flex items-center gap-4"><span className="grid size-14 place-items-center rounded-2xl bg-[var(--accent-soft)] text-lg font-bold text-[var(--accent-strong)]">{initials(customer)}</span><div><h3 className="text-xl font-semibold">{customerName(customer)}</h3><div className="mt-2"><Badge tone={statusTone(customer.status)}>{customer.status}</Badge></div></div></div><div className="mt-7 grid gap-x-6 gap-y-5 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label}><p className="text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">{label}</p><p className="mt-1 text-sm">{value || "Not provided"}</p></div>)}<div className="sm:col-span-2"><p className="text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">Notes</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{customer.notes || "No notes added."}</p></div></div><div className="mt-7 flex justify-end gap-3 border-t border-[var(--line)] pt-5"><Button variant="secondary" onClick={onClose}>Close</Button><Button variant="primary" onClick={onEdit}><Pencil className="size-4" aria-hidden="true" /> Edit customer</Button></div></div></Modal>;
}

function CustomerFormModal({ mode, form, errors, saving, onChange, onSubmit, onClose }: { mode: "create" | "edit"; form: CustomerForm; errors: FormErrors; saving: boolean; onChange: (field: keyof CustomerForm, value: string) => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const fields: { field: keyof CustomerForm; label: string; placeholder: string; required?: boolean }[] = [{ field: "firstName", label: "First name", placeholder: "Alex", required: true }, { field: "lastName", label: "Last name", placeholder: "Morgan", required: true }, { field: "email", label: "Email address", placeholder: "alex@company.com" }, { field: "phone", label: "Phone", placeholder: "+1 555 123 4567" }, { field: "company", label: "Company", placeholder: "Acme Inc." }, { field: "address", label: "Address", placeholder: "123 Market Street" }, { field: "city", label: "City", placeholder: "San Francisco" }, { field: "country", label: "Country", placeholder: "United States" }];
  return <Modal title={mode === "create" ? "Add customer" : "Edit customer"} onClose={onClose}><form onSubmit={onSubmit} className="p-5 sm:p-6"><div className="grid gap-4 sm:grid-cols-2">{fields.map(({ field, label, placeholder, required }) => <div key={field} className="space-y-2"><label htmlFor={`customer-${field}`} className="text-sm font-medium">{label}{required ? <span className="text-red-500"> *</span> : null}</label><Input id={`customer-${field}`} value={form[field] as string} onChange={(event) => onChange(field, event.target.value)} placeholder={placeholder} aria-invalid={Boolean(errors[field])} />{errors[field] ? <p className="text-xs text-red-600">{errors[field]}</p> : null}</div>)}<div className="space-y-2"><label htmlFor="customer-status" className="text-sm font-medium">Status</label><select id="customer-status" value={form.status} onChange={(event) => onChange("status", event.target.value)} className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]"><option value="active">Active</option><option value="inactive">Inactive</option></select></div><div className="space-y-2 sm:col-span-2"><label htmlFor="customer-notes" className="text-sm font-medium">Notes</label><textarea id="customer-notes" value={form.notes ?? ""} onChange={(event) => onChange("notes", event.target.value)} placeholder="Add context about this customer..." rows={4} className="w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 py-2 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]" /></div></div>{errors.form ? <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{errors.form}</p> : null}<div className="mt-7 flex justify-end gap-3 border-t border-[var(--line)] pt-5"><Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button><Button type="submit" variant="primary" disabled={saving}>{saving ? <><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Saving...</> : mode === "create" ? <><Plus className="size-4" aria-hidden="true" /> Add customer</> : <><Pencil className="size-4" aria-hidden="true" /> Save changes</>}</Button></div></form></Modal>;
}
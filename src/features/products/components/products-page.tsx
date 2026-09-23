"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, Loader2, Package, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { BackToDashboardLink } from "@/components/common/back-to-dashboard-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type ProductStatus = "active" | "inactive";

type Product = {
  id: string;
  name: string;
  description: string | null;
  sku: string;
  price: number;
  costPrice: number | null;
  stock: number;
  category: string | null;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
};

type ProductForm = {
  name: string;
  sku: string;
  description: string;
  price: string;
  costPrice: string;
  stock: string;
  category: string;
  status: ProductStatus;
};

type FormErrors = Partial<Record<keyof ProductForm, string>> & { form?: string };

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const emptyForm: ProductForm = {
  name: "",
  sku: "",
  description: "",
  price: "",
  costPrice: "",
  stock: "",
  category: "",
  status: "active",
};

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function statusTone(status: ProductStatus) {
  return status === "active" ? "positive" as const : "neutral" as const;
}

function validateProductForm(form: ProductForm) {
  const nextErrors: FormErrors = {};

  if (!form.name.trim()) nextErrors.name = "Product name is required.";
  if (!form.sku.trim()) nextErrors.sku = "SKU is required.";
  if (!form.price.trim()) nextErrors.price = "Price is required.";
  if (Number(form.price) <= 0 || Number.isNaN(Number(form.price))) nextErrors.price = "Price must be greater than 0.";
  if (form.costPrice.trim() && (Number.isNaN(Number(form.costPrice)) || Number(form.costPrice) < 0)) {
    nextErrors.costPrice = "Cost price must be 0 or greater.";
  }
  if (!form.stock.trim()) nextErrors.stock = "Stock is required.";
  if (!Number.isInteger(Number(form.stock)) || Number(form.stock) < 0) nextErrors.stock = "Stock must be a non-negative whole number.";
  if (form.description.trim().length > 2000) nextErrors.description = "Description is too long.";
  if (form.category.trim().length > 100) nextErrors.category = "Category is too long.";

  return nextErrors;
}

function buildPayload(form: ProductForm) {
  return {
    name: form.name.trim(),
    sku: form.sku.trim(),
    description: form.description.trim() || undefined,
    price: Number(form.price),
    costPrice: form.costPrice.trim() === "" ? undefined : Number(form.costPrice),
    stock: Number(form.stock),
    category: form.category.trim() || undefined,
    status: form.status,
  };
}

export function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | ProductStatus>("all");
  const [page, setPage] = useState(1);
  const [refreshTick, setRefreshTick] = useState(0);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 10, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"create" | "edit" | "details" | null>(null);
  const [selected, setSelected] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
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

    async function loadProducts() {
      setLoading(true);
      setError("");

      try {
        const params = new URLSearchParams({ page: String(page), pageSize: "10" });
        if (search) params.set("search", search);
        if (status !== "all") params.set("status", status);

        const response = await fetch(`/api/products?${params}`, {
          signal: controller.signal,
          credentials: "include",
        });

        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load products.");

        setProducts(payload.data);
        setPagination(payload.pagination);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load products.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadProducts();
    return () => controller.abort();
  }, [page, search, status, refreshTick]);

  function openCreate() {
    setSelected(null);
    setForm(emptyForm);
    setFormErrors({});
    setModal("create");
  }

  function openEdit(product: Product) {
    setSelected(product);
    setForm({
      name: product.name,
      sku: product.sku,
      description: product.description ?? "",
      price: String(product.price),
      costPrice: product.costPrice == null ? "" : String(product.costPrice),
      stock: String(product.stock),
      category: product.category ?? "",
      status: product.status,
    });
    setFormErrors({});
    setModal("edit");
  }

  function openDetails(product: Product) {
    setSelected(product);
    setModal("details");
  }

  function updateForm(field: keyof ProductForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setFormErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  }

  async function saveProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validateProductForm(form);
    if (Object.keys(nextErrors).length > 0) {
      setFormErrors(nextErrors);
      return;
    }

    setSaving(true);
    setFormErrors({});

    const endpoint = selected ? `/api/products/${selected.id}` : "/api/products";
    const method = selected ? "PATCH" : "POST";

    try {
      const response = await fetch(endpoint, {
        method,
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(buildPayload(form)),
      });

      const payload = await response.json();
      if (!response.ok) {
        if (response.status === 409) {
          throw new Error("A product with this SKU already exists. Please use a different SKU.");
        }
        throw new Error(payload.error || "Unable to save product.");
      }

      setModal(null);
      setFeedback(selected ? "Product updated successfully." : "Product added successfully.");
      setRefreshTick((current) => current + 1);
      setPage(selected ? page : 1);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Unable to save product.";
      setFormErrors({ form: message });
    } finally {
      setSaving(false);
    }
  }

  async function deleteProduct(product: Product) {
    const confirmed = window.confirm(`Delete ${product.name}? This action cannot be undone.`);
    if (!confirmed) return;

    setDeletingId(product.id);
    setFeedback("");

    try {
      const response = await fetch(`/api/products/${product.id}`, {
        method: "DELETE",
        credentials: "include",
      });

      const payload = response.status === 204 ? null : await response.json();
      if (!response.ok) throw new Error(payload?.error || "Unable to delete product.");

      setFeedback("Product deleted successfully.");
      setRefreshTick((current) => current + 1);
      if (products.length === 1 && page > 1) {
        setPage((current) => current - 1);
      } else {
        setProducts((current) => current.filter((item) => item.id !== product.id));
      }
      setPagination((current) => ({ ...current, total: Math.max(current.total - 1, 0) }));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete product.");
    } finally {
      setDeletingId(null);
    }
  }

  const pageStart = (pagination.page - 1) * pagination.pageSize + 1;
  const pageEnd = Math.min(pagination.page * pagination.pageSize, pagination.total);

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-xs font-bold tracking-[0.18em] text-[var(--accent)] uppercase">Workspace / Products</p>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Products</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">Track stock, pricing, and product details in one place.</p>
        </div>
        <div className="flex flex-col gap-3 self-start sm:self-auto sm:flex-row sm:items-center">
          <BackToDashboardLink />
          <Button type="button" variant="primary" className="self-start sm:self-auto" onClick={openCreate}>
            <Plus className="size-4" aria-hidden="true" /> Add Product
          </Button>
        </div>
      </div>

      {feedback ? (
        <div className="mb-5 rounded-xl border border-[var(--positive)]/20 bg-[var(--positive-soft)] px-4 py-3 text-sm font-medium text-[var(--positive)]" role="status">
          {feedback}
        </div>
      ) : null}

      <Card padding="none">
        <div className="flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm text-[var(--muted)]">Total products</p>
            <p className="mt-1 text-2xl font-semibold tracking-[-0.03em]">{pagination.total}</p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="min-w-0 sm:w-72">
              <Input
                aria-label="Search products"
                placeholder="Search products..."
                type="search"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                className="h-10"
              />
            </div>

            <label className="flex h-10 items-center rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 text-sm text-[var(--muted)]">
              <span className="sr-only">Filter by status</span>
              <select
                aria-label="Filter by status"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as "all" | ProductStatus);
                  setPage(1);
                }}
                className="bg-transparent pr-5 text-sm font-medium text-[var(--ink)] outline-none"
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          </div>
        </div>

        {error ? (
          <div className="mx-5 mb-5 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:mx-6">
            <span>{error}</span>
            <Button type="button" variant="ghost" className="h-8 px-2 text-red-700" onClick={() => setRefreshTick((current) => current + 1)}>
              <RefreshCw className="size-4" aria-hidden="true" /> Retry
            </Button>
          </div>
        ) : null}

        {loading ? (
          <div className="space-y-3 p-5 sm:p-6" aria-label="Loading products" aria-busy="true">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="h-14 animate-pulse rounded-xl bg-[var(--surface-soft)]" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
              <Package className="size-7" aria-hidden="true" />
            </span>
            <h2 className="mt-5 text-lg font-semibold">
              {search || status !== "all" ? "No products match these filters" : "No products yet"}
            </h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">
              {search || status !== "all"
                ? "Try another search or clear the filter to see your full product list."
                : "Add your first product to begin tracking inventory and pricing."}
            </p>
            {!search && status === "all" ? (
              <Button type="button" variant="secondary" className="mt-5" onClick={openCreate}>
                <Plus className="size-4" aria-hidden="true" /> Add product
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[980px] text-left">
                <thead className="border-y border-[var(--line)] bg-[var(--surface-soft)] text-[11px] font-bold tracking-[0.12em] text-[var(--muted)] uppercase">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Product</th>
                    <th className="px-5 py-3 font-semibold">SKU</th>
                    <th className="px-5 py-3 font-semibold">Price</th>
                    <th className="px-5 py-3 font-semibold">Cost price</th>
                    <th className="px-5 py-3 font-semibold">Stock</th>
                    <th className="px-5 py-3 font-semibold">Category</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 font-semibold">Created</th>
                    <th className="px-5 py-3 font-semibold"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {products.map((product) => (
                    <ProductRow
                      key={product.id}
                      product={product}
                      deleting={deletingId === product.id}
                      onView={() => openDetails(product)}
                      onEdit={() => openEdit(product)}
                      onDelete={() => deleteProduct(product)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-[var(--line)] md:hidden">
              {products.map((product) => (
                <ProductMobileCard
                  key={product.id}
                  product={product}
                  deleting={deletingId === product.id}
                  onView={() => openDetails(product)}
                  onEdit={() => openEdit(product)}
                  onDelete={() => deleteProduct(product)}
                />
              ))}
            </div>

            <div className="flex flex-col gap-3 border-t border-[var(--line)] p-4 text-sm text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between">
              <p>
                Showing {pageStart}-{pageEnd} of {pagination.total}
              </p>

              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" className="h-9 px-3" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
                  <ChevronLeft className="size-4" aria-hidden="true" /> Previous
                </Button>

                <span className="px-2 text-xs font-semibold text-[var(--ink)]">
                  Page {page} of {Math.max(pagination.totalPages, 1)}
                </span>

                <Button type="button" variant="secondary" className="h-9 px-3" disabled={page >= pagination.totalPages || pagination.totalPages === 0} onClick={() => setPage((current) => current + 1)}>
                  Next <ChevronRight className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      {modal === "details" && selected ? <DetailsModal product={selected} onClose={() => setModal(null)} onEdit={() => openEdit(selected)} /> : null}
      {modal === "create" || modal === "edit" ? (
        <ProductFormModal
          mode={modal}
          form={form}
          errors={formErrors}
          saving={saving}
          onChange={updateForm}
          onSubmit={saveProduct}
          onClose={() => setModal(null)}
        />
      ) : null}
    </main>
  );
}

function ProductRow({ product, deleting, onView, onEdit, onDelete }: { product: Product; deleting: boolean; onView: () => void; onEdit: () => void; onDelete: () => void }) {
  return (
    <tr className="text-sm">
      <td className="px-5 py-4">
        <button type="button" className="flex items-center gap-3 text-left" onClick={onView}>
          <span className="grid size-9 place-items-center rounded-xl bg-[var(--accent-soft)] text-xs font-bold text-[var(--accent-strong)]">
            {product.name.slice(0, 2).toUpperCase()}
          </span>
          <span className="font-semibold hover:text-[var(--accent-strong)]">{product.name}</span>
        </button>
      </td>
      <td className="px-5 py-4 text-[var(--muted)]">{product.sku}</td>
      <td className="px-5 py-4 font-medium">{formatPrice(product.price)}</td>
      <td className="px-5 py-4 text-[var(--muted)]">{product.costPrice != null ? formatPrice(product.costPrice) : "—"}</td>
      <td className="px-5 py-4 text-[var(--muted)]">{product.stock}</td>
      <td className="px-5 py-4 text-[var(--muted)]">{product.category || "—"}</td>
      <td className="px-5 py-4">
        <Badge tone={statusTone(product.status)}>{product.status}</Badge>
      </td>
      <td className="px-5 py-4 text-[var(--muted)]">{formatDate(product.createdAt)}</td>
      <td className="px-5 py-4">
        <ActionMenu deleting={deleting} onView={onView} onEdit={onEdit} onDelete={onDelete} />
      </td>
    </tr>
  );
}

function ProductMobileCard({ product, deleting, onView, onEdit, onDelete }: { product: Product; deleting: boolean; onView: () => void; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <button type="button" className="flex min-w-0 items-center gap-3 text-left" onClick={onView}>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-xs font-bold text-[var(--accent-strong)]">
            {product.name.slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold">{product.name}</span>
            <span className="mt-1 block truncate text-xs text-[var(--muted)]">{product.sku}</span>
          </span>
        </button>
        <ActionMenu deleting={deleting} onView={onView} onEdit={onEdit} onDelete={onDelete} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-[var(--muted)]">Price</p>
          <p className="mt-1 font-medium">{formatPrice(product.price)}</p>
        </div>
        <div>
          <p className="text-[var(--muted)]">Stock</p>
          <p className="mt-1 font-medium">{product.stock}</p>
        </div>
        <div>
          <p className="text-[var(--muted)]">Category</p>
          <p className="mt-1 font-medium">{product.category || "—"}</p>
        </div>
        <div>
          <p className="text-[var(--muted)]">Status</p>
          <div className="mt-1">
            <Badge tone={statusTone(product.status)}>{product.status}</Badge>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionMenu({ deleting, onView, onEdit, onDelete }: { deleting: boolean; onView: () => void; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-1">
      <Button type="button" variant="icon" className="size-8" aria-label="View product" onClick={onView}>
        <Eye className="size-4" aria-hidden="true" />
      </Button>
      <Button type="button" variant="icon" className="size-8" aria-label="Edit product" onClick={onEdit}>
        <Pencil className="size-4" aria-hidden="true" />
      </Button>
      <Button type="button" variant="icon" className="size-8 text-red-500 hover:text-red-600" aria-label="Delete product" onClick={onDelete} disabled={deleting}>
        {deleting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
      </Button>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[var(--ink)]/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close dialog" onClick={onClose} />
      <div className="relative z-10 my-auto max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-[var(--line)] bg-[var(--surface-raised)] px-5 py-4 sm:px-6">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button type="button" variant="icon" className="size-8" aria-label="Close dialog" onClick={onClose}>
            <X className="size-5" aria-hidden="true" />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DetailsModal({ product, onClose, onEdit }: { product: Product; onClose: () => void; onEdit: () => void }) {
  const fields = [
    ["SKU", product.sku],
    ["Price", formatPrice(product.price)],
    ["Cost price", product.costPrice != null ? formatPrice(product.costPrice) : "Not set"],
    ["Stock", String(product.stock)],
    ["Category", product.category || "Not set"],
    ["Status", product.status],
    ["Created date", formatDate(product.createdAt)],
    ["Updated date", formatDate(product.updatedAt)],
  ];

  return (
    <Modal title="Product details" onClose={onClose}>
      <div className="p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <span className="grid size-14 place-items-center rounded-2xl bg-[var(--accent-soft)] text-lg font-bold text-[var(--accent-strong)]">
            {product.name.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <h3 className="text-xl font-semibold">{product.name}</h3>
            <div className="mt-2">
              <Badge tone={statusTone(product.status)}>{product.status}</Badge>
            </div>
          </div>
        </div>

        <div className="mt-7 grid gap-x-6 gap-y-5 sm:grid-cols-2">
          {fields.map(([label, value]) => (
            <div key={label}>
              <p className="text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">{label}</p>
              <p className="mt-1 text-sm">{value}</p>
            </div>
          ))}
          <div className="sm:col-span-2">
            <p className="text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">Description</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{product.description || "No description provided."}</p>
          </div>
        </div>

        <div className="mt-7 flex justify-end gap-3 border-t border-[var(--line)] pt-5">
          <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
          <Button type="button" variant="primary" onClick={onEdit}>
            <Pencil className="size-4" aria-hidden="true" /> Edit product
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ProductFormModal({ mode, form, errors, saving, onChange, onSubmit, onClose }: { mode: "create" | "edit"; form: ProductForm; errors: FormErrors; saving: boolean; onChange: (field: keyof ProductForm, value: string) => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; onClose: () => void; }) {
  const fields: { field: keyof ProductForm; label: string; placeholder: string; type?: string; required?: boolean }[] = [
    { field: "name", label: "Name", placeholder: "Classic Leather Chair", required: true },
    { field: "sku", label: "SKU", placeholder: "SKU-1001", required: true },
    { field: "price", label: "Price", placeholder: "245.00", type: "number", required: true },
    { field: "costPrice", label: "Cost price", placeholder: "160.00", type: "number" },
    { field: "stock", label: "Stock", placeholder: "12", type: "number", required: true },
    { field: "category", label: "Category", placeholder: "Furniture" },
  ];

  return (
    <Modal title={mode === "create" ? "Add product" : "Edit product"} onClose={onClose}>
      <form onSubmit={onSubmit} className="p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map(({ field, label, placeholder, type, required }) => (
            <div key={field} className={field === "description" || field === "category" ? "sm:col-span-2" : "space-y-2"}>
              <label htmlFor={`product-${field}`} className="text-sm font-medium">
                {label}
                {required ? <span className="text-red-500"> *</span> : null}
              </label>

              <Input
                id={`product-${field}`}
                type={type ?? "text"}
                value={form[field] as string}
                onChange={(event) => onChange(field, event.target.value)}
                placeholder={placeholder}
                aria-invalid={Boolean(errors[field])}
                className={field === "description" ? "h-10" : "h-10"}
              />

              {errors[field] ? <p className="text-xs text-red-600">{errors[field]}</p> : null}
            </div>
          ))}

          <div className="space-y-2 sm:col-span-2">
            <label htmlFor="product-description" className="text-sm font-medium">Description</label>
            <textarea
              id="product-description"
              value={form.description}
              onChange={(event) => onChange("description", event.target.value)}
              placeholder="Describe this product..."
              rows={4}
              className="w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 py-2 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]"
            />
            {errors.description ? <p className="text-xs text-red-600">{errors.description}</p> : null}
          </div>

          <div className="space-y-2">
            <label htmlFor="product-status" className="text-sm font-medium">Status</label>
            <select
              id="product-status"
              value={form.status}
              onChange={(event) => onChange("status", event.target.value)}
              className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        {errors.form ? (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {errors.form}
          </p>
        ) : null}

        <div className="mt-7 flex justify-end gap-3 border-t border-[var(--line)] pt-5">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? <><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Saving...</> : mode === "create" ? "Create product" : "Save changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

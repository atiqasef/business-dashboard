"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, Loader2, Pencil, Plus, RefreshCw, Search, ShoppingCart, Trash2, X } from "lucide-react";
import { BackToDashboardLink } from "@/components/common/back-to-dashboard-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type OrderStatus = "pending" | "confirmed" | "completed" | "cancelled";

type OrderListItem = {
  id: string;
  customerId: string;
  items: Array<{
    productId: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  subtotal: number;
  discount: number;
  total: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
};

type CustomerSummary = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  company: string | null;
};

type ProductSummary = {
  id: string;
  name: string;
  price: number;
  sku: string;
  stock: number;
  category: string | null;
};

type OrderFormItem = {
  productId: string;
  quantity: string;
  search: string;
  product?: ProductSummary;
};

type OrderForm = {
  customerId: string;
  items: OrderFormItem[];
  discount: string;
  status: OrderStatus;
};

type FormErrors = Partial<Record<"customerId" | "discount" | "status" | "form", string>> & {
  items?: string;
  item?: Record<number, string | undefined>;
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const ORDER_STATUSES: Array<"all" | OrderStatus> = ["all", "pending", "confirmed", "completed", "cancelled"];

const emptyItem = (): OrderFormItem => ({ productId: "", quantity: "1", search: "" });

const emptyForm = (): OrderForm => ({
  customerId: "",
  items: [emptyItem()],
  discount: "0",
  status: "pending",
});

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function getCustomerName(customer: CustomerSummary | null | undefined) {
  if (!customer) return "Unknown customer";
  return `${customer.firstName} ${customer.lastName}`.trim() || "Unnamed customer";
}

function getStatusTone(status: OrderStatus) {
  switch (status) {
    case "completed":
      return "positive" as const;
    case "confirmed":
      return "accent" as const;
    case "cancelled":
      return "neutral" as const;
    default:
      return "warning" as const;
  }
}

function parseNumber(value: string, fallback: number) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) return fallback;
  return nextValue;
}

function isValidInteger(value: string) {
  return Number.isInteger(Number(value)) && Number(value) > 0 && Number.isFinite(Number(value));
}

export function OrdersPage() {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [status, setStatus] = useState<"all" | OrderStatus>("all");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 10, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [modal, setModal] = useState<"create" | "edit" | "details" | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderListItem | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [form, setForm] = useState<OrderForm>(emptyForm());
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [customerSearchDraft, setCustomerSearchDraft] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerSummary[]>([]);
  const [customerMap, setCustomerMap] = useState<Record<string, CustomerSummary>>({});
  const [productLookup, setProductLookup] = useState<Record<string, ProductSummary>>({});
  const [productSearchResults, setProductSearchResults] = useState<Record<number, ProductSummary[]>>({});
  const requestRef = useRef(0);
  const customerSearchTimerRef = useRef<number | null>(null);
  const productSearchTimerRefs = useRef<Record<number, number | null>>({});

  const selectedCustomer = form.customerId ? customerMap[form.customerId] ?? null : null;
  const productSearchSignature = useMemo(
    () => form.items.map((item) => `${item.search.trim()}::${item.productId}`).join("|"),
    [form.items],
  );

  useEffect(() => {
    const controller = new AbortController();

    async function loadOrders() {
      setLoading(true);
      setError("");

      try {
        const params = new URLSearchParams({ page: String(page), pageSize: "10" });
        if (status !== "all") params.set("status", status);

        const response = await fetch(`/api/orders?${params.toString()}`, {
          signal: controller.signal,
          credentials: "include",
        });

        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load orders.");

        const nextOrders = payload.data as OrderListItem[];
        setOrders(nextOrders);
        setPagination(payload.pagination);

        const customerIds = [...new Set(nextOrders.map((order) => order.customerId))].filter((value) => !!value && !customerMap[value]);
        if (customerIds.length > 0) {
          const hydration = await Promise.all(
            customerIds.map(async (id) => {
              try {
                const response = await fetch(`/api/customers/${id}`, { credentials: "include" });
                const payload = await response.json();
                if (!response.ok || !payload?.data) return [id, null] as const;
                return [id, payload.data as CustomerSummary] as const;
              } catch {
                return [id, null] as const;
              }
            }),
          );

          const nextCustomerMap = Object.fromEntries(hydration.filter(([, value]) => value) as [string, CustomerSummary][]);
          setCustomerMap((current) => ({ ...current, ...nextCustomerMap }));
        }
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load orders.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadOrders();
    return () => controller.abort();
  }, [page, status, refreshTick]);

  useEffect(() => {
    const trimmed = customerSearchDraft.trim();
    setCustomerSearch(trimmed);

    if (!trimmed) {
      setCustomerResults([]);
      return;
    }

    const timeout = window.setTimeout(() => {
      const search = trimmed;
      const requestId = ++requestRef.current;

      async function loadCustomers() {
        try {
          const response = await fetch(`/api/customers?search=${encodeURIComponent(search)}&page=1&pageSize=6`, {
            credentials: "include",
          });
          const payload = await response.json();
          if (!response.ok) {
            if (requestId !== requestRef.current) return;
            setCustomerResults([]);
            return;
          }
          if (requestId === requestRef.current) {
            setCustomerResults((payload.data ?? []) as CustomerSummary[]);
          }
        } catch {
          if (requestId === requestRef.current) {
            setCustomerResults([]);
          }
        }
      }

      void loadCustomers();
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [customerSearchDraft]);

  useEffect(() => {
    if (!form.items.length) return;

    const timeouts: number[] = [];

    form.items.forEach((item, index) => {
      const trimmedSearch = item.search.trim();

      if (!trimmedSearch) {
        setProductSearchResults((current) => {
          const next = { ...current };
          next[index] = [];
          return next;
        });
        return;
      }

      const timeout = window.setTimeout(() => {
        const search = trimmedSearch;
        const requestId = ++requestRef.current;

        async function loadProducts() {
          try {
            const response = await fetch(`/api/products?search=${encodeURIComponent(search)}&page=1&pageSize=5`, {
              credentials: "include",
            });
            const payload = await response.json();
            if (!response.ok) {
              if (requestId === requestRef.current) {
                setProductSearchResults((current) => ({ ...current, [index]: [] }));
              }
              return;
            }
            if (requestId === requestRef.current) {
              setProductSearchResults((current) => ({ ...current, [index]: payload.data ?? [] }));
            }
          } catch {
            if (requestId === requestRef.current) {
              setProductSearchResults((current) => ({ ...current, [index]: [] }));
            }
          }
        }

        void loadProducts();
      }, 250);

      timeouts.push(timeout);
    });

    return () => {
      timeouts.forEach((timeout) => window.clearTimeout(timeout));
    };
  }, [productSearchSignature]);

  function setFilterStatus(statusValue: "all" | OrderStatus) {
    setStatus(statusValue);
    setPage(1);
  }

  function handleCustomerSearchChange(value: string) {
    setCustomerSearchDraft(value);
    const trimmed = value.trim();
    setCustomerSearch(trimmed);

    if (customerSearchTimerRef.current) {
      window.clearTimeout(customerSearchTimerRef.current);
    }

    if (!trimmed) {
      setCustomerResults([]);
      return;
    }

    const requestId = ++requestRef.current;
    customerSearchTimerRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/customers?search=${encodeURIComponent(trimmed)}&page=1&pageSize=6`, {
            credentials: "include",
          });
          const payload = await response.json();
          if (!response.ok) {
            if (requestId === requestRef.current) {
              setCustomerResults([]);
            }
            return;
          }
          if (requestId === requestRef.current) {
            setCustomerResults((payload.data ?? []) as CustomerSummary[]);
          }
        } catch {
          if (requestId === requestRef.current) {
            setCustomerResults([]);
          }
        }
      })();
    }, 250);
  }

  function openCreate() {
    setSelectedOrder(null);
    setForm(emptyForm());
    setFormErrors({});
    setCustomerSearchDraft("");
    setCustomerSearch("");
    setCustomerResults([]);
    setModal("create");
  }

  async function loadOrderDetails(orderId: string) {
    const response = await fetch(`/api/orders/${orderId}`, { credentials: "include" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to load order details.");
    return payload.data as OrderListItem;
  }

  async function openDetails(order: OrderListItem) {
    try {
      const details = await loadOrderDetails(order.id);
      setSelectedOrder(details);
      setModal("details");
      setFormErrors({});
      if (!customerMap[details.customerId]) {
        const customerResponse = await fetch(`/api/customers/${details.customerId}`, { credentials: "include" });
        const customerPayload = await customerResponse.json();
        if (customerResponse.ok && customerPayload?.data) {
          setCustomerMap((current) => ({ ...current, [details.customerId]: customerPayload.data }));
        }
      }
      const productIds = [...new Set(details.items.map((item) => item.productId))];
      const nextProductMap = await Promise.all(
        productIds.map(async (productId) => {
          if (productLookup[productId]) return [productId, productLookup[productId]] as const;
          try {
            const response = await fetch(`/api/products/${productId}`, { credentials: "include" });
            const productPayload = await response.json();
            if (!response.ok || !productPayload?.data) return [productId, null] as const;
            return [productId, productPayload.data as ProductSummary] as const;
          } catch {
            return [productId, null] as const;
          }
        }),
      );

      const hydratedProducts = Object.fromEntries(nextProductMap.filter(([, value]) => value) as [string, ProductSummary][]);
      if (Object.keys(hydratedProducts).length) {
        setProductLookup((current) => ({ ...current, ...hydratedProducts }));
      }
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : "Unable to load order details.");
      setModal(null);
    }
  }

  async function openEdit(order: OrderListItem) {
    try {
      const details = await loadOrderDetails(order.id);
      const customer = customerMap[details.customerId] ?? (await fetchCustomer(details.customerId));
      if (customer) {
        setCustomerMap((current) => ({ ...current, [customer.id]: customer }));
      }

      const itemProducts = await Promise.all(
        details.items.map(async (item) => {
          const product = productLookup[item.productId] ?? (await fetchProduct(item.productId));
          if (product) {
            setProductLookup((current) => ({ ...current, [product.id]: product }));
          }
          return {
            productId: item.productId,
            quantity: String(item.quantity),
            search: product?.name ?? "",
            product,
          };
        }),
      );

      setSelectedOrder(details);
      setForm({
        customerId: details.customerId,
        items: itemProducts.length ? itemProducts : [emptyItem()],
        discount: String(details.discount),
        status: details.status,
      });
      setCustomerSearchDraft(customer ? `${customer.firstName} ${customer.lastName}`.trim() : "");
      setCustomerSearch("");
      setCustomerResults([]);
      setFormErrors({});
      setModal("edit");
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : "Unable to load order for editing.");
      setModal(null);
    }
  }

  async function fetchCustomer(customerId: string) {
    try {
      const response = await fetch(`/api/customers/${customerId}`, { credentials: "include" });
      const payload = await response.json();
      if (!response.ok || !payload?.data) return null;
      return payload.data as CustomerSummary;
    } catch {
      return null;
    }
  }

  async function fetchProduct(productId: string) {
    try {
      const response = await fetch(`/api/products/${productId}`, { credentials: "include" });
      const payload = await response.json();
      if (!response.ok || !payload?.data) return null;
      return payload.data as ProductSummary;
    } catch {
      return null;
    }
  }

  function updateFormItem(index: number, field: "productId" | "quantity" | "search", value: string) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        if (field === "search") {
          return { ...item, search: value, productId: item.productId, quantity: item.quantity };
        }
        if (field === "quantity") {
          return { ...item, quantity: value };
        }
        return { ...item, productId: value };
      }),
    }));

    if (field === "search") {
      const trimmed = value.trim();
      setProductSearchResults((current) => ({ ...current, [index]: [] }));

      if (productSearchTimerRefs.current[index]) {
        window.clearTimeout(productSearchTimerRefs.current[index]!);
      }

      if (!trimmed) {
        return;
      }

      const timer = window.setTimeout(() => {
        const requestId = ++requestRef.current;
        void (async () => {
          try {
            const response = await fetch(`/api/products?search=${encodeURIComponent(trimmed)}&page=1&pageSize=5`, {
              credentials: "include",
            });
            const payload = await response.json();
            if (!response.ok) {
              if (requestId === requestRef.current) {
                setProductSearchResults((current) => ({ ...current, [index]: [] }));
              }
              return;
            }
            if (requestId === requestRef.current) {
              setProductSearchResults((current) => ({ ...current, [index]: payload.data ?? [] }));
            }
          } catch {
            if (requestId === requestRef.current) {
              setProductSearchResults((current) => ({ ...current, [index]: [] }));
            }
          }
        })();
      }, 250);

      productSearchTimerRefs.current[index] = timer;
    }

    setFormErrors((current) => {
      const nextItemErrors = current.item ? { ...current.item } : {};
      delete nextItemErrors[index];
      return {
        ...current,
        items: undefined,
        item: Object.keys(nextItemErrors).length ? nextItemErrors : undefined,
        form: undefined,
      };
    });
  }

  function addItemRow() {
    setForm((current) => ({ ...current, items: [...current.items, emptyItem()] }));
    setFormErrors((current) => ({ ...current, items: undefined, form: undefined }));
  }

  function removeItemRow(index: number) {
    setForm((current) => ({
      ...current,
      items: current.items.length === 1 ? [emptyItem()] : current.items.filter((_, itemIndex) => itemIndex !== index),
    }));
    setFormErrors((current) => ({
      ...current,
      items: undefined,
      item: current.item ? Object.fromEntries(Object.entries(current.item).filter(([key]) => Number(key) !== index)) : undefined,
      form: undefined,
    }));
    setProductSearchResults((current) => {
      const next = { ...current };
      delete next[index];
      return next;
    });
  }

  function previewSubtotal() {
    return form.items.reduce((total, item) => {
      const product = item.productId ? productLookup[item.productId] ?? item.product : null;
      if (!product) return total;
      const quantity = Number(item.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) return total;
      return total + product.price * quantity;
    }, 0);
  }

  function validateOrderForm() {
    const nextErrors: FormErrors = {};
    if (!form.customerId.trim()) nextErrors.customerId = "Please select a customer.";

    if (!form.items.length || form.items.some((item) => !item.productId.trim())) {
      nextErrors.items = "Add at least one product item.";
    }

    const seen = new Set<string>();
    const itemErrors: Record<number, string> = {};
    form.items.forEach((item, index) => {
      if (!item.productId.trim()) {
        itemErrors[index] = "Select a product.";
        return;
      }
      if (seen.has(item.productId)) {
        itemErrors[index] = "Duplicate product selected.";
        return;
      }
      seen.add(item.productId);

      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0 || !Number.isFinite(quantity)) {
        itemErrors[index] = "Quantity must be a whole number greater than 0.";
      }
    });

    if (Object.keys(itemErrors).length) {
      nextErrors.item = itemErrors;
    }

    const discountValue = Number(form.discount);
    if (!Number.isFinite(discountValue) || discountValue < 0) {
      nextErrors.discount = "Discount must be a valid amount greater than or equal to 0.";
    } else if (discountValue > previewSubtotal()) {
      nextErrors.discount = "Discount cannot exceed the subtotal preview.";
    }

    return nextErrors;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateOrderForm();
    if (Object.keys(nextErrors).length > 0) {
      setFormErrors(nextErrors);
      return;
    }

    setSaving(true);
    setFormErrors({});

    const endpoint = selectedOrder ? `/api/orders/${selectedOrder.id}` : "/api/orders";
    const method = selectedOrder ? "PATCH" : "POST";

    const payload = {
      customerId: form.customerId,
      items: form.items.map((item) => ({ productId: item.productId, quantity: Number(item.quantity) })),
      discount: Number(form.discount),
      status: form.status,
    };

    try {
      const response = await fetch(endpoint, {
        method,
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const responsePayload = await response.json();
      if (!response.ok) {
        throw new Error(responsePayload?.error || "Unable to save order.");
      }

      setModal(null);
      setFeedback(selectedOrder ? "Order updated successfully." : "Order created successfully.");
      setRefreshTick((current) => current + 1);
      setPage(1);
      setForm(emptyForm());
      setCustomerSearchDraft("");
      setCustomerSearch("");
      setCustomerResults([]);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Unable to save order.";
      setFormErrors({ form: message });
    } finally {
      setSaving(false);
    }
  }

  async function deleteOrder(order: OrderListItem) {
    const confirmed = window.confirm(`Delete order #${order.id.slice(-6)}? This cannot be undone.`);
    if (!confirmed) return;

    setDeletingId(order.id);
    setFeedback("");

    try {
      const response = await fetch(`/api/orders/${order.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const payload = response.status === 204 ? null : await response.json();
      if (!response.ok) throw new Error(payload?.error || "Unable to delete order.");

      setFeedback("Order deleted successfully.");
      setRefreshTick((current) => current + 1);
      if (orders.length === 1 && page > 1) {
        setPage((current) => current - 1);
      }
      setPagination((current) => ({ ...current, total: Math.max(current.total - 1, 0) }));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete order.");
    } finally {
      setDeletingId(null);
    }
  }

  const pageStart = (pagination.page - 1) * pagination.pageSize + 1;
  const pageEnd = Math.min(pagination.page * pagination.pageSize, pagination.total);
  const previewSubtotalValue = previewSubtotal();
  const previewDiscount = Number(form.discount) || 0;
  const previewTotalValue = Math.max(previewSubtotalValue - previewDiscount, 0);

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-xs font-bold tracking-[0.18em] text-[var(--accent)] uppercase">Workspace / Orders</p>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Orders</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">Manage customer orders, pricing, and fulfillment status from one workflow.</p>
        </div>

        <div className="flex flex-col gap-3 self-start sm:self-auto sm:flex-row sm:items-center">
          <BackToDashboardLink />
          <Button type="button" variant="primary" className="self-start sm:self-auto" onClick={openCreate}>
            <Plus className="size-4" aria-hidden="true" /> Add order
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
            <p className="text-sm text-[var(--muted)]">Total orders</p>
            <p className="mt-1 text-2xl font-semibold tracking-[-0.03em]">{pagination.total}</p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="flex h-10 items-center rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 text-sm text-[var(--muted)]">
              <span className="sr-only">Filter by status</span>
              <select
                aria-label="Filter orders by status"
                value={status}
                onChange={(event) => setFilterStatus(event.target.value as "all" | OrderStatus)}
                className="bg-transparent pr-5 text-sm font-medium text-[var(--ink)] outline-none"
              >
                {ORDER_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {value === "all" ? "All statuses" : value}
                  </option>
                ))}
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
          <div className="space-y-3 p-5 sm:p-6" aria-label="Loading orders" aria-busy="true">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="h-14 animate-pulse rounded-xl bg-[var(--surface-soft)]" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
              <ShoppingCart className="size-7" aria-hidden="true" />
            </span>
            <h2 className="mt-5 text-lg font-semibold">{status !== "all" ? "No orders match this filter" : "No orders yet"}</h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">
              {status !== "all"
                ? "Try another status to view your full order history."
                : "Add your first order to start tracking customer purchases and fulfillment."}
            </p>
            {status === "all" ? (
              <Button type="button" variant="secondary" className="mt-5" onClick={openCreate}>
                <Plus className="size-4" aria-hidden="true" /> Add order
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[980px] text-left">
                <thead className="border-y border-[var(--line)] bg-[var(--surface-soft)] text-[11px] font-bold tracking-[0.12em] text-[var(--muted)] uppercase">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Order</th>
                    <th className="px-5 py-3 font-semibold">Customer</th>
                    <th className="px-5 py-3 font-semibold">Items</th>
                    <th className="px-5 py-3 font-semibold">Subtotal</th>
                    <th className="px-5 py-3 font-semibold">Discount</th>
                    <th className="px-5 py-3 font-semibold">Total</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 font-semibold">Created</th>
                    <th className="px-5 py-3 font-semibold"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {orders.map((order) => (
                    <OrderRow
                      key={order.id}
                      order={order}
                      customer={customerMap[order.customerId] ?? null}
                      deleting={deletingId === order.id}
                      onView={() => void openDetails(order)}
                      onEdit={() => void openEdit(order)}
                      onDelete={() => void deleteOrder(order)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-[var(--line)] md:hidden">
              {orders.map((order) => (
                <OrderMobileCard
                  key={order.id}
                  order={order}
                  customer={customerMap[order.customerId] ?? null}
                  deleting={deletingId === order.id}
                  onView={() => void openDetails(order)}
                  onEdit={() => void openEdit(order)}
                  onDelete={() => void deleteOrder(order)}
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

      {modal === "details" && selectedOrder ? (
        <DetailsModal order={selectedOrder} onClose={() => setModal(null)} onEdit={() => void openEdit(selectedOrder)} customer={customerMap[selectedOrder.customerId] ?? null} productLookup={productLookup} />
      ) : null}

      {modal === "create" || modal === "edit" ? (
        <OrderFormModal
          mode={modal}
          form={form}
          errors={formErrors}
          saving={saving}
          customerSearch={customerSearchDraft}
          setCustomerSearch={handleCustomerSearchChange}
          customerResults={customerResults}
          selectedCustomer={selectedCustomer}
          onSelectCustomer={(customerId: string) => {
            setForm((current) => ({ ...current, customerId }));
            const customer = customerMap[customerId];
            if (customer) {
              setCustomerSearchDraft(`${customer.firstName} ${customer.lastName}`.trim());
              setCustomerSearch("");
              setCustomerResults([]);
            } else {
              setCustomerSearchDraft("");
              setCustomerSearch("");
              setCustomerResults([]);
            }
            setFormErrors((current) => ({ ...current, customerId: undefined, form: undefined }));
          }}
          onChange={(field, value) => {
            if (field === "customerId") {
              setForm((current) => ({ ...current, customerId: value }));
            }
            if (field === "discount") {
              setForm((current) => ({ ...current, discount: value }));
            }
            if (field === "status") {
              setForm((current) => ({ ...current, status: value as OrderStatus }));
            }
            setFormErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
          }}
          productSearchResults={productSearchResults}
          onAddItem={addItemRow}
          onRemoveItem={removeItemRow}
          onUpdateItem={updateFormItem}
          onSelectProduct={(index, productId) => {
            const product = productLookup[productId] ?? productSearchResults[index]?.find((entry) => entry.id === productId);
            if (product) {
              setProductLookup((current) => ({ ...current, [product.id]: product }));
            }
            setForm((current) => ({
              ...current,
              items: current.items.map((item, itemIndex) => {
                if (itemIndex !== index) return item;
                return {
                  ...item,
                  productId,
                  product: product ?? item.product,
                  search: product?.name ?? item.search,
                };
              }),
            }));
            setFormErrors((current) => {
              const nextItemErrors = current.item ? { ...current.item } : {};
              delete nextItemErrors[index];
              return {
                ...current,
                item: Object.keys(nextItemErrors).length ? nextItemErrors : undefined,
                items: undefined,
                form: undefined,
              };
            });
          }}
          onSubmit={handleSubmit}
          onClose={() => {
            setModal(null);
            setForm(emptyForm());
            setCustomerSearchDraft("");
            setCustomerSearch("");
            setCustomerResults([]);
            setFormErrors({});
          }}
          previewSubtotal={previewSubtotalValue}
          previewDiscount={previewDiscount}
          previewTotal={previewTotalValue}
          selectedOrder={selectedOrder}
        />
      ) : null}
    </main>
  );
}

function OrderRow({ order, customer, deleting, onView, onEdit, onDelete }: { order: OrderListItem; customer: CustomerSummary | null; deleting: boolean; onView: () => void; onEdit: () => void; onDelete: () => void }) {
  return (
    <tr className="text-sm">
      <td className="px-5 py-4">
        <button type="button" className="text-left font-semibold hover:text-[var(--accent-strong)]" onClick={onView}>
          #{order.id.slice(-6)}
        </button>
      </td>
      <td className="px-5 py-4 text-[var(--muted)]">{customer ? getCustomerName(customer) : "Loading..."}</td>
      <td className="px-5 py-4 text-[var(--muted)]">{order.items.reduce((total, item) => total + item.quantity, 0)}</td>
      <td className="px-5 py-4 font-medium">{formatMoney(order.subtotal)}</td>
      <td className="px-5 py-4 text-[var(--muted)]">{formatMoney(order.discount)}</td>
      <td className="px-5 py-4 font-medium">{formatMoney(order.total)}</td>
      <td className="px-5 py-4">
        <Badge tone={getStatusTone(order.status)}>{order.status}</Badge>
      </td>
      <td className="px-5 py-4 text-[var(--muted)]">{formatDate(order.createdAt)}</td>
      <td className="px-5 py-4">
        <ActionMenu deleting={deleting} onView={onView} onEdit={onEdit} onDelete={onDelete} />
      </td>
    </tr>
  );
}

function OrderMobileCard({ order, customer, deleting, onView, onEdit, onDelete }: { order: OrderListItem; customer: CustomerSummary | null; deleting: boolean; onView: () => void; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button type="button" className="text-left font-semibold hover:text-[var(--accent-strong)]" onClick={onView}>
            Order #{order.id.slice(-6)}
          </button>
          <p className="mt-1 truncate text-xs text-[var(--muted)]">{customer ? getCustomerName(customer) : "Loading..."}</p>
        </div>
        <ActionMenu deleting={deleting} onView={onView} onEdit={onEdit} onDelete={onDelete} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-[var(--muted)]">Items</p>
          <p className="mt-1 font-medium">{order.items.reduce((total, item) => total + item.quantity, 0)}</p>
        </div>
        <div>
          <p className="text-[var(--muted)]">Status</p>
          <div className="mt-1"><Badge tone={getStatusTone(order.status)}>{order.status}</Badge></div>
        </div>
        <div>
          <p className="text-[var(--muted)]">Subtotal</p>
          <p className="mt-1 font-medium">{formatMoney(order.subtotal)}</p>
        </div>
        <div>
          <p className="text-[var(--muted)]">Total</p>
          <p className="mt-1 font-medium">{formatMoney(order.total)}</p>
        </div>
      </div>
    </div>
  );
}

function ActionMenu({ deleting, onView, onEdit, onDelete }: { deleting: boolean; onView: () => void; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-1">
      <Button type="button" variant="icon" className="size-8" aria-label="View order" onClick={onView}>
        <Eye className="size-4" aria-hidden="true" />
      </Button>
      <Button type="button" variant="icon" className="size-8" aria-label="Edit order" onClick={onEdit}>
        <Pencil className="size-4" aria-hidden="true" />
      </Button>
      <Button type="button" variant="icon" className="size-8 text-red-500 hover:text-red-600" aria-label="Delete order" onClick={onDelete} disabled={deleting}>
        {deleting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
      </Button>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[var(--ink)]/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close dialog" onClick={onClose} />
      <div className="relative z-10 my-auto max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] shadow-2xl">
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

function DetailsModal({
  order,
  customer,
  productLookup,
  onClose,
  onEdit,
}: {
  order: OrderListItem;
  customer: CustomerSummary | null;
  productLookup: Record<string, ProductSummary>;
  onClose: () => void;
  onEdit: () => void;
}) {
  return (
    <Modal title="Order details" onClose={onClose}>
      <div className="p-5 sm:p-6">
        <div className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-[var(--muted)]">Order #{order.id.slice(-6)}</p>
              <h3 className="mt-1 text-xl font-semibold">{customer ? getCustomerName(customer) : "Unknown customer"}</h3>
            </div>
            <Badge tone={getStatusTone(order.status)}>{order.status}</Badge>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">Subtotal</p>
              <p className="mt-1 text-sm">{formatMoney(order.subtotal)}</p>
            </div>
            <div>
              <p className="text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">Discount</p>
              <p className="mt-1 text-sm">{formatMoney(order.discount)}</p>
            </div>
            <div>
              <p className="text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">Total</p>
              <p className="mt-1 text-sm">{formatMoney(order.total)}</p>
            </div>
            <div>
              <p className="text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">Created</p>
              <p className="mt-1 text-sm">{formatDateTime(order.createdAt)}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4">
            <h4 className="text-sm font-semibold text-[var(--ink)]">Items</h4>
            <div className="mt-4 space-y-3">
              {order.items.map((item, index) => {
                const product = productLookup[item.productId];
                return (
                  <div key={`${item.productId}-${index}`} className="flex flex-col gap-2 rounded-xl border border-[var(--line)] bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">{product?.name ?? `Product ${item.productId}`}</p>
                      <p className="text-xs text-[var(--muted)]">Qty: {item.quantity}</p>
                    </div>
                    <div className="text-sm text-[var(--muted)]">
                      <div>Unit: {formatMoney(item.unitPrice)}</div>
                      <div>Line total: {formatMoney(item.lineTotal)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">Status</p>
              <p className="mt-1 text-sm">{order.status}</p>
            </div>
            <div>
              <p className="text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">Updated</p>
              <p className="mt-1 text-sm">{formatDateTime(order.updatedAt)}</p>
            </div>
          </div>
        </div>

        <div className="mt-7 flex justify-end gap-3 border-t border-[var(--line)] pt-5">
          <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
          <Button type="button" variant="primary" onClick={onEdit}><Pencil className="size-4" aria-hidden="true" /> Edit order</Button>
        </div>
      </div>
    </Modal>
  );
}

function OrderFormModal({
  mode,
  form,
  errors,
  saving,
  customerSearch,
  setCustomerSearch,
  customerResults,
  selectedCustomer,
  onSelectCustomer,
  onChange,
  productSearchResults,
  onAddItem,
  onRemoveItem,
  onUpdateItem,
  onSelectProduct,
  onSubmit,
  onClose,
  previewSubtotal,
  previewDiscount,
  previewTotal,
  selectedOrder,
}: {
  mode: "create" | "edit";
  form: OrderForm;
  errors: FormErrors;
  saving: boolean;
  customerSearch: string;
  setCustomerSearch: (value: string) => void;
  customerResults: CustomerSummary[];
  selectedCustomer: CustomerSummary | null;
  onSelectCustomer: (customerId: string) => void;
  onChange: (field: "customerId" | "discount" | "status", value: string) => void;
  productSearchResults: Record<number, ProductSummary[]>;
  onAddItem: () => void;
  onRemoveItem: (index: number) => void;
  onUpdateItem: (index: number, field: "productId" | "quantity" | "search", value: string) => void;
  onSelectProduct: (index: number, productId: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  previewSubtotal: number;
  previewDiscount: number;
  previewTotal: number;
  selectedOrder: OrderListItem | null;
}) {
  return (
    <Modal title={mode === "create" ? "Add order" : "Edit order"} onClose={onClose}>
      <form onSubmit={onSubmit} className="p-5 sm:p-6">
        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium">Customer</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" aria-hidden="true" />
              <Input
                aria-label="Search customers"
                placeholder="Search customers..."
                value={customerSearch}
                onChange={(event) => setCustomerSearch(event.target.value)}
                className="h-10 pl-9"
              />
            </div>

            {selectedCustomer ? (
              <div className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{getCustomerName(selectedCustomer)}</p>
                  <p className="text-[var(--muted)]">{selectedCustomer.company || selectedCustomer.email || "Customer record"}</p>
                </div>
                <Button type="button" variant="ghost" className="h-8 px-2 text-xs" onClick={() => onSelectCustomer("")}>
                  Clear
                </Button>
              </div>
            ) : null}

            {!selectedCustomer && customerResults.length > 0 ? (
              <div className="mt-2 max-h-48 overflow-auto rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] p-2">
                {customerResults.map((customer) => (
                  <button
                    type="button"
                    key={customer.id}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-white"
                    onClick={() => onSelectCustomer(customer.id)}
                  >
                    <span>
                      <span className="block font-medium">{getCustomerName(customer)}</span>
                      <span className="block text-xs text-[var(--muted)]">{customer.company || customer.email || "Customer"}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            {errors.customerId ? <p className="text-xs text-red-600">{errors.customerId}</p> : null}
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-medium">Order items</label>
              <Button type="button" variant="secondary" className="h-8 px-3" onClick={onAddItem}>
                <Plus className="size-4" aria-hidden="true" /> Add item
              </Button>
            </div>

            {form.items.map((item, index) => {
              const results = productSearchResults[index] ?? [];
              const selectedProduct = item.productId ? item.product : null;

              return (
                <div key={`${index}-${item.productId || "new"}`} className="rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">Item {index + 1}</p>
                    {form.items.length > 1 ? (
                      <Button type="button" variant="ghost" className="h-8 px-2 text-red-600" onClick={() => onRemoveItem(index)} aria-label={`Remove item ${index + 1}`}>
                        Remove
                      </Button>
                    ) : null}
                  </div>

                  <div className="grid gap-4 md:grid-cols-[1.5fr_0.8fr]">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Product</label>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" aria-hidden="true" />
                        <Input
                          aria-label={`Search products for item ${index + 1}`}
                          placeholder="Search products..."
                          value={item.search}
                          onChange={(event) => onUpdateItem(index, "search", event.target.value)}
                          className="h-10 pl-9"
                        />
                      </div>

                      {selectedProduct ? (
                        <div className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm">
                          <p className="font-medium">{selectedProduct.name}</p>
                          <p className="text-[var(--muted)]">{selectedProduct.sku} · {formatMoney(selectedProduct.price)}</p>
                        </div>
                      ) : null}

                      {item.search.trim() && results.length > 0 ? (
                        <div className="max-h-44 overflow-auto rounded-xl border border-[var(--line)] bg-white p-2">
                          {results.map((product) => (
                            <button
                              type="button"
                              key={product.id}
                              className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-[var(--surface-soft)]"
                              onClick={() => onSelectProduct(index, product.id)}
                            >
                              <span>
                                <span className="block font-medium">{product.name}</span>
                                <span className="block text-xs text-[var(--muted)]">{product.sku}</span>
                              </span>
                              <span className="text-xs font-medium">{formatMoney(product.price)}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <label htmlFor={`quantity-${index}`} className="text-sm font-medium">Quantity</label>
                      <Input
                        id={`quantity-${index}`}
                        aria-label={`Quantity for item ${index + 1}`}
                        type="number"
                        min={1}
                        step={1}
                        value={item.quantity}
                        onChange={(event) => onUpdateItem(index, "quantity", event.target.value)}
                        className="h-10"
                      />
                    </div>
                  </div>

                  {errors.item?.[index] ? <p className="mt-3 text-xs text-red-600">{errors.item[index]}</p> : null}
                </div>
              );
            })}

            {errors.items ? <p className="text-xs text-red-600">{errors.items}</p> : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="order-discount" className="text-sm font-medium">Discount (fixed amount)</label>
              <Input
                id="order-discount"
                type="number"
                min={0}
                step="0.01"
                value={form.discount}
                onChange={(event) => onChange("discount", event.target.value)}
                placeholder="0.00"
                aria-invalid={Boolean(errors.discount)}
              />
              {errors.discount ? <p className="text-xs text-red-600">{errors.discount}</p> : null}
            </div>

            <div className="space-y-2">
              <label htmlFor="order-status" className="text-sm font-medium">Status</label>
              <select
                id="order-status"
                value={form.status}
                onChange={(event) => onChange("status", event.target.value)}
                className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]"
              >
                <option value="pending">Pending</option>
                <option value="confirmed">Confirmed</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4">
            <h3 className="text-sm font-semibold text-[var(--ink)]">Financial preview</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">Subtotal</p>
                <p className="mt-1 text-sm font-medium">{formatMoney(previewSubtotal)}</p>
              </div>
              <div>
                <p className="text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">Discount</p>
                <p className="mt-1 text-sm font-medium">{formatMoney(previewDiscount)}</p>
              </div>
              <div>
                <p className="text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">Total</p>
                <p className="mt-1 text-sm font-medium">{formatMoney(previewTotal)}</p>
              </div>
            </div>
          </div>

          {errors.form ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {errors.form}
            </p>
          ) : null}
        </div>

        <div className="mt-7 flex justify-end gap-3 border-t border-[var(--line)] pt-5">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving} aria-busy={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {saving ? (selectedOrder ? "Saving..." : "Creating...") : mode === "create" ? "Create order" : "Save changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

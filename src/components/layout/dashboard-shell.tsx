"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  Boxes,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  FileBarChart,
  LayoutDashboard,
  Menu,
  Moon,
  MoreHorizontal,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  ShoppingCart,
  Sun,
  Users,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { DialogPlaceholder, TablePlaceholder } from "@/components/ui/placeholders";
import { Input } from "@/components/ui/input";

type NavigationItem = {
  label: string;
  icon: LucideIcon;
  count?: string;
};

const navigationGroups: { label: string; items: NavigationItem[] }[] = [
  {
    label: "Workspace",
    items: [
      { label: "Dashboard", icon: LayoutDashboard },
      { label: "Customers", icon: Users },
      { label: "Products", icon: Package },
      { label: "Orders", icon: ShoppingCart, count: "12" },
      { label: "Payments", icon: CircleDollarSign },
    ],
  },
  {
    label: "Insights",
    items: [
      { label: "Reports", icon: FileBarChart },
      { label: "Notifications", icon: Bell, count: "3" },
    ],
  },
];

const metrics = [
  { label: "Total revenue", value: "$84,240", change: "+12.8%", detail: "vs. previous month", icon: CircleDollarSign, tone: "accent" },
  { label: "Total orders", value: "1,284", change: "+8.2%", detail: "vs. previous month", icon: ShoppingCart, tone: "green" },
  { label: "New customers", value: "384", change: "+14.5%", detail: "vs. previous month", icon: Users, tone: "blue" },
  { label: "Products in stock", value: "2,431", change: "18 low", detail: "items need attention", icon: Boxes, tone: "orange" },
];

const orders = [
  { id: "#10482", customer: "Olivia Martin", date: "Today, 10:24 AM", amount: "$2,480.00", status: "Paid", tone: "positive" as const },
  { id: "#10481", customer: "Liam Johnson", date: "Today, 09:48 AM", amount: "$840.00", status: "Processing", tone: "accent" as const },
  { id: "#10480", customer: "Sophia Williams", date: "Yesterday, 04:12 PM", amount: "$1,240.00", status: "Paid", tone: "positive" as const },
  { id: "#10479", customer: "Noah Brown", date: "Yesterday, 01:36 PM", amount: "$560.00", status: "Pending", tone: "warning" as const },
];

const inventory = [
  { name: "Classic Oxford Shirt", sku: "SKU-1024", stock: "4 left", tone: "warning" as const },
  { name: "Canvas Weekender Bag", sku: "SKU-1088", stock: "7 left", tone: "warning" as const },
  { name: "Everyday Chino Trouser", sku: "SKU-1142", stock: "9 left", tone: "accent" as const },
];

export function DashboardShell() {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  function getNavigationHref(label: string) {
    if (label === "Dashboard") return "/";
    if (label === "Customers") return "/customers";
    if (label === "Products") return "/products";
    if (label === "Orders") return "/orders";
    return `#${label.toLowerCase()}`;
  }

  return (
    <div className="min-h-screen bg-[var(--surface)] text-[var(--ink)]">
      <div className="flex min-h-screen">
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-[var(--line)] bg-[var(--surface-raised)] transition-transform duration-200 lg:static lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"} ${sidebarCollapsed ? "lg:w-20" : "lg:w-64"}`}
        >
          <div className="flex h-20 items-center justify-between border-b border-[var(--line)] px-5">
            <div className={`flex items-center gap-3 ${sidebarCollapsed ? "lg:mx-auto" : ""}`}>
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--ink)] text-sm font-bold text-white">L</span>
              <span className={`text-sm font-bold tracking-[0.18em] uppercase ${sidebarCollapsed ? "lg:hidden" : ""}`}>Ledger</span>
            </div>
            <Button variant="icon" className="lg:hidden" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}>
              <X className="size-5" aria-hidden="true" />
            </Button>
          </div>

          <nav className="flex-1 space-y-7 overflow-y-auto px-3 py-6" aria-label="Primary navigation">
            {navigationGroups.map((group) => (
              <div key={group.label}>
                <p className={`mb-2 px-3 text-[10px] font-bold tracking-[0.18em] text-[var(--muted)] uppercase ${sidebarCollapsed ? "lg:hidden" : ""}`}>{group.label}</p>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const href = getNavigationHref(item.label);
                    const active = pathname === href || (item.label === "Dashboard" && pathname === "/");
                    return (
                      <a
                        href={href}
                        key={item.label}
                        onClick={() => setSidebarOpen(false)}
                        className={`group flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors ${active ? "bg-[var(--ink)] text-white" : "text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--ink)]"} ${sidebarCollapsed ? "lg:justify-center" : ""}`}
                        aria-current={active ? "page" : undefined}
                        title={sidebarCollapsed ? item.label : undefined}
                      >
                        <Icon className="size-[18px] shrink-0" aria-hidden="true" />
                        <span className={sidebarCollapsed ? "lg:hidden" : ""}>{item.label}</span>
                        {item.count ? <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${active ? "bg-white/15 text-white" : "bg-[var(--surface-soft)] text-[var(--muted)]"} ${sidebarCollapsed ? "lg:hidden" : ""}`}>{item.count}</span> : null}
                      </a>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="border-t border-[var(--line)] p-3">
            <a href="#settings" className={`flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--ink)] ${sidebarCollapsed ? "lg:justify-center" : ""}`}>
              <Settings className="size-[18px] shrink-0" aria-hidden="true" />
              <span className={sidebarCollapsed ? "lg:hidden" : ""}>Settings</span>
            </a>
            <div className={`mt-3 flex items-center gap-3 rounded-xl bg-[var(--surface-soft)] p-3 ${sidebarCollapsed ? "lg:justify-center lg:p-2" : ""}`}>
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-xs font-bold text-[var(--accent-strong)]">AM</span>
              <div className={sidebarCollapsed ? "lg:hidden" : ""}>
                <p className="text-xs font-semibold">Alex Morgan</p>
                <p className="mt-0.5 text-[11px] text-[var(--muted)]">Administrator</p>
              </div>
              <ChevronDown className={`ml-auto size-4 text-[var(--muted)] ${sidebarCollapsed ? "lg:hidden" : ""}`} aria-hidden="true" />
            </div>
          </div>
        </aside>

        {sidebarOpen ? <button className="fixed inset-0 z-30 bg-[var(--ink)]/30 lg:hidden" aria-label="Close navigation overlay" onClick={() => setSidebarOpen(false)} /> : null}

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex h-20 items-center justify-between gap-4 border-b border-[var(--line)] bg-[var(--surface)]/95 px-4 backdrop-blur sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <Button variant="icon" className="lg:hidden" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}>
                <Menu className="size-5" aria-hidden="true" />
              </Button>
              <Button variant="icon" className="hidden lg:inline-flex" aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
                {sidebarCollapsed ? <PanelLeftOpen className="size-5" aria-hidden="true" /> : <PanelLeftClose className="size-5" aria-hidden="true" />}
              </Button>
              <div className="hidden min-w-0 items-center gap-2 text-sm sm:flex">
                <span className="text-[var(--muted)]">Workspace</span>
                <ChevronRight className="size-4 text-[var(--line-strong)]" aria-hidden="true" />
                <span className="truncate font-semibold">Dashboard</span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
              <div className="hidden w-52 md:block lg:w-64">
                <Input aria-label="Search workspace" placeholder="Search workspace" type="search" className="h-10" />
              </div>
              <Button variant="icon" className="md:hidden" aria-label="Search workspace">
                <Search className="size-5" aria-hidden="true" />
              </Button>
              <Button variant="icon" aria-label="Toggle theme" onClick={() => setDarkMode(!darkMode)}>
                {darkMode ? <Sun className="size-5" aria-hidden="true" /> : <Moon className="size-5" aria-hidden="true" />}
              </Button>
              <Button variant="icon" className="relative" aria-label="Notifications">
                <Bell className="size-5" aria-hidden="true" />
                <span className="absolute right-2 top-2 size-1.5 rounded-full bg-[var(--accent)]" />
              </Button>
              <div className="relative ml-1 border-l border-[var(--line)] pl-2 sm:ml-2 sm:pl-3">
                <Button variant="ghost" className="h-10 gap-2 px-2" aria-expanded={profileOpen} aria-haspopup="menu" onClick={() => setProfileOpen(!profileOpen)}>
                  <span className="grid size-8 place-items-center rounded-full bg-[var(--accent-soft)] text-xs font-bold text-[var(--accent-strong)]">AM</span>
                  <span className="hidden text-sm font-semibold lg:block">Alex Morgan</span>
                  <ChevronDown className="hidden size-4 sm:block" aria-hidden="true" />
                </Button>
                {profileOpen ? <div className="absolute right-0 top-12 w-44 rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] p-2 shadow-xl" role="menu"><button className="w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--ink)]" role="menuitem" onClick={() => setProfileOpen(false)}>Profile settings</button></div> : null}
              </div>
            </div>
          </header>

          <main className="mx-auto max-w-[1600px] px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
            <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="mb-2 text-xs font-bold tracking-[0.18em] text-[var(--accent)] uppercase">Tuesday, September 22, 2026</p>
                <h1 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Good morning, Alex</h1>
                <p className="mt-2 text-sm text-[var(--muted)]">Here is what is happening across your business today.</p>
              </div>
              <Button variant="secondary" className="self-start sm:self-auto"><FileBarChart className="size-4" aria-hidden="true" />View reports</Button>
            </div>

            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Business overview">
              {metrics.map((metric) => {
                const Icon = metric.icon;
                return <Card key={metric.label} padding="compact" className="min-h-36">
                  <div className="flex items-start justify-between">
                    <span className={`grid size-10 place-items-center rounded-xl ${metric.tone === "accent" ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]" : metric.tone === "green" ? "bg-[var(--positive-soft)] text-[var(--positive)]" : metric.tone === "blue" ? "bg-[var(--blue-soft)] text-[var(--blue)]" : "bg-[var(--warning-soft)] text-[var(--warning)]"}`}><Icon className="size-5" aria-hidden="true" /></span>
                    <MoreHorizontal className="size-5 text-[var(--muted)]" aria-hidden="true" />
                  </div>
                  <p className="mt-4 text-sm text-[var(--muted)]">{metric.label}</p>
                  <div className="mt-1 flex items-baseline gap-2"><p className="text-2xl font-semibold tracking-[-0.03em]">{metric.value}</p><span className={`text-xs font-semibold ${metric.tone === "orange" ? "text-[var(--warning)]" : "text-[var(--positive)]"}`}>{metric.change}</span></div>
                  <p className="mt-1 text-xs text-[var(--muted)]">{metric.detail}</p>
                </Card>;
              })}
            </section>

            <section className="mt-5 grid gap-5 xl:grid-cols-[1.45fr_0.85fr]">
              <Card>
                <CardHeading>
                  <div><h2 className="text-base font-semibold">Revenue overview</h2><p className="mt-1 text-sm text-[var(--muted)]">Monthly revenue performance</p></div>
                  <Button variant="secondary" className="hidden h-9 text-xs sm:inline-flex">Last 6 months <ChevronDown className="size-3.5" aria-hidden="true" /></Button>
                </CardHeading>
                <div className="mt-7 flex items-end justify-between gap-3"><div><p className="text-3xl font-semibold tracking-[-0.035em]">$84,240</p><p className="mt-1 text-xs text-[var(--positive)]">+12.8% from last month</p></div><div className="hidden items-center gap-4 text-xs text-[var(--muted)] sm:flex"><span className="flex items-center gap-2"><i className="size-2 rounded-full bg-[var(--accent)]" />Revenue</span><span className="flex items-center gap-2"><i className="size-2 rounded-full bg-[var(--line-strong)]" />Target</span></div></div>
                <div className="relative mt-8 h-52 border-b border-l border-[var(--line)] px-2 pb-2 pt-3">
                  <div className="pointer-events-none absolute inset-x-0 top-1/4 border-t border-dashed border-[var(--line)]" /><div className="pointer-events-none absolute inset-x-0 top-2/4 border-t border-dashed border-[var(--line)]" /><div className="pointer-events-none absolute inset-x-0 top-3/4 border-t border-dashed border-[var(--line)]" />
                  <div className="relative flex h-full items-end justify-between gap-2 sm:gap-4"><span className="chart-bar h-[30%]" /><span className="chart-bar h-[42%]" /><span className="chart-bar h-[38%]" /><span className="chart-bar h-[56%]" /><span className="chart-bar h-[51%]" /><span className="chart-bar h-[68%]" /><span className="chart-bar h-[76%]" /><span className="chart-bar h-[88%]" /></div>
                </div>
                <div className="mt-3 flex justify-between pl-2 text-[11px] text-[var(--muted)]"><span>Apr</span><span>May</span><span>Jun</span><span>Jul</span><span>Aug</span><span>Sep</span></div>
              </Card>

              <Card>
                <CardHeading><div><h2 className="text-base font-semibold">Inventory watch</h2><p className="mt-1 text-sm text-[var(--muted)]">Products running low</p></div><Button variant="icon" className="size-8" aria-label="View inventory"><ChevronRight className="size-4" aria-hidden="true" /></Button></CardHeading>
                <div className="mt-5 divide-y divide-[var(--line)]">{inventory.map((item) => <div key={item.sku} className="flex items-center gap-3 py-4 first:pt-0 last:pb-0"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--surface-soft)] text-[var(--muted)]"><Package className="size-5" aria-hidden="true" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item.name}</p><p className="mt-1 text-xs text-[var(--muted)]">{item.sku}</p></div><Badge tone={item.tone}>{item.stock}</Badge></div>)}</div>
                <DialogPlaceholder><span className="font-medium text-[var(--ink)]">18 products</span> need your attention before the next restock cycle.</DialogPlaceholder>
              </Card>
            </section>

            <section className="mt-5 grid gap-5 xl:grid-cols-[1.45fr_0.85fr]">
              <Card padding="none">
                <div className="p-5 sm:p-6"><CardHeading><div><h2 className="text-base font-semibold">Recent orders</h2><p className="mt-1 text-sm text-[var(--muted)]">The latest activity from your customers</p></div><Button variant="ghost" className="h-9 px-2 text-xs">View all <ChevronRight className="size-3.5" aria-hidden="true" /></Button></CardHeading></div>
                <TablePlaceholder><table className="w-full text-left"><thead className="border-y border-[var(--line)] bg-[var(--surface-soft)] text-[11px] font-bold tracking-[0.12em] text-[var(--muted)] uppercase"><tr><th className="px-5 py-3 font-semibold">Order</th><th className="hidden px-5 py-3 font-semibold sm:table-cell">Customer</th><th className="hidden px-5 py-3 font-semibold md:table-cell">Date</th><th className="px-5 py-3 font-semibold">Amount</th><th className="px-5 py-3 font-semibold">Status</th></tr></thead><tbody className="divide-y divide-[var(--line)]">{orders.map((order) => <tr key={order.id} className="text-sm"><td className="px-5 py-4 font-semibold">{order.id}<span className="mt-1 block text-xs font-normal text-[var(--muted)] sm:hidden">{order.customer}</span></td><td className="hidden px-5 py-4 text-[var(--muted)] sm:table-cell">{order.customer}</td><td className="hidden px-5 py-4 text-[var(--muted)] md:table-cell">{order.date}</td><td className="px-5 py-4 font-medium">{order.amount}</td><td className="px-5 py-4"><Badge tone={order.tone}>{order.status}</Badge></td></tr>)}</tbody></table></TablePlaceholder>
              </Card>

              <Card>
                <CardHeading><div><h2 className="text-base font-semibold">Quick overview</h2><p className="mt-1 text-sm text-[var(--muted)]">This month at a glance</p></div><ClipboardList className="size-5 text-[var(--muted)]" aria-hidden="true" /></CardHeading>
                <div className="mt-6 space-y-5"><div><div className="mb-2 flex justify-between text-sm"><span className="text-[var(--muted)]">Orders fulfilled</span><span className="font-semibold">78%</span></div><div className="h-2 rounded-full bg-[var(--surface-soft)]"><div className="h-2 w-[78%] rounded-full bg-[var(--accent)]" /></div></div><div><div className="mb-2 flex justify-between text-sm"><span className="text-[var(--muted)]">Customer retention</span><span className="font-semibold">64%</span></div><div className="h-2 rounded-full bg-[var(--surface-soft)]"><div className="h-2 w-[64%] rounded-full bg-[var(--positive)]" /></div></div><div><div className="mb-2 flex justify-between text-sm"><span className="text-[var(--muted)]">Monthly target</span><span className="font-semibold">82%</span></div><div className="h-2 rounded-full bg-[var(--surface-soft)]"><div className="h-2 w-[82%] rounded-full bg-[var(--blue)]" /></div></div></div>
                <div className="mt-7 border-t border-[var(--line)] pt-5"><p className="text-sm font-semibold">Keep the momentum going.</p><p className="mt-1 text-sm leading-6 text-[var(--muted)]">Your revenue is trending ahead of the previous period.</p></div>
              </Card>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  FileBarChart,
  LayoutDashboard,
  Menu,
  Moon,
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
import { Button } from "@/components/ui/button";
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
      { label: "Orders", icon: ShoppingCart },
      { label: "Payments", icon: CircleDollarSign },
    ],
  },
  {
    label: "Insights",
    items: [
      { label: "Reports", icon: FileBarChart },
      { label: "Notifications", icon: Bell },
    ],
  },
];

export function DashboardShell({
  userName,
  readOnlyDemo,
  pendingOrdersCount,
  children,
}: {
  userName: string;
  readOnlyDemo: boolean;
  pendingOrdersCount?: number;
  children: ReactNode;
}) {
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

  function getNavigationCount(label: string) {
    if (label === "Orders" && typeof pendingOrdersCount === "number" && pendingOrdersCount > 0) {
      return String(pendingOrdersCount);
    }
    return undefined;
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
                    const count = getNavigationCount(item.label);
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
                        {count ? <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${active ? "bg-white/15 text-white" : "bg-[var(--surface-soft)] text-[var(--muted)]"} ${sidebarCollapsed ? "lg:hidden" : ""}`}>{count}</span> : null}
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
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-xs font-bold text-[var(--accent-strong)]">
                {(userName || "A").slice(0, 1).toUpperCase()}
              </span>
              <div className={sidebarCollapsed ? "lg:hidden" : ""}>
                <p className="text-xs font-semibold">{userName || "Account owner"}</p>
                <p className="mt-0.5 text-[11px] text-[var(--muted)]">{readOnlyDemo ? "Read-only demo" : "Administrator"}</p>
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
              </Button>
              <div className="relative ml-1 border-l border-[var(--line)] pl-2 sm:ml-2 sm:pl-3">
                <Button variant="ghost" className="h-10 gap-2 px-2" aria-expanded={profileOpen} aria-haspopup="menu" onClick={() => setProfileOpen(!profileOpen)}>
                  <span className="grid size-8 place-items-center rounded-full bg-[var(--accent-soft)] text-xs font-bold text-[var(--accent-strong)]">
                    {(userName || "A").slice(0, 1).toUpperCase()}
                  </span>
                  <span className="hidden text-sm font-semibold lg:block">{userName || "Account owner"}</span>
                  <ChevronDown className="hidden size-4 sm:block" aria-hidden="true" />
                </Button>
                {profileOpen ? (
                  <div className="absolute right-0 top-12 w-44 rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] p-2 shadow-xl" role="menu">
                    <button className="w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--ink)]" role="menuitem" onClick={() => setProfileOpen(false)}>
                      Profile settings
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </header>

          {children}
        </div>
      </div>
    </div>
  );
}

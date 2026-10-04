"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import {
  Banknote,
  Bell,
  ChartColumn,
  ChevronRight,
  LayoutDashboard,
  Menu,
  Moon,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings as SettingsIcon,
  ShoppingCart,
  Sparkles,
  Sun,
  Users,
  FileText,
  X,
  type LucideIcon,
} from "lucide-react";
import { AccountMenu } from "@/components/layout/account-menu";
import {
  WORKSPACE_NAV_ITEMS,
  getWorkspacePageTitle,
  isNavItemActive,
} from "@/components/layout/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const navIcons: Record<string, LucideIcon> = {
  Dashboard: LayoutDashboard,
  Customers: Users,
  Products: Package,
  Orders: ShoppingCart,
  Invoices: FileText,
  Payments: Banknote,
  Reports: ChartColumn,
  "AI Assistant": Sparkles,
  Notifications: Bell,
  Settings: SettingsIcon,
};

export function DashboardShell({
  userName,
  userEmail,
  readOnlyDemo,
  children,
}: {
  userName: string;
  userEmail: string;
  readOnlyDemo: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const pageTitle = getWorkspacePageTitle(pathname);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  return (
    <div className="min-h-screen bg-[var(--surface)] text-[var(--ink)]">
      <div className="flex min-h-screen">
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-[var(--line)] bg-[var(--surface-raised)] transition-transform duration-200 lg:static lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"} ${sidebarCollapsed ? "lg:w-20" : "lg:w-64"}`}
        >
          <div className="flex h-20 items-center justify-between border-b border-[var(--line)] px-5">
            <Link href="/" className={`flex items-center gap-3 ${sidebarCollapsed ? "lg:mx-auto" : ""}`}>
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--ink)] text-sm font-bold text-white">L</span>
              <span className={`text-sm font-bold tracking-[0.18em] uppercase ${sidebarCollapsed ? "lg:hidden" : ""}`}>Ledger</span>
            </Link>
            <Button type="button" variant="icon" className="lg:hidden" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}>
              <X className="size-5" aria-hidden="true" />
            </Button>
          </div>

          <nav className="flex-1 space-y-2 overflow-y-auto px-3 py-6" aria-label="Primary navigation">
            <p className={`mb-2 px-3 text-[10px] font-bold tracking-[0.18em] text-[var(--muted)] uppercase ${sidebarCollapsed ? "lg:hidden" : ""}`}>
              Workspace
            </p>
            <div className="space-y-1">
              {WORKSPACE_NAV_ITEMS.map((item) => {
                const Icon = navIcons[item.label] ?? LayoutDashboard;
                const active = isNavItemActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={`group flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors ${active ? "bg-[var(--ink)] text-white" : "text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--ink)]"} ${sidebarCollapsed ? "lg:justify-center" : ""}`}
                    aria-current={active ? "page" : undefined}
                    title={sidebarCollapsed ? item.label : undefined}
                  >
                    <Icon className="size-[18px] shrink-0" aria-hidden="true" />
                    <span className={sidebarCollapsed ? "lg:hidden" : ""}>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className={`border-t border-[var(--line)] p-3 ${sidebarCollapsed ? "lg:px-2" : ""}`}>
            <div className={sidebarCollapsed ? "lg:hidden" : ""}>
              <AccountMenu userName={userName} userEmail={userEmail} readOnlyDemo={readOnlyDemo} compact />
            </div>
            {sidebarCollapsed ? (
              <div className="hidden lg:flex lg:justify-center">
                <AccountMenu userName={userName} userEmail={userEmail} readOnlyDemo={readOnlyDemo} />
              </div>
            ) : null}
          </div>
        </aside>

        {sidebarOpen ? (
          <button
            type="button"
            className="fixed inset-0 z-30 bg-[var(--ink)]/30 lg:hidden"
            aria-label="Close navigation overlay"
            onClick={() => setSidebarOpen(false)}
          />
        ) : null}

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex h-20 items-center justify-between gap-4 border-b border-[var(--line)] bg-[var(--surface)]/95 px-4 backdrop-blur sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <Button type="button" variant="icon" className="lg:hidden" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}>
                <Menu className="size-5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="icon"
                className="hidden lg:inline-flex"
                aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              >
                {sidebarCollapsed ? <PanelLeftOpen className="size-5" aria-hidden="true" /> : <PanelLeftClose className="size-5" aria-hidden="true" />}
              </Button>
              <div className="hidden min-w-0 items-center gap-2 text-sm sm:flex">
                <span className="text-[var(--muted)]">Workspace</span>
                <ChevronRight className="size-4 text-[var(--line-strong)]" aria-hidden="true" />
                <span className="truncate font-semibold">{pageTitle}</span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
              <div className="hidden w-52 md:block lg:w-64">
                <Input aria-label="Search workspace" placeholder="Search workspace" type="search" className="h-10" />
              </div>
              <Button type="button" variant="icon" className="md:hidden" aria-label="Search workspace">
                <Search className="size-5" aria-hidden="true" />
              </Button>
              <Button type="button" variant="icon" aria-label="Toggle theme" onClick={() => setDarkMode(!darkMode)}>
                {darkMode ? <Sun className="size-5" aria-hidden="true" /> : <Moon className="size-5" aria-hidden="true" />}
              </Button>
              <Button type="button" variant="icon" className="relative" aria-label="Notifications">
                <Bell className="size-5" aria-hidden="true" />
              </Button>
              <div className="ml-1 border-l border-[var(--line)] pl-2 sm:ml-2 sm:pl-3">
                <AccountMenu userName={userName} userEmail={userEmail} readOnlyDemo={readOnlyDemo} />
              </div>
            </div>
          </header>

          {children}
        </div>
      </div>
    </div>
  );
}

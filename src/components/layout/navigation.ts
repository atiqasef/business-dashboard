export type WorkspaceNavItem = {
  label: string;
  href: string;
};

export const WORKSPACE_NAV_ITEMS: WorkspaceNavItem[] = [
  { label: "Dashboard", href: "/" },
  { label: "Customers", href: "/customers" },
  { label: "Products", href: "/products" },
  { label: "Orders", href: "/orders" },
  { label: "Invoices", href: "/invoices" },
];

export function isNavItemActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getWorkspacePageTitle(pathname: string) {
  const match = WORKSPACE_NAV_ITEMS.find((item) => isNavItemActive(pathname, item.href));
  return match?.label ?? "Workspace";
}

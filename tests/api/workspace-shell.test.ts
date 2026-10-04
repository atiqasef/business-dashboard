import { describe, expect, it } from "vitest";
import {
  WORKSPACE_NAV_ITEMS,
  getWorkspacePageTitle,
  isNavItemActive,
} from "@/components/layout/navigation";
import { APP_HOME_PATH, LEGACY_DASHBOARD_PATH } from "@/lib/app-paths";

describe("workspace shell navigation", () => {
  it("exposes the implemented workspace routes only", () => {
    expect(WORKSPACE_NAV_ITEMS.map((item) => item.href)).toEqual([
      "/",
      "/customers",
      "/products",
      "/orders",
      "/invoices",
      "/reports",
    ]);
  });

  it("marks nested invoice routes as invoices-active without matching dashboard", () => {
    expect(isNavItemActive("/", "/")).toBe(true);
    expect(isNavItemActive("/customers", "/")).toBe(false);
    expect(isNavItemActive("/invoices", "/invoices")).toBe(true);
    expect(isNavItemActive("/invoices/abc123", "/invoices")).toBe(true);
    expect(isNavItemActive("/orders", "/invoices")).toBe(false);
    expect(isNavItemActive("/reports", "/reports")).toBe(true);
    expect(getWorkspacePageTitle("/invoices/abc123")).toBe("Invoices");
    expect(getWorkspacePageTitle("/reports")).toBe("Reports");
    expect(getWorkspacePageTitle("/")).toBe("Dashboard");
  });

  it("keeps the live dashboard at / and legacy dashboard path separate", () => {
    expect(APP_HOME_PATH).toBe("/");
    expect(LEGACY_DASHBOARD_PATH).toBe("/dashboard");
    expect(isNavItemActive("/dashboard", "/")).toBe(false);
  });
});

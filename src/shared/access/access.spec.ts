import { hasPermission, PERMISSIONS } from "./permissions";
import { ROLES, requiresMfa } from "./roles";

describe("access", () => {
  it("requires MFA for every role outside the vendor organisation", () => {
    const withoutMfa = ROLES.filter((role) => !requiresMfa(role));
    expect(withoutMfa).toEqual(["VENDOR_OWNER", "VENDOR_MEMBER"]);
  });

  it("keeps country management to super admins", () => {
    const managers = ROLES.filter((role) => hasPermission(role, "countries.manage"));
    expect(managers).toEqual(["SUPER_ADMIN"]);
  });

  it("keeps verification decisions to compliance and super admins", () => {
    const reviewers = ROLES.filter((role) => hasPermission(role, "verifications.review"));
    expect(reviewers).toEqual(["COMPLIANCE", "SUPER_ADMIN"]);
  });

  it("lets only the vendor owner manage the team and verification", () => {
    expect(hasPermission("VENDOR_MEMBER", "vendor.team.manage")).toBe(false);
    expect(hasPermission("VENDOR_MEMBER", "vendor.verification.manage")).toBe(false);
    expect(hasPermission("VENDOR_OWNER", "vendor.team.manage")).toBe(true);
  });

  it("never lets a vendor read the audit log", () => {
    expect(hasPermission("VENDOR_OWNER", "audit.read")).toBe(false);
  });

  it("keeps receiving to warehouse operators, partner warehouse teams and super admins", () => {
    expect(ROLES.filter((role) => hasPermission(role, "inbound.receive"))).toEqual(["WAREHOUSE_OPERATOR", "FULFILMENT_PARTNER", "PARTNER_STAFF", "SUPER_ADMIN"]);
    expect(ROLES.filter((role) => hasPermission(role, "staff.manage"))).toEqual(["SUPER_ADMIN"]);
  });

  it("lets members see stock but only owners change it", () => {
    expect(hasPermission("VENDOR_MEMBER", "vendor.stock.read")).toBe(true);
    expect(hasPermission("VENDOR_MEMBER", "vendor.stock.manage")).toBe(false);
  });

  it("gives partner teams no vendor, finance or platform administration permissions", () => {
    for (const role of ["FULFILMENT_PARTNER", "PARTNER_STAFF"] as const) {
      const granted = PERMISSIONS.filter((permission) => hasPermission(role, permission));
      expect(granted.filter((permission) => /^(vendor\.|finance\.|fees\.|partners\.|staff\.|users\.|audit\.|countries\.)/.test(permission))).toEqual([]);
    }
  });
});

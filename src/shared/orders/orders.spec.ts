import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SEED_COUNTRIES } from "../country/seed-countries";
import { CsvFormatError, csvRecipient, groupOrderRows, ORDER_CSV_COLUMNS, parseCsv } from "./order-csv";
import { canMoveOrder, ORDER_STATUSES, ORDER_TRANSITIONS, staffOrderActions, vendorOrderActions } from "./order-lifecycle";
import { orderRecipientSchema, recipientProblems, recipientSchema } from "./recipient";

const MIGRATION = join(__dirname, "../../../prisma/migrations/20261025000008_orders/migration.sql");

describe("order lifecycle", () => {
  it("allows exactly the same status moves in the database as in code", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const body = sql.slice(sql.indexOf("order_status_transition_allowed"), sql.indexOf("$$;", sql.indexOf("order_status_transition_allowed")));
    const pairs = [...body.matchAll(/\('([A-Z_]+)', '([A-Z_]+)'\)/g)].map((match) => `${match[1]}>${match[2]}`).sort();
    const code = ORDER_STATUSES.flatMap((from) => ORDER_TRANSITIONS[from].map((to) => `${from}>${to}`)).sort();
    expect(pairs).toEqual(code);
  });

  it("never leaves a cancelled or returned order", () => {
    for (const to of ORDER_STATUSES) {
      expect(canMoveOrder("CANCELLED", to)).toBe(to === "CANCELLED");
      expect(canMoveOrder("RETURNED", to)).toBe(to === "RETURNED");
    }
  });

  it("lets vendors cancel before packing and ask once after", () => {
    expect(vendorOrderActions("PENDING_PACKING", false)).toEqual(["CANCEL"]);
    expect(vendorOrderActions("PACKING_COMPLETED", false)).toEqual(["REQUEST_CANCELLATION"]);
    expect(vendorOrderActions("PACKING_COMPLETED", true)).toEqual([]);
    expect(vendorOrderActions("AWAITING_WALLET_FUNDING", false)).toEqual(["PAY_SHIPPING", "REQUEST_CANCELLATION"]);
    expect(vendorOrderActions("HANDED_OFF", false)).toEqual([]);
  });

  it("shows staff only the steps their role allows", () => {
    expect(staffOrderActions("LABEL_PURCHASED", { fulfil: true, cancel: false })).toEqual(["HAND_OFF"]);
    expect(staffOrderActions("LABEL_PURCHASED", { fulfil: false, cancel: true })).toEqual(["CANCEL"]);
  });
});

describe("recipients", () => {
  const gb = SEED_COUNTRIES.find((country) => country.code === "GB")!.config.address;
  const us = SEED_COUNTRIES.find((country) => country.code === "US")!.config.address;
  const base = recipientSchema.parse({ name: "Ada Obi", line1: "1 High Street", city: "Manchester", postalCode: "m1 1aa", countryCode: "GB" });

  it("checks postcodes and regions against the country's rules", () => {
    expect(recipientProblems(base, gb)).toEqual({});
    expect(recipientProblems({ ...base, postalCode: "12345" }, gb)).toHaveProperty("postalCode");
    expect(recipientProblems({ ...base, postalCode: "10001", countryCode: "US" }, us)).toEqual({ region: ["Enter the state"] });
    expect(recipientProblems({ ...base, postalCode: "10001", region: "ZZ", countryCode: "US" }, us)).toEqual({ region: ["Choose a valid state"] });
  });

  it("lets an order leave the country out of the address", () => {
    expect(orderRecipientSchema.parse({ ...base, countryCode: undefined }).countryCode).toBeUndefined();
  });
});

describe("spreadsheet import", () => {
  const header = ORDER_CSV_COLUMNS.join(",");
  const row = (reference: string, code: string, quantity: string, name = "Ada Obi") => [reference, name, "", "", "", "1 High Street", "", "Manchester", "", "M1 1AA", "GB", code, quantity].join(",");

  it("parses quotes, escaped quotes, blank lines and a byte-order mark", () => {
    expect(parseCsv('﻿a,"b, c","say ""hi"""\r\n\r\nd,e,f\n')).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["d", "e", "f"],
    ]);
    expect(() => parseCsv('a,"b')).toThrow(CsvFormatError);
  });

  it("groups rows into orders by reference and reports bad rows", () => {
    const { orders, errors } = groupOrderRows(parseCsv([header, row("A-1", "wig-1", "2"), row("A-1", "wig-2", "1"), row("B-2", "wig-1", "0"), row("A-1", "wig-3", "1", "Someone Else")].join("\n")));
    expect(orders).toHaveLength(1);
    expect(orders[0]!.lines).toEqual([
      { row: 2, productCode: "WIG-1", quantity: 2 },
      { row: 3, productCode: "WIG-2", quantity: 1 },
    ]);
    expect(errors.map((error) => error.row)).toEqual([4, 5]);
  });

  it("refuses a header that doesn't match the template", () => {
    expect(() => groupOrderRows(parseCsv("order_reference,name\n1,2"))).toThrow(/missing/);
  });

  it("uses the selected country when the country column is blank or left out", () => {
    const blank = groupOrderRows(parseCsv([header, row("A-1", "wig-1", "1").replace(",GB,", ",,")].join("\n")));
    expect(csvRecipient(blank.orders[0]!.recipient, "US").countryCode).toBe("US");
    const withoutColumn = ORDER_CSV_COLUMNS.filter((column) => column !== "country");
    const cells = row("B-2", "wig-1", "1").split(",");
    cells.splice(ORDER_CSV_COLUMNS.indexOf("country"), 1);
    const omitted = groupOrderRows(parseCsv([withoutColumn.join(","), cells.join(",")].join("\n")));
    expect(omitted.errors).toEqual([]);
    expect(csvRecipient(omitted.orders[0]!.recipient, "GB").countryCode).toBe("GB");
  });

  it("keeps the country a row names", () => {
    const { orders } = groupOrderRows(parseCsv([header, row("A-1", "wig-1", "1")].join("\n")));
    expect(csvRecipient(orders[0]!.recipient, "US").countryCode).toBe("GB");
  });
});

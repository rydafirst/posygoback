import { hubArea, hubLabels } from "./receiving-hubs";

describe("receiving hub labels", () => {
  it("names a hub by its city when it's the only one there", () => {
    expect(hubLabels([{ city: "Manchester", postalCode: "M17 1AA" }, { city: "London", postalCode: "SE2 0NX" }])).toEqual(["Manchester", "London"]);
  });

  it("adds the area when a city has more than one hub, and numbers hubs in the same area", () => {
    expect(
      hubLabels([
        { city: "Manchester", postalCode: "M1 1AA" },
        { city: "Manchester", postalCode: "M17 1AA" },
        { city: "Manchester", postalCode: "M17 9ZZ" },
      ]),
    ).toEqual(["Manchester M1", "Manchester M17 (1)", "Manchester M17 (2)"]);
  });

  it("reads the area from postcodes with or without a space", () => {
    expect(hubArea("m17 1aa")).toBe("M17");
    expect(hubArea("M171AA")).toBe("M17");
    expect(hubArea("10115")).toBe("101");
  });
});

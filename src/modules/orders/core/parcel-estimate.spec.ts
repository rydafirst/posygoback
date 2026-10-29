import { estimateParcel, PACKING_ALLOWANCE_GRAMS } from "./parcel-estimate";

const BOXES = [
  { label: "Large box", lengthMm: 500, widthMm: 400, heightMm: 300 },
  { label: "Small mailer", lengthMm: 250, widthMm: 180, heightMm: 20 },
  { label: "Small box", lengthMm: 300, widthMm: 200, heightMm: 100 },
  { label: "Medium box", lengthMm: 400, widthMm: 300, heightMm: 200 },
];

describe("estimating the parcel for a new order", () => {
  it("picks the smallest box that holds everything, with the packing added to the weight", () => {
    const estimate = estimateParcel([{ weightGrams: 300, quantity: 2, lengthMm: 200, widthMm: 150, heightMm: 40 }], BOXES);
    expect(estimate).toEqual({ parcel: { lengthMm: 300, widthMm: 200, heightMm: 100, weightGrams: 600 + PACKING_ALLOWANCE_GRAMS }, boxLabel: "Small box", sized: true });
  });

  it("never picks a box an item can't lie flat in, even when the volume would do", () => {
    expect(estimateParcel([{ weightGrams: 900, quantity: 1, lengthMm: 450, widthMm: 50, heightMm: 50 }], BOXES)?.boxLabel).toBe("Large box");
  });

  it("uses a middle-sized box and says so when it doesn't know the sizes", () => {
    const estimate = estimateParcel([{ weightGrams: 350, quantity: 1, lengthMm: null, widthMm: null, heightMm: null }], BOXES);
    expect(estimate).toMatchObject({ boxLabel: "Medium box", sized: false, parcel: { weightGrams: 350 + PACKING_ALLOWANCE_GRAMS } });
  });

  it("sizes from the products it knows, but still flags the estimate as rough", () => {
    const estimate = estimateParcel(
      [
        { weightGrams: 100, quantity: 1, lengthMm: 240, widthMm: 170, heightMm: 10 },
        { weightGrams: 200, quantity: 1, lengthMm: null, widthMm: null, heightMm: null },
      ],
      BOXES,
    );
    expect(estimate).toMatchObject({ boxLabel: "Small mailer", sized: false });
  });

  it("gives up without boxes or items", () => {
    expect(estimateParcel([], BOXES)).toBeNull();
    expect(estimateParcel([{ weightGrams: 1, quantity: 1, lengthMm: null, widthMm: null, heightMm: null }], [])).toBeNull();
  });
});

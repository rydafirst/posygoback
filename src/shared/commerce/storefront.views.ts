import type { DestinationView } from "../country/country.schema";
import type { StorefrontReturnStatus } from "./buyer.schema";
import type { DiscountKind } from "./discount.schema";
import type { DeliverySpeed, StorefrontOrderStatus, StorefrontStatus, StorefrontTone, VendorPayoutStatus } from "./storefront.schema";

export interface VendorPayoutAccountView {
  provider: string;
  status: "ONBOARDING" | "ACTIVE" | "RESTRICTED";
  bankSummary: string | null;
}

export interface StorefrontSettingsView {
  slug: string | null;
  displayName: string;
  about: string | null;
  tone: StorefrontTone;
  status: StorefrontStatus;
  returnsAllowed: boolean;
  returnWindowDays: number;
  setupFeePaid: boolean;
  setupFeeMinor: number;
  commissionBps: number;
  currency: string;
  listedProducts: number;
  payoutAccount: VendorPayoutAccountView | null;
  missing: string[];
}

export interface ListingView {
  productId: string;
  code: string;
  name: string;
  declaredValueMinor: number;
  retailPriceMinor: number | null;
  listed: boolean;
  description: string | null;
  category: string | null;
  available: number;
  imageUrl: string | null;
}

export interface PublicProductView {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  priceMinor: number;
  currency: string;
  inStock: boolean;
  imageUrl: string | null;
  store: { slug: string; displayName: string; tone: StorefrontTone };
}

export interface PublicStoreListing {
  slug: string;
  displayName: string;
  countryCode: string;
  updatedAt: string;
}

export interface PublicStoreView {
  slug: string;
  displayName: string;
  about: string | null;
  tone: StorefrontTone;
  currency: string;
  countryCode: string;
  pricesIncludeTax: boolean;
  returnsAllowed: boolean;
  returnWindowDays: number;
  destinations: DestinationView[];
  products: PublicProductView[];
}

export interface DeliveryOptionView {
  speed: DeliverySpeed;
  label: string;
  window: string;
  priceMinor: number;
  totalMinor: number;
  taxMinor: number;
}

export interface QuoteView {
  currency: string;
  lines: Array<{ productId: string; name: string; quantity: number; unitPriceMinor: number }>;
  goodsMinor: number;
  discountMinor: number;
  discountProblem: string | null;
  taxIncluded: boolean;
  taxLabel: string;
  options: DeliveryOptionView[];
}

export interface CheckoutStartedView {
  reference: string;
  redirectUrl: string;
}

export interface StorefrontOrderView {
  id: string;
  reference: string;
  storeName: string;
  storeSlug: string | null;
  status: StorefrontOrderStatus;
  currency: string;
  buyerName: string;
  buyerEmail: string | null;
  recipientCity: string;
  destinationCountryCode: string;
  lines: Array<{ productId: string; productName: string; quantity: number; unitPriceMinor: number }>;
  goodsMinor: number;
  discountMinor: number;
  deliverySpeed: DeliverySpeed;
  deliveryMinor: number;
  taxMinor: number;
  taxIncluded: boolean;
  totalMinor: number;
  refundedMinor: number;
  vendorShareMinor: number | null;
  platformShareMinor: number | null;
  payoutStatus: VendorPayoutStatus | null;
  payoutReleaseAt: string | null;
  returnsUntil: string | null;
  canRequestReturn: boolean;
  returns: StorefrontReturnView[];
  fulfilmentReference: string | null;
  trackingNumber: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface StorefrontReturnView {
  id: string;
  reference: string;
  status: StorefrontReturnStatus;
  reason: string;
  decisionNote: string | null;
  refundMinor: number | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface StoreReturnCaseView extends StorefrontReturnView {
  order: StorefrontOrderView;
}

export interface BuyerView {
  email: string;
  name: string | null;
}

export interface DiscountCodeView {
  id: string;
  code: string;
  kind: DiscountKind;
  percentBps: number | null;
  amountMinor: number | null;
  minGoodsMinor: number;
  startsAt: string | null;
  endsAt: string | null;
  maxRedemptions: number | null;
  redemptions: number;
  active: boolean;
  createdAt: string;
}

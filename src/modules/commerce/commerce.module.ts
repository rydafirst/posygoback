import { Module } from "@nestjs/common";

import { CountriesModule } from "../countries/countries.module";
import { FilesModule } from "../files/files.module";
import { FinanceModule } from "../finance/finance.module";
import { OnboardingModule } from "../onboarding/onboarding.module";
import { OrdersModule } from "../orders/orders.module";
import { PartnersModule } from "../partners/partners.module";
import { CheckoutPreparationService } from "./checkout/checkout-preparation.service";
import { CheckoutService } from "./checkout/checkout.service";
import { DeliveryQuotesService } from "./checkout/delivery-quotes.service";
import { DiscountsService } from "./checkout/discounts.service";
import { BuyerAuthService } from "./buyers/buyer-auth.service";
import { BuyerSessionGuard } from "./buyers/buyer-session.guard";
import { CommerceJobs } from "./commerce.jobs";
import { BuyerAccountController, BuyerAuthController } from "./controllers/buyer.controllers";
import { AdminShoppingController, BuyerShoppingController, PublicShoppingController, WarehouseShoppingController } from "./controllers/shopping.controllers";
import { AdminStoreReturnsController, VendorStoreReturnsController } from "./controllers/store-returns.controllers";
import { AdminStorefrontOrdersController, PublicStorefrontController, VendorStorefrontController } from "./controllers/storefront.controllers";
import { HoldWindowService } from "./orders/hold-window.service";
import { StorefrontFulfilmentService } from "./orders/storefront-fulfilment.service";
import { StorefrontOrdersService } from "./orders/storefront-orders.service";
import { StorefrontPaymentsService } from "./orders/storefront-payments.service";
import { StorefrontPayoutsService } from "./orders/storefront-payouts.service";
import { StorefrontRefundsService } from "./orders/storefront-refunds.service";
import { StorefrontReturnsService } from "./returns/storefront-returns.service";
import { ShoppingPaymentsService } from "./shopping/shopping-payments.service";
import { ShoppingPurchasesService } from "./shopping/shopping-purchases.service";
import { ShoppingQuotesService } from "./shopping/shopping-quotes.service";
import { ShoppingRefundsService } from "./shopping/shopping-refunds.service";
import { ShoppingRequestsService } from "./shopping/shopping-requests.service";
import { ShoppingWarehouseService } from "./shopping/shopping-warehouse.service";
import { ShoppingRepository } from "./shopping/shopping.repository";
import { DiscountCodesService } from "./storefront/discount-codes.service";
import { PublicStorefrontService } from "./storefront/public-storefront.service";
import { StorefrontListingsService } from "./storefront/storefront-listings.service";
import { StorefrontSettingsService } from "./storefront/storefront-settings.service";
import { VendorPayoutAccountService } from "./storefront/vendor-payout-account.service";
import { StorefrontRepository } from "./storefront.repository";

@Module({
  imports: [CountriesModule, FilesModule, FinanceModule, OnboardingModule, OrdersModule, PartnersModule],
  controllers: [
    VendorStorefrontController,
    VendorStoreReturnsController,
    PublicStorefrontController,
    AdminStorefrontOrdersController,
    AdminStoreReturnsController,
    BuyerAuthController,
    BuyerAccountController,
    PublicShoppingController,
    BuyerShoppingController,
    AdminShoppingController,
    WarehouseShoppingController,
  ],
  providers: [
    StorefrontRepository,
    StorefrontSettingsService,
    StorefrontListingsService,
    VendorPayoutAccountService,
    PublicStorefrontService,
    DiscountsService,
    DeliveryQuotesService,
    CheckoutPreparationService,
    CheckoutService,
    StorefrontRefundsService,
    HoldWindowService,
    StorefrontFulfilmentService,
    StorefrontPaymentsService,
    StorefrontPayoutsService,
    StorefrontOrdersService,
    StorefrontReturnsService,
    DiscountCodesService,
    BuyerAuthService,
    BuyerSessionGuard,
    ShoppingRepository,
    ShoppingRequestsService,
    ShoppingQuotesService,
    ShoppingRefundsService,
    ShoppingPaymentsService,
    ShoppingPurchasesService,
    ShoppingWarehouseService,
    CommerceJobs,
  ],
})
export class CommerceModule {}

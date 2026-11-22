const USER_ERRORS = "userErrors { field message }";

export const CREATE_FULFILMENT_SERVICE = `
mutation CreateService($name: String!, $callbackUrl: URL!) {
  fulfillmentServiceCreate(name: $name, callbackUrl: $callbackUrl, inventoryManagement: true) {
    fulfillmentService { id location { id name } }
    ${USER_ERRORS}
  }
}`;

export const DELETE_FULFILMENT_SERVICE = `
mutation DeleteService($id: ID!) {
  fulfillmentServiceDelete(id: $id) {
    deletedId
    ${USER_ERRORS}
  }
}`;

export const ASSIGNED_FULFILMENT_ORDERS = `
query Assigned($status: FulfillmentOrderAssignmentStatus!, $locationIds: [ID!]) {
  assignedFulfillmentOrders(first: 25, assignmentStatus: $status, locationIds: $locationIds) {
    nodes {
      id
      orderName
      destination { firstName lastName company address1 address2 city province zip countryCode phone email }
      lineItems(first: 50) { nodes { sku remainingQuantity productTitle requiresShipping } }
    }
  }
}`;

export const ACCEPT_FULFILMENT_REQUEST = `
mutation Accept($id: ID!, $message: String) {
  fulfillmentOrderAcceptFulfillmentRequest(id: $id, message: $message) {
    fulfillmentOrder { id }
    ${USER_ERRORS}
  }
}`;

export const REJECT_FULFILMENT_REQUEST = `
mutation Reject($id: ID!, $message: String) {
  fulfillmentOrderRejectFulfillmentRequest(id: $id, message: $message, reason: OTHER) {
    fulfillmentOrder { id }
    ${USER_ERRORS}
  }
}`;

export const ACCEPT_CANCELLATION = `
mutation AcceptCancel($id: ID!, $message: String) {
  fulfillmentOrderAcceptCancellationRequest(id: $id, message: $message) {
    fulfillmentOrder { id }
    ${USER_ERRORS}
  }
}`;

export const REJECT_CANCELLATION = `
mutation RejectCancel($id: ID!, $message: String) {
  fulfillmentOrderRejectCancellationRequest(id: $id, message: $message) {
    fulfillmentOrder { id }
    ${USER_ERRORS}
  }
}`;

export const CREATE_FULFILMENT = `
mutation Fulfil($fulfillment: FulfillmentInput!) {
  fulfillmentCreate(fulfillment: $fulfillment) {
    fulfillment { id }
    ${USER_ERRORS}
  }
}`;

export const CLOSE_FULFILMENT_ORDER = `
mutation Close($id: ID!, $message: String) {
  fulfillmentOrderClose(id: $id, message: $message) {
    fulfillmentOrder { id }
    ${USER_ERRORS}
  }
}`;

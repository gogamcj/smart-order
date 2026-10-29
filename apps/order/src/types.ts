import type { OrderStatus } from '@qr/web';

export interface OrderContext {
  storeId: string;
  tenantName: string;
  storeName: string;
  tableLabel: string;
  storeStatus: string;
  acceptingOrders: boolean;
  logoUrl: string | null;
}

export interface MenuOption {
  id: string;
  name: string;
  extraPrice: number;
  soldOut: boolean;
}
export interface OptionGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: MenuOption[];
}
export interface Menu {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  price: number;
  salePrice: number | null;
  soldOut: boolean;
  availableNow: boolean;
  isPopular: boolean;
  imageUrl: string | null;
  optionGroups: OptionGroup[];
}
export interface MenuBoard {
  categories: { id: string; name: string }[];
  menus: Menu[];
}

export interface QuoteLine {
  menuId: string;
  name: string;
  listPrice: number;
  unitPrice: number;
  optionsTotal: number;
  quantity: number;
  lineTotal: number;
  options: { optionId: string; groupName: string; name: string; extraPrice: number }[];
}
export interface Quote {
  lines: QuoteLine[];
  subtotal: number;
  discount: number;
  total: number;
}
export interface CartProblem {
  index: number;
  menuId: string;
  code: string;
  message: string;
}

export interface Me {
  authenticated: boolean;
  userId?: string;
  actorKind?: 'customer' | 'staff';
  displayName?: string | null;
}

export interface Terms {
  id: string;
  kind: string;
  version: string;
  title: string;
  body_url: string | null;
  required: boolean;
  agreed: boolean;
}

export interface OrderDetail {
  id: string;
  orderNo: string;
  displayNo: number;
  storeName: string;
  tableLabel: string;
  status: OrderStatus;
  subtotalAmount: number;
  discountAmount: number;
  totalAmount: number;
  customerRequest: string | null;
  createdAt: string;
  placedAt: string | null;
  acceptedAt: string | null;
  readyAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  items: { id: string; name: string; unitPrice: number; optionsTotal: number; quantity: number; lineTotal: number; options: { groupName: string; name: string; extraPrice: number }[] }[];
  payment: { id: string; status: string; amount: number; approvedAt: string | null; refundedAmount: number } | null;
  refunds: { id: string; amount: number; status: string; createdAt: string }[];
}

export interface OrderSummary {
  id: string;
  orderNo: string;
  displayNo: number;
  storeName: string;
  tableLabel: string;
  status: OrderStatus;
  totalAmount: number;
  createdAt: string;
}

export interface PaymentStart {
  paymentId: string;
  paymentRequestId: string;
  amount: number;
  provider: string;
  environment: 'test' | 'live';
  checkout: Record<string, unknown>;
}

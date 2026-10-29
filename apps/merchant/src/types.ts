import type { OrderStatus } from '@qr/web';

export type Role = 'tenant_admin' | 'order_staff' | 'menu_staff' | 'viewer';
export const ROLE_LABEL: Record<Role, string> = { tenant_admin: '업체 관리자', order_staff: '주문 처리', menu_staff: '메뉴 관리', viewer: '조회 전용' };

export interface Me {
  authenticated: boolean;
  userId?: string;
  actorKind?: 'customer' | 'staff';
  displayName?: string | null;
  tenantId?: string | null;
  memberships?: { tenantId: string; tenantName: string; tenantStatus: string; role: Role; status: string }[];
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: 'pending' | 'active' | 'rejected' | 'suspended' | 'closed';
  statusReason: string | null;
  representativeName: string;
  contactEmail: string;
  contactPhone: string;
  businessRegistrationNo: string;
  myRole: Role;
  plan: { code: string; billingEnabled: boolean } | null;
  settings: { acceptingOrders: boolean; autoAcceptOrders: boolean; orderSoundEnabled: boolean };
}

export interface Store {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  status: 'open' | 'paused' | 'inactive';
  businessHours: { dow: number; open: string; close: string }[];
  timezone: string;
}

export interface MerchantOrder {
  id: string;
  orderNo: string;
  displayNo: number;
  storeId: string;
  tableLabel: string;
  status: OrderStatus;
  version: number;
  totalAmount: number;
  customerRequest: string | null;
  placedAt: string | null;
  acceptedAt: string | null;
  readyAt: string | null;
  completedAt: string | null;
  payment: { status: string; amount: number; refundedAmount: number } | null;
  refunds: { status: string; amount: number }[];
  items: { name: string; quantity: number; lineTotal: number; options: { groupName: string; name: string }[] }[];
  history?: { from: string | null; to: string; actorKind: string; actorName: string | null; reason: string | null; at: string }[];
}

export interface Category {
  id: string;
  name: string;
  sortOrder: number;
  isVisible: boolean;
}

export type MenuStatus = 'on_sale' | 'sold_out' | 'paused' | 'inactive';
export const MENU_STATUS_LABEL: Record<MenuStatus, string> = { on_sale: '판매 중', sold_out: '품절', paused: '판매 중지', inactive: '숨김' };

export interface AdminOptionGroup {
  id?: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: { id?: string; name: string; extraPrice: number; status?: 'available' | 'sold_out' | 'inactive' }[];
}

export interface AdminMenu {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  price: number;
  salePrice: number | null;
  status: MenuStatus;
  isPopular: boolean;
  imageMediaId: string | null;
  imageUrl: string | null;
  optionGroups: AdminOptionGroup[];
  availability: { dayOfWeek: number; start: string; end: string }[];
}

export interface TableRow {
  id: string;
  storeId: string;
  label: string;
  isActive: boolean;
  qrCodeId: string | null;
  qrIssuedAt: string | null;
}

export interface Member {
  id: string;
  userId: string;
  displayName: string | null;
  email: string | null;
  role: Role;
  canRefund: boolean;
  status: 'active' | 'disabled';
}

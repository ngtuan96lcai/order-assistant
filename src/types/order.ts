export type OrderStatus = "pending" | "processing" | "shipped" | "delivered" | "cancelled";

export interface Order {
  orderId: string;
  status: OrderStatus;
  /** ISO date, e.g. "2026-11-20" */
  createdAt: string;
  stockAvailable: number;
}

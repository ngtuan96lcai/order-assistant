import type { Order } from "../types/order";

// Mock data only. No database or production system is involved.
const ORDERS: readonly Order[] = [
  {
    orderId: "ORD-1001",
    status: "processing",
    createdAt: "2026-11-20",
    stockAvailable: 100,
  },
  {
    orderId: "ORD-1002",
    status: "shipped",
    createdAt: "2026-11-19",
    stockAvailable: 200,
  },
];

export function findOrderById(orderId: string): Order | undefined {
  return ORDERS.find((order) => order.orderId === orderId);
}

export const EXPENSE_RECEIPT_BUCKET = "expense-receipts";
export const MAX_EXPENSE_RECEIPTS = 8;
export const MAX_EXPENSE_RECEIPT_BYTES = 5 * 1024 * 1024;
export const EXPENSE_RECEIPT_MAX_EDGE = 1600;
export const EXPENSE_RECEIPT_JPEG_QUALITY = 0.7;
export const EXPENSE_RECEIPT_SIGNED_URL_TTL_SEC = 60 * 60;

export const ALLOWED_RECEIPT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export type AllowedReceiptMime = (typeof ALLOWED_RECEIPT_MIME_TYPES)[number];

export interface TransactionReceipt {
  id: string;
  transaction_id: number;
  group_id: string;
  storage_path: string;
  content_type: string;
  byte_size?: number | null;
  sort_order?: number;
  created_at?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAllowedReceiptMime(value: string | null | undefined): value is AllowedReceiptMime {
  return !!value && (ALLOWED_RECEIPT_MIME_TYPES as readonly string[]).includes(value);
}

export function receiptFileExtension(mime: string): "jpg" | "png" | "webp" {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

export function receiptObjectPath(
  groupId: string,
  transactionId: number,
  receiptId: string,
  mime = "image/jpeg",
): string {
  if (!UUID.test(groupId) || !UUID.test(receiptId) || !Number.isInteger(transactionId) || transactionId <= 0) {
    throw new Error("Invalid receipt path parts");
  }
  return `${groupId}/${transactionId}/${receiptId}.${receiptFileExtension(mime)}`;
}

export function canAddReceipts(currentCount: number, incomingCount = 1): boolean {
  return currentCount + incomingCount <= MAX_EXPENSE_RECEIPTS;
}

export function newReceiptId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function resizeForReceipt(width?: number | null, height?: number | null): { width: number } | null {
  const w = width ?? 0;
  const h = height ?? 0;
  const edge = Math.max(w, h);
  if (edge <= EXPENSE_RECEIPT_MAX_EDGE || edge <= 0) return null;
  if (w >= h) return { width: EXPENSE_RECEIPT_MAX_EDGE };
  return { width: Math.max(1, Math.round((EXPENSE_RECEIPT_MAX_EDGE * w) / h)) };
}

export function normalizeTransactionReceipts(value: unknown): TransactionReceipt[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is TransactionReceipt => (
    !!item
    && typeof item === "object"
    && typeof (item as TransactionReceipt).id === "string"
    && typeof (item as TransactionReceipt).storage_path === "string"
    && typeof (item as TransactionReceipt).group_id === "string"
    && typeof (item as TransactionReceipt).transaction_id === "number"
  )).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.created_at || "").localeCompare(b.created_at || ""));
}

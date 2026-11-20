import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "../supabase";
import {
  EXPENSE_RECEIPT_BUCKET,
  EXPENSE_RECEIPT_JPEG_QUALITY,
  EXPENSE_RECEIPT_SIGNED_URL_TTL_SEC,
  MAX_EXPENSE_RECEIPT_BYTES,
  newReceiptId,
  receiptObjectPath,
  resizeForReceipt,
  type TransactionReceipt,
} from "./expenseReceipts";

export type LocalReceiptDraft = {
  kind: "local";
  id: string;
  uri: string;
  mimeType: string;
};

export type SavedReceiptDraft = {
  kind: "saved";
  receipt: TransactionReceipt;
};

export type ReceiptDraft = LocalReceiptDraft | SavedReceiptDraft;

export async function pickExpenseReceipts(source: "camera" | "library"): Promise<LocalReceiptDraft[]> {
  const permission = source === "camera"
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error(
      source === "camera"
        ? "Camera permission is required to photograph a receipt."
        : "Photo library permission is required to attach a receipt.",
    );
  }

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    quality: 1,
    allowsMultipleSelection: source === "library",
    selectionLimit: 8,
    exif: false,
  };
  const result = source === "camera"
    ? await ImagePicker.launchCameraAsync(options)
    : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return [];

  const drafts: LocalReceiptDraft[] = [];
  for (const asset of result.assets || []) {
    if (!asset.uri) continue;
    const compressed = await compressReceiptAsset(asset);
    drafts.push({
      kind: "local",
      id: newReceiptId(),
      uri: compressed.uri,
      mimeType: compressed.mimeType,
    });
  }
  return drafts;
}

async function compressReceiptAsset(asset: ImagePicker.ImagePickerAsset): Promise<{ uri: string; mimeType: string }> {
  const resize = resizeForReceipt(asset.width, asset.height);
  const actions = resize ? [{ resize }] : [];
  const result = await ImageManipulator.manipulateAsync(
    asset.uri,
    actions,
    { compress: EXPENSE_RECEIPT_JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
  );
  return { uri: result.uri, mimeType: "image/jpeg" };
}

export async function createReceiptSignedUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(EXPENSE_RECEIPT_BUCKET)
    .createSignedUrl(storagePath, EXPENSE_RECEIPT_SIGNED_URL_TTL_SEC);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

export async function uploadLocalReceipt(params: {
  groupId: string;
  transactionId: number;
  draft: LocalReceiptDraft;
  sortOrder: number;
}): Promise<TransactionReceipt> {
  const path = receiptObjectPath(params.groupId, params.transactionId, params.draft.id, params.draft.mimeType);
  const body = await readUriAsArrayBuffer(params.draft.uri);
  if (body.byteLength > MAX_EXPENSE_RECEIPT_BYTES) {
    throw new Error("That photo is too large. Try another or take a closer crop.");
  }

  const { error: uploadError } = await supabase.storage
    .from(EXPENSE_RECEIPT_BUCKET)
    .upload(path, body, { contentType: "image/jpeg", upsert: false });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from("transaction_receipts")
    .insert({
      id: params.draft.id,
      transaction_id: params.transactionId,
      group_id: params.groupId,
      storage_path: path,
      content_type: "image/jpeg",
      byte_size: body.byteLength,
      sort_order: params.sortOrder,
      created_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    })
    .select("id, transaction_id, group_id, storage_path, content_type, byte_size, sort_order, created_at")
    .single();

  if (error || !data) {
    await supabase.storage.from(EXPENSE_RECEIPT_BUCKET).remove([path]).catch(() => undefined);
    throw error || new Error("Failed to save receipt");
  }
  return data as TransactionReceipt;
}

export async function deleteSavedReceipt(receiptId: string): Promise<void> {
  const { error } = await supabase.from("transaction_receipts").delete().eq("id", receiptId);
  if (error) throw error;
}

export async function syncExpenseReceipts(params: {
  groupId: string;
  transactionId: number;
  drafts: ReceiptDraft[];
  removedIds: string[];
}): Promise<TransactionReceipt[]> {
  for (const receiptId of params.removedIds) {
    await deleteSavedReceipt(receiptId);
  }

  const saved: TransactionReceipt[] = [];
  let sortOrder = 0;
  for (const draft of params.drafts) {
    if (draft.kind === "saved") {
      saved.push(draft.receipt);
      sortOrder += 1;
      continue;
    }
    saved.push(await uploadLocalReceipt({
      groupId: params.groupId,
      transactionId: params.transactionId,
      draft,
      sortOrder,
    }));
    sortOrder += 1;
  }
  return saved;
}

async function readUriAsArrayBuffer(uri: string): Promise<ArrayBuffer> {
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error("Could not read the selected photo.");
  }
  return response.arrayBuffer();
}

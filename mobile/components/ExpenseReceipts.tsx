import { Image } from "expo-image";
import React, { useEffect, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { IconButton, Text, useTheme } from "react-native-paper";
import {
  canAddReceipts,
  MAX_EXPENSE_RECEIPTS,
  type TransactionReceipt,
} from "../utils/expenseReceipts";
import {
  createReceiptSignedUrl,
  pickExpenseReceipts,
  type ReceiptDraft,
} from "../utils/expenseReceiptActions";

export function ExpenseReceiptEditor({
  drafts,
  disabled,
  onChange,
}: {
  drafts: ReceiptDraft[];
  disabled?: boolean;
  onChange: (drafts: ReceiptDraft[]) => void;
}) {
  const theme = useTheme();
  const canAdd = !disabled && canAddReceipts(drafts.length, 1);

  const addFrom = (source: "camera" | "library") => {
    void (async () => {
      try {
        const picked = await pickExpenseReceipts(source);
        if (picked.length === 0) return;
        const remaining = MAX_EXPENSE_RECEIPTS - drafts.length;
        onChange([...drafts, ...picked.slice(0, remaining)]);
      } catch (error) {
        Alert.alert(
          "Couldn’t add receipt",
          error instanceof Error ? error.message : "Please try again.",
        );
      }
    })();
  };

  return (
    <View testID="expense-receipts-editor">
      <View style={styles.headerRow}>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          Receipts
        </Text>
        <View style={styles.headerActions}>
          <IconButton
            icon="camera-outline"
            size={20}
            disabled={!canAdd}
            accessibilityLabel="Photograph a receipt"
            testID="receipt-add-camera"
            onPress={() => addFrom("camera")}
          />
          <IconButton
            icon="image-plus-outline"
            size={20}
            disabled={!canAdd}
            accessibilityLabel="Choose receipt photos"
            testID="receipt-add-library"
            onPress={() => addFrom("library")}
          />
        </View>
      </View>
      {drafts.length === 0 ? (
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          Attach photos from the camera or your library. They stay private to the group.
        </Text>
      ) : (
        <ReceiptThumbnailRow
          items={drafts.map((draft) => ({
            key: draft.kind === "saved" ? draft.receipt.id : draft.id,
            previewUri: draft.kind === "local" ? draft.uri : null,
            receipt: draft.kind === "saved" ? draft.receipt : null,
            onRemove: disabled
              ? undefined
              : () => onChange(drafts.filter((item) => item !== draft)),
          }))}
        />
      )}
    </View>
  );
}

export function ExpenseReceiptGallery({ receipts }: { receipts: TransactionReceipt[] }) {
  if (receipts.length === 0) return null;
  return (
    <View testID="expense-receipt-gallery" style={styles.gallery}>
      <ReceiptThumbnailRow
        items={receipts.map((receipt) => ({
          key: receipt.id,
          previewUri: null,
          receipt,
        }))}
      />
    </View>
  );
}

function ReceiptThumbnailRow({
  items,
}: {
  items: Array<{
    key: string;
    previewUri: string | null;
    receipt: TransactionReceipt | null;
    onRemove?: () => void;
  }>;
}) {
  const [openUri, setOpenUri] = useState<string | null>(null);

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.map((item) => (
          <ReceiptThumb
            key={item.key}
            previewUri={item.previewUri}
            receipt={item.receipt}
            onRemove={item.onRemove}
            onOpen={setOpenUri}
          />
        ))}
      </ScrollView>
      <Modal visible={!!openUri} transparent animationType="fade" onRequestClose={() => setOpenUri(null)}>
        <Pressable style={styles.lightbox} onPress={() => setOpenUri(null)} testID="receipt-lightbox">
          {openUri ? (
            <Image
              source={{ uri: openUri }}
              style={styles.fullImage}
              contentFit="contain"
              accessibilityLabel="Receipt photo"
            />
          ) : null}
        </Pressable>
      </Modal>
    </>
  );
}

function ReceiptThumb({
  previewUri,
  receipt,
  onRemove,
  onOpen,
}: {
  previewUri: string | null;
  receipt: TransactionReceipt | null;
  onRemove?: () => void;
  onOpen: (uri: string) => void;
}) {
  const theme = useTheme();
  const [uri, setUri] = useState<string | null>(previewUri);

  useEffect(() => {
    if (previewUri) {
      setUri(previewUri);
      return;
    }
    if (!receipt) return;
    let cancelled = false;
    void createReceiptSignedUrl(receipt.storage_path)
      .then((signed) => {
        if (!cancelled) setUri(signed);
      })
      .catch(() => {
        if (!cancelled) setUri(null);
      });
    return () => {
      cancelled = true;
    };
  }, [previewUri, receipt]);

  return (
    <View style={styles.thumbWrap}>
      <Pressable
        onPress={() => {
          if (uri) onOpen(uri);
        }}
        accessibilityRole="imagebutton"
        accessibilityLabel="View receipt"
        testID={`receipt-thumb-${receipt?.id || "local"}`}
        style={[styles.thumb, { backgroundColor: theme.colors.surfaceVariant }]}
      >
        {uri ? (
          <Image source={{ uri }} style={styles.thumbImage} contentFit="cover" />
        ) : (
          <Text variant="bodySmall">…</Text>
        )}
      </Pressable>
      {onRemove ? (
        <IconButton
          icon="close-circle"
          size={18}
          style={styles.remove}
          iconColor={theme.colors.onSurface}
          accessibilityLabel="Remove receipt"
          onPress={onRemove}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerActions: { flexDirection: "row" },
  gallery: { marginTop: 28 },
  row: { gap: 8, paddingVertical: 4 },
  thumbWrap: { width: 72, height: 72 },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: 8,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbImage: { width: "100%", height: "100%" },
  remove: { position: "absolute", top: -12, right: -12, margin: 0 },
  lightbox: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  fullImage: { width: "100%", height: "100%" },
});

import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { toQR } from "toqr";

type UpiQrCodeProps = {
  /** Full `upi://pay?…` URI encoded into the QR. */
  value: string;
  /** Outer size in px; Design asks for 160 or larger. */
  size?: number;
  testID?: string;
};

/**
 * Quiet QR for desktop-web settle handoff. Uses tiny `toqr` (already in the
 * Expo tree) as a light encoder; renders a View matrix (no heavy QR package).
 */
export function UpiQrCode({
  value,
  size = 160,
  testID = "settlement-upi-qr",
}: UpiQrCodeProps) {
  const modules = useMemo(() => {
    try {
      return toQR(value);
    } catch {
      return null;
    }
  }, [value]);

  if (!modules || modules.length === 0) return null;

  const dim = Math.round(Math.sqrt(modules.length));
  if (dim * dim !== modules.length || dim < 1) return null;

  const cell = size / dim;
  const rows: React.ReactNode[] = [];
  for (let y = 0; y < dim; y += 1) {
    const cells: React.ReactNode[] = [];
    for (let x = 0; x < dim; x += 1) {
      const on = modules[y * dim + x] === 1;
      cells.push(
        <View
          key={`${x}-${y}`}
          style={{
            width: cell,
            height: cell,
            backgroundColor: on ? "#111111" : "#FFFFFF",
          }}
        />,
      );
    }
    rows.push(
      <View key={`r-${y}`} style={styles.row}>
        {cells}
      </View>,
    );
  }

  return (
    <View
      testID={testID}
      accessibilityLabel="UPI payment QR code"
      style={[
        styles.frame,
        {
          width: size,
          height: size,
        },
      ]}
    >
      {rows}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.18)",
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
  },
});

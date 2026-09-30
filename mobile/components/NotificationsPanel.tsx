import React from "react";
import { Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import { Surface, useTheme } from "react-native-paper";

interface NotificationsPanelProps {
  visible: boolean;
  onDismiss: () => void;
  children: React.ReactNode;
}

const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function NotificationsPanel({
  visible,
  onDismiss,
  children,
}: NotificationsPanelProps) {
  const theme = useTheme();
  const panelRef = React.useRef<View>(null);

  React.useEffect(() => {
    if (!visible || Platform.OS !== "web" || typeof document === "undefined") return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current as unknown as HTMLElement | null;

    const focusFirst = () => {
      const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel)?.focus?.();
    };
    const frame = requestAnimationFrame(focusFirst);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onDismiss, visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      <View style={styles.overlay} accessibilityViewIsModal>
        <Pressable
          style={styles.scrim}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Close notifications"
        />
        <Surface
          ref={panelRef}
          elevation={5}
          style={[styles.panel, { backgroundColor: theme.colors.surface }]}
          tabIndex={-1}
          role="dialog"
          aria-modal
          aria-label="Notifications"
        >
          {children}
        </Surface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(23, 32, 42, 0.42)",
  },
  panel: {
    width: 460,
    maxWidth: "100%",
    height: "100%",
    overflow: "hidden",
  },
});

import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { OnboardingItem, fetchOnboardingTemplate, upsertInventoryItem } from "../api";
import { getItemIcon } from "../icons";

interface Props {
  onComplete: () => void;
}

interface SelectedItem extends OnboardingItem {
  desired: string;
  current: string;
  restock: string;
  daysSincePurchase: string;
}

type Phase = "landing" | "loading" | "wizard" | "summary" | "review_selected" | "review_skipped" | "saving";

export default function OnboardingWizardScreen({ onComplete }: Props) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>("landing");
  const [items, setItems] = useState<OnboardingItem[]>([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<SelectedItem[]>([]);
  const [skipped, setSkipped] = useState<OnboardingItem[]>([]);
  const [hasReachedSummary, setHasReachedSummary] = useState(false);

  // Per-item form state
  const [desired, setDesired] = useState("1");
  const [current, setCurrent] = useState("0");
  const [restock, setRestock] = useState("7");
  const [daysSincePurchase, setDaysSincePurchase] = useState("7");

  const desiredRef = useRef<TextInput>(null);

  const startWizard = () => {
    setPhase("loading");
    fetchOnboardingTemplate().then((data) => {
      if (!data.length) {
        onComplete();
        return;
      }
      setItems(data);
      setPhase("wizard");
    });
  };

  const resetForm = () => {
    setDesired("1");
    setCurrent("0");
    setRestock("7");
    setDaysSincePurchase("7");
  };

  const currentItem = items[index];

  const handleInclude = useCallback(() => {
    const d = Math.max(1, parseInt(desired) || 1);
    const c = Math.max(0, parseInt(current) || 0);
    const r = Math.max(1, parseInt(restock) || 7);
    const dsp = Math.max(0, parseInt(daysSincePurchase) || 7);
    setSelected((prev) => [
      ...prev,
      { ...currentItem, desired: String(d), current: String(c), restock: String(r), daysSincePurchase: String(dsp) },
    ]);
    if (index + 1 >= items.length) {
      setHasReachedSummary(true);
      setPhase("summary");
    } else {
      setIndex((i) => i + 1);
      resetForm();
    }
  }, [currentItem, desired, current, restock, daysSincePurchase, index, items.length]);

  const handleSkip = useCallback(() => {
    setSkipped((prev) => [...prev, currentItem]);
    if (index + 1 >= items.length) {
      setHasReachedSummary(true);
      setPhase("summary");
    } else {
      setIndex((i) => i + 1);
      resetForm();
    }
  }, [currentItem, index, items.length]);

  const handleAddToInventory = async () => {
    setPhase("saving");
    try {
      for (const item of selected) {
        const dsp = parseInt(item.daysSincePurchase) || 7;
        const lastPurchased = new Date();
        lastPurchased.setDate(lastPurchased.getDate() - dsp);
        const lastPurchasedStr = lastPurchased.toISOString().split("T")[0];
        await upsertInventoryItem({
          item_name: item.item_name,
          unit: "",
          current_quantity: parseInt(item.current) || 0,
          desired_quantity: parseInt(item.desired) || 1,
          days_until_restock: parseInt(item.restock) || 7,
          last_purchased_date: lastPurchasedStr,
        });
      }
      onComplete();
    } catch {
      Alert.alert("שגיאה", "לא ניתן לשמור פריטים. נסה שוב.");
      setPhase("review_selected");
    }
  };

  // ── Landing ──────────────────────────────────────────────────────────────────
  if (phase === "landing") {
    return (
      <View style={{ flex: 1, backgroundColor: "#f0f8ff" }}>
        <View style={[styles.headerBar, { paddingTop: insets.top }]} />
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 32 }}>
          <Image source={require("../../assets/icon.png")} style={styles.landingIcon} />
          <Text style={styles.landingTitle}>ברוכים הבאים לסלבדור{"\n"}עוזר הקניות האישי שלכם</Text>
          <Text style={styles.landingBody}>
            בשלב הראשון נגדיר מוצרי מלאי בסיסיים.
          </Text>
          <Text style={styles.landingBody}>
            אל דאגה! בהמשך תוכלו להוסיף, להוריד ולערוך פרטי מלאי וכמויות.
          </Text>
          <Text style={styles.landingNote}>
            בכל שלב תוכל לצאת מהתהליך ולהשלימו ידנית מאוחר יותר בלשונית &apos;מלאי&apos;
          </Text>
          <TouchableOpacity style={styles.landingBtn} onPress={startWizard}>
            <Text style={styles.landingBtnText}>הגדר מלאי</Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.footerBar, { paddingBottom: insets.bottom + 12 }]} />
      </View>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (phase === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0262A0" />
      </View>
    );
  }

  // ── Saving ───────────────────────────────────────────────────────────────────
  if (phase === "saving") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0262A0" />
        <Text style={{ marginTop: 16, color: "#555" }}>שומר פריטים...</Text>
      </View>
    );
  }

  // ── Summary ───────────────────────────────────────────────────────────────────
  if (phase === "summary") {
    const handleRevisitSkipped = () => {
      setItems(skipped);
      setSkipped([]);
      setIndex(0);
      resetForm();
      setPhase("wizard");
    };

    return (
      <View style={styles.container}>
        <Text style={styles.summaryTitle}>סיימת לעבור על הפריטים!</Text>
        <Text style={styles.summarySubtitle}>
          נבחרו {selected.length} פריטים, לא נבחרו {skipped.length} פריטים
        </Text>
        <View style={styles.summaryBtns}>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => setPhase("review_selected")}>
            <Text style={styles.primaryBtnText}>הצג פריטים שנבחרו ({selected.length})</Text>
          </TouchableOpacity>
          {skipped.length > 0 && (
            <TouchableOpacity style={styles.secondaryBtn} onPress={handleRevisitSkipped}>
              <Text style={styles.secondaryBtnText}>חזור אל פריטים שלא נבחרו ({skipped.length})</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.exitBtn} onPress={onComplete}>
            <Text style={styles.exitBtnText}>צא מהאשף</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Review skipped ────────────────────────────────────────────────────────────
  if (phase === "review_skipped") {
    return (
      <View style={styles.container}>
        <Text style={styles.reviewTitle}>פריטים שדולגו</Text>
        <FlatList
          data={skipped}
          keyExtractor={(item) => item.item_name}
          style={{ flex: 1, width: "100%" }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.reviewRow}
              onPress={() => {
                // Move from skipped to end of remaining items to re-visit
                setSkipped((prev) => prev.filter((s) => s.item_name !== item.item_name));
                setItems((prev) => [...prev, item]);
                if (phase === "review_skipped") setPhase("review_skipped");
              }}
            >
              <Text style={styles.reviewRowText}>
                {getItemIcon(item.item_name)} {item.item_name}
              </Text>
              <Text style={styles.reviewRowCategory}>{item.category}</Text>
            </TouchableOpacity>
          )}
        />
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => setPhase("summary")}>
          <Text style={styles.secondaryBtnText}>חזור</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Review selected ───────────────────────────────────────────────────────────
  if (phase === "review_selected") {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
        <Text style={styles.reviewTitle}>פריטים שנבחרו ({selected.length})</Text>
        <FlatList
          data={selected}
          keyExtractor={(item) => item.item_name}
          style={{ flex: 1, width: "100%" }}
          renderItem={({ item }) => (
            <View style={styles.reviewRow}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={styles.reviewRowText}>
                  {getItemIcon(item.item_name)} {item.item_name}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setSelected((prev) => prev.filter((s) => s.item_name !== item.item_name));
                    setSkipped((prev) => [...prev, item]);
                  }}
                  style={styles.removeBtn}
                >
                  <Text style={styles.removeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.reviewRowMeta}>כמות רצויה: {item.desired} · כמות קיימת: {item.current}</Text>
              <Text style={styles.reviewRowMeta}>לרכישה כל {item.restock} ימים · נרכש לפני {item.daysSincePurchase} ימים</Text>
            </View>
          )}
        />
        <View style={{ width: "100%", gap: 12, marginTop: 12 }}>
          <TouchableOpacity style={styles.primaryBtn} onPress={handleAddToInventory}>
            <Text style={styles.primaryBtnText}>הוסף {selected.length} פריטים למלאי</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => setPhase("summary")}>
            <Text style={styles.secondaryBtnText}>חזור</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Wizard (item by item) ─────────────────────────────────────────────────────
  const icon = getItemIcon(currentItem.item_name);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      {/* Blue top header bar */}
      <View style={[styles.headerBar, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.headerTitle}>הגדרת מלאי ראשוני</Text>
      </View>

      <ScrollView contentContainerStyle={styles.wizardContainer} keyboardShouldPersistTaps="handled">
        {/* Progress */}
        <Text style={styles.progress}>{`פריט ${index + 1} מתוך ${items.length}`}</Text>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${((index + 1) / items.length) * 100}%` }]} />
        </View>

        {/* Category */}
        <Text style={styles.category}>{currentItem.category}</Text>

        {/* Item */}
        <Text style={styles.itemIcon}>{icon || "🛒"}</Text>
        <Text style={styles.itemName}>{currentItem.item_name}</Text>

        {/* Inputs */}
        <View style={styles.inputs}>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>כמות רצויה</Text>
            <TextInput
              ref={desiredRef}
              style={styles.input}
              value={desired}
              onChangeText={setDesired}
              keyboardType="numeric"
              selectTextOnFocus
            />
          </View>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>כמות קיימת</Text>
            <TextInput
              style={styles.input}
              value={current}
              onChangeText={setCurrent}
              keyboardType="numeric"
              selectTextOnFocus
            />
          </View>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>לרכישה כל X ימים</Text>
            <TextInput
              style={styles.input}
              value={restock}
              onChangeText={setRestock}
              keyboardType="numeric"
              selectTextOnFocus
            />
          </View>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>נרכש לאחרונה לפני X ימים</Text>
            <TextInput
              style={styles.input}
              value={daysSincePurchase}
              onChangeText={setDaysSincePurchase}
              keyboardType="numeric"
              selectTextOnFocus
            />
          </View>
        </View>

        {/* Buttons */}
        <View style={styles.actionBtns}>
          <TouchableOpacity style={styles.skipItemBtn} onPress={handleSkip}>
            <Text style={styles.skipItemBtnText}>אל תכלול במלאי</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.includeBtn} onPress={handleInclude}>
            <Text style={styles.includeBtnText}>כלול במלאי</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Blue bottom bar with exit button */}
      <View style={[styles.footerBar, { paddingBottom: insets.bottom + 12 }]}>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <TouchableOpacity style={styles.backBtn} onPress={() => {
            if (hasReachedSummary) {
              // Push unprocessed items back into skipped before returning to summary
              setSkipped((prev) => [...prev, ...items.slice(index)]);
              setPhase("summary");
            } else {
              setPhase("landing");
            }
          }}>
            <Text style={styles.backBtnText}>חזור</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.exitBtn, { flex: 1 }]} onPress={onComplete}>
            <Text style={styles.exitBtnText}>צא מהאשף</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f0f8ff", alignItems: "center", justifyContent: "center", padding: 24 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f0f8ff" },
  wizardContainer: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#f0f8ff" },

  headerBar: {
    backgroundColor: "#0262A0",
    width: "100%",
    paddingVertical: 16,
    alignItems: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },

  footerBar: {
    backgroundColor: "#0262A0",
    width: "100%",
    paddingVertical: 12,
    paddingHorizontal: 24,
    elevation: 8,
    shadowColor: "#0262A0",
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },

  progress: { fontSize: 13, color: "#888", marginBottom: 6, width: "100%", textAlign: "center" },
  progressBar: { width: "100%", height: 4, backgroundColor: "#dce8f5", borderRadius: 2, marginBottom: 24 },
  progressFill: { height: 4, backgroundColor: "#0262A0", borderRadius: 2 },

  category: { fontSize: 16, color: "#0262A0", fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 },
  itemIcon: { fontSize: 64, marginBottom: 8 },
  itemName: { fontSize: 26, fontWeight: "800", color: "#1a1a1a", textAlign: "center", marginBottom: 28 },

  inputs: { flexDirection: "column", gap: 12, marginBottom: 32, width: "100%" },
  inputGroup: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  inputLabel: { fontSize: 15, color: "#444", fontWeight: "600", flex: 1, textAlign: "left" },
  input: {
    width: 80,
    borderWidth: 2,
    borderColor: "#b3d4ef",
    borderRadius: 10,
    padding: 10,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
    backgroundColor: "#fff",
    color: "#0262A0",
    marginStart: 12,
  },

  actionBtns: { flexDirection: "row", gap: 12, width: "100%", marginBottom: 16 },
  skipItemBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "#ffebee",
    borderWidth: 2,
    borderColor: "#ef9a9a",
  },
  skipItemBtnText: { fontSize: 14, color: "#c62828", fontWeight: "600" },
  includeBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "#0262A0",
    elevation: 3,
  },
  includeBtnText: { fontSize: 16, color: "#fff", fontWeight: "700" },

  backBtn: {
    flex: 1,
    backgroundColor: "#ffebee",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#ef9a9a",
  },
  backBtnText: { color: "#c62828", fontSize: 16, fontWeight: "700" },

  exitBtn: {
    backgroundColor: "#e53935",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    width: "100%",
    elevation: 3,
  },
  exitBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },

  summaryTitle: { fontSize: 24, fontWeight: "800", color: "#1a1a1a", textAlign: "center", marginBottom: 8 },
  summarySubtitle: { fontSize: 15, color: "#666", textAlign: "center", marginBottom: 32 },
  summaryBtns: { width: "100%", gap: 14 },

  reviewTitle: { fontSize: 20, fontWeight: "800", color: "#1a1a1a", marginBottom: 16, textAlign: "center" },
  reviewRow: { width: "100%", backgroundColor: "#fff", borderRadius: 10, padding: 14, marginBottom: 8, elevation: 1 },
  removeBtn: { width: 28, height: 28, alignItems: "center", justifyContent: "center", marginStart: 8 },
  removeBtnText: { color: "#e53935", fontSize: 16, fontWeight: "700" },
  reviewRowText: { fontSize: 16, fontWeight: "700", color: "#1a1a1a" },
  reviewRowCategory: { fontSize: 13, color: "#888", marginTop: 2 },
  reviewRowMeta: { fontSize: 13, color: "#0262A0", marginTop: 4 },

  primaryBtn: { backgroundColor: "#0262A0", paddingVertical: 16, borderRadius: 12, alignItems: "center", width: "100%", elevation: 3 },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  secondaryBtn: { backgroundColor: "#fff", paddingVertical: 14, borderRadius: 12, alignItems: "center", borderWidth: 2, borderColor: "#0262A0", width: "100%" },
  secondaryBtnText: { color: "#0262A0", fontSize: 16, fontWeight: "700" },
  skipBtn: { paddingVertical: 10, alignItems: "center" },
  skipBtnText: { color: "#aaa", fontSize: 14 },

  landingIcon: { width: 100, height: 100, borderRadius: 20, marginBottom: 20 },
  landingEmoji: { fontSize: 72, marginBottom: 16 },
  landingTitle: { fontSize: 22, fontWeight: "800", color: "#0262A0", textAlign: "center", marginBottom: 24 },
  landingBody: { fontSize: 16, color: "#333", textAlign: "center", marginBottom: 12, lineHeight: 24 },
  landingNote: { fontSize: 13, color: "#888", textAlign: "center", marginBottom: 36, lineHeight: 20 },
  landingBtn: {
    backgroundColor: "#0262A0",
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 12,
    alignItems: "center",
    width: "100%",
    marginBottom: 16,
    elevation: 3,
  },
  landingBtnText: { color: "#fff", fontSize: 18, fontWeight: "700" },
});

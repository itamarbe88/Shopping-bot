import { useFocusEffect, useNavigation } from "@react-navigation/native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { InventoryItem, fetchInventory, deleteInventoryItem, upsertInventoryItem } from "../api";
import { getItemIcon } from "../icons";

const BLUE = "#0288D1";

export default function InventoryScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editCurrent, setEditCurrent] = useState("");
  const [editDesired, setEditDesired] = useState("");
  const [editDays, setEditDays] = useState("");
  const [editDate, setEditDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  const [addVisible, setAddVisible] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCurrent, setNewCurrent] = useState("");
  const [newDesired, setNewDesired] = useState("");
  const [newDays, setNewDays] = useState("");
  const [newDate, setNewDate] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => setKeyboardOffset(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardOffset(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showShortagesOnly, setShowShortagesOnly] = useState(false);
  const [sortByLastPurchased, setSortByLastPurchased] = useState(false);

  const onSearchChange = (text: string) => {
    setSearchInput(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearchQuery(text), 400);
  };

    const calculateDaysAgo = (dateValue: string | number | Date): number => {
    const now = new Date();
    const date = new Date(dateValue);
    const diffInMs = now.getTime() - date.getTime();
    const days = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
    
    return Math.abs(days);
  };

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchInventory();
      setItems(data);
    } catch {
      setError("לא ניתן להתחבר לשרת. האם הוא פועל?");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    const displayCount = items
      .filter((i) => {
        if (showShortagesOnly) return i.type === "" && parseFloat(i.current_quantity) < parseFloat(i.desired_quantity);
        return i.type === "";
      })
      .filter((i) => {
        if (!searchQuery.trim()) return true;
        const pattern = searchQuery.trim().replace(/\*/g, ".*");
        try { return new RegExp(pattern, "i").test(i.item_name); }
        catch { return i.item_name.includes(searchQuery.trim()); }
      }).length;
    navigation.setOptions({
      headerTitle: `מלאי הבית (${displayCount})`,
      headerLeft: () => (
        <TouchableOpacity onPress={load} style={{ marginHorizontal: 16, padding: 6 }}>
          <Text style={{ color: "#fff", fontSize: 28 }}>↻</Text>
        </TouchableOpacity>
      ),
      headerRight: () => (
        <View style={{ flexDirection: "row", alignItems: "center", marginHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.4)", overflow: "hidden" }}>
          {[{ label: "נרכש", value: true }, { label: "הבאה", value: false }].map(({ label, value }) => (
            <TouchableOpacity
              key={label}
              onPress={() => setSortByLastPurchased(value)}
              style={{
                backgroundColor: sortByLastPurchased === value ? "rgba(255,255,255,0.9)" : "transparent",
                paddingHorizontal: 10,
                paddingVertical: 5,
              }}
            >
              <Text style={{ color: sortByLastPurchased === value ? "#0262A0" : "#fff", fontSize: 14, fontWeight: "700" }}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ),
    });
  }, [navigation, load, showShortagesOnly, sortByLastPurchased, items, searchQuery]);

  const openEdit = (item: InventoryItem) => {
    setEditItem(item);
    setEditName(item.item_name);
    setEditCurrent(item.current_quantity);
    setEditDesired(item.desired_quantity);
    setEditDays(item.days_until_restock);
    setEditDate(item.last_purchased_date);
  };

  const handleDelete = async () => {
    if (!editItem) return;
    Alert.alert("מחיקה", `למחוק את "${editItem.item_name}"?`, [
      { text: "ביטול", style: "cancel" },
      {
        text: "מחק", style: "destructive", onPress: async () => {
          try {
            await deleteInventoryItem(editItem.item_name);
            setEditItem(null);
            load();
          } catch {
            Alert.alert("שגיאה", "לא ניתן למחוק.");
          }
        }
      }
    ]);
  };

  const handleSave = async () => {
    if (!editName.trim()) { Alert.alert("שגיאה", "שם הפריט לא יכול להיות ריק."); return; }
    if (!editDesired.trim()) { Alert.alert("שגיאה", "יש להזין כמות רצויה."); return; }
    if (!editDays.trim()) { Alert.alert("שגיאה", "יש להזין תדירות רכישה בימים."); return; }
    setSaving(true);
    try {
      if (editItem && editName.trim() !== editItem.item_name) {
        await deleteInventoryItem(editItem.item_name);
      }
      await upsertInventoryItem({
        item_name: editName.trim(),
        unit: editItem?.unit ?? "",
        current_quantity: parseFloat(editCurrent) || 0,
        desired_quantity: parseFloat(editDesired) || 0,
        days_until_restock: parseInt(editDays) || 7,
        last_purchased_date: editDate || undefined,
      });
      setEditItem(null);
      load();
    } catch {
      Alert.alert("שגיאה", "לא ניתן לשמור.");
    } finally {
      setSaving(false);
    }
  };

  const openAdd = () => {
    const today = new Date().toISOString().split("T")[0];
    setNewName(""); setNewCurrent(""); setNewDesired(""); setNewDays(""); setNewDate("0");
    setAddVisible(true);
  };

  const handleAdd = async () => {
    if (!newName.trim()) { Alert.alert("שגיאה", "שם הפריט לא יכול להיות ריק."); return; }
    const exists = items.some(i => i.item_name.trim() === newName.trim());
    if (exists) { Alert.alert("שגיאה", `הפריט "${newName.trim()}" כבר קיים במלאי.`); return; }
    if (!newDesired.trim()) { Alert.alert("שגיאה", "יש להזין כמות רצויה."); return; }
    if (!newDays.trim()) { Alert.alert("שגיאה", "יש להזין תדירות רכישה בימים."); return; }
    const daysAgo = parseInt(newDate) || 0;
    const lastDate = new Date();
    lastDate.setDate(lastDate.getDate() - daysAgo);
    const lastDateStr = lastDate.toISOString().split("T")[0];
    setAdding(true);
    try {
      await upsertInventoryItem({
        item_name: newName.trim(),
        unit: "",
        current_quantity: parseFloat(newCurrent) || 0,
        desired_quantity: parseFloat(newDesired) || 0,
        days_until_restock: parseInt(newDays) || 7,
        last_purchased_date: lastDateStr,
      });
      setAddVisible(false);
      load();
    } catch {
      Alert.alert("שגיאה", "לא ניתן להוסיף פריט.");
    } finally {
      setAdding(false);
    }
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={BLUE} /></View>;
  }

  if (error) {
    return <View style={styles.center}><Text style={styles.error}>{error}</Text></View>;
  }

  const filteredItems = items
    .filter((item) => {
      if (showShortagesOnly) {
        return item.type == "" && parseFloat(item.current_quantity) < parseFloat(item.desired_quantity);
      }
      return item.type == "";
    })
    .filter((item) => {
      if (!searchQuery.trim()) return true;
      const pattern = searchQuery.trim().replace(/\*/g, ".*");
      try {
        return new RegExp(pattern, "i").test(item.item_name);
      } catch {
        return item.item_name.includes(searchQuery.trim());
      }
    })
    .sort((a, b) => {
      if (sortByLastPurchased) {
        const toMs = (d: string | undefined) => {
          if (!d || d === "unknown") return -Infinity;
          const ms = new Date(d).getTime();
          return isNaN(ms) ? -Infinity : ms;
        };
        const da = toMs(a.last_purchased_date);
        const db = toMs(b.last_purchased_date);
        if (da !== db) return db - da; // most recently purchased first
        return a.item_name.localeCompare(b.item_name, "he");
      } else {
        const toMs = (d: string | undefined) => {
          if (!d || d === "unknown") return Infinity;
          if (d === "needed now") return -Infinity;
          const ms = new Date(d).getTime();
          return isNaN(ms) ? Infinity : ms;
        };
        const da = toMs(a.next_purchase_date);
        const db = toMs(b.next_purchase_date);
        if (da !== db) return da - db;
        return a.item_name.localeCompare(b.item_name, "he");
      }
    });

  const highlightName = (name: string) => {
    const q = searchQuery.trim();
    if (!q) return <Text style={styles.itemName}>{name} {getItemIcon(name)}</Text>;
    let regex: RegExp;
    try { regex = new RegExp(`(${q.replace(/\*/g, ".*")})`, "gi"); }
    catch { regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"); }
    const parts = name.split(regex);
    return (
      <Text style={styles.itemName}>
        {parts.map((p, i) =>
          regex.test(p)
            ? <Text key={i} style={{ color: "#e53935" }}>{p}</Text>
            : p
        )} {getItemIcon(name)}
      </Text>
    );
  };

  const renderItem = ({ item }: { item: InventoryItem }) => {
    const current = parseFloat(item.current_quantity);
    const desired = parseFloat(item.desired_quantity);
    const needsRestock = current < desired;
    const isManual = item.type === "manual";
    const isOverdue = !needsRestock && !isManual && !!item.next_purchase_date &&
      item.next_purchase_date !== "unknown" && item.next_purchase_date !== "needed now" &&
      new Date(item.next_purchase_date) <= new Date();

    return (
      <TouchableOpacity onPress={() => openEdit(item)} activeOpacity={0.75}>
        <View style={[styles.card, isManual ? styles.cardManual : needsRestock ? styles.cardAlert : isOverdue && styles.cardOverdue]}>
          <View style={styles.row}>
            {highlightName(item.item_name)}
            <View style={[styles.badge, isManual ? styles.badgeManual : needsRestock ? styles.badgeAlert : isOverdue ? styles.badgeOverdue : styles.badgeOk]}>
              <Text style={[styles.badgeText, isManual ? styles.badgeTextManual : needsRestock ? styles.badgeTextAlert : isOverdue ? styles.badgeTextOverdue : styles.badgeTextOk]}>
                {isManual ? "נוסף ידנית לרשימה" : needsRestock ? "נדרשת רכישה" : isOverdue ? "לא נרכש זמן רב" : "תקין"}
              </Text>
            </View>
          </View>
          {!isManual && (
            <View style={styles.detailRow}>
              <Text style={[styles.detailCurrent, needsRestock && styles.detailAlert]}>
                יש: {item.current_quantity}
              </Text>
              <Text style={styles.detailCenter}>להשלים: {Math.max(0, desired - current)}</Text>
              <Text style={styles.detailCenter}>רצוי: {desired}</Text>
              <Text style={styles.detailDays}> כל {item.days_until_restock} ימים</Text>
            </View>
          )}
          {isManual ? (
            <Text style={styles.date}>{`כמות: ${desired}`}</Text>
          ) : (
            <View style={styles.dateRow}>
              <Text style={styles.date}>
                {needsRestock ? "⚠️ יש לרכוש בהקדם" : `רכישה הבאה בעוד ${calculateDaysAgo(item.next_purchase_date)} ימים`}
              </Text>
              {!!item.last_purchased_date && (
                <Text style={styles.dateRight}>נרכש לאחרונה לפני {calculateDaysAgo(item.last_purchased_date)} ימים</Text>
              )}
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="חיפוש..."
          placeholderTextColor="#aaa"
          value={searchInput}
          onChangeText={onSearchChange}
          textAlign="right"
        />
        {searchInput.length > 0 && (
          <TouchableOpacity style={styles.searchClear} onPress={() => { setSearchInput(""); setSearchQuery(""); }}>
            <Text style={styles.searchClearText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>
      <FlatList
        data={filteredItems}
        keyExtractor={(item) => item.item_name}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      />

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={openAdd}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {/* Add modal */}
      <Modal visible={addVisible} transparent animationType="slide" onRequestClose={() => setAddVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setAddVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalBox, { paddingBottom: insets.bottom + 20, marginBottom: keyboardOffset }]}>
            <Text style={styles.modalTitle}>פריט חדש</Text>

            <Text style={styles.fieldLabel}>שם פריט <Text style={styles.required}>*</Text></Text>
            <TextInput style={styles.fieldInput} value={newName} onChangeText={setNewName} placeholder="לדוגמה: חלב" textAlign="right" />

            <Text style={styles.fieldLabel}>יש לרכוש כל (ימים) <Text style={styles.required}>*</Text></Text>
            <TextInput style={styles.fieldInput} value={newDays} onChangeText={setNewDays} keyboardType="numeric" textAlign="right" />

            <View style={styles.fieldRow}>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>יש כרגע</Text>
                <TextInput style={styles.fieldInput} value={newCurrent} onChangeText={setNewCurrent} keyboardType="numeric" textAlign="right" />
              </View>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>כמות רצויה <Text style={styles.required}>*</Text></Text>
                <TextInput style={styles.fieldInput} value={newDesired} onChangeText={setNewDesired} keyboardType="numeric" textAlign="right" />
              </View>
            </View>

            <Text style={styles.fieldLabel}>לפני כמה ימים נרכש לאחרונה? (0 = היום)</Text>
            <TextInput style={styles.fieldInput} value={newDate} onChangeText={setNewDate} keyboardType="numeric" placeholder="0" textAlign="right" />

            <View style={styles.bottomBtnRow}>
              <TouchableOpacity style={[styles.saveBtn, { flex: 1 }]} onPress={handleAdd} disabled={adding}>
                <Text style={styles.saveBtnText}>{adding ? "מוסיף..." : "הוסף"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.cancelBtn, { flex: 1, marginBottom: 0 }]} onPress={() => setAddVisible(false)}>
                <Text style={styles.cancelBtnText}>ביטול</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Edit modal */}
      <Modal visible={!!editItem} transparent animationType="slide" onRequestClose={() => setEditItem(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setEditItem(null)}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalBox, { paddingBottom: insets.bottom + 20, marginBottom: keyboardOffset }]}>
            <Text style={styles.modalTitle}>עדכון פריט</Text>

            <Text style={styles.fieldLabel}>שם <Text style={styles.required}>*</Text></Text>
            <TextInput style={styles.fieldInput} value={editName} onChangeText={setEditName} />

            <Text style={styles.fieldLabel}>יש לרכוש כל (ימים) <Text style={styles.required}>*</Text></Text>
            <TextInput style={styles.fieldInput} value={editDays} onChangeText={setEditDays} keyboardType="numeric" />

            <View style={styles.fieldRow}>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>יש כרגע</Text>
                <TextInput style={styles.fieldInput} value={editCurrent} onChangeText={setEditCurrent} keyboardType="numeric" />
              </View>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>כמות רצויה <Text style={styles.required}>*</Text></Text>
                <TextInput style={styles.fieldInput} value={editDesired} onChangeText={setEditDesired} keyboardType="numeric" />
              </View>
            </View>

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>נרכש לאחרונה {editDate ? `לפני ${calculateDaysAgo(editDate)} ימים` : "—"}</Text>
              <Text style={styles.infoLabel}>רכישה הבאה {editItem?.next_purchase_date ? `בעוד ${calculateDaysAgo(editItem.next_purchase_date)} ימים` : "—"}</Text>
              <Text style={styles.infoLabel}>חסר {Math.max(0, (parseFloat(editDesired) || 0) - (parseFloat(editCurrent) || 0))} יחידות</Text>
            </View>

            <View style={styles.bottomBtnRow}>
              <TouchableOpacity style={[styles.saveBtn, { flex: 1 }]} onPress={handleSave} disabled={saving}>
                <Text style={styles.saveBtnText}>{saving ? "שומר..." : "עדכן"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.cancelBtn, { flex: 1, marginBottom: 0 }]} onPress={() => setEditItem(null)}>
                <Text style={styles.cancelBtnText}>ביטול</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={[styles.deleteBtn, { marginTop: 8 }]} onPress={handleDelete}>
              <Text style={styles.deleteBtnText}>מחק פריט</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  searchBar: { backgroundColor: "#fff", paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#e1f5fe", flexDirection: "row", alignItems: "center" },
  searchInput: { flex: 1, borderWidth: 1.5, borderColor: "#90caf9", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, backgroundColor: "#f8fbff", color: "#1a1a1a" },
  searchClear: { marginLeft: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: "#e0e0e0", alignItems: "center", justifyContent: "center" },
  searchClearText: { color: "#555", fontSize: 13, fontWeight: "700" },
  error: { color: "#c62828", fontSize: 16, textAlign: "center", padding: 20 },
  list: { padding: 12, paddingBottom: 90 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.07,
    shadowRadius: 6,
    borderRightWidth: 4,
    borderRightColor: "#E1F5FE",
  },
  cardAlert: { borderRightColor: "#e53935" },
  cardOverdue: { borderRightColor: "#f57c00" },
  cardManual: { borderRightColor: BLUE, backgroundColor: "#e8f4fd" },
  badgeManual: { backgroundColor: "#dbeeff" },
  badgeTextManual: { color: BLUE },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  itemName: { fontSize: 17, fontWeight: "700", color: "#1a1a1a", textAlign: "left", flex: 1, marginLeft: 4 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20, marginLeft: 8 },
  badgeOk: { backgroundColor: "#E1F5FE" },
  badgeAlert: { backgroundColor: "#ffebee" },
  badgeOverdue: { backgroundColor: "#fff3e0" },
  badgeText: { fontSize: 12, fontWeight: "700" },
  badgeTextOk: { color: BLUE },
  badgeTextAlert: { color: "#c62828" },
  badgeTextOverdue: { color: "#e65100" },
  detailRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 2, paddingVertical: 2, borderTopWidth: 1, borderTopColor: "#f0f0f0" },
  detailCurrent: { fontSize: 14, color: "#555", textAlign: "left", flex: 1, marginLeft: 4 },
  detailCenter: { fontSize: 14, color: "#555", textAlign: "center", flex: 1, marginRight: 5 },
  detailDays: { fontSize: 14, color: "#555", textAlign: "right", flex: 1, marginRight: 4 },
  detailAlert: { color: "#c62828", fontWeight: "600" },
  dateRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", top: 3 },
  date: { fontSize: 12, color: "#888", textAlign: "left", width: 150 },
  dateRight: { fontSize: 12, color: "#888", textAlign: "right", paddingRight: 4, width: 150 },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalBox: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: "700", textAlign: "center", marginBottom: 16, color: "#1a1a1a" },
  fieldLabel: { fontSize: 13, color: "#888", textAlign: "left", marginBottom: 4 },
  fieldInput: { borderWidth: 1.5, borderColor: "#90caf9", borderRadius: 8, padding: 9, fontSize: 15, textAlign: "right", backgroundColor: "#f8fbff", marginBottom: 12 },
  fieldRow: { flexDirection: "row-reverse", gap: 10 },
  fieldHalf: { flex: 1 },
  infoRow: { flexDirection: "column", gap: 4, marginBottom: 12 },
  infoHalf: {},
  infoLabel: { fontSize: 13, color: "#aaa", textAlign: "left" },
  infoValue: { fontSize: 13, color: "#888" },
  saveBtn: { backgroundColor: BLUE, paddingVertical: 13, borderRadius: 10, alignItems: "center" },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  bottomBtnRow: { flexDirection: "row", gap: 8, marginBottom: 0 },
  deleteBtn: { backgroundColor: "#e53935", paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  deleteBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  cancelBtn: { paddingVertical: 12, borderRadius: 10, alignItems: "center", backgroundColor: "#ffebee", borderWidth: 1, borderColor: "#ffcdd2" },
  cancelBtnText: { color: "#c62828", fontSize: 15, fontWeight: "600" },
  fab: { position: "absolute", bottom: 24, left: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: BLUE, alignItems: "center", justifyContent: "center", elevation: 8, shadowColor: BLUE, shadowOpacity: 0.4, shadowRadius: 8 },
  fabText: { color: "#fff", fontSize: 32, lineHeight: 36, fontWeight: "300" },
  required: { color: "#e53935" },
});

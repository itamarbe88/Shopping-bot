import { useFocusEffect, useNavigation } from "@react-navigation/native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Keyboard,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import {
  InventoryItem, ShoppingItem, VoiceMatchedItem,
  fetchInventory, fetchShoppingList,
  upsertInventoryItem, deleteInventoryItem,
  addManualItem, addTemporaryItem, processVoiceItems,
  uploadItemImage, fetchItemImage, deleteItemImage, fetchItemsWithImages,
  overrideShoppingListQty,
} from "../api";
import { getItemIcon } from "../icons";
import { useVoice } from "../hooks/useVoice";

const BLUE = "#0288D1";

export default function SimulationScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ShoppingItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [itemsWithImages, setItemsWithImages] = useState<Set<string>>(new Set());
  const [viewImageBase64, setViewImageBase64] = useState<string | null>(null);

  // Edit modal
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editCurrent, setEditCurrent] = useState("");
  const [editDesired, setEditDesired] = useState("");
  const [editDays, setEditDays] = useState("");
  const [editDate, setEditDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [editImageBase64, setEditImageBase64] = useState<string | null>(null);
  const [removeEditImage, setRemoveEditImage] = useState(false);

  // Add manual modal
  const [manualModalVisible, setManualModalVisible] = useState(false);
  const [manualSearch, setManualSearch] = useState("");
  const [manualQty, setManualQty] = useState("1");
  const manualSearchRef = useRef<TextInput>(null);

  // Qty edit (inline)
  const [qtyValues, setQtyValues] = useState<Record<string, string>>({});
  const qtyValuesRef = useRef<Record<string, string>>({});

  // Add temporary modal
  const [tempModalVisible, setTempModalVisible] = useState(false);
  const [tempName, setTempName] = useState("");
  const [savingTemp, setSavingTemp] = useState(false);
  const tempNameRef = useRef<TextInput>(null);

  // Voice
  const { isRecording, transcript, error: voiceError, startRecording, stopRecording, cancelRecording } = useVoice();
  const [voiceModalVisible, setVoiceModalVisible] = useState(false);
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  const [voiceResult, setVoiceResult] = useState<{ found: VoiceMatchedItem[]; not_found: string[] } | null>(null);
  const [checkedNotFound, setCheckedNotFound] = useState<Set<string>>(new Set());
  const [checkedFound, setCheckedFound] = useState<Set<string>>(new Set());

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => setKeyboardOffset(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardOffset(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const handleSimulate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setItems(null);
    try {
      const result = await fetchShoppingList(false);
      setItems(result.shopping_list);
      setQtyValues({});
      qtyValuesRef.current = {};
    } catch {
      setError("לא ניתן להתחבר לשרת.");
    } finally {
      setLoading(false);
    }
  }, []);

  const hasResults = useRef(false);
  useEffect(() => { hasResults.current = items !== null; }, [items]);

  const loadInventory = useCallback(() => {
    fetchInventory().then(setInventoryItems).catch(() => {});
    fetchItemsWithImages().then((names) => setItemsWithImages(new Set(names))).catch(() => {});
  }, []);

  useFocusEffect(useCallback(() => {
    loadInventory();
    if (hasResults.current) handleSimulate();
  }, [handleSimulate, loadInventory]));

  const calculateDaysAgo = (dateValue: string | number | Date): number => {
    const now = new Date();
    const past = new Date(dateValue);
    const diffInMs = now.getTime() - past.getTime();
    const days = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
    return isNaN(days) ? 0 : Math.max(0, days);
  };

  // ── Image helpers ──────────────────────────────────────────────────────────
  const pickImage = (onResult: (base64: string) => void) => {
    Alert.alert("הוסף תמונה", "בחר מקור", [
      {
        text: "מצלמה", onPress: async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) { Alert.alert("נדרשת הרשאה", "אפשר גישה למצלמה בהגדרות."); return; }
          const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 });
          if (!result.canceled) await processImage(result.assets[0].uri, onResult);
        }
      },
      {
        text: "גלריה", onPress: async () => {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) { Alert.alert("נדרשת הרשאה", "אפשר גישה לגלריה בהגדרות."); return; }
          const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
          if (!result.canceled) await processImage(result.assets[0].uri, onResult);
        }
      },
      { text: "ביטול", style: "cancel" },
    ]);
  };

  const processImage = async (uri: string, onResult: (base64: string) => void) => {
    try {
      let quality = 0.85;
      let result = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1080, height: 1080 } }], { compress: quality, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      while (result.base64 && result.base64.length * 0.75 > 200 * 1024 && quality > 0.1) {
        quality -= 0.1;
        result = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1080, height: 1080 } }], { compress: quality, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      }
      if (!result.base64) { Alert.alert("שגיאה", "לא ניתן לעבד את התמונה."); return; }
      onResult(result.base64);
    } catch {
      Alert.alert("שגיאה", "לא ניתן לעבד את התמונה.");
    }
  };

  // ── Edit modal ─────────────────────────────────────────────────────────────
  const openEdit = (itemName: string) => {
    const inv = inventoryItems.find((i) => i.item_name === itemName);
    if (!inv) return;
    setEditItem(inv);
    setEditName(inv.item_name);
    setEditCurrent(inv.current_quantity);
    setEditDesired(inv.desired_quantity);
    setEditDays(inv.days_until_restock);
    setEditDate(inv.last_purchased_date);
    setEditImageBase64(null);
    setRemoveEditImage(false);
    fetchItemImage(inv.item_name).then(setEditImageBase64).catch(() => {});
  };

  const handleSave = async () => {
    if (!editItem) return;
    if (!editDesired.trim()) { Alert.alert("שגיאה", "יש להזין כמות רצויה."); return; }
    if (!editDays.trim()) { Alert.alert("שגיאה", "יש להזין תדירות רכישה בימים."); return; }
    setSaving(true);
    try {
      await upsertInventoryItem({ item_name: editName.trim(), unit: editItem.unit ?? "", current_quantity: parseFloat(editCurrent) || 0, desired_quantity: parseFloat(editDesired) || 0, days_until_restock: parseInt(editDays) || 7, last_purchased_date: editDate || undefined });
      if (removeEditImage) {
        await deleteItemImage(editItem.item_name);
        setItemsWithImages((prev) => { const s = new Set(prev); s.delete(editItem.item_name); return s; });
      } else if (editImageBase64) {
        await uploadItemImage(editName.trim(), editImageBase64);
        setItemsWithImages((prev) => new Set([...prev, editName.trim()]));
      }
      setEditItem(null);
      loadInventory();
      handleSimulate();
    } catch {
      Alert.alert("שגיאה", "לא ניתן לשמור.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editItem) return;
    Alert.alert("מחיקה", `למחוק את "${editItem.item_name}"?`, [
      { text: "ביטול", style: "cancel" },
      { text: "מחק", style: "destructive", onPress: async () => {
        try {
          await deleteInventoryItem(editItem.item_name);
          setEditItem(null);
          loadInventory();
          handleSimulate();
        } catch { Alert.alert("שגיאה", "לא ניתן למחוק."); }
      }}
    ]);
  };

  // ── Reset purchase date ────────────────────────────────────────────────────
  const handleResetPurchaseDate = async (itemName: string) => {
    const inv = inventoryItems.find((i) => i.item_name === itemName);
    if (!inv) return;
    try {
      const cycle = parseInt(inv.days_until_restock) || 7;
      const d = new Date();
      d.setDate(d.getDate() - Math.floor(cycle / 2));
      const lastDate = d.toISOString().split("T")[0];
      await upsertInventoryItem({ item_name: inv.item_name, unit: inv.unit ?? "", current_quantity: parseFloat(inv.current_quantity) || 0, desired_quantity: parseFloat(inv.desired_quantity) || 0, days_until_restock: cycle, last_purchased_date: lastDate });
      handleSimulate();
    } catch {
      Alert.alert("שגיאה", "לא ניתן לעדכן תאריך רכישה.");
    }
  };

  const showResetButton = (item: ShoppingItem): boolean => {
    if (item.purchase_reason !== "overdue") return false;
    const inv = inventoryItems.find((i) => i.item_name === item.item_name);
    if (!inv) return false;
    return (parseFloat(inv.current_quantity) || 0) >= (parseFloat(inv.desired_quantity) || 0);
  };

  // ── Remove manual/temp from list ───────────────────────────────────────────
  const handleRemoveItem = async (item: ShoppingItem) => {
    try {
      const itemType = item.is_temporary ? "temporary" : "manual";
      await deleteInventoryItem(item.item_name, itemType);
      handleSimulate();
    } catch {
      Alert.alert("שגיאה", "לא ניתן להסיר פריט.");
    }
  };

  // ── Change quantity ────────────────────────────────────────────────────────
  const handleQtyChange = async (item: ShoppingItem, newQty: number) => {
    newQty = Math.max(1, newQty);
    try {
      // For all item types — update local state and patch last_list cache only.
      // Never re-add via addManualItem/addTemporaryItem for qty changes — that creates duplicates.
      setItems((prev) => prev ? prev.map((i) => i.item_name === item.item_name ? { ...i, quantity_to_buy: newQty } : i) : prev);
      await overrideShoppingListQty(item.item_name, newQty);
    } catch {
      Alert.alert("שגיאה", "לא ניתן לעדכן כמות.");
    }
  };

  // ── Add manual item ────────────────────────────────────────────────────────
  const filteredInventoryNames = manualSearch.trim()
    ? inventoryItems.map((i) => i.item_name).filter((n) => n.includes(manualSearch.trim()))
    : inventoryItems.map((i) => i.item_name);

  const handleAddManual = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const alreadyInList = (items ?? []).some((i) => i.item_name === trimmed);
    if (alreadyInList) {
      Alert.alert("פריט כבר ברשימה", `"${trimmed}" כבר נמצא ברשימה.`);
      return;
    }
    try {
      await addManualItem(trimmed, Math.max(1, parseInt(manualQty) || 1));
      setManualSearch("");
      setManualQty("1");
      setManualModalVisible(false);
      handleSimulate();
    } catch {
      Alert.alert("שגיאה", "לא ניתן להוסיף פריט.");
    }
  };

  // ── Add temporary item ─────────────────────────────────────────────────────
  const handleAddTemp = async () => {
    const name = tempName.trim();
    if (!name) { Alert.alert("שגיאה", "יש להזין שם פריט."); return; }
    setSavingTemp(true);
    try {
      const existsInInventory = inventoryItems.some((i) => i.item_name === name);
      if (existsInInventory) {
        await addManualItem(name, 1);
        Alert.alert("פריט קיים במלאי", `"${name}" קיים במלאי ונוסף כפריט מלאי.`);
      } else {
        await addTemporaryItem(name, 1);
      }
      setTempName("");
      setTempModalVisible(false);
      handleSimulate();
    } catch {
      Alert.alert("שגיאה", "לא ניתן לשמור פריט.");
    } finally {
      setSavingTemp(false);
    }
  };

  // ── Voice ──────────────────────────────────────────────────────────────────
  const handleMicPress = async () => {
    if (isRecording) {
      await stopRecording();
    } else {
      setVoiceResult(null);
      setVoiceModalVisible(true);
      await startRecording();
    }
  };

  const handleVoiceSubmit = async () => {
    if (!transcript.trim()) return;
    setVoiceProcessing(true);
    try {
      const result = await processVoiceItems(transcript.trim());
      setVoiceResult(result);
      setCheckedNotFound(new Set(result.not_found));
      const existingNames = new Set((items ?? []).map((i) => i.item_name));
      setCheckedFound(new Set(result.found.map((i) => i.matched).filter((n) => !existingNames.has(n))));
    } catch {
      Alert.alert("שגיאה", "לא ניתן לעבד את הדיבור. נסה שוב.");
    } finally {
      setVoiceProcessing(false);
    }
  };

  const closeVoiceModal = async () => {
    await cancelRecording();
    setVoiceModalVisible(false);
    setVoiceResult(null);
  };

  const handleAddAllFound = async () => {
    if (!voiceResult) return;
    if (checkedFound.size === 0 && checkedNotFound.size === 0) {
      Alert.alert("", "הפריטים שנבחרו כבר נמצאים ברשימה.");
      return;
    }
    const currentNames = new Set((items ?? []).map((i) => i.item_name));
    const alreadyInList: string[] = [];
    for (const item of voiceResult.found) {
      if (!checkedFound.has(item.matched)) continue;
      if (currentNames.has(item.matched)) { alreadyInList.push(item.matched); continue; }
      try { await addManualItem(item.matched, 1); } catch {}
    }
    for (const name of checkedNotFound) {
      if (currentNames.has(name)) { alreadyInList.push(name); continue; }
      try { await addTemporaryItem(name, 1); } catch {}
    }
    if (alreadyInList.length > 0) {
      Alert.alert("", `הפריטים הבאים כבר ברשימה ולא נוספו:\n${alreadyInList.join(", ")}`);
    } else {
      closeVoiceModal();
    }
    handleSimulate();
  };

  const wasRecordingRef = useRef(false);
  useEffect(() => {
    if (wasRecordingRef.current && !isRecording && transcript.trim() && !voiceResult) {
      handleVoiceSubmit();
    }
    wasRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    navigation.setOptions({
      headerLeft: items !== null ? () => (
        <TouchableOpacity onPress={handleSimulate} style={{ marginHorizontal: 16, padding: 6 }}>
          <Text style={{ color: "#fff", fontSize: 28 }}>↻</Text>
        </TouchableOpacity>
      ) : undefined,
      headerRight: items !== null ? () => (
        <TouchableOpacity onPress={() => setItems(null)} style={{ marginHorizontal: 16, padding: 6 }}>
          <Text style={{ color: "#fff", fontSize: 28 }}>›</Text>
        </TouchableOpacity>
      ) : undefined,
    });
  }, [navigation, handleSimulate, items]);

  type LabelStyle = { badge: object; text: object; label: string };
  const getRowLabel = (item: ShoppingItem): LabelStyle => {
    if (item.is_temporary) return { badge: styles.badgeTemp, text: styles.badgeTextTemp, label: "התווסף ידנית כזמני" };
    if (item.item_type === "manual") return { badge: styles.badgeManual, text: styles.badgeTextManual, label: "התווסף ידנית מהמלאי" };
    if (item.purchase_reason === "overdue") return { badge: styles.badgeOverdue, text: styles.badgeTextOverdue, label: "לא נרכש זמן רב" };
    return { badge: styles.badgeOk, text: styles.badgeTextOk, label: "אוטומטית עקב חוסרים" };
  };

  if (items === null && !loading && !error) {
    return (
      <View style={styles.centerContainer}>
        <View style={styles.card}>
          <Text style={styles.cardDesc}>במסך זה נמצאת הרשימה המייצגת את מצב המלאי שלכם, מומלץ לעבור ולוודא שהרשימה מדוייקת.{"\n"}תוכלו ללחוץ על פריט בכדי לעדכנו במלאי.</Text>
          <View style={{ gap: 6, marginBottom: 24 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="close" size={18} color="#e53935" />
              <Text style={[styles.hintText, { flex: 1 }]}>הסר מהרשימה פריט שנוסף ידנית</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ width: 18, height: 18, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="calendar-outline" size={14} color="#2e7d32" style={{ position: "absolute" }} />
                <Ionicons name="create-outline" size={8} color="#2e7d32" style={{ position: "absolute", bottom: -1, right: -2 }} />
              </View>
              <Text style={[styles.hintText, { flex: 1 }]}>הסר מהרשימה פריט למרות שלא נרכש זמן רב</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.button} onPress={handleSimulate}>
            <Ionicons name="create" size={20} color="#fff" style={{ marginLeft: 8 }} />
            <Text style={styles.buttonText}>הכן רשימת קניות</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {loading && <View style={styles.center}><ActivityIndicator size="large" color={BLUE} /></View>}
      {error && <Text style={styles.error}>{error}</Text>}

      {items !== null && !loading && (
        <>
          <Text style={styles.header}>
            {items.length === 0 ? "הכל במלאי! אין צורך לקנות כרגע." : `${items.length} פריטים יידרשו`}
          </Text>
          <FlatList
            data={[...items].sort((a, b) => {
              const priority = (item: ShoppingItem) => {
                if (item.is_temporary) return 0;
                if (item.item_type === "manual") return 1;
                if (item.purchase_reason !== "overdue") return 2;
                return 3;
              };
              return priority(a) - priority(b);
            })}
            keyExtractor={(item) => item.item_name}
            contentContainerStyle={{ paddingBottom: 80 }}
            renderItem={({ item }) => {
              const { badge, text, label } = getRowLabel(item);
              const canRemove = item.is_temporary || item.item_type === "manual";
              return (
                <TouchableOpacity
                  activeOpacity={item.is_temporary ? 1 : 0.7}
                  onPress={() => { if (!item.is_temporary) openEdit(item.item_name); }}
                >
                  <View style={[styles.row, item.item_type === "temporary" && styles.rowTemp, item.item_type === "manual" && styles.rowManual]}>
                    <TextInput
                      style={[styles.qty, item.is_temporary && styles.qtyTemp]}
                      value={qtyValues[item.item_name] ?? String(item.quantity_to_buy)}
                      onChangeText={(v) => {
                        qtyValuesRef.current[item.item_name] = v;
                        setQtyValues((prev) => ({ ...prev, [item.item_name]: v }));
                      }}
                      onBlur={() => {
                        const val = parseInt(qtyValuesRef.current[item.item_name] ?? "");
                        delete qtyValuesRef.current[item.item_name];
                        if (!isNaN(val) && val >= 1 && val !== item.quantity_to_buy) {
                          handleQtyChange(item, val);
                        }
                        setQtyValues((prev) => { const n = { ...prev }; delete n[item.item_name]; return n; });
                      }}
                      keyboardType="numeric"
                      selectTextOnFocus
                    />
                    <Text style={styles.name} numberOfLines={1}>{item.item_name} {getItemIcon(item.item_name)}</Text>
                    {itemsWithImages.has(item.item_name) && (
                      <TouchableOpacity onPress={(e) => { e.stopPropagation(); fetchItemImage(item.item_name).then(setViewImageBase64).catch(() => {}); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginHorizontal: 4 }}>
                        <Ionicons name="image-outline" size={18} color="#888" />
                      </TouchableOpacity>
                    )}
                    <View style={[styles.badge, badge]}>
                      <Text style={[styles.badgeText, text]}>{label}</Text>
                    </View>
                    {canRemove ? (
                      <TouchableOpacity
                        onPress={(e) => { e.stopPropagation(); handleRemoveItem(item); }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={{ marginLeft: 4 }}
                      >
                        <Ionicons name="close" size={18} color="#e53935" />
                      </TouchableOpacity>
                    ) : showResetButton(item) ? (
                      <TouchableOpacity onPress={(e) => { e.stopPropagation(); handleResetPurchaseDate(item.item_name); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginLeft: 4 }}>
                        <View style={{ width: 20, height: 20 }}>
                          <Ionicons name="calendar-outline" size={18} color="#2e7d32" style={{ position: "absolute" }} />
                          <Ionicons name="create-outline" size={10} color="#2e7d32" style={{ position: "absolute", bottom: -1, right: -3 }} />
                        </View>
                      </TouchableOpacity>
                    ) : (
                      <View style={{ width: 22, marginLeft: 4 }} />
                    )}
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        </>
      )}

      {/* FAB row */}
      {items !== null && !loading && (
        <View style={styles.fabRow}>
          <TouchableOpacity style={styles.fabButton} onPress={() => setManualModalVisible(true)}>
            <Text style={styles.fabText}>הוסף פריט מהמלאי</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.fabButtonTemp} onPress={() => setTempModalVisible(true)}>
            <Text style={styles.fabText}>הוסף פריט זמני</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.fabButtonMic, isRecording && styles.fabButtonMicActive]} onPress={handleMicPress}>
            <Ionicons name={isRecording ? "stop" : "mic"} size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {/* Full-screen image viewer */}
      <Modal visible={!!viewImageBase64} transparent animationType="fade" onRequestClose={() => setViewImageBase64(null)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.9)", justifyContent: "center", alignItems: "center" }} activeOpacity={1} onPress={() => setViewImageBase64(null)}>
          {viewImageBase64 && <Image source={{ uri: `data:image/jpeg;base64,${viewImageBase64}` }} style={{ width: "90%", height: "70%", resizeMode: "contain" }} />}
        </TouchableOpacity>
      </Modal>

      {/* Add manual modal */}
      <Modal visible={manualModalVisible} transparent animationType="slide" onRequestClose={() => setManualModalVisible(false)} onShow={() => manualSearchRef.current?.focus()}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setManualModalVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalBox, { paddingBottom: insets.bottom + 20, marginBottom: keyboardOffset }]}>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setManualModalVisible(false)}>
              <Text style={styles.modalCloseBtnText}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>הוסף פריט לרשימה</Text>
            <TextInput style={styles.searchInput} placeholder="חפש שם פריט..." ref={manualSearchRef} value={manualSearch} onChangeText={setManualSearch} textAlign="right" />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", marginBottom: 8, gap: 8 }}>
              <Text style={{ color: "#555", fontSize: 14 }}>כמות:</Text>
              <TextInput
                style={{ width: 56, borderWidth: 1, borderColor: "#90caf9", borderRadius: 6, textAlign: "center", fontSize: 14, padding: 4, backgroundColor: "#e3f2fd" }}
                value={manualQty}
                onChangeText={(v) => setManualQty(v.replace(/[^0-9]/g, ""))}
                keyboardType="numeric"
              />
            </View>
            <ScrollView style={{ maxHeight: 200 }} keyboardShouldPersistTaps="handled">
              {filteredInventoryNames.slice(0, 20).map((name) => (
                <TouchableOpacity key={name} style={styles.suggestionItem} onPress={() => handleAddManual(name)}>
                  <Text style={styles.suggestionText}>{name} {getItemIcon(name)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Add temporary modal */}
      <Modal visible={tempModalVisible} transparent animationType="slide" onRequestClose={() => setTempModalVisible(false)} onShow={() => tempNameRef.current?.focus()}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setTempModalVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalBox, { paddingBottom: insets.bottom + 20, marginBottom: keyboardOffset }]}>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setTempModalVisible(false)}>
              <Text style={styles.modalCloseBtnText}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>פריט זמני לרשימה</Text>
            <Text style={styles.modalSub}>הפריט יצורף לרשימה עד לסיום הקנייה</Text>
            <TextInput ref={tempNameRef} style={styles.searchInput} placeholder="שם הפריט..." value={tempName} onChangeText={setTempName} textAlign="right" />
            <TouchableOpacity style={styles.modalAddBtn} onPress={handleAddTemp} disabled={savingTemp}>
              <Text style={styles.modalAddBtnText}>{savingTemp ? "שומר..." : "הוסף לרשימה"}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Voice modal */}
      <Modal visible={voiceModalVisible} transparent animationType="slide" onRequestClose={closeVoiceModal}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeVoiceModal}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalBox, { paddingBottom: insets.bottom + 20 }]}>
            <Text style={styles.modalTitle}>הוספה קולית</Text>
            {!voiceResult && (
              <>
                <View style={styles.voiceStatusRow}>
                  <View style={[styles.voiceDot, isRecording && styles.voiceDotActive]} />
                  <Text style={styles.voiceStatusText}>{isRecording ? "מקשיב..." : voiceProcessing ? "מעבד..." : "לחץ להקלטה"}</Text>
                </View>
                {transcript.length > 0 && <Text style={styles.voiceTranscript}>{transcript}</Text>}
                {voiceError && <Text style={[styles.voiceTranscript, { color: "#c62828" }]}>{voiceError}</Text>}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TouchableOpacity style={[styles.modalAddBtn, { flex: 1, backgroundColor: "#ffebee", marginBottom: 0 }]} onPress={closeVoiceModal}>
                    <Text style={[styles.modalAddBtnText, { color: "#c62828" }]}>ביטול</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
            {voiceResult && (
              <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
                {voiceResult.found.length > 0 && (
                  <>
                    <Text style={styles.voiceSectionTitle}>נמצאו במלאי</Text>
                    {voiceResult.found.filter((item, idx, arr) => arr.findIndex((x) => x.matched === item.matched) === idx).map((item) => {
                      const alreadyInList = (items ?? []).some((i) => i.item_name === item.matched);
                      const checked = checkedFound.has(item.matched);
                      return (
                        <TouchableOpacity
                          key={item.matched}
                          style={styles.voiceResultRow}
                          onPress={() => {
                            if (alreadyInList) return;
                            setCheckedFound((prev) => { const next = new Set(prev); checked ? next.delete(item.matched) : next.add(item.matched); return next; });
                          }}
                        >
                          {alreadyInList
                            ? <Ionicons name="checkmark-circle" size={22} color="#388e3c" style={{ marginLeft: 4 }} />
                            : <Ionicons name={checked ? "checkbox" : "square-outline"} size={22} color={BLUE} style={{ marginLeft: 4 }} />
                          }
                          <Text style={[styles.voiceResultName, { flex: 1, marginRight: 8 }]}>{item.matched} {getItemIcon(item.matched)}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </>
                )}
                {voiceResult.not_found.length > 0 && (
                  <>
                    <Text style={[styles.voiceSectionTitle, { color: "#e65100" }]}>לא נמצאו — הוסף כזמני</Text>
                    {voiceResult.not_found.map((name) => {
                      const checked = checkedNotFound.has(name);
                      return (
                        <TouchableOpacity key={name} style={styles.voiceResultRow} onPress={() => setCheckedNotFound((prev) => { const next = new Set(prev); checked ? next.delete(name) : next.add(name); return next; })}>
                          <Ionicons name={checked ? "checkbox" : "square-outline"} size={22} color={BLUE} style={{ marginLeft: 4 }} />
                          <Text style={[styles.voiceResultName, { flex: 1, marginRight: 8 }]}>{name}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </>
                )}
                {voiceResult.found.length === 0 && voiceResult.not_found.length === 0 && (
                  <Text style={styles.voiceStatusText}>לא זוהו פריטים. נסה שוב.</Text>
                )}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 12, alignItems: "center" }}>
                  <View style={{ flex: 1, flexDirection: "row", gap: 8 }}>
                    <TouchableOpacity style={[styles.modalAddBtn, { flex: 1, marginBottom: 0 }]} onPress={handleAddAllFound}>
                      <Text style={styles.modalAddBtnText}>הוסף</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.modalCancelBtn, { flex: 1 }]} onPress={closeVoiceModal}>
                      <Text style={styles.modalCancelText}>סגור</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity style={styles.fabButtonMic} onPress={async () => { setVoiceResult(null); await cancelRecording(); await startRecording(); }}>
                    <Ionicons name="mic" size={20} color="#fff" />
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Edit modal */}
      <Modal visible={!!editItem} transparent animationType="slide" onRequestClose={() => setEditItem(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setEditItem(null)}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalBox, { paddingBottom: insets.bottom + 20, marginBottom: keyboardOffset }]}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>{editName}</Text>
              <Text style={styles.fieldLabel}>יש לרכוש כל (ימים) <Text style={{ color: "#e53935" }}>*</Text></Text>
              <TextInput style={styles.fieldInput} value={editDays} onChangeText={setEditDays} keyboardType="numeric" />
              <View style={{ flexDirection: "row-reverse", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>יש כרגע</Text>
                  <TextInput style={styles.fieldInput} value={editCurrent} onChangeText={setEditCurrent} keyboardType="numeric" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>כמות רצויה <Text style={{ color: "#e53935" }}>*</Text></Text>
                  <TextInput style={styles.fieldInput} value={editDesired} onChangeText={setEditDesired} keyboardType="numeric" />
                </View>
              </View>
              <Text style={styles.infoLabel}>נרכש לאחרונה {editDate ? `לפני ${calculateDaysAgo(editDate)} ימים` : "—"}</Text>
              <View style={styles.imageRow}>
                {editImageBase64 ? (
                  <TouchableOpacity onPress={() => setViewImageBase64(editImageBase64)}>
                    <Image source={{ uri: `data:image/jpeg;base64,${editImageBase64}` }} style={styles.imagePreview} />
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity style={styles.cameraBtn} onPress={() => pickImage((b64) => { setEditImageBase64(b64); setRemoveEditImage(false); })}>
                  <Ionicons name={editImageBase64 ? "camera" : "camera-outline"} size={22} color="#555" />
                </TouchableOpacity>
                {editImageBase64 ? (
                  <TouchableOpacity style={[styles.cameraBtn, { borderColor: "#ffcdd2" }]} onPress={() => { setEditImageBase64(null); setRemoveEditImage(true); }}>
                    <Ionicons name="trash-outline" size={22} color="#e53935" />
                  </TouchableOpacity>
                ) : null}
              </View>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 0 }}>
                <TouchableOpacity style={[styles.saveBtn, { flex: 1 }]} onPress={handleSave} disabled={saving}>
                  <Text style={styles.saveBtnText}>{saving ? "שומר..." : "עדכן"}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.cancelBtn, { flex: 1 }]} onPress={() => setEditItem(null)}>
                  <Text style={styles.cancelBtnText}>ביטול</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  centerContainer: { flex: 1, backgroundColor: "#f0f8ff", justifyContent: "center", padding: 20 },
  card: { backgroundColor: "#fff", borderRadius: 16, padding: 24, elevation: 4, shadowColor: BLUE, shadowOpacity: 0.12, shadowRadius: 10 },
  cardDesc: { fontSize: 15, color: "#666", textAlign: "center", lineHeight: 22, marginBottom: 12 },
  hintText: { fontSize: 13, color: "#555" },
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  button: { backgroundColor: BLUE, paddingVertical: 16, borderRadius: 12, alignItems: "center", flexDirection: "row", justifyContent: "center", elevation: 2, shadowColor: BLUE, shadowOpacity: 0.3, shadowRadius: 6 },
  buttonText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  error: { color: "red", textAlign: "center", padding: 12 },
  header: { paddingHorizontal: 16, paddingBottom: 8, paddingTop: 8, fontSize: 14, color: "#555", fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", marginHorizontal: 12, marginBottom: 6, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, elevation: 1 },
  rowTemp: { backgroundColor: "#fff0f0" },
  rowManual: { backgroundColor: "#e8f4fd" },
  qty: { width: 34, height: 34, borderWidth: 1, borderColor: "#90caf9", borderRadius: 6, textAlign: "center", fontSize: 13, fontWeight: "900", color: "#1565c0", backgroundColor: "#e3f2fd", marginRight: 6, paddingVertical: 0 },
  qtyTemp: { color: "#e53935" },
  name: { flex: 1, fontSize: 16, marginHorizontal: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  badgeOk: { backgroundColor: "#E1F5FE" },
  badgeTextOk: { color: BLUE },
  badgeTemp: { backgroundColor: "#ffebee" },
  badgeTextTemp: { color: "#c62828" },
  badgeManual: { backgroundColor: "#dbeeff" },
  badgeTextManual: { color: BLUE },
  badgeOverdue: { backgroundColor: "#fff3e0" },
  badgeTextOverdue: { color: "#e65100" },
  fabRow: { flexDirection: "row", gap: 10, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#f5f5f5" },
  fabButton: { flex: 1, height: 44, borderRadius: 22, backgroundColor: BLUE, alignItems: "center", justifyContent: "center", elevation: 6, shadowColor: BLUE, shadowOpacity: 0.4, shadowRadius: 6 },
  fabButtonTemp: { flex: 1, height: 44, borderRadius: 22, backgroundColor: "#e53935", alignItems: "center", justifyContent: "center", elevation: 6, shadowColor: "#e53935", shadowOpacity: 0.4, shadowRadius: 6 },
  fabButtonMic: { width: 44, height: 44, borderRadius: 22, backgroundColor: BLUE, alignItems: "center", justifyContent: "center", elevation: 6, shadowColor: BLUE, shadowOpacity: 0.4, shadowRadius: 6 },
  fabButtonMicActive: { backgroundColor: "#e53935", shadowColor: "#e53935" },
  fabText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalBox: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "80%" },
  modalTitle: { fontSize: 18, fontWeight: "700", textAlign: "center", marginBottom: 16, color: "#1a1a1a" },
  modalSub: { fontSize: 12, color: "#aaa", textAlign: "center", marginBottom: 16 },
  modalCloseBtn: { position: "absolute", top: 12, right: 12, width: 28, height: 28, alignItems: "center", justifyContent: "center", zIndex: 10 },
  modalCloseBtnText: { fontSize: 16, color: "#888", fontWeight: "700" },
  searchInput: { borderWidth: 1.5, borderColor: "#90caf9", borderRadius: 10, padding: 10, fontSize: 16, textAlign: "right", marginBottom: 12, backgroundColor: "#f8fbff" },
  suggestionItem: { paddingVertical: 12, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  suggestionText: { fontSize: 16, textAlign: "left", color: "#1a1a1a" },
  modalAddBtn: { backgroundColor: BLUE, paddingVertical: 12, borderRadius: 10, alignItems: "center", marginBottom: 8 },
  modalAddBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  modalCancelBtn: { paddingVertical: 12, paddingHorizontal: 8, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#ffebee", borderWidth: 1, borderColor: "#ffcdd2" },
  modalCancelText: { color: "#c62828", fontSize: 15, textAlign: "center", fontWeight: "700" },
  voiceStatusRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  voiceDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: "#ccc", marginRight: 8 },
  voiceDotActive: { backgroundColor: "#e53935" },
  voiceStatusText: { fontSize: 16, color: "#555", textAlign: "center" },
  voiceTranscript: { fontSize: 15, color: "#333", textAlign: "right", backgroundColor: "#f8fbff", borderRadius: 8, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: "#e3f2fd" },
  voiceSectionTitle: { fontSize: 14, fontWeight: "700", color: "#1a7a1a", marginTop: 12, marginBottom: 6 },
  voiceResultRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  voiceResultName: { fontSize: 15, fontWeight: "600", color: "#1a1a1a" },
  // Edit modal
  fieldLabel: { fontSize: 13, color: "#888", textAlign: "left", marginBottom: 4 },
  fieldInput: { borderWidth: 1.5, borderColor: "#90caf9", borderRadius: 8, padding: 9, fontSize: 15, textAlign: "right", backgroundColor: "#f8fbff", marginBottom: 12 },
  infoLabel: { fontSize: 13, color: "#aaa", textAlign: "left", marginBottom: 12 },
  imageRow: { flexDirection: "row", alignItems: "center", marginBottom: 12, gap: 10 },
  imagePreview: { width: 64, height: 64, borderRadius: 8, borderWidth: 1, borderColor: "#e0e0e0" },
  cameraBtn: { width: 44, height: 44, borderRadius: 8, borderWidth: 1.5, borderColor: "#90caf9", alignItems: "center", justifyContent: "center", backgroundColor: "#f8fbff" },
  saveBtn: { backgroundColor: BLUE, paddingVertical: 13, borderRadius: 10, alignItems: "center" },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  deleteBtn: { backgroundColor: "#e53935", paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  deleteBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  cancelBtn: { paddingVertical: 12, borderRadius: 10, alignItems: "center", backgroundColor: "#ffebee", borderWidth: 1, borderColor: "#ffcdd2" },
  cancelBtnText: { color: "#c62828", fontSize: 15, fontWeight: "600" },
});

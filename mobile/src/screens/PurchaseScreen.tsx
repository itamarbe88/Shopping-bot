import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
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
import { PurchaseItem, ShoppingItem, VoiceMatchedItem, addManualItem, addTemporaryItem, confirmPurchases, deleteInventoryItem, fetchInventory, fetchItemImage, fetchItemsWithImages, fetchShoppingList, processVoiceItems, removeFromShoppingList } from "../api";
import { getItemIcon } from "../icons";
import { useVoice } from "../hooks/useVoice";

interface RouteParams { items: ShoppingItem[] }

interface PurchaseRow {
  item: ShoppingItem;
  checked: boolean;
  qty: string;
  isExtra?: boolean;
}

export default function PurchaseScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const route = useRoute();

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => setKeyboardOffset(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardOffset(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const routeItems = (route.params as RouteParams | undefined)?.items;

  const rowPriority = (row: PurchaseRow): number => {
    if (row.item.is_temporary) return 0;
    if (row.isExtra) return 1;
    if (row.item.purchase_reason !== "overdue") return 2;
    return 3;
  };

  const sortRows = (list: PurchaseRow[]): PurchaseRow[] =>
    [...list].sort((a, b) =>
      (a.checked ? 1 : 0) - (b.checked ? 1 : 0) || rowPriority(a) - rowPriority(b)
    );

  const toRows = (list: ShoppingItem[]): PurchaseRow[] =>
    sortRows(list.map((item) => ({ item, checked: false, qty: String(item.quantity_to_buy), isExtra: item.item_type === "manual" })));

  const [rows, setRows] = useState<PurchaseRow[]>(routeItems ? toRows(routeItems) : []);
  const [hasGenerated, setHasGenerated] = useState(!!routeItems);
  const [submitting, setSubmitting] = useState(false);


  // Blue + modal (session-only extra items)
  const [modalVisible, setModalVisible] = useState(false);
  const [allInventoryNames, setAllInventoryNames] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [extraQty, setExtraQty] = useState("1");

  // Red + modal (permanent temporary items saved to CSV)
  const [tempModalVisible, setTempModalVisible] = useState(false);
  const [tempName, setTempName] = useState("");
  const [tempQty, setTempQty] = useState("1");
  const [savingTemp, setSavingTemp] = useState(false);

  const tempNameRef = useRef<TextInput>(null);
  const extraSearchRef = useRef<TextInput>(null);

  // ── Voice ──────────────────────────────────────────────────────────────────
  const { isRecording, transcript, error: voiceError, startRecording, stopRecording, cancelRecording } = useVoice();
  const [voiceModalVisible, setVoiceModalVisible] = useState(false);
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  const [voiceResult, setVoiceResult] = useState<{ found: VoiceMatchedItem[]; not_found: string[] } | null>(null);
  const [checkedNotFound, setCheckedNotFound] = useState<Set<string>>(new Set());

  // ── Item images ────────────────────────────────────────────────────────────
  const [itemsWithImages, setItemsWithImages] = useState<Set<string>>(new Set());
  const [viewImage, setViewImage] = useState<string | null>(null);

  const handleViewImage = async (item_name: string) => {
    try {
      const base64 = await fetchItemImage(item_name);
      if (base64) setViewImage(base64);
    } catch {}
  };

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

    const existingNames = new Set(rows.map((r) => r.item.item_name));

    // Found items — same logic as הוסף פריט מלאי button
    for (const item of voiceResult.found) {
      if (existingNames.has(item.matched)) continue;
      try {
        await addManualItem(item.matched, 1);
        const newRow: PurchaseRow = {
          item: { item_name: item.matched, quantity_to_buy: 1, current_quantity: 0, item_type: "manual" },
          checked: false, qty: "1", isExtra: true,
        };
        setRows((prev) => sortRows([newRow, ...prev]));
      } catch {
        Alert.alert("שגיאה", `לא ניתן להוסיף את "${item.matched}"`);
      }
    }

    // Not-found checked items — add to inventory as temporary then add to rows
    for (const name of checkedNotFound) {
      if (existingNames.has(name)) continue;
      try {
        await addTemporaryItem(name, 1);
        const newRow: PurchaseRow = {
          item: { item_name: name, quantity_to_buy: 1, current_quantity: 0, is_temporary: true, item_type: "temporary" },
          checked: false, qty: "1", isExtra: false,
        };
        setRows((prev) => sortRows([newRow, ...prev]));
      } catch {
        Alert.alert("שגיאה", `לא ניתן להוסיף את "${name}"`);
      }
    }

    closeVoiceModal();
  };

  const handleReRecord = async () => {
    setVoiceResult(null);
    await cancelRecording();
    await startRecording();
  };

  // Auto-search when recording stops and there is a transcript
  const wasRecordingRef = useRef(false);
  useEffect(() => {
    if (wasRecordingRef.current && !isRecording && transcript.trim() && !voiceResult) {
      handleVoiceSubmit();
    }
    wasRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    fetchInventory().then((inv) => setAllInventoryNames(inv.map((i) => i.item_name)));
    fetchItemsWithImages().then((names) => setItemsWithImages(new Set(names)));
  }, []);

  const handleRefresh = useCallback(async () => {
    try {
      const result = await fetchShoppingList(false);
      setRows((prev) => {
        const stateMap = new Map(prev.map((r) => [r.item.item_name, { checked: r.checked, qty: r.qty }]));
        const merged = result.shopping_list.map((item) => {
          const saved = stateMap.get(item.item_name);
          return { item, checked: saved?.checked ?? false, qty: saved?.qty ?? String(item.quantity_to_buy), isExtra: item.item_type === "manual" };
        });
        return sortRows(merged);
      });
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => {
    if (hasGenerated) handleRefresh();
  }, [hasGenerated]));

  useEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <TouchableOpacity onPress={handleRefresh} style={{ marginHorizontal: 16, padding: 6 }}>
          <Text style={{ color: "#fff", fontSize: 28 }}>↻</Text>
        </TouchableOpacity>
      ),
      headerRight: () => (
        <TouchableOpacity onPress={() => { setHasGenerated(false); setRows([]); navigation.navigate("Shopping"); }} style={{ marginHorizontal: 16, padding: 6 }}>
          <Text style={{ color: "#fff", fontSize: 28 }}>›</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, handleRefresh]);

  const toggle = (i: number) =>
    setRows((prev) => sortRows(prev.map((r, idx) => idx === i ? { ...r, checked: !r.checked } : r)));

  const setQty = (i: number, val: string) =>
    setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, qty: val } : r));

  const checkedCount = rows.filter((r) => r.checked).length;

  const filteredNames = search.trim()
    ? allInventoryNames.filter((n) => n.includes(search.trim()))
    : allInventoryNames;

  const handleAddExtra = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const already = rows.find((r) => r.item.item_name === trimmed);
    if (already) {
      Alert.alert("פריט קיים", `${trimmed} כבר ברשימה.`);
      return;
    }
    const newRow: PurchaseRow = {
      item: { item_name: trimmed, quantity_to_buy: parseFloat(extraQty) || 1, current_quantity: 0, item_type: "manual" },
      checked: false,
      qty: extraQty,
      isExtra: true,
    };
    // Save to server
    addManualItem(trimmed, parseFloat(extraQty) || 1).catch(() => {});
    setRows((prev) => sortRows([newRow, ...prev]));
    setSearch("");
    setExtraQty("1");
    setModalVisible(false);
  };

  const handleAddTemp = async () => {
    const name = tempName.trim();
    if (!name) { Alert.alert("שגיאה", "יש להזין שם פריט."); return; }
    if (rows.find((r) => r.item.item_name === name)) {
      Alert.alert("פריט קיים ברשימה", `"${name}" כבר נמצא ברשימה.`);
      return;
    }
    const qty = parseFloat(tempQty) || 1;
    const existsInInventory = allInventoryNames.includes(name);
    setSavingTemp(true);
    try {
      if (existsInInventory) {
        await addManualItem(name, qty);
        setRows((prev) => sortRows([{
          item: { item_name: name, quantity_to_buy: qty, current_quantity: 0, item_type: "manual" },
          checked: false,
          qty: tempQty,
          isExtra: true,
        }, ...prev]));
        Alert.alert("פריט קיים במלאי", `"${name}" קיים במלאי ונוסף כפריט מלאי.`);
      } else {
        await addTemporaryItem(name, qty);
        setRows((prev) => sortRows([{
          item: { item_name: name, quantity_to_buy: qty, current_quantity: 0, is_temporary: true },
          checked: false,
          qty: tempQty,
        }, ...prev]));
      }
      setTempName("");
      setTempQty("1");
      setTempModalVisible(false);
    } catch {
      Alert.alert("שגיאה", "לא ניתן לשמור פריט.");
    } finally {
      setSavingTemp(false);
    }
  };

  const handleDone = async () => {
    const purchases: PurchaseItem[] = rows
      .filter((r) => r.checked && parseFloat(r.qty) > 0)
      .map((r) => ({ item_name: r.item.item_name, quantity_bought: parseFloat(r.qty) || 0 }));

    const tempItems: number = rows.filter((r) => r.item.is_temporary).length;

    if (purchases.length === 0) {
      Alert.alert("אין פריטים", "לא נבחרו פריטים לעדכון.");
      return;
    }
    setSubmitting(true);
    try {
      await confirmPurchases(purchases);
      Alert.alert("הקנייה הושלמה בהצלחה!", `עודכנו ${purchases.length - tempItems} פריטים במלאי.`, [
        { text: "סגור", onPress: () => { setRows([]); setHasGenerated(false); navigation.navigate("Shopping"); } },
      ]);
    } catch {
      Alert.alert("שגיאה", "לא ניתן לעדכן את המלאי.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!hasGenerated) {
    return (
      <View style={{ flex: 1, backgroundColor: "#f0f8ff", justifyContent: "center", padding: 20 }}>
        <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 24, elevation: 4 }}>
          <Text style={{ fontSize: 15, color: "#666", textAlign: "center", lineHeight: 22, marginBottom: 24 }}>
סלבדור ייצר לכם רשימת קניות לפי חוסרי המלאי שלכם, אל הרשימה תוכלו להוסיף פרטי מלאי אחרים וגם פריטים זמניים
          </Text>
          <TouchableOpacity
            style={{ backgroundColor: "#0288D1", paddingVertical: 16, borderRadius: 12, alignItems: "center", elevation: 2 }}
            disabled={submitting}
            onPress={async () => {
              setSubmitting(true);
              try {
                const result = await fetchShoppingList(false);
                setRows(toRows(result.shopping_list));
                setHasGenerated(true);
              } catch {
                Alert.alert("שגיאה", "לא ניתן להתחבר לשרת.");
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700" }}>יצר לי רשימת קניות 🛒</Text>
            }
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.summaryBar}>
        <Text style={styles.summaryText}>{checkedCount} מתוך {rows.length} פריטים נבחרו</Text>
      </View>

      <TouchableOpacity
        style={[styles.selectAllBtn, checkedCount === rows.length ? styles.selectAllBtnClear : styles.selectAllBtnSelect]}
        onPress={() => {
          const allChecked = checkedCount === rows.length;
          setRows((prev) => prev.map((r) => ({ ...r, checked: !allChecked })));
        }}
      >
        <Text style={styles.selectAllBtnText}>{checkedCount === rows.length ? "נקה הכל" : "סמן הכל"}</Text>
      </TouchableOpacity>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.item.item_name}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40 }}>
            <Text style={{ fontSize: 15, color: "#888", textAlign: "center", lineHeight: 24 }}>
              הוסף פריטים זמניים או מהמלאי באופן ידני בעזרת הכפתורים בתחתית המסך
            </Text>
          </View>
        }
        renderItem={({ item: row, index }) => (
          <View style={[styles.card, row.isExtra && styles.cardExtra, row.item.is_temporary && styles.cardTemp, row.checked && styles.cardDone]}>
            {/* Top label row */}
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={row.item.is_temporary ? styles.tempLabel : row.item.purchase_reason === "overdue" ? styles.overdueLabel : styles.itemLabel}>
                {row.item.is_temporary ? "התווסף ידנית כזמני" : row.isExtra ? "התווסף ידנית מהמלאי" : row.item.purchase_reason === "overdue" ? "לא נרכש זמן רב" : "אוטומטית עקב חוסרים"}
              </Text>
              <View style={styles.left}>
                {(row.isExtra || row.item.is_temporary) ? (
                  <TouchableOpacity
                    style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}
                    onPress={() => {
                      const itemType = row.item.is_temporary ? "temporary" : "manual";
                      deleteInventoryItem(row.item.item_name, itemType).catch(() => {});
                      removeFromShoppingList(row.item.item_name).catch(() => {});
                      setRows((prev) => prev.filter((_, i) => i !== index));
                    }}
                  >
                    <Text style={styles.removeBtnText}>✕</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}>
                    <Text style={styles.removeBtnDisabled}>✕</Text>
                  </View>
                )}
              </View>
            </View>
            {/* Item name */}
            <Text style={[styles.name, row.checked && styles.nameDone]}>
              {row.item.item_name} {getItemIcon(row.item.item_name)}
            </Text>
            {/* Checkbox + qty row */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <TouchableOpacity
                style={[styles.checkbox, row.checked && styles.checkboxChecked]}
                onPress={() => toggle(index)}
              >
                {row.checked && <Text style={styles.checkmark}>✓</Text>}
              </TouchableOpacity>
              <TextInput
                style={[styles.qtyInput, row.checked && styles.qtyDone]}
                value={row.qty}
                onChangeText={(v) => setQty(index, v)}
                keyboardType="numeric"
                editable={!row.checked}
                selectTextOnFocus
              />
              {itemsWithImages.has(row.item.item_name) && (
                <TouchableOpacity onPress={() => handleViewImage(row.item.item_name)}>
                  <Ionicons name="image-outline" size={22} color="#888" />
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      />

      <View style={styles.fabRow}>
        <TouchableOpacity style={styles.fabButton} onPress={() => setModalVisible(true)}>
          <Text style={styles.fabText}>הוסף פריט מהמלאי</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.fabButtonTemp} onPress={() => setTempModalVisible(true)}>
          <Text style={styles.fabText}>הוסף פריט זמני</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.fabButtonMic, isRecording && styles.fabButtonMicActive]}
          onPress={handleMicPress}
        >
          <Ionicons name={isRecording ? "stop" : "mic"} size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity style={[styles.btnDone, rows.length === 0 && styles.btnDoneDisabled]} onPress={handleDone} disabled={submitting || rows.length === 0}>
          <Text style={styles.btnDoneText}>{submitting ? "שומר..." : "סיום קנייה"}</Text>
        </TouchableOpacity>
      </View>

      {/* Voice modal */}
      <Modal visible={voiceModalVisible} transparent animationType="slide" onRequestClose={closeVoiceModal}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeVoiceModal}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalBox, { paddingBottom: insets.bottom + 20 }]}>
            <Text style={styles.modalTitle}>הוספה קולית</Text>

            {!voiceResult && (
              <>
                <View style={styles.voiceStatusRow}>
                  <View style={[styles.voiceDot, isRecording && styles.voiceDotActive]} />
                  <Text style={styles.voiceStatusText}>
                    {isRecording ? "מקשיב..." : voiceProcessing ? "מעבד..." : "לחץ להקלטה"}
                  </Text>
                </View>
                {transcript.length > 0 && <Text style={styles.voiceTranscript}>{transcript}</Text>}
                {voiceError && <Text style={[styles.voiceTranscript, { color: "#c62828" }]}>{voiceError}</Text>}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {isRecording ? (
                    <TouchableOpacity style={[styles.modalAddBtn, { flex: 1, backgroundColor: "#e53935" }]} onPress={stopRecording}>
                      <Text style={styles.modalAddBtnText}>עצור</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={[styles.modalCancelBtn, { flex: 1 }]} onPress={closeVoiceModal}>
                      <Text style={styles.modalCancelText}>ביטול</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )}

            {voiceResult && (
              <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
                {voiceResult.found.length > 0 && (
                  <>
                    <Text style={styles.voiceSectionTitle}>✅ נמצאו ({voiceResult.found.length})</Text>
                    {voiceResult.found.map((item) => (
                      <View key={item.matched} style={styles.voiceResultRow}>
                        <Text style={styles.voiceResultName}>{item.matched} {getItemIcon(item.matched)}</Text>
                      </View>
                    ))}
                  </>
                )}
                {voiceResult.not_found.length > 0 && (
                  <>
                    <Text style={[styles.voiceSectionTitle, { color: "#e65100" }]}>❓ הוסף כפריט זמני ({voiceResult.not_found.length})</Text>
                    {voiceResult.not_found.map((name) => {
                      const checked = checkedNotFound.has(name);
                      return (
                        <TouchableOpacity key={name} style={styles.voiceResultRow} onPress={() => setCheckedNotFound((prev) => {
                          const next = new Set(prev);
                          checked ? next.delete(name) : next.add(name);
                          return next;
                        })}>
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
                  {(voiceResult.found.length > 0 || checkedNotFound.size > 0) && (
                    <TouchableOpacity style={[styles.modalAddBtn, { flex: 1, marginBottom: 0 }]} onPress={handleAddAllFound}>
                      <Text style={styles.modalAddBtnText}>הוסף</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={[styles.modalCancelBtn, { flex: 1 }]} onPress={closeVoiceModal}>
                    <Text style={styles.modalCancelText}>סגור</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.fabButtonMic} onPress={handleReRecord}>
                    <Ionicons name="mic" size={20} color="#fff" />
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Temp item modal */}
      <Modal visible={tempModalVisible} transparent animationType="slide" onRequestClose={() => setTempModalVisible(false)} onShow={() => tempNameRef.current?.focus()}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setTempModalVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalBox, { paddingBottom: insets.bottom + 20, marginBottom: keyboardOffset }]}>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setTempModalVisible(false)}>
              <Text style={styles.modalCloseBtnText}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitleTemp}>פריט זמני לרשימה</Text>
            <Text style={styles.modalSubTemp}>הפריט יצורף לרשימה עד לסיום הקנייה</Text>
            <TextInput ref={tempNameRef} style={styles.searchInput} placeholder="שם הפריט..." value={tempName} onChangeText={setTempName} />
            <TouchableOpacity style={styles.modalAddBtnTemp} onPress={handleAddTemp} disabled={savingTemp}>
              <Text style={styles.modalAddBtnText}>{savingTemp ? "שומר..." : "הוסף לרשימה"}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Full-screen image viewer */}
      <Modal visible={!!viewImage} transparent animationType="fade" onRequestClose={() => setViewImage(null)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.9)", justifyContent: "center", alignItems: "center" }} activeOpacity={1} onPress={() => setViewImage(null)}>
          {viewImage && (
            <Image source={{ uri: `data:image/jpeg;base64,${viewImage}` }} style={{ width: "90%", height: "70%", resizeMode: "contain" }} />
          )}
        </TouchableOpacity>
      </Modal>

      {/* Add extra item modal */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)} onShow={() => extraSearchRef.current?.focus()}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setModalVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalBox, { paddingBottom: insets.bottom + 20, marginBottom: keyboardOffset }]}>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setModalVisible(false)}>
              <Text style={styles.modalCloseBtnText}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>הוסף פריט לרשימה</Text>
            <Text style={styles.modalSubTemp}>הפריט יצורף לרשימה עד לסיום הקנייה</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="חפש או הקלד שם פריט..."
              ref={extraSearchRef}
              value={search}
              onChangeText={setSearch}
            />
            <ScrollView style={styles.suggestionList} keyboardShouldPersistTaps="handled">
              {filteredNames.slice(0, 20).map((name) => (
                <TouchableOpacity key={name} style={styles.suggestionItem} onPress={() => handleAddExtra(name)}>
                  <Text style={styles.suggestionText}>{name} {getItemIcon(name)}</Text>
                </TouchableOpacity>
              ))}
              {search.trim().length > 0 && filteredNames.length === 0 && (
                <Text style={styles.noResultsText}>הפריט לא קיים במלאי</Text>
              )}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const BLUE = "#0288D1";

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f0f8ff" },
  summaryBar: { backgroundColor: BLUE, paddingVertical: 10, paddingHorizontal: 16, alignItems: "center" },
  summaryText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  list: { padding: 12 },
  card: {
    flexDirection: "row-reverse",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginBottom: 4,
    elevation: 1,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  cardUnchecked: { opacity: 0.6 },
  cardDone: { backgroundColor: "#e8f5e9" },
  nameDone: { color: "#388e3c", textDecorationLine: "line-through" },
  qtyDone: { color: "#388e3c", borderColor: "#a5d6a7", backgroundColor: "#c8e6c9" },
  cardExtra: { backgroundColor: "#e8f4fd", borderRadius: 10 },
  left: { width: 38, alignItems: "center", justifyContent: "center" },
  checkbox: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: BLUE, alignItems: "center", justifyContent: "center" },
  checkboxChecked: { backgroundColor: BLUE },
  checkmark: { color: "#fff", fontSize: 16, fontWeight: "700" },
  name: { flex: 1, fontSize: 16, color: "#1a1a1a", textAlign: "left", marginLeft: 12 },
  nameUnchecked: { color: "#bbb", textDecorationLine: "line-through" },
  extraBadge: { color: BLUE, fontWeight: "700" },
  qtyInput: { width: 34, height: 34, borderWidth: 1, borderColor: "#90caf9", borderRadius: 6, textAlign: "center", fontSize: 12, fontWeight: "900", color: "#1565c0", backgroundColor: "#e3f2fd", marginLeft: 4, paddingVertical: 0 },
  qtyDisabled: { color: "#ccc", borderColor: "#eee", backgroundColor: "#f5f5f5" },
  fabRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#f0f8ff",
  },
  fabButton: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    backgroundColor: BLUE,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: BLUE,
    shadowOpacity: 0.4,
    shadowRadius: 6,
  },
  fabText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  fabButtonTemp: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#e53935",
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: "#e53935",
    shadowOpacity: 0.4,
    shadowRadius: 6,
  },
  fabButtonMic: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: BLUE,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: BLUE,
    shadowOpacity: 0.4,
    shadowRadius: 6,
  },
  fabButtonMicActive: { backgroundColor: "#e53935", shadowColor: "#e53935" },
  voiceStatusRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  voiceDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: "#ccc", marginRight: 8 },
  voiceDotActive: { backgroundColor: "#e53935" },
  voiceStatusText: { fontSize: 16, color: "#555", textAlign: "center" },
  voiceTranscript: { fontSize: 15, color: "#333", textAlign: "right", backgroundColor: "#f8fbff", borderRadius: 8, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: "#e3f2fd" },
  voiceSectionTitle: { fontSize: 14, fontWeight: "700", color: "#1a7a1a", marginTop: 12, marginBottom: 6 },
  voiceResultRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  voiceResultName: { fontSize: 15, fontWeight: "600", color: "#1a1a1a" },
  voiceResultDetail: { fontSize: 13, color: "#888" },
  voiceAddBtn: { backgroundColor: BLUE, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  voiceAddBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  cardTemp: { backgroundColor: "#fff0f0" },
  footer: { flexDirection: "row-reverse", padding: 14, gap: 10, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#e1f5fe", elevation: 8 },
  btnCancel: { flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: "center", backgroundColor: "#ffebee", borderWidth: 1, borderColor: "#ffcdd2" },
  btnDone: { flex: 2, paddingVertical: 14, borderRadius: 10, alignItems: "center", backgroundColor: BLUE, elevation: 2 },
  btnDoneDisabled: { backgroundColor: "#B0BEC5", elevation: 0 },
  btnCancelText: { color: "#666", fontSize: 16, fontWeight: "600" },
  btnDoneText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalBox: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "80%" },
  modalTitle: { fontSize: 18, fontWeight: "700", textAlign: "center", marginBottom: 16, color: "#1a1a1a" },
  searchInput: { borderWidth: 1.5, borderColor: "#90caf9", borderRadius: 10, padding: 10, fontSize: 16, textAlign: "right", marginBottom: 12, backgroundColor: "#f8fbff" },
  modalQtyRow: { flexDirection: "row", alignItems: "center", marginBottom: 12, gap: 10 },
  modalQtyLabel: { fontSize: 15, color: "#555" },
  modalQtyInput: { width: 50, borderWidth: 1.5, borderColor: "#90caf9", borderRadius: 8, textAlign: "center", fontSize: 16, fontWeight: "700", color: "#1565c0", backgroundColor: "#e3f2fd", padding: 6 },
  suggestionList: { maxHeight: 200, marginBottom: 8 },
  suggestionItem: { paddingVertical: 12, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: "#f0f0f0" },
  suggestionText: { fontSize: 16, textAlign: "left", color: "#1a1a1a" },
  suggestionNewItem: { paddingVertical: 12, paddingHorizontal: 8, backgroundColor: "#e3f2fd", borderRadius: 8, marginBottom: 4 },
  suggestionNewText: { fontSize: 15, textAlign: "left", color: BLUE, fontWeight: "600" },
  modalAddBtn: { backgroundColor: BLUE, paddingVertical: 12, borderRadius: 10, alignItems: "center", marginBottom: 8 },
  modalAddBtnTemp: { backgroundColor: BLUE, paddingVertical: 12, borderRadius: 10, alignItems: "center", marginBottom: 8 },
  modalAddBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  modalCancelBtn: { paddingVertical: 10, paddingHorizontal: 24, borderRadius: 10, alignItems: "center", backgroundColor: "#ffebee", borderWidth: 1, borderColor: "#ffcdd2" },
  modalCloseBtn: { position: "absolute", top: 12, right: 12, width: 28, height: 28, alignItems: "center", justifyContent: "center", zIndex: 10 },
  modalCloseBtnText: { fontSize: 16, color: "#888", fontWeight: "700" },
  modalCancelText: { color: "#c62828", fontSize: 15, width: 50 },
  modalTitleTemp: { fontSize: 18, fontWeight: "700", textAlign: "center", marginBottom: 4 },
  modalSubTemp: { fontSize: 12, color: "#aaa", textAlign: "center", marginBottom: 16 },
  removeBtn: { marginLeft: 6, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },
  removeBtnText: { color: "#e53935", fontSize: 15, fontWeight: "700" },
  removeBtnDisabled: { color: "#ccc", fontSize: 15, fontWeight: "700" },
  tempLabel: { fontSize: 12, color: "#e53935", fontWeight: "600" },
  itemLabel: { fontSize: 12, color: BLUE, fontWeight: "600" },
  overdueLabel: { fontSize: 12, color: "#f57c00", fontWeight: "600" },
  noResultsText: { textAlign: "center", color: "#999", fontSize: 14, paddingVertical: 12 },
  selectAllBtn: { marginHorizontal: 12, marginTop: 8, marginBottom: 2, paddingVertical: 8, borderRadius: 10, alignItems: "center" },
  selectAllBtnSelect: { backgroundColor: "#c8f5c8" },
  selectAllBtnClear: { backgroundColor: "#ffdddd" },
  selectAllBtnText: { fontSize: 14, fontWeight: "700", color: "#333" },
});

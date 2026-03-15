import { useFocusEffect, useNavigation } from "@react-navigation/native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { ShoppingItem, fetchShoppingList } from "../api";
import { getItemIcon } from "../icons";

const BLUE = "#0288D1";

export default function SimulationScreen() {
  const navigation = useNavigation();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ShoppingItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSimulate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setItems(null);
    try {
      const result = await fetchShoppingList(true);
      setItems(result.shopping_list);
    } catch {
      setError("לא ניתן להתחבר לשרת.");
    } finally {
      setLoading(false);
    }
  }, []);

    const hasResults = useRef(false);
  useEffect(() => { hasResults.current = items !== null; }, [items]);

  useFocusEffect(useCallback(() => {
    if (hasResults.current) handleSimulate();
  }, [handleSimulate]));

  const calculateDaysAgo = (dateValue: string | number | Date): number => {
    const now = new Date();
    const past = new Date(dateValue);
    const diffInMs = now.getTime() - past.getTime();
    const days = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
    
    return isNaN(days) ? 0 : Math.max(0, days);
  };

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

  // Before results: centered card like ShoppingListScreen
  if (items === null && !loading && !error) {
    return (
      <View style={styles.centerContainer}>
        <View style={styles.card}>
          <Text style={styles.cardDesc}>רשימת קניות לצרכי סימולציה בלבד</Text>
          <TouchableOpacity style={styles.button} onPress={handleSimulate}>
            <Text style={styles.buttonText}>סמלץ</Text>
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
              const da = a.next_purchase_date ? new Date(a.next_purchase_date).getTime() : Infinity;
              const db = b.next_purchase_date ? new Date(b.next_purchase_date).getTime() : Infinity;
              return da - db;
            })}
            keyExtractor={(item) => item.item_name}
            renderItem={({ item }) => (
              <View style={[styles.row, item.item_type === "temporary" && styles.rowTemp, item.item_type === "manual" && styles.rowManual]}>
                <Text style={[styles.qty, item.is_temporary && styles.qtyTemp]}>{item.quantity_to_buy}</Text>
                <Text style={styles.name}>{item.item_name} {getItemIcon(item.item_name)}</Text>
                {item.last_purchased_date ? (
                    <Text style={styles.date}>
                      {`נקנה לפני ${calculateDaysAgo(item.last_purchased_date)} ימים`}
                    </Text>
                ) : (
                    <Text style={styles.date}>
                      {item.item_type === "manual" ? "התווסף ידנית מהמלאי" : "התווסף ידנית כזמני"}
                    </Text>
                )}
              </View>
            )}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centerContainer: { flex: 1, backgroundColor: "#f0f8ff", justifyContent: "center", padding: 20 },
  card: { backgroundColor: "#fff", borderRadius: 16, padding: 24, elevation: 4, shadowColor: BLUE, shadowOpacity: 0.12, shadowRadius: 10 },
  cardTitle: { fontSize: 22, fontWeight: "700", color: "#1a1a1a", textAlign: "center", marginBottom: 10 },
  cardDesc: { fontSize: 15, color: "#666", textAlign: "center", lineHeight: 22, marginBottom: 24 },
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  buttonTop: { margin: 16, backgroundColor: BLUE, paddingVertical: 14, borderRadius: 12, alignItems: "center", elevation: 2 },
  button: { backgroundColor: BLUE, paddingVertical: 16, borderRadius: 12, alignItems: "center", elevation: 2, shadowColor: BLUE, shadowOpacity: 0.3, shadowRadius: 6 },
  buttonText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  center: { flex: 1, justifyContent: "center", alignItems: "center"},
  error: { color: "red", textAlign: "center", padding: 12 },
  header: { paddingHorizontal: 16, paddingBottom: 8, paddingTop: 8, fontSize: 14, color: "#555", fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", marginHorizontal: 12, marginBottom: 8, borderRadius: 8, padding: 12, elevation: 1 },
  rowTemp: { backgroundColor: "#fff0f0" },
  rowManual: { backgroundColor: "#e8f4fd" },
  qty: { width: 36, fontSize: 16, fontWeight: "700", color: BLUE, textAlign: "center" },
  qtyTemp: { color: "#e53935" },
  name: { flex: 1, fontSize: 16, marginHorizontal: 8 },
  date: { fontSize: 12, color: "#666", width: 120, textAlign: "right" },
});

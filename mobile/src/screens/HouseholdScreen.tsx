import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import CartIcon from "../CartIcon";
import { createHousehold, joinHousehold } from "../api";

interface Props {
  onHouseholdReady: (householdId: string) => void;
}

export default function HouseholdScreen({ onHouseholdReady }: Props) {
  const [mode, setMode] = useState<"menu" | "join">("menu");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const id = await createHousehold();
      Alert.alert(
        "הרשימה נוצרה!",
        `קוד השיתוף שלך: ${id}\n\nשלח את הקוד לבני המשפחה כדי שיוכלו להצטרף.\nתוכל למצוא את הקוד גם בדף הפרופיל.`,
        [{ text: "אישור", onPress: () => onHouseholdReady(id) }]
      );
    } catch {
      Alert.alert("שגיאה", "לא ניתן ליצור רשימה. נסה שוב.");
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (code.trim().length < 6) {
      Alert.alert("שגיאה", "הכנס קוד בן 6 תווים");
      return;
    }
    setLoading(true);
    try {
      const id = await joinHousehold(code.trim());
      onHouseholdReady(id);
    } catch (e: any) {
      Alert.alert("שגיאה", e.message || "הקוד לא נמצא. בדוק שוב.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <CartIcon size={140} />
      <Text style={styles.title}>מנהל המכולת</Text>
      <Text style={styles.subtitle}>צור רשימה משפחתית או הצטרף לאחת קיימת</Text>

      {mode === "menu" ? (
        <View style={styles.btnGroup}>
          <TouchableOpacity style={styles.primaryBtn} onPress={handleCreate} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>צור רשימה משפחתית</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryBtn} onPress={() => setMode("join")} disabled={loading}>
            <Text style={styles.secondaryBtnText}>הצטרף לרשימה משפחתית</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.joinBox}>
          <Text style={styles.joinLabel}>הכנס קוד שיתוף</Text>
          <TextInput
            style={styles.codeInput}
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            placeholder="לדוגמה: ABC123"
            placeholderTextColor="#aaa"
            autoCapitalize="characters"
            maxLength={6}
            textAlign="center"
          />
          <TouchableOpacity style={styles.primaryBtn} onPress={handleJoin} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>הצטרף</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.backBtn} onPress={() => setMode("menu")} disabled={loading}>
            <Text style={styles.backBtnText}>חזור</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f0f8ff", alignItems: "center", justifyContent: "center", padding: 32 },
  title: { fontSize: 28, fontWeight: "800", color: "#0262A0", marginBottom: 8, marginTop: 16 },
  subtitle: { fontSize: 15, color: "#888", marginBottom: 48, textAlign: "center" },
  btnGroup: { width: "100%", gap: 16 },
  primaryBtn: {
    backgroundColor: "#0262A0",
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: "center",
    elevation: 4,
    shadowColor: "#0262A0",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    width: "100%",
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  secondaryBtn: {
    backgroundColor: "#fff",
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#0262A0",
    width: "100%",
  },
  secondaryBtnText: { color: "#0262A0", fontSize: 16, fontWeight: "700" },
  joinBox: { width: "100%", gap: 16, alignItems: "center" },
  joinLabel: { fontSize: 16, color: "#444", fontWeight: "600" },
  codeInput: {
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#0262A0",
    padding: 16,
    fontSize: 24,
    fontWeight: "800",
    color: "#0262A0",
    letterSpacing: 6,
  },
  backBtn: { marginTop: 4 },
  backBtnText: { color: "#888", fontSize: 15 },
});

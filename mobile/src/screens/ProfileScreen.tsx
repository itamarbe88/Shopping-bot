import React, { useEffect, useState } from "react";
import { Alert, Clipboard, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import CartIcon from "../CartIcon";
import { fetchHousehold } from "../api";
import { useAuth } from "../context/AuthContext";

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchHousehold().then(setHouseholdId);
  }, []);

  const handleCopy = () => {
    if (!householdId) return;
    Clipboard.setString(householdId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSignOut = () => {
    Alert.alert("התנתקות", "האם אתה בטוח שברצונך להתנתק?", [
      { text: "ביטול", style: "cancel" },
      { text: "התנתק", style: "destructive", onPress: signOut },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <CartIcon size={80} />
        <Text style={styles.appName}>מנהל המכולת</Text>
      </View>

      <View style={styles.card}>
        {user?.picture ? (
          <Image source={{ uri: user.picture }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarInitial}>{user?.name?.[0] ?? "?"}</Text>
          </View>
        )}
        <Text style={styles.name}>{user?.name}</Text>
        <Text style={styles.email}>{user?.email}</Text>
      </View>

      {householdId && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>רשימה משפחתית</Text>
          <Text style={styles.cardSubtitle}>שתף את הקוד עם בני המשפחה</Text>
          <View style={styles.codeRow}>
            <Text style={styles.codeText}>{householdId}</Text>
            <TouchableOpacity style={[styles.copyBtn, copied && styles.copyBtnDone]} onPress={handleCopy}>
              <Text style={styles.copyBtnText}>{copied ? "הועתק ✓" : "העתק"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
        <Text style={styles.signOutText}>התנתק</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: "#f0f8ff", alignItems: "center", padding: 24, paddingTop: 32 },
  header: { alignItems: "center", marginBottom: 24 },
  appName: { fontSize: 20, fontWeight: "800", color: "#0262A0", marginTop: 8 },
  card: {
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    marginBottom: 16,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  avatar: { width: 80, height: 80, borderRadius: 40, marginBottom: 12 },
  avatarPlaceholder: { width: 80, height: 80, borderRadius: 40, backgroundColor: "#0262A0", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  avatarInitial: { fontSize: 34, fontWeight: "800", color: "#fff" },
  name: { fontSize: 20, fontWeight: "700", color: "#1a1a1a", marginBottom: 4 },
  email: { fontSize: 14, color: "#888" },
  cardTitle: { fontSize: 16, fontWeight: "700", color: "#0262A0", marginBottom: 4 },
  cardSubtitle: { fontSize: 13, color: "#888", marginBottom: 16 },
  codeRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  codeText: { fontSize: 28, fontWeight: "800", color: "#0262A0", letterSpacing: 6 },
  copyBtn: { backgroundColor: "#0262A0", paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20 },
  copyBtnDone: { backgroundColor: "#43a047" },
  copyBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  signOutBtn: { marginTop: 8, backgroundColor: "#e53935", paddingVertical: 14, paddingHorizontal: 48, borderRadius: 30, elevation: 3 },
  signOutText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});

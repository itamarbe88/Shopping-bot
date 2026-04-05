import React from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const BLUE = "#0262A0";

interface Section {
  title: string;
  body: string;
}

const sections: Section[] = [
  {
    title: "מה זה סלבדור?",
    body: "סלבדור הוא עוזר קניות חכם שעוזר לכם לנהל את המלאי הביתי ולהכין רשימות קניות אוטומטיות. המערכת לומדת את דפוסי הצריכה של משק הבית שלכם ומציעה מתי ומה לקנות.",
  },
  {
    title: "מסך מלאי",
    body: "כאן תנהלו את כל מוצרי הבית שלכם. לכל פריט תגדירו כמות רצויה, כמות קיימת, ותדירות רכישה בימים. המערכת עוקבת אחרי הרכישה האחרונה ומחשבת מתי הפריט יזדקק לחידוש.",
  },
  {
    title: "מסך הכן רשימה",
    body: "כאן תוכלו לראות אילו פריטים המערכת מציעה לקנות ולכוונן את הרשימה לפני היציאה לקנות. תוכלו לשנות כמויות, להסיר פריטים שאינם נחוצים, ולהוסיף פריטים ידניים או זמניים.\n\nלחצן 'אפס תאריך' מאפשר להסיר פריט מהרשימה למרות שהמערכת חישבה שיש לקנותו — שימושי כשהפריט לא נרכש זמן רב אך כרגע אין בו צורך.",
  },
  {
    title: "מסך קניות",
    body: "זהו המסך שתשתמשו בו בסופרמרקט. הרשימה מוצגת בצורה נוחה לסימון פריטים שנקנו. בסיום הקנייה לחצו על 'סיימתי לקנות' ותאריכי הרכישה יתעדכנו אוטומטית.\n\nהמסך תומך במצב לא מקוון — אם אין אינטרנט בסופר, תוצג הרשימה האחרונה שהייתה בזיכרון.",
  },
  {
    title: "איך המערכת מחשבת מה לקנות?",
    body: "לכל פריט מחושב תאריך הרכישה הבאה על פי הנוסחה:\n\nתאריך רכישה אחרון + תדירות רכישה = תאריך רכישה הבאה\n\nאם התאריך הבא עבר (או מתקרב), הפריט יופיע ברשימה. ככל שהכמות הקיימת נמוכה יחסית לכמות הרצויה, כך עולה הדחיפות.",
  },
  {
    title: "שיתוף משק בית",
    body: "ניתן לשתף משק בית עם בני המשפחה. כל חבר שמצטרף עם קוד משק הבית יראה את אותו מלאי ורשימת קניות. שינויים של כל חבר מתעדכנים לכולם.",
  },
];

export default function AboutScreen() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", marginBottom: 4, gap: 12 }}>
        <Text style={styles.appTitle}>סלבדור</Text>
        <Image source={require("../../assets/icon.png")} style={{ width: 48, height: 48, borderRadius: 10 }} />
      </View>
      <Text style={styles.appSubtitle}>עוזר הקניות האישי שלכם</Text>
      {sections.map((s) => (
        <View key={s.title} style={styles.sectionShadow}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{s.title}</Text>
            <Text style={styles.sectionBody}>{s.body}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f0f8ff" },
  content: { padding: 20 },
  appTitle: { fontSize: 28, fontWeight: "800", color: BLUE, textAlign: "center", marginBottom: 4 },
  appSubtitle: { fontSize: 15, color: "#666", textAlign: "center", marginBottom: 28 },
  sectionShadow: {
    marginBottom: 14,
    elevation: 1,
    borderRadius: 12,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  section: {
    borderRadius: 12,
    padding: 16,
    paddingBottom: 24,
    overflow: "hidden",
  },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: BLUE, marginBottom: 8, textAlign: "left" },
  sectionBody: { fontSize: 14, color: "#333", lineHeight: 22, textAlign: "left" },
});

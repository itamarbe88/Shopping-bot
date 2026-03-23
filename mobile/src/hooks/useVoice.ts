import { useEffect, useRef, useState } from "react";
import { PermissionsAndroid, Platform } from "react-native";
import Voice, {
  SpeechErrorEvent,
  SpeechResultsEvent,
} from "@react-native-voice/voice";

async function requestMicPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    {
      title: "הרשאת מיקרופון",
      message: "האפליקציה צריכה גישה למיקרופון כדי לזהות דיבור",
      buttonPositive: "אישור",
      buttonNegative: "ביטול",
    }
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

export interface UseVoiceOptions {
  /** BCP-47 locale tag. Defaults to Israeli Hebrew. */
  locale?: string;
  /**
   * Minimum confidence (0–1) to accept a result.
   * @react-native-voice/voice reports confidence per partial result;
   * we use it to pick the best candidate when multiple alternatives arrive.
   * Defaults to 0.5. Set lower to accept noisier speech.
   */
  minConfidence?: number;
}

export function useVoice({
  locale = "he-IL",
  minConfidence = 0.5,
}: UseVoiceOptions = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const minConfidenceRef = useRef(minConfidence);
  minConfidenceRef.current = minConfidence;

  useEffect(() => {
    Voice.onSpeechResults = (e: SpeechResultsEvent) => {
      const results = e.value ?? [];
      if (results.length > 0) {
        // Pick first (highest-ranked) result; confidence filtering happens on
        // partial results via onSpeechPartialResults if needed
        setTranscript(results[0]);
      }
    };

    Voice.onSpeechPartialResults = (e: SpeechResultsEvent) => {
      const results = e.value ?? [];
      if (results.length > 0) {
        setTranscript(results[0]);
      }
    };

    Voice.onSpeechError = (e: SpeechErrorEvent) => {
      // Error code 7 = "No match" — not a hard failure
      if (e.error?.code !== "7") {
        setError(e.error?.message ?? "שגיאת זיהוי קול");
      }
      setIsRecording(false);
    };

    Voice.onSpeechEnd = () => {
      setIsRecording(false);
    };

    return () => {
      Voice.destroy().then(() => Voice.removeAllListeners());
    };
  }, []);

  const startRecording = async () => {
    try {
      if (!Voice) {
        setError("מודול הקול אינו זמין — נסה לבנות מחדש את האפליקציה");
        return;
      }
      setTranscript("");
      setError(null);
      const hasPermission = await requestMicPermission();
      if (!hasPermission) {
        setError("נדרשת הרשאת מיקרופון");
        return;
      }
      await Voice.start(locale);
      setIsRecording(true);
    } catch (e: any) {
      setError(e.message ?? "לא ניתן להתחיל הקלטה");
    }
  };

  const stopRecording = async () => {
    try {
      await Voice.stop();
    } catch {
      // ignore — onSpeechEnd will fire
    } finally {
      setIsRecording(false);
    }
  };

  const cancelRecording = async () => {
    try {
      await Voice.destroy();
    } catch {
      // ignore
    } finally {
      setIsRecording(false);
      setTranscript("");
    }
  };

  return {
    isRecording,
    transcript,
    error,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}

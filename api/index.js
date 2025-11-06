import axios from "axios";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const { hr, spo2, hrv, userId = "user1" } = req.body;
  const { FIREBASE_PROJECT_ID, FIREBASE_API_KEY } = process.env;

  if (!FIREBASE_PROJECT_ID || !FIREBASE_API_KEY) {
    return res.status(500).json({ error: "Firebase credentials missing" });
  }

  try {
    const docPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/user_display/${userId}/readings/latest`;

    const fields = {
      hr: { doubleValue: hr },
      spo2: { doubleValue: spo2 },
      hrv: { doubleValue: hrv },
      timestamp: { timestampValue: new Date().toISOString() },
    };

    // ✅ POST instead of PATCH ensures document is created if not exists
    await axios.post(
      `https://firestore.googleapis.com/v1/${docPath}?key=${FIREBASE_API_KEY}`,
      { fields }
    );

    res.status(200).json({ success: true, message: "Data uploaded" });
  } catch (error) {
    console.error("Firestore error:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to upload data" });
  }
}

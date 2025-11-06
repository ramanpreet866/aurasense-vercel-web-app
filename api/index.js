/**
 * AuraSense - Vercel Function
 * Receives HR/HRV/BT data from ESP32, sends it to the prediction API,
 * and writes the prediction to Firestore.
 */

const axios = require("axios");

const RENDER_API_ENDPOINT = "https://aurasense-api.onrender.com/predict";

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;

async function writeToFirestore(userId, data) {
  const docPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/user_display/${userId}/readings/latest`;

  const fields = {
    stress_level: { stringValue: data.stress_level },
    hr: { doubleValue: data.hr },
    timestamp: { timestampValue: new Date().toISOString() },
  };

  if (data.probabilities) {
    const probFields = {};
    for (const key in data.probabilities) {
      probFields[key] = { doubleValue: data.probabilities[key] };
    }
    fields.probabilities = { mapValue: { fields: probFields } };
  }

  try {
    await axios.post(
      `https://firestore.googleapis.com/v1/${docPath}?key=${FIREBASE_API_KEY}`,
      { fields }
    );
    console.log(`[Vercel Brain] ✅ Wrote to Firestore for user ${userId}`);
  } catch (error) {
    console.error(
      "[Vercel Brain] ❌ Error writing to Firestore:",
      error.response ? error.response.data : error.message
    );
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).send("Method Not Allowed");
  }

  const { hr, hrv, bt, userId } = req.body;

  if (!hr || !userId) {
    return res.status(400).send({ error: "Missing required fields: hr, userId" });
  }

  console.log(`[Vercel Brain] Received data for user ${userId}:`, req.body);

  const apiPayload = {
    mode: "raw",
    raw: {
      HR: hr,
      HRV: hrv,
      BT: bt,
    },
  };

  try {
    const apiResponse = await axios.post(RENDER_API_ENDPOINT, apiPayload);

    if (apiResponse.data && apiResponse.data.stress_level) {
      const prediction = apiResponse.data.stress_level;
      const probabilities = apiResponse.data.probabilities || null;

      console.log(`[Vercel Brain] ✅ Prediction: ${prediction}`);

      await writeToFirestore(userId, {
        stress_level: prediction,
        probabilities,
        hr,
      });

      return res.status(200).send({ success: true, prediction });
    } else {
      console.error(
        "[Vercel Brain] ⚠️ API returned unexpected format:",
        apiResponse.data
      );
      return res.status(500).send({ error: "Internal - Bad API Response" });
    }
  } catch (error) {
    console.error("[Vercel Brain] ❌ Error calling prediction API:", error.message);
    if (error.response) console.error("API Error Data:", error.response.data);
    return res.status(500).send({ error: "Internal - API Call Failed" });
  }
};

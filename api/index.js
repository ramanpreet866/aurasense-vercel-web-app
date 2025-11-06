/**
 * VERCEL Serverless Function (Node.js)
 *
 * This function acts as the "brain" for your project.
 * It:
 * 1. Receives raw data (HR, HRV, BT, userId) from the ESP32.
 * 2. Calls your hosted API on Render with that raw data.
 * 3. Gets the stress prediction.
 * 4. Writes that prediction to the correct Firestore document.
 */

const axios = require("axios");

// Your hosted API endpoint
const RENDER_API_ENDPOINT = "https://aurasense-api.onrender.com/predict";

// Environment variables (set these in Vercel Dashboard → Settings → Environment Variables)
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;

/**
 * Writes the final data to Firestore using REST API (no admin SDK required)
 * @param {string} userId - The user's UID
 * @param {object} data - Data to write (stress_level, hr, probabilities, etc.)
 */
async function writeToFirestore(userId, data) {
  // ✅ Correct Firestore path: user_display/{userId}/readings/latest
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
    await axios.patch(
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

/**
 * Main handler for Vercel
 */
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
    // Call your hosted API on Render
    const apiResponse = await axios.post(RENDER_API_ENDPOINT, apiPayload);

    if (apiResponse.data && apiResponse.data.stress_level) {
      const prediction = apiResponse.data.stress_level;
      const probabilities = apiResponse.data.probabilities || null;

      console.log(`[Vercel Brain] ✅ API Success. Prediction: ${prediction}`);

      // Write prediction to Firestore
      await writeToFirestore(userId, {
        stress_level: prediction,
        probabilities: probabilities,
        hr: hr,
      });

      return res.status(200).send({ success: true, prediction: prediction });
    } else {
      console.error(
        "[Vercel Brain] ⚠️ API returned unexpected format:",
        apiResponse.data
      );
      return res.status(500).send({ error: "Internal - Bad API Response" });
    }
  } catch (error) {
    console.error("[Vercel Brain] ❌ Error calling prediction API:", error.message);
    if (error.response) {
      console.error("API Error Data:", error.response.data);
    }
    return res.status(500).send({ error: "Internal - API Call Failed" });
  }
};

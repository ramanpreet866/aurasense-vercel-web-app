/**
 * VERCEL Serverless Function (Node.js)
 *
 * This function acts as the "brain" or "glue" for your project.
 * It lives at `https://<your-project>.vercel.app/api`
 *
 * ACTION:
 * 1. Receives raw data (HR, HRV, BT, userId) from the ESP32.
 * 2. Calls your *existing* hosted API (on Render) with that raw data.
 * 3. Gets the final stress prediction from your API.
 * 4. Writes that prediction to the correct Firestore document.
 */

const axios = require('axios');

// This is the public URL of your API (which you provided)
const RENDER_API_ENDPOINT = "https://aurasense-api.onrender.com/predict";

// Environment variables you must set in Vercel
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;

/**
 * Writes the final data to the Firestore database using the REST API.
 * This avoids needing a complex admin service account.
 *
 * @param {string} userId - The user's UID (from ESP32)
 * @param {object} data - The data to write (stress_level, hr, etc.)
 */
async function writeToFirestore(userId, data) {
  // Format the data for the Firestore REST API (patch)
  // This will create or overwrite the "latest" document
  const docPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/user_display/${userId}/latest`;

  const fields = {
    stress_level: { stringValue: data.stress_level },
    hr: { doubleValue: data.hr },
    timestamp: { timestampValue: new Date().toISOString() },
  };

  if (data.probabilities) {
    // Need to convert JS object to Firestore Map
    const probFields = {};
    for (const key in data.probabilities) {
      probFields[key] = { doubleValue: data.probabilities[key] };
    }
    fields.probabilities = { mapValue: { fields: probFields } };
  }

  try {
    // We use axios.patch to create or overwrite the doc
    await axios.patch(
      `https://firestore.googleapis.com/v1/${docPath}?key=${FIREBASE_API_KEY}`,
      { fields }
    );
    console.log(`[Vercel Brain] Wrote to Firestore for user ${userId}`);
  } catch (error) {
    console.error("[Vercel Brain] Error writing to Firestore:", error.response ? error.response.data : error.message);
  }
}

/**
 * The main Vercel function handler.
 */
module.exports = async (req, res) => {
  // 1. Check if it's a POST request
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).send('Method Not Allowed');
  }

  // 2. Get the raw data from the ESP32
  const { hr, hrv, bt, userId } = req.body;

  if (!hr || !userId) {
    return res.status(400).send({ error: "Missing required fields: hr, userId" });
  }

  console.log(`[Vercel Brain] Received data for user ${userId}:`, req.body);

  // 3. Format the payload for *your* Render API
  const apiPayload = {
    mode: "raw",
    raw: {
      HR: hr,
      HRV: hrv,
      BT: bt,
    }
  };

  try {
    // 4. Call your hosted API on Render
    const apiResponse = await axios.post(RENDER_API_ENDPOINT, apiPayload);

    if (apiResponse.data && apiResponse.data.stress_level) {
      const prediction = apiResponse.data.stress_level;
      const probabilities = apiResponse.data.probabilities || null;

      console.log(`[Vercel Brain] API Success. Prediction: ${prediction}`);

      // 5. Write the *final prediction* to the display document
      await writeToFirestore(userId, {
        stress_level: prediction,
        probabilities: probabilities,
        hr: hr,
      });

      // 6. Send a 200 OK response back to the ESP32
      return res.status(200).send({ success: true, prediction: prediction });

    } else {
      console.error("[Vercel Brain] API response was successful but format was unexpected:", apiResponse.data);
      return res.status(500).send({ error: "Internal - Bad API Response" });
    }

  } catch (error) {
    console.error("[Vercel Brain] Error calling prediction API:", error.message);
    if (error.response) {
      console.error("API Error Data:", error.response.data);
    }
    return res.status(500).send({ error: "Internal - API Call Failed" });
  }
};
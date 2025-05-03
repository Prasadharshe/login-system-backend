// Load .env variables at the top
require("dotenv").config();
const timezones = require('./timezones.json');
const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
const { v4: uuidv4 } = require("uuid");
const { SessionsClient } = require("@google-cloud/dialogflow");
const axios = require("axios");
const moment = require('moment-timezone');

const app = express();
const PORT = process.env.PORT || 3000;

// Validate required environment variables
const MONGO_URI = process.env.MONGO_URI;
const DIALOGFLOW_KEY_PATH = process.env.DIALOGFLOW_KEY_PATH;
const DIALOGFLOW_PROJECT_ID = process.env.DIALOGFLOW_PROJECT_ID;

if (!MONGO_URI || !DIALOGFLOW_KEY_PATH || !DIALOGFLOW_PROJECT_ID) {
  console.error("❌ Missing required environment variables in .env");
  process.exit(1);
}

// ✅ Create Dialogflow session client using key file
const sessionClient = new SessionsClient({
  keyFilename: process.env.DIALOGFLOW_KEY_PATH,
});

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, "../login-system-frontend")));

// MongoDB Connection
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// User schema & model
const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  password: String,
});
const User = mongoose.model("User", userSchema);

const messageSchema = new mongoose.Schema({
  userMessage: String,
  botReply: String,
  timestamp: {
    type: Date,
    default: Date.now,
  },  
});
const Message = mongoose.model("Message", messageSchema);

function getCurrentTime(inputText) {
  // Normalize input text by trimming and converting to lowercase
  const lowerText = inputText.toLowerCase().trim();
  console.log("Normalized Input:", lowerText);

  const prefix = "time in ";
  
  // Remove the "time in " prefix from the input if it exists
  let locationInput = lowerText.startsWith(prefix) ? lowerText.slice(prefix.length) : lowerText;
  locationInput = locationInput.trim();
  console.log("Input for matching:", locationInput);

  // List all keys in the timezones object
  const inputKeys = Object.keys(timezones);

  // Try to find a key in the timezones object that matches the input city (case-insensitive)
  const matchedKey = inputKeys.find(key => key.toLowerCase() === locationInput.toLowerCase());
  console.log("Matched Key:", matchedKey);

  // If no match is found, return a warning message with the server time
  if (!matchedKey) {
    return `⚠️ I couldn't find the timezone for "${locationInput}". Server time is ${moment().format('dddd, MMMM Do YYYY, h:mm:ss A')}`;
  }

  // If a match is found, get the corresponding timezone
  const tz = timezones[matchedKey];

  // Return the current time in the matched timezone using Moment.js
  return `🕒 Current time in ${matchedKey} is ${moment().tz(tz).format('dddd, MMMM Do YYYY, h:mm:ss A')}`;
}


// Registration route
app.post("/register", async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: "❌ All fields are required" });
  }

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "❌ Email already exists" });
    }

    const newUser = new User({ name, email, password });
    await newUser.save();
    res.status(201).json({ message: "✅ Registration successful" });
  } catch (error) {
    console.error("❌ Registration Error:", error);
    res.status(500).json({ message: "❌ Server Error" });
  }
});

// Login route
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email, password });
    if (!user) {
      return res.status(401).json({ message: "❌ Invalid Email or Password" });
    }

    res.json({ message: "✅ Login Successful", name: user.name });
  } catch (error) {
    console.error("❌ Login Error:", error);
    res.status(500).json({ message: "❌ Server Error" });
  }
});

// Chatbot route (UPDATED with intent handling)
app.post("/api/chat", async (req, res) => {
  const { message } = req.body;
  const sessionId = uuidv4();
  const sessionPath = sessionClient.projectAgentSessionPath(
    DIALOGFLOW_PROJECT_ID,
    sessionId
  );

  try {
    const request = {
      session: sessionPath,
      queryInput: {
        text: {
          text: message,
          languageCode: "en-US",
        },
      },
    };

    const responses = await sessionClient.detectIntent(request);
    const result = responses[0].queryResult;
    let reply = result.fulfillmentText;

    // Handle custom intents manually
    if (result.intent) {
      const intentName = result.intent.displayName;

      switch (intentName) {
        case "TimeIntent":
          const city = result.parameters?.fields?.["geo-city"]?.stringValue || null;
          reply = await getCurrentTime(city || "your location");
          
          break;

        case "JokeIntent":
          try {
            const category = result.parameters["joke-category"] || "Any";
            const validCategories = [
              "Programming",
              "Miscellaneous",
              "Dark",
              "Pun",
              "Spooky",
              "Christmas",
            ];

            const selectedCategory = validCategories.includes(
              category.charAt(0).toUpperCase() + category.slice(1).toLowerCase()
            )
              ? category.charAt(0).toUpperCase() +
                category.slice(1).toLowerCase()
              : "Any";

            const jokeResponse = await axios.get(
              `https://v2.jokeapi.dev/joke/${selectedCategory}`
            );

            const jokeData = jokeResponse.data;

            if (jokeData.error) {
              reply = "😅 I couldn't fetch a joke right now.";
            } else if (jokeData.type === "single") {
              reply = `😂 (${jokeData.category} Joke) ${jokeData.joke}`;
            } else {
              reply = `😂 (${jokeData.category} Joke) ${jokeData.setup} ${jokeData.delivery}`;
            }
          } catch (error) {
            console.error("❌ Joke API error:", error.message);
            reply = "😅 I couldn't fetch a joke right now.";
          }
          break;

        case "WeatherIntent":
          try {
            let city =
              result.parameters?.fields?.["geo-city"]?.stringValue || null;

            // Fallback from message text (regex)
            if (!city || city.trim() === "") {
              const regexMatch = message.match(
                /(?:in|at|for)\s+([A-Za-z\s]+?)(?:\?|\.|$)/i
              );
              if (regexMatch && regexMatch[1]) {
                city = regexMatch[1].trim().replace(/[^\w\s]/gi, "");
              }
            }

            city = city || "New Delhi";

            const weatherResponse = await axios.get(
              `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(
                city
              )}&appid=${process.env.OPENWEATHER_API_KEY}&units=metric`
            );
            const weatherData = weatherResponse.data;
            reply = `🌤️ Weather in ${city}: ${weatherData.weather[0].description}, ${weatherData.main.temp}°C`;
          } catch (error) {
            console.log("👉 Extracted geo-city:", city);
            console.error("❌ Weather API error:", error.message);
            reply = "⚠️ I couldn't fetch the weather right now.";
          }
          break;
        default:
          if (!reply) {
            reply = "🤖 I’m not sure how to respond to that.";
          }
      }
    }

    // Save message to MongoDB
    await Message.create({ userMessage: message, botReply: reply });

    res.json({ reply });
  } catch (error) {
    console.error("❌ Chatbot Error:", error);
    res.status(500).json({ reply: "Sorry, the AI is currently unavailable." });
  }
});

// Webhook route (updated with dynamic joke & weather API support)
app.post("/webhook", express.json(), async (req, res) => {
  const intent = req.body.queryResult.intent.displayName;
  const parameters = req.body.queryResult.parameters || {};
  const userMessage = req.body.queryResult.queryText || "";
  let responseText = "🤖 I'm not sure how to help with that.";

  try {
    if (intent === "TimeIntent") {
      const location =
        parameters["geo-city"] ||
        parameters["geo-country"] ||
        parameters["geo-state"] ||
        "";
    
      responseText = await getCurrentTime(location || "your location");
    }   
    else if (intent === "WeatherIntent") {
      let city = parameters["geo-city"];

      // Fallback: extract city from user's message manually
      if (!city || city.trim() === "") {
        const regexMatch = userMessage.match(
          /(?:in|at|for)\s+([A-Za-z\s]+?)(?:\?|\.|$)/i
        );
        if (regexMatch && regexMatch[1]) {
          city = regexMatch[1].trim().replace(/[^\w\s]/gi, ""); // Clean punctuation
        }
      }

      city = city || "New Delhi"; // default fallback
      console.log("🌍 Detected city:", city);

      try {
        const weatherResponse = await axios.get(
          `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(
            city
          )}&appid=${process.env.OPENWEATHER_API_KEY}&units=metric`
        );
        const weatherData = weatherResponse.data;
        responseText = `🌦️ Weather in ${city}: ${weatherData.weather[0].description}, ${weatherData.main.temp}°C`;
      } catch (error) {
        console.error("❌ Weather API error:", error.message);
        responseText = `⚠️ I couldn't fetch the weather for ${city}.`;
      }
    } else if (intent === "JokeIntent") {
      try {
        let category = parameters["joke-category"] || "Any";
        const validCategories = [
          "Programming",
          "Miscellaneous",
          "Dark",
          "Pun",
          "Spooky",
          "Christmas",
        ];

        // Capitalize first letter for proper matching
        category =
          category.charAt(0).toUpperCase() + category.slice(1).toLowerCase();

        const selectedCategory = validCategories.includes(category)
          ? category
          : "Any";

        const jokeResponse = await axios.get(
          `https://v2.jokeapi.dev/joke/${selectedCategory}`
        );

        const joke = jokeResponse.data;

        if (joke.error) {
          responseText = "😅 I couldn't fetch a joke right now.";
        } else if (joke.type === "single") {
          responseText = `😂 (${joke.category}) ${joke.joke}`;
        } else {
          responseText = `😂 (${joke.category}) ${joke.setup} ${joke.delivery}`;
        }
      } catch (error) {
        console.error("❌ Joke API error:", error.message);
        responseText = "😅 I couldn't fetch a joke right now.";
      }
    }

    res.json({
      fulfillmentText: responseText,
    });
  } catch (err) {
    console.error("❌ Webhook processing error:", err);
    console.log("🌍 Extracted geo-city:", parameters["geo-city"]);
    console.log("🗣️ User message:", userMessage);
    res.json({
      fulfillmentText:
        "⚠️ Sorry, something went wrong while processing your request.",
    });
  }
});

// View all chat logs (for admin/debug)
app.get("/api/chatlogs", async (req, res) => {
  try {
    const logs = await Message.find().sort({ timestamp: -1 }); // newest first
    res.json(logs);
  } catch (error) {
    console.error("❌ Failed to fetch chat logs:", error);
    res.status(500).json({ message: "❌ Unable to retrieve logs" });
  }
});

// Test route
app.get("/", (req, res) => {
  res.send("🎉 Backend is working!");
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

require("dotenv").config(); // Load .env variables
const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Allows frontend to talk to backend
app.use(bodyParser.json()); // Parse JSON request bodies

// Serve static frontend files
app.use(express.static(path.join(__dirname, "../login-system-frontend")));

// MongoDB Connection
// const mongoURI = process.env.MONGO_URI || "mongodb://localhost:27017/loginDB";
// mongoose
//   .connect(mongoURI)
//   .then(() => console.log("✅ Connected to MongoDB"))
//   .catch((err) => {
//     console.error("❌ MongoDB Connection Error:", err);
//     process.exit(1);
//   });

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log("Connected to MongoDB Atlas");
}).catch((err) => {
  console.error("MongoDB connection error:", err);
});

// Define User Schema & Model
const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  password: String,
});
const User = mongoose.model("User", userSchema);

// Handle User Registration
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
    res.status(201).json({
      message: "✅ Registration successful, Redirecting to dashboard",
    });
  } catch (error) {
    console.error("❌ Registration Error:", error);
    res.status(500).json({ message: "❌ Server Error" });
  }
});

// Handle User Login
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email, password });
    if (!user) {
      return res.status(401).json({ message: "❌ Invalid Email or Password" });
    }

    // Send the user's name along with the success message
    res.json({ message: "✅ Login Successful, Redirecting..", name: user.name });
  } catch (error) {
    console.error("❌ Login Error:", error);
    res.status(500).json({ message: "❌ Server Error" });
  }
});

// Start Server
app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);

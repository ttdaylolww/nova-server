import express from "express";

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Server works");
});

app.post("/chat", async (req, res) => {
  try {
    const messages = req.body.messages;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ reply: "Нет сообщений" });
    }

    const geminiContents = messages.map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }]
    }));

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: geminiContents
        })
      }
    );

    const data = await response.json();

    console.log("GEMINI STATUS:", response.status);
    console.log("GEMINI DATA:", JSON.stringify(data, null, 2));

    if (!response.ok) {
      return res.status(response.status).json({
        reply: data?.error?.message || "Ошибка Gemini API"
      });
    }

    let reply = "";

    if (
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text
    ) {
      reply = data.candidates[0].content.parts[0].text;
    }

    if (!reply.trim()) {
      reply = "Модель ответила, но текст не удалось извлечь";
    }

    res.json({ reply });
  } catch (error) {
    console.error("SERVER ERROR:", error);
    res.status(500).json({
      reply: "Ошибка сервера"
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});

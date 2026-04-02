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

    const input = messages.map((msg) => ({
      role: msg.role,
      content: msg.content
    }));

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: input
      })
    });

    const data = await response.json();

    res.json({
      reply: data.output_text || "Нет ответа"
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      reply: "Ошибка сервера"
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});

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

    console.log("OPENAI STATUS:", response.status);
    console.log("OPENAI DATA:", JSON.stringify(data, null, 2));

    if (!response.ok) {
      return res.status(response.status).json({
        reply: data?.error?.message || "Ошибка OpenAI"
      });
    }

    let reply = "";

    if (typeof data.output_text === "string" && data.output_text.trim() !== "") {
      reply = data.output_text;
    } else if (Array.isArray(data.output)) {
      for (const item of data.output) {
        if (Array.isArray(item.content)) {
          for (const part of item.content) {
            if (part.type === "output_text" && part.text) {
              reply += part.text;
            }
          }
        }
      }
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

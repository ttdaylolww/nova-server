import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 3000;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "NOVA server is running"
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    model: MODEL
  });
});

app.post("/chat", async (req, res) => {
  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];

    if (!DEEPSEEK_API_KEY) {
      return res.status(500).json({
        reply: "На сервере не задан DEEPSEEK_API_KEY"
      });
    }

    if (messages.length === 0) {
      return res.status(400).json({
        reply: "Сообщения не переданы"
      });
    }

    const systemMessage = {
      role: "system",
      content:
        "Ты NOVA Coach — дружелюбный фитнес-коуч в приложении NOVA. Отвечай на русском языке. Пиши понятно, структурно, с нормальными переносами строк. Можно использовать markdown: заголовки, списки, жирный текст. Не пиши слишком заумно. Если вопрос про тренировки, питание, восстановление, мотивацию — отвечай как полезный коуч."
    };

    const payload = {
      model: MODEL,
      messages: [systemMessage, ...messages],
      temperature: 0.7,
      max_tokens: 1000,
      stream: false
    };

    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const rawText = await response.text();

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      return res.status(500).json({
        reply: `Ошибка чтения ответа DeepSeek: ${rawText}`
      });
    }

    if (!response.ok) {
      return res.status(response.status).json({
        reply: data?.error?.message || rawText || "Ошибка DeepSeek"
      });
    }

    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      "Пустой ответ от модели";

    return res.json({ reply });
  } catch (error) {
    return res.status(500).json({
      reply: `Ошибка сервера: ${error.message}`
    });
  }
});

app.listen(PORT, () => {
  console.log(`NOVA server running on port ${PORT}`);
});

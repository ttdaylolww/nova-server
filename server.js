import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

if (!process.env.DEEPSEEK_API_KEY) {
  console.error("Ошибка: не найден DEEPSEEK_API_KEY");
  process.exit(1);
}

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com"
});

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "NOVA DeepSeek server is running"
  });
});

app.post("/chat", async (req, res) => {
  try {
    const { messages } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        reply: "Ошибка: массив messages пустой или не передан"
      });
    }

    const normalizedMessages = messages
      .filter((msg) => msg && typeof msg.role === "string")
      .map((msg) => ({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: typeof msg.content === "string" ? msg.content : ""
      }))
      .filter((msg) => msg.content.trim().length > 0);

    if (normalizedMessages.length === 0) {
      return res.status(400).json({
        reply: "Ошибка: нет корректных сообщений для отправки"
      });
    }

    const systemMessage = {
      role: "system",
      content:
        "Ты NOVA Coach — дружелюбный ИИ-коуч по тренировкам, питанию, восстановлению и мотивации. " +
        "Отвечай на русском языке, понятно, естественно и без лишней воды. " +
        "Если уместно, используй списки. " +
        "Можно использовать markdown: **жирный**, *курсив*, списки."
    };

    const completion = await client.chat.completions.create({
      model: "deepseek-chat",
      messages: [systemMessage, ...normalizedMessages],
      temperature: 0.7,
      max_tokens: 1000,
      stream: false
    });

    const reply = completion?.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      return res.status(500).json({
        reply: "Ошибка: DeepSeek не вернул текст ответа"
      });
    }

    res.json({ reply });
  } catch (error) {
    console.error("Ошибка /chat:", error);

    const status = error?.status || 500;
    const message =
      error?.error?.message ||
      error?.message ||
      "Неизвестная ошибка сервера";

    res.status(status).json({
      reply: `Ошибка сервера: ${message}`
    });
  }
});

app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});

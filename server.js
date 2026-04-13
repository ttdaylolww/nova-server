import express from "express";
import cors from "cors";
import dotenv from "dotenv";

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const OpenAI = require("openai").default;
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ─────────────────────────────────────────────
// Инициализация
// ─────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;

// OpenAI клиент — ключ только из .env, не хардкодим
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Модели через .env
const VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4o";
const CHAT_MODEL   = process.env.OPENAI_CHAT_MODEL   || "gpt-4o";

// ─────────────────────────────────────────────
// Загрузка локальной food database
// ИСТОЧНИК ДАННЫХ: меняется здесь — см. функцию lookupNutrientsUSDA
// ─────────────────────────────────────────────
const DB_PATH = path.join(__dirname, "data", "food_database.json");
const foodDB = JSON.parse(fs.readFileSync(DB_PATH, "utf-8")).foods;

// ─────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "*")
  .split(",").map(s => s.trim());

app.use(cors({
  origin: (origin, cb) => {
    if (allowedOrigins.includes("*") || !origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error("Not allowed by CORS"));
  },
}));

app.use(express.json({ limit: "10mb" }));

// ─────────────────────────────────────────────
// Multer — multipart/form-data, только изображения
// ─────────────────────────────────────────────
const ALLOWED_MIME = ["image/jpeg","image/jpg","image/png","image/webp","image/heic"];
const MAX_FILE_MB = 15;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error(`Недопустимый тип файла: ${file.mimetype}`));
    }
  },
});

// ─────────────────────────────────────────────
// Промпт для GPT-4o Vision
// ─────────────────────────────────────────────
const FOOD_ANALYSIS_PROMPT = `
You are a professional nutritionist analyzing a food photo.
Identify ALL food items visible. Estimate portion weight in grams.

STRICT RULES:
1. Return ONLY valid JSON — no text before or after.
2. Lower confidence (0.0–1.0) if unsure.
3. Do NOT invent items you cannot see.
4. If no food visible — return empty items array.

Return EXACTLY this JSON:
{
  "items": [
    {
      "name_ru": "название на русском",
      "name_en": "name in English",
      "estimated_weight_g": 200,
      "confidence": 0.85,
      "alternatives_ru": ["альтернатива 1", "альтернатива 2"]
    }
  ]
}
`;

// ─────────────────────────────────────────────
// Поиск нутриентов — локальная база
// ─────────────────────────────────────────────
function lookupNutrientsLocal(nameRu, nameEn) {
  const queries = [nameRu, nameEn]
    .map(s => (s || "").toLowerCase().trim())
    .filter(Boolean);

  let best = null, bestScore = 0;

  for (const food of foodDB) {
    for (const q of queries) {
      for (const alias of food.names) {
        const a = alias.toLowerCase();
        if (a === q) return { food, score: 1.0, matched: alias };
        if (a.includes(q) || q.includes(a)) {
          const score = Math.min(a.length, q.length) / Math.max(a.length, q.length);
          if (score > bestScore) { best = food; bestScore = score; }
        }
      }
    }
  }

  if (best && bestScore >= 0.4) return { food: best, score: bestScore, matched: best.names[0] };
  const fallback = foodDB.find(f => f.id === "mixed_dish");
  return { food: fallback, score: 0.0, matched: "mixed_dish" };
}

// ─────────────────────────────────────────────
// Поиск через USDA FoodData Central (опционально)
// Включается автоматически при наличии USDA_API_KEY в .env
// Документация: https://fdc.nal.usda.gov/api-guide.html
// ─────────────────────────────────────────────
async function lookupNutrientsUSDA(query) {
  if (!process.env.USDA_API_KEY) return null;
  try {
    const resp = await axios.get("https://api.nal.usda.gov/fdc/v1/foods/search", {
      params: {
        query,
        api_key: process.env.USDA_API_KEY,
        pageSize: 1,
        dataType: "SR Legacy,Foundation",
      },
      timeout: 5000,
    });
    const hit = resp.data?.foods?.[0];
    if (!hit) return null;
    const get = (num) => hit.foodNutrients?.find(n => n.nutrientNumber === num)?.value ?? 0;
    return {
      calories_per_100g: get("208"),
      protein_per_100g:  get("203"),
      fat_per_100g:      get("204"),
      carbs_per_100g:    get("205"),
    };
  } catch { return null; }
}

// ─────────────────────────────────────────────
// Расчёт нутриентов для одного элемента
// ─────────────────────────────────────────────
async function calcNutrients(nameRu, nameEn, weightG) {
  const usdaData = await lookupNutrientsUSDA(nameEn || nameRu);
  let per100, estimationNote = null, source;

  if (usdaData) {
    per100 = usdaData;
    source = "usda";
  } else {
    const { food, score, matched } = lookupNutrientsLocal(nameRu, nameEn);
    per100 = food;
    source = "local";
    if (score < 0.5) {
      estimationNote = `Приблизительная оценка по ближайшему совпадению в базе (${matched})`;
    }
  }

  const f = weightG / 100;
  return {
    calories:  Math.round(per100.calories_per_100g * f),
    protein_g: Math.round(per100.protein_per_100g  * f * 10) / 10,
    fat_g:     Math.round(per100.fat_per_100g      * f * 10) / 10,
    carbs_g:   Math.round(per100.carbs_per_100g    * f * 10) / 10,
    nutrition_source: source,
    ...(estimationNote ? { estimation_note: estimationNote } : {}),
  };
}

// ─────────────────────────────────────────────
// POST /analyze-food-photo
// ─────────────────────────────────────────────
app.post("/analyze-food-photo", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "Файл не получен. Поле: 'photo'." });
    }

    const base64Image = req.file.buffer.toString("base64");
    const mimeType    = req.file.mimetype;

    // Запрос к GPT-4o Vision
    let aiRaw;
    try {
      const response = await openai.chat.completions.create({
        model: VISION_MODEL,
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: FOOD_ANALYSIS_PROMPT },
            { type: "image_url", image_url: {
              url: `data:${mimeType};base64,${base64Image}`,
              detail: "high",
            }},
          ],
        }],
      });
      aiRaw = response.choices[0]?.message?.content ?? "";
    } catch (aiErr) {
      console.error("Vision error:", aiErr.message);
      return res.status(502).json({ success: false, error: "Ошибка анализа: " + aiErr.message });
    }

    // Парсинг JSON — убираем возможный ```json блок
    let aiData;
    try {
      const cleaned = aiRaw.replace(/```json\n?|```/g, "").trim();
      aiData = JSON.parse(cleaned);
    } catch {
      console.error("JSON parse error. AI returned:", aiRaw);
      return res.status(502).json({ success: false, error: "Модель вернула некорректный JSON." });
    }

    if (!Array.isArray(aiData.items)) {
      return res.status(422).json({ success: false, error: "Некорректная структура ответа модели." });
    }

    if (aiData.items.length === 0) {
      return res.json({
        success: true, items: [],
        total_calories: 0, total_protein_g: 0, total_fat_g: 0, total_carbs_g: 0,
        message: "На фото не обнаружено еды.",
      });
    }

    // Обогащаем каждый элемент нутриентами из базы
    const enrichedItems = await Promise.all(
      aiData.items.map(async (item) => {
        const weight = Math.max(item.estimated_weight_g || 100, 1);
        const nutrients = await calcNutrients(item.name_ru || "", item.name_en || "", weight);
        return {
          name:               item.name_ru || item.name_en || "Неизвестное блюдо",
          name_en:            item.name_en || "",
          estimated_weight_g: weight,
          calories:           nutrients.calories,
          protein_g:          nutrients.protein_g,
          fat_g:              nutrients.fat_g,
          carbs_g:            nutrients.carbs_g,
          confidence:         Math.round((item.confidence ?? 0.5) * 100) / 100,
          alternatives:       item.alternatives_ru || [],
          nutrition_source:   nutrients.nutrition_source,
          ...(nutrients.estimation_note ? { estimation_note: nutrients.estimation_note } : {}),
        };
      })
    );

    const total = enrichedItems.reduce(
      (acc, i) => ({
        calories:  acc.calories  + i.calories,
        protein_g: acc.protein_g + i.protein_g,
        fat_g:     acc.fat_g     + i.fat_g,
        carbs_g:   acc.carbs_g   + i.carbs_g,
      }),
      { calories: 0, protein_g: 0, fat_g: 0, carbs_g: 0 }
    );

    return res.json({
      success:        true,
      items:          enrichedItems,
      total_calories:  Math.round(total.calories),
      total_protein_g: Math.round(total.protein_g * 10) / 10,
      total_fat_g:     Math.round(total.fat_g     * 10) / 10,
      total_carbs_g:   Math.round(total.carbs_g   * 10) / 10,
    });

  } catch (err) {
    console.error("Unhandled error:", err);
    res.status(500).json({ success: false, error: "Внутренняя ошибка сервера." });
  }
});

// ─────────────────────────────────────────────
// POST /save-meal-entry
// ─────────────────────────────────────────────
app.post("/save-meal-entry", (req, res) => {
  const { user_id, meal_type, items } = req.body;
  if (!items || items.length === 0) {
    return res.status(400).json({ success: false, error: "Поле items обязательно." });
  }
  const entry = {
    id: Date.now().toString(),
    user_id: user_id || "anonymous",
    meal_type: meal_type || "snack",
    items,
    created_at: new Date().toISOString(),
  };
  // TODO: здесь подключить БД (MongoDB / Postgres)
  console.log("Saved meal entry:", JSON.stringify(entry));
  res.json({ success: true, entry_id: entry.id });
});

// ─────────────────────────────────────────────
// POST /chat — AI Coach (переписан с DeepSeek на OpenAI)
// ─────────────────────────────────────────────
app.post("/chat", async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Поле messages обязательно." });
  }
  try {
    const response = await openai.chat.completions.create({
      model: CHAT_MODEL,
      max_tokens: 1500,
      messages: [
        {
          role: "system",
          content: `Ты — персональный AI-тренер и нутрициолог приложения NOVA.
Отвечай по-русски, кратко и по делу.
Давай советы по питанию, тренировкам и восстановлению.
Используй Markdown для форматирования.
Если вопрос не связан со здоровьем и фитнесом — вежливо верни к теме.`,
        },
        ...messages,
      ],
    });
    res.json({ reply: response.choices?.message?.content ?? "Нет ответа." });
  } catch (err) {
    console.error("Chat error:", err.message);
    res.status(502).json({ reply: "Ошибка AI. Попробуйте ещё раз." });
  }
});

// GET /health
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Глобальная обработка ошибок multer
app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ success: false, error: `Файл слишком большой. Максимум ${MAX_FILE_MB}MB.` });
  }
  res.status(400).json({ success: false, error: err.message });
});

app.listen(PORT, () => {
  console.log(`✅ NOVA Server on port ${PORT} | Vision: ${VISION_MODEL} | Chat: ${CHAT_MODEL}`);
  console.log(`   Food DB: ${foodDB.length} items | USDA: ${process.env.USDA_API_KEY ? "ON" : "OFF"}`);
});

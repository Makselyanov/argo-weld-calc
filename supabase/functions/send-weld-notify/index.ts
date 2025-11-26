import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

serve(async (req) => {
  // Читаем сырое тело запроса
  let raw: string;
  try {
    raw = await req.text();
  } catch (err) {
    console.error("Failed to read request body:", err);
    return new Response("Failed to read request body", { status: 400 });
  }

  console.log("RAW BODY:", raw);

  // Проверяем, что тело не пустое
  if (!raw) {
    console.error("Empty body received");
    return new Response("Empty body", { status: 400 });
  }

  // Парсим JSON
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error("JSON parse error:", err);
    return new Response("Invalid JSON", { status: 400 });
  }

  // Извлекаем поля из данных
  const {
    id,
    description,
    typeOfWork,
    material,
    deadline,
    totalMin,
    totalMax,
    status
  } = data;

  // Проверяем наличие обязательных полей
  if (!id || !description || typeof totalMin !== 'number' || typeof totalMax !== 'number' || !status) {
    console.error("Missing required fields:", data);
    return new Response("Missing required fields (id, description, totalMin, totalMax, status)", { status: 400 });
  }

  // Читаем конфигурацию Telegram
  const TELEGRAM_TOKEN = Deno.env.get("TELEGRAM_TOKEN");
  const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID");

  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("Missing Telegram config");
    return new Response("Missing Telegram config", { status: 500 });
  }

  // Формируем текст сообщения
  const text =
    `🔧 Новый расчёт ARGO-72\n\n` +
    `ID: ${id}\n` +
    `Тип: ${typeOfWork || "не указан"}\n` +
    `Материал: ${material || "не указан"}\n` +
    `Срок: ${deadline || "не указан"}\n` +
    `Диапазон: от ${totalMin} до ${totalMax} ₽\n` +
    `Статус: ${status}\n\n` +
    `Описание:\n${description}`;

  console.log("Sending Telegram message to chat:", TELEGRAM_CHAT_ID);

  // Отправляем сообщение в Telegram
  try {
    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text,
        }),
      }
    );

    if (!telegramResponse.ok) {
      const errorBody = await telegramResponse.text();
      console.error("Telegram API error:", telegramResponse.status, errorBody);
      return new Response("Telegram error", { status: 500 });
    }

    const telegramData = await telegramResponse.json();
    console.log("Telegram response:", telegramData);

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("Failed to send Telegram message:", err);
    return new Response("Telegram error", { status: 500 });
  }
});

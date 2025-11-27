import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

type AiResponse = {
    aiMin: number;
    aiMax: number;
    reasonShort: string;
    reasonLong: string;
    warnings: string[];
};

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    const response: AiResponse = {
        aiMin: 10000,
        aiMax: 15000,
        reasonShort: "Тестовый ответ ИИ для проверки связки Supabase и фронта.",
        reasonLong:
            "Это тестовое коммерческое предложение. Если вы видите этот текст в интерфейсе, значит edge-функция ai-price-estimate успешно отработала и данные дошли до фронта. Реальный расчёт ИИ временно отключён для отладки.",
        warnings: [],
    };

    return new Response(JSON.stringify(response), {
        headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
        },
    });
});

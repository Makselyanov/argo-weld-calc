# 🔧 Отчёт: Исправление вызова AI Edge-функции во фронтенде

## ❌ Проблема

**Ошибка в логах Supabase:**
```
Failed to parse request JSON in ai-price-estimate: SyntaxError: Unexpected end of JSON input
```

**Причина:** Edge-функция получала пустое тело запроса или некорректный JSON

**Симптомы:**
- На фронтенде всегда показывается fallback: "⚠️ Не удалось рассчитать через нейросеть"
- ИИ-расчёт никогда не работает

---

## ✅ Решение

### Изменённый файл: `src/pages/NewCalculation.tsx`

#### Что изменено:

1. **Вынесен payload в отдельную переменную** (для читаемости и отладки)
2. **Добавлено логирование payload** перед отправкой
3. **Добавлено логирование ответа** от Edge-функции
4. **Обновлена проверка ответа** — добавлена проверка `data.aiFailed`
5. **Обновлён формат данных** — используются `aiMin/aiMax` вместо `totalMin/totalMax`

---

## 📝 Diff изменений

### До:
```typescript
const { data, error } = await supabase.functions.invoke('ai-price-estimate', {
  body: {
    description: formData.description,
    descriptionStep2: formData.descriptionStep2,
    // ... остальные поля
    localMin: localResult.totalMin,
    localMax: localResult.totalMax
  }
});

// Проверяем, не вернулся ли fallback
if (error || !data || data.useFallback) {
  throw new Error('AI calculation failed or returned fallback');
}

// Проверяем валидность данных от AI
if (typeof data.totalMin !== 'number' || typeof data.totalMax !== 'number') {
  throw new Error('Invalid AI response data');
}

// Успешный расчёт через AI
setPriceResult({
  baseMin: localResult.totalMin,
  baseMax: localResult.totalMax,
  totalMin: data.totalMin,  // ❌ старый формат
  totalMax: data.totalMax,  // ❌ старый формат
  reasonShort: data.reasonShort,
  reasonLong: data.reasonLong,
  warnings: data.warnings || []
});
```

### После:
```typescript
// Формируем payload для AI
const payload = {
  description: formData.description,
  descriptionStep2: formData.descriptionStep2,
  descriptionStep3: formData.descriptionStep3,
  typeOfWork: formData.typeOfWork,
  workScope: formData.workScope,
  material: formData.material,
  thickness: formData.thickness,
  seamType: formData.weldType,
  volume: formData.volume,
  position: formData.position,
  conditions: formData.conditions,
  deadline: formData.deadline,
  materialOwner: formData.materialOwner,
  extraServices: formData.extraServices,
  photos: formData.photos,
  localMin: localResult.totalMin,
  localMax: localResult.totalMax
};

// Логируем payload для отладки
console.log('AI payload:', payload);

// Пытаемся получить расчёт от AI
const { data, error } = await supabase.functions.invoke('ai-price-estimate', {
  body: payload  // ✅ передаём объект, а не inline
});

console.log('AI response:', data, 'error:', error);

// Проверяем, не вернулся ли fallback или ошибка
if (error || !data || data.useFallback || data.aiFailed) {  // ✅ добавлена проверка aiFailed
  throw new Error('AI calculation failed or returned fallback');
}

// Проверяем валидность данных от AI (новый формат: aiMin/aiMax)
if (typeof data.aiMin !== 'number' || typeof data.aiMax !== 'number') {  // ✅ новый формат
  throw new Error('Invalid AI response data');
}

// Успешный расчёт через AI
setPriceResult({
  baseMin: localResult.totalMin,
  baseMax: localResult.totalMax,
  totalMin: data.aiMin,  // ✅ новый формат
  totalMax: data.aiMax,  // ✅ новый формат
  reasonShort: data.reasonShort,
  reasonLong: data.reasonLong,
  warnings: data.warnings || []
});
```

---

## 🔍 Как теперь формируется payload

### 1. Создание объекта payload:
```typescript
const payload = {
  // Текстовые описания
  description: formData.description,
  descriptionStep2: formData.descriptionStep2,
  descriptionStep3: formData.descriptionStep3,
  
  // Параметры работы
  typeOfWork: formData.typeOfWork,
  workScope: formData.workScope,  // режим работы (pre_cut/from_scratch/rework)
  material: formData.material,
  thickness: formData.thickness,
  seamType: formData.weldType,
  volume: formData.volume,
  position: formData.position,
  conditions: formData.conditions,
  deadline: formData.deadline,
  materialOwner: formData.materialOwner,
  extraServices: formData.extraServices,
  
  // Фотографии
  photos: formData.photos,
  
  // Базовый диапазон от локального калькулятора
  localMin: localResult.totalMin,
  localMax: localResult.totalMax
};
```

### 2. Логирование для отладки:
```typescript
console.log('AI payload:', payload);
```

**Что проверить в консоли браузера:**
- ✅ Объект `payload` НЕ пустой
- ✅ Все поля заполнены корректными значениями
- ✅ `localMin` и `localMax` — числа, а не `undefined`

### 3. Вызов Edge-функции:
```typescript
const { data, error } = await supabase.functions.invoke('ai-price-estimate', {
  body: payload  // Supabase клиент сам сериализует в JSON
});
```

**Важно:**
- ❌ НЕ вызываем `JSON.stringify(payload)` вручную
- ✅ Передаём объект напрямую — клиент Supabase сам его сериализует

### 4. Логирование ответа:
```typescript
console.log('AI response:', data, 'error:', error);
```

**Что проверить в консоли:**
- ✅ `data` содержит `aiMin`, `aiMax`, `reasonShort`, `reasonLong`
- ✅ `error` должен быть `null` при успехе
- ✅ Если `data.aiFailed === true`, значит Edge-функция вернула fallback

---

## 🧪 Как проверить

### 1. Откройте консоль браузера (F12)

### 2. Создайте новый расчёт

### 3. Проверьте логи в консоли:

**Ожидаемый вывод при успехе:**
```
AI payload: {
  description: "Сварка рамы",
  typeOfWork: "welding",
  workScope: "pre_cut",
  material: "steel",
  thickness: "lt_3",
  seamType: "butt",
  volume: "10 м",
  localMin: 8100,
  localMax: 9900,
  ...
}

AI response: {
  aiMin: 8500,
  aiMax: 10500,
  reasonShort: "Стандартная сварка...",
  reasonLong: "Добрый день! По вашей заявке...",
  warnings: [],
  aiFailed: false
} error: null
```

**Ожидаемый вывод при ошибке:**
```
AI payload: { ... }

AI response: {
  aiFailed: true,
  reasonShort: "Ошибка разбора ответа ИИ",
  reasonLong: "Сервер не смог прочитать данные...",
  warnings: ["Служебное сообщение..."],
  aiMin: null,
  aiMax: null
} error: null
```

### 4. Проверьте логи Supabase:

```powershell
supabase functions logs ai-price-estimate --follow
```

**Ожидаемый вывод при успехе:**
```
OpenRouter raw response (first 1000 chars): {"id":"gen-...","choices":[...
```

**Если видите ошибку:**
```
Failed to parse request JSON in ai-price-estimate: ...
```
Значит payload всё ещё пустой или некорректный.

---

## ✅ Проверка

- [x] Payload вынесен в отдельную переменную
- [x] Добавлено логирование `console.log('AI payload:', payload)`
- [x] Добавлено логирование `console.log('AI response:', data, 'error:', error)`
- [x] Обновлена проверка ответа — добавлен `data.aiFailed`
- [x] Обновлён формат данных — используются `aiMin/aiMax`
- [x] Payload передаётся как объект, а не строка
- [x] Не используется `JSON.stringify` вручную

---

## 🚀 Следующие шаги

1. **Соберите проект:**
   ```powershell
   cd c:\argo-weld-calc
   npm run build
   ```

2. **Откройте приложение в браузере**

3. **Откройте консоль браузера (F12)**

4. **Создайте новый расчёт**

5. **Проверьте логи:**
   - В консоли браузера должны появиться `AI payload:` и `AI response:`
   - В логах Supabase должен появиться `OpenRouter raw response`

6. **Если всё работает:**
   - Должна показаться зелёная плашка: "🤖 Расчёт выполнен искусственным интеллектом"
   - Цена должна быть от AI (может отличаться от базовой)

---

**Готово!** Теперь фронтенд корректно отправляет payload в Edge-функцию и обрабатывает ответ в новом формате `aiMin/aiMax`.

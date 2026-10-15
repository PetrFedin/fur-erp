-- Свои параметры артикула: ProductModel.attributes (JSON-массив [{ name, value }] в порядке добавления).
ALTER TABLE "ProductModel" ADD COLUMN IF NOT EXISTS "attributes" JSONB;

-- Перенос из служебной таблицы (SystemState, ключ `article-params:<id артикула>`, значение { params: [...] }).
-- Идемпотентно: уже заполненное поле не трогаем. Записи SystemState остаются как есть (запасной путь отката).
UPDATE "ProductModel" m
SET "attributes" = s."value"->'params'
FROM "SystemState" s
WHERE s."organizationId" = m."organizationId"
  AND s."key" = 'article-params:' || m."id"
  AND m."attributes" IS NULL
  AND jsonb_typeof(s."value"->'params') = 'array'
  AND jsonb_array_length(s."value"->'params') > 0;

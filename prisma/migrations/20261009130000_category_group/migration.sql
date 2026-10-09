-- Группа категории: верхний уровень справочника («Верхняя одежда», «Одежда», «Аксессуары»).
ALTER TABLE "CategoryRef" ADD COLUMN "group" TEXT;

UPDATE "CategoryRef" SET "group" = 'Верхняя одежда' WHERE "name" IN ('Пальто', 'Полупальто', 'Куртка', 'Шуба / полушубок', 'Кейп');
UPDATE "CategoryRef" SET "group" = 'Одежда' WHERE "name" IN ('Жакет', 'Жилет', 'Юбка');
UPDATE "CategoryRef" SET "group" = 'Аксессуары' WHERE "name" IN ('Шарф', 'Головной убор', 'Варежки');

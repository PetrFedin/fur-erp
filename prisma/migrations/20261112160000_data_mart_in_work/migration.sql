-- В работе = заказано − получено (приход решает, а не статус ТЗ): товар приехал — он есть; не приехал — в работе, даже если ТЗ ещё нет.
CREATE OR REPLACE VIEW "vDmInWork" AS
SELECT k."organizationId", s."season", k."skuKey", k."modelCode", k."acode", k."colorCanon", k."size",
  s."conf", s."deliv", greatest(s."conf" - s."deliv", 0) AS in_work
FROM "DmSkuSeason" s JOIN "DmSku" k ON k."id" = s."skuId";

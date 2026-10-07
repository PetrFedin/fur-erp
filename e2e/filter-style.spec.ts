import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const source=readFileSync('e2e/live-check.spec.ts','utf8');
const email=source.match(/getByLabel\("Email"\)\.fill\("([^"]+)"\)/)?.[1]!;
const password=source.match(/getByLabel\("Пароль"\)\.fill\("([^"]+)"\)/)?.[1]!;

test('operational sections use one filter language', async ({page})=>{
  test.setTimeout(60000);
  await page.goto('http://localhost:3000/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button',{name:'Войти'}).click();
  await page.waitForURL(/\/dashboard$/);

  for (const [url,title] of [
    ['/purchases','Фильтры закупок'],
    ['/lots','Фильтры сырья'],
    ['/production','Фильтры производства'],
    ['/payments','Фильтры оплат'],
    ['/documents','Фильтры анализа документов'],
    ['/articles','Фильтры изделий'],
    ['/verify','Фильтры проверки'],
    ['/history','Фильтры журнала'],
    ['/lots','Фильтры меха'],
    ['/analytics/products','Фильтры'],
    ['/analytics/pricing','Фильтры'],
    ['/analytics/raw','Фильтры'],
    ['/shipments','Фильтры отгрузок'],
    ['/fittings','Фильтры примерок'],
    ['/plan','Фильтры плана'],
    ['/plan/seasons','Фильтры ТЗ'],
    ['/calendar','Фильтры календаря'],
    ['/supply-plan','Фильтры плана поставок'],
    ['/suppliers','Фильтры поставщиков'],
    ['/clients','Фильтры заказчиков'],
    ['/users','Фильтры пользователей'],
    ['/materials','Фильтры материалов'],
    ['/settings/colors','Фильтры цветов'],
    ['/settings/furs','Фильтры меха'],
    ['/settings/articles-ref','Фильтры артикулов'],
  ] as const) {
    await page.goto('http://localhost:3000'+url);
    await expect(page.getByText(title,{exact:true}).first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Internal Server Error');
  }

  await page.goto('http://localhost:3000/dashboard');
  const raw=page.locator('section').filter({hasText:'Операции · Сырьё и склад'}).first();
  await expect(raw.getByText('Партия закупки',{exact:true}).first()).toBeVisible();
  await expect(raw.getByText('Лиса красная',{exact:true})).toHaveCount(0);
});

test('multi-select filter applies at once, shows chips, resets all and keeps other params', async ({page})=>{
  test.setTimeout(60000);
  await page.goto('http://localhost:3000/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button',{name:'Войти'}).click();
  await page.waitForURL(/\/dashboard$/);

  await page.goto('http://localhost:3000/purchases');
  // выпадающий список «Статус»: галочка меняет адрес без кнопки «Применить»
  await page.locator('summary',{hasText:'Статус'}).first().click();
  await page.getByRole('checkbox',{name:/Принято на склад/}).check();
  await expect(page).toHaveURL(/status=RECEIVED/);
  // чип активного фильтра и «Сбросить всё»
  await expect(page.getByRole('button',{name:/Принято на склад/}).first()).toBeVisible();
  await page.getByRole('button',{name:'Сбросить всё'}).click();
  await expect(page).not.toHaveURL(/status=/);

  // /lots: вкладка и фильтры не теряются, быстрые чипы партий остаются ссылками /lots?auction=
  await page.goto('http://localhost:3000/lots?q=15016');
  await page.getByRole('link',{name:'Сводка по годам'}).click();
  await expect(page).toHaveURL(/tab=summary/);
  expect(await page.locator('a[href^="/lots?auction="]').count()).toBeGreaterThanOrEqual(0);
});

test('fur table filters share the common bar: apply at once, chips, reset, URL', async ({page})=>{
  test.setTimeout(60000);
  await page.goto('http://localhost:3000/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button',{name:'Войти'}).click();
  await page.waitForURL(/\/dashboard$/);

  await page.goto('http://localhost:3000/lots');
  const bar=page.locator('[data-filter-bar]').filter({hasText:'Фильтры меха'});
  await bar.locator('summary',{hasText:'Мех'}).first().click();
  await bar.getByRole('checkbox',{name:/Соболь/}).check();
  await expect(page).toHaveURL(/fur=/);
  await expect(page.locator('tr[data-row]')).toHaveCount(1);
  await bar.getByRole('button',{name:'Сбросить всё'}).click();
  await expect(page).not.toHaveURL(/fur=/);
  await expect(page.locator('tr[data-row]').first()).toBeVisible();
});

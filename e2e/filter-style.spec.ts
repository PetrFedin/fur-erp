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

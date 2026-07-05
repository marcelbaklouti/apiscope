import { expect, test } from '@playwright/test'

test('overview renders seeded traffic', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('span-count')).toContainText('40 requests')
  await expect(page.getByTestId('latency-strip')).toBeVisible()
})

test('overview visual snapshot dark and light', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('span-count')).toBeVisible()
  await expect(page).toHaveScreenshot('overview-dark.png')
  await page.getByRole('button', { name: 'toggle theme' }).click()
  await expect(page).toHaveScreenshot('overview-light.png')
})

test('inspector deep link shows waterfall, payload and redaction badge', async ({ page }) => {
  await page.goto('/#/inspector/seed-0')
  await expect(page.getByTestId('span-detail-title')).toContainText('GET /api/users/0')
  await expect(page.getByText('downstream')).toBeVisible()
  await expect(page.getByText('1 redacted')).toBeVisible()
})

test('keyboard k moves the inspector selection', async ({ page }) => {
  await page.goto('/#/inspector/seed-0')
  await expect(page.getByTestId('span-detail-title')).toBeVisible()
  await page.keyboard.press('k')
  await expect(page).toHaveURL(/seed-1/)
})

test('routes view lists registry with stats', async ({ page }) => {
  await page.goto('/#/routes')
  await expect(page.getByText('/api/users/:id')).toBeVisible()
  await expect(page.getByText('app/api/users/[id]/route.ts')).toBeVisible()
})

test('command palette opens and navigates', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('connection')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+k')
  await page.getByTestId('palette-input').fill('runs')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#\/runs/)
})

test('load view exports config code', async ({ page }) => {
  await page.goto('/#/load')
  await expect(page.getByTestId('config-code')).toContainText('defineConfig')
  await expect(page.getByTestId('config-code')).toContainText('"baseUrl": "http://127.0.0.1:3000"')
})

test('config view shows resolved meta', async ({ page }) => {
  await page.goto('/#/config')
  await expect(page.getByTestId('config-json')).toContainText('4655')
})

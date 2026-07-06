import { expect, test } from '@playwright/test'

test('insights hub is the landing view and shows the health verdict', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('health-verdict')).toBeVisible()
  await expect(page.getByTestId('insights-list')).toBeVisible()
})

test('a finding expands to reveal a paste-ready fix and evidence deep-link', async ({ page }) => {
  await page.goto('/#/insights')
  const firstToggle = page.getByTestId('finding-toggle').first()
  await firstToggle.click()
  await expect(page.getByTestId('finding-snippet').first()).toBeVisible()
  const evidence = page.getByTestId('finding-evidence').first()
  await expect(evidence).toHaveAttribute('href', /#\//)
})

test('copy-fix writes the snippet and confirms', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/#/insights')
  await page.getByTestId('finding-toggle').first().click()
  await page.getByTestId('finding-copy').first().click()
  await expect(page.getByTestId('finding-copied').first()).toBeVisible()
})

test('the evidence deep-link navigates into the pre-filtered expert view', async ({ page }) => {
  await page.goto('/#/insights')
  await page.getByTestId('finding-toggle').first().click()
  await page.getByTestId('finding-evidence').first().click()
  await expect(page).toHaveURL(/#\/(routes|inspector)/)
})

test('dismissing a finding removes its card and offers restore', async ({ page }) => {
  await page.goto('/#/insights')
  await expect(page.getByTestId('insights-list')).toBeVisible()
  const before = await page.getByTestId('finding-title').count()
  await page.getByTestId('finding-dismiss').first().click()
  await expect(page.getByTestId('finding-title')).toHaveCount(before - 1)
  await expect(page.getByTestId('insights-restore')).toBeVisible()
})

test('insufficient-data state before enough traffic', async ({ page }) => {
  await page.goto('http://127.0.0.1:4656/#/insights')
  await expect(page.getByTestId('insights-insufficient')).toBeVisible()
})

test('all-clear empty state lists what was checked', async ({ page }) => {
  await page.goto('http://127.0.0.1:4657/#/insights')
  await expect(page.getByTestId('insights-empty')).toBeVisible()
  await expect(page.getByTestId('insights-checked')).toBeVisible()
})

test('mobile layout collapses nav and avoids horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/#/insights')
  await expect(page.getByTestId('mobile-nav')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  expect(overflow).toBe(true)
})

test('routes table does not break the page layout on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/#/routes')
  const bodyOverflow = await page.evaluate(() => document.body.scrollWidth <= window.innerWidth + 1)
  expect(bodyOverflow).toBe(true)
})

test('reduced motion renders the verdict value immediately and is stable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/#/insights')
  await expect(page.getByTestId('health-verdict')).toBeVisible()
})

test('routes view annotates p95 with a plain-language explainer', async ({ page }) => {
  await page.goto('/#/routes')
  await expect(page.getByTestId('metric-explainer').first()).toBeAttached()
})

test('overview renders seeded traffic', async ({ page }) => {
  await page.goto('/#/overview')
  await expect(page.getByTestId('span-count')).toContainText('65 requests')
  await expect(page.getByTestId('latency-strip')).toBeVisible()
})

test('overview visual snapshot dark and light', async ({ page }) => {
  await page.goto('/#/overview')
  await expect(page.getByTestId('span-count')).toBeVisible()
  await expect(page).toHaveScreenshot('overview-dark.png')
  await page.getByRole('button', { name: 'toggle theme' }).click()
  await expect(page).toHaveScreenshot('overview-light.png')
})

test('insights hub visual snapshot dark and light (desktop)', async ({ page }) => {
  await page.goto('/#/insights')
  await expect(page.getByTestId('health-verdict')).toBeVisible()
  await expect(page).toHaveScreenshot('insights-desktop-dark.png')
  await page.getByRole('button', { name: 'toggle theme' }).click()
  await expect(page).toHaveScreenshot('insights-desktop-light.png')
})

test('insights hub visual snapshot mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/#/insights')
  await expect(page.getByTestId('health-verdict')).toBeVisible()
  await expect(page).toHaveScreenshot('insights-mobile-dark.png')
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

test('inspector renders db child spans and an n+1 warning banner', async ({ page }) => {
  await page.goto('/#/inspector/seed-4')
  await expect(page.getByTestId('span-detail-title')).toContainText('GET /api/users/4')
  await expect(page.getByTestId('n-plus-one-banner')).toBeVisible()
  await expect(page.getByTestId('n-plus-one-banner')).toContainText('n+1: 6×')
  const dbRows = page.getByTestId('waterfall-row-db')
  await expect(dbRows).toHaveCount(7)
  await expect(dbRows.first()).toContainText('postgresql')
})

test('routes view flags the n+1-prone route', async ({ page }) => {
  await page.goto('/#/routes')
  const usersRow = page.locator('tr', { has: page.getByText('/api/users/:id') })
  await expect(usersRow.getByTestId('n-plus-one-indicator')).toContainText('1')
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

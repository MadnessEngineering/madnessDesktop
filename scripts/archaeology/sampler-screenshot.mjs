#!/usr/bin/env node
// Re-shoot the preload sampler screenshot used in docs/terminal-and-ai.md.
// Needs the sampler running (node scripts/archaeology/preload-sampler.mjs).
//
//   node scripts/archaeology/sampler-screenshot.mjs [repo-name] [theme]
//
// Clicks Sample, then Measure exact (a few thousand Claude tokens), and
// writes docs/assets/preload-sampler.png.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repoName = process.argv[2] || 'madnessDesktop'
const theme = process.argv[3] || 'mad-laboratory'
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/assets/preload-sampler.png')

// Prefer the installed Google Chrome so no Playwright browser download is needed.
const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch())
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, colorScheme: 'dark' })
await page.goto('http://127.0.0.1:4747/')
await page.waitForSelector(`#theme option[value="${theme}"]`, { state: 'attached' })
await page.selectOption('#theme', theme)
const repo = await page.$eval('#repo', (sel, name) =>
  [...sel.options].find(o => o.textContent === name)?.value, repoName)
if (!repo) throw new Error(`repo ${repoName} not in the sampler's list`)
await page.selectOption('#repo', repo)
await page.click('button:has-text("Sample")')
await page.waitForFunction(() => document.querySelectorAll('.panel').length === 4, null, { timeout: 120000 })
await page.click('#measure')
await page.waitForFunction(() => document.querySelectorAll('.measured').length >= 3, null, { timeout: 240000 })
await page.screenshot({ path: out, fullPage: true })
await browser.close()
console.log(`wrote ${out}`)

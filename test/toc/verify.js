const task = await taskSpace("AIPM TOC viewport and anchor regression")
const page = task.page("p1")
let checked = 0
let skipped = 0

for (const [width, height, position] of [
  [1646, 853, 600], [1646, 853, 1800],
  [1000, 700, 600], [800, 650, 1800],
  [390, 844, 600], [390, 844, 3200]
]) {
  await page.cdp("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: 1, mobile: width < 500
  })
  await page.goto("http://127.0.0.1:8765/ai/evaluation/")
  await page.evaluate(y => window.scrollTo(0, y), position)
  await page.waitForTimeout(1100)

  const result = await page.evaluate(() => {
    const nav = document.querySelector(
      innerWidth <= 800
        ? ".md-sidebar--primary .md-nav--secondary"
        : ".md-sidebar--secondary .md-nav--secondary"
    )
    if (!nav) throw new Error("TOC not found")
    const list = nav.querySelector(":scope > .md-nav__list")
    const header = document.querySelector(".md-header").getBoundingClientRect().height
    const links = [...list.querySelectorAll(".md-nav__link")]
    const rows = links.map(link => {
      const target = document.getElementById(decodeURIComponent(link.hash.slice(1)))
      if (!target) throw new Error(`Missing heading: ${link.hash}`)
      const top = target.getBoundingClientRect().top
      return {
        text: link.textContent.trim(),
        expected: top >= header && top < innerHeight,
        actual: link.classList.contains("md-nav__link--active"),
        rowHeight: link.getBoundingClientRect().height
      }
    })
    const indicator = list.querySelector(":scope > .pm-toc-indicator")
    const marker = indicator?.querySelector(".pm-toc-marker")
    const track = indicator?.querySelector(".pm-toc-track path")
    return {
      candidates: links.length,
      rows,
      marker: list.style.getPropertyValue("--pm-toc-marker-height"),
      clip: marker && getComputedStyle(marker).clipPath,
      track: track?.getAttribute("d"),
      trackWidth: track?.getBBox().width
    }
  })

  if (!result.rows.length) throw new Error("All TOC rows skipped")
  checked += result.rows.length
  skipped += result.candidates - result.rows.length
  const mismatch = result.rows.filter(row => row.expected !== row.actual)
  if (mismatch.length) throw new Error(JSON.stringify({ width, position, mismatch }))
  if (!result.clip?.startsWith("polygon(") ||
      !result.track?.includes(" C") || !parseFloat(result.marker)) {
    throw new Error(`Indicator absent: ${JSON.stringify({ width, position, result })}`)
  }

  if (width === 1646) {
    if (result.trackWidth < 10) throw new Error("Nested indicator did not fold")
  }
  if (width === 390) {
    const long = result.rows.find(row => row.text.includes("Judge 校准"))
    const short = result.rows.find(row => row.text === "红队测试")
    if (!long || !short || long.rowHeight <= short.rowHeight)
      throw new Error("Wrapped TOC row not verified")
  }

  if (width === 390 && position === 3200) {
    if (result.rows.some(row => row.actual) || parseFloat(result.marker) !== 8)
      throw new Error("Missing 8px tail without visible headings")
    await page.click(".md-header label[for=__drawer]")
    await page.click(".md-sidebar--primary label[for=__toc]")
    await page.waitForTimeout(1100)
    await page.evaluate(() => window.scrollTo(0, 3200))
    await page.waitForFunction(() => {
      const list = document.querySelector(
        ".md-sidebar--primary .md-nav--secondary > .md-nav__list"
      )
      const marker = list.querySelector(".pm-toc-marker")
      const bounds = [...getComputedStyle(marker).clipPath
        .matchAll(/(?:0px|100%) (-?[\d.]+)px/g)]
        .map(([, value]) => Number(value))
      return list.getBoundingClientRect().left < 1 && scrollY >= 3100 &&
        list.style.getPropertyValue("--pm-toc-marker-height") === "8px" &&
        !list.querySelector(".md-nav__link--active") &&
        Math.abs(bounds[2] - bounds[0] - 8) < 0.6
    }, undefined, { timeout: 6000 })
    const open = await page.evaluate(() => {
      const list = document.querySelector(
        ".md-sidebar--primary .md-nav--secondary > .md-nav__list"
      )
      const marker = list.querySelector(".pm-toc-marker")
      const clip = getComputedStyle(marker).clipPath
      const bounds = [...clip.matchAll(/(?:0px|100%) (-?[\d.]+)px/g)]
        .map(([, value]) => Number(value))
      return {
        y: scrollY,
        drawer: document.querySelector("#__drawer").checked,
        toc: document.querySelector("#__toc").checked,
        left: list.getBoundingClientRect().left,
        path: marker.querySelector("path").getAttribute("d"),
        clipHeight: bounds[2] - bounds[0]
      }
    })
    if (!open.drawer || !open.toc || open.y < 3100 || open.left < 0 ||
        !open.path || Math.abs(open.clipHeight - 8) > 0.6) {
      throw new Error(`Mobile tail not visible: ${JSON.stringify(open)}`)
    }
  }
  console.log(`TOC ${width}x${height} y=${position}: ${result.rows.length} rows checked`)
}

await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 1646, height: 853, deviceScaleFactor: 1, mobile: false
})
await page.goto("http://127.0.0.1:8765/pm/monetization/")
await page.evaluate(() => window.scrollTo(0, 600))
await page.waitForTimeout(1100)
const corners = await page.evaluate(() => {
  const list = document.querySelector(
    ".md-sidebar--secondary .md-nav--secondary > .md-nav__list"
  )
  const links = [...list.querySelectorAll(".md-nav__link")]
  const active = links.filter(link => link.classList.contains("md-nav__link--active"))
  const left = Math.min(...links.map(link => link.getBoundingClientRect().left))
  const path = list.querySelector(".pm-toc-marker path")
  const stroke = getComputedStyle(path)
  const length = path.getTotalLength()
  if (!path.getAttribute("d").includes(" C") || stroke.stroke === "none" ||
      parseFloat(stroke.strokeWidth) < 1.5 || length <= 0) {
    throw new Error("Curved indicator is not rendered")
  }

  return active.slice(1).flatMap((link, index) => {
    const previous = active[index].getBoundingClientRect()
    const next = link.getBoundingClientRect()
    if (previous.left === next.left) return []
    const startX = previous.left - left + 1
    const endX = next.left - left + 1
    const y = (previous.bottom + next.top) / 2 - list.getBoundingClientRect().top
    let connected = false
    for (let distance = 0; distance <= length; distance += 0.25) {
      const point = path.getPointAtLength(distance)
      if (Math.abs(point.y - y) < 0.5 &&
          point.x > Math.min(startX, endX) + 1 &&
          point.x < Math.max(startX, endX) - 1) {
        connected = true
        break
      }
    }
    return [{ from: active[index].textContent.trim(), to: link.textContent.trim(),
      direction: Math.sign(next.left - previous.left),
      connected }]
  })
})
if (corners.length < 2 || new Set(corners.map(corner => corner.direction)).size !== 2 ||
    corners.some(corner => !corner.connected)) {
  throw new Error(`Disconnected TOC corners: ${JSON.stringify(corners)}`)
}
console.log(`CONNECTED_CORNERS=${corners.length}: ${JSON.stringify(corners)}`)

await page.evaluate(async () => {
  window.scrollTo(0, 2100)
  await new Promise(resolve => requestAnimationFrame(resolve))
  window.scrollTo(0, 300)
  await new Promise(resolve => requestAnimationFrame(resolve))
  window.scrollTo(0, 600)
})
await page.waitForTimeout(750)
const rapid = await page.evaluate(() => {
  const list = document.querySelector(".md-sidebar--secondary .md-nav--secondary > .md-nav__list")
  const marker = list.querySelector(".pm-toc-marker")
  const active = [...list.querySelectorAll(".md-nav__link--active")]
  const clip = getComputedStyle(marker).clipPath
  const bounds = [...clip.matchAll(/(?:0px|100%) (-?[\d.]+)px/g)]
    .map(([, value]) => Number(value))
  const rect = list.getBoundingClientRect()
  return {
    active: active.map(link => link.textContent.trim()),
    expectedTop: active[0]?.getBoundingClientRect().top - rect.top,
    expectedBottom: active.at(-1)?.getBoundingClientRect().bottom - rect.top,
    top: bounds[0], bottom: bounds[2]
  }
})
if (rapid.active.length < 2 ||
    Math.abs(rapid.expectedTop - rapid.top) > 1 ||
    Math.abs(rapid.expectedBottom - rapid.bottom) > 1) {
  throw new Error(`Rapid scrolling left stale indicator: ${JSON.stringify(rapid)}`)
}
console.log(`RAPID_SCROLL=${JSON.stringify(rapid)}`)

await page.cdp("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-reduced-motion", value: "reduce" }]
})
await page.reload()
const reduced = await page.evaluate(() => ({
  matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
  duration: getComputedStyle(document.querySelector(".pm-toc-marker")).transitionDuration
}))
if (!reduced.matches || reduced.duration !== "0s")
  throw new Error(`Reduced-motion setting ignored: ${JSON.stringify(reduced)}`)
await page.cdp("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-reduced-motion", value: "no-preference" }]
})
await page.reload()
const animated = await page.evaluate(() => ({
  matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
  duration: getComputedStyle(document.querySelector(".pm-toc-marker")).transitionDuration
}))
if (animated.matches || parseFloat(animated.duration) <= 0)
  throw new Error(`Normal animation missing: ${JSON.stringify(animated)}`)
console.log(`REDUCED_MOTION=${JSON.stringify(reduced)} NORMAL_MOTION=${JSON.stringify(animated)}`)

for (const [width, height] of [[1646, 853], [390, 844]]) {
  await page.cdp("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: 1, mobile: width < 500
  })
  await page.goto("http://127.0.0.1:8766/ai/evaluation/")
  if (width < 500) {
    await page.click(".md-header label[for=__drawer]")
    await page.click(".md-sidebar--primary label[for=__toc]")
    await page.waitForTimeout(850)
  }
  await page.click(width < 500
    ? '.md-sidebar--primary .md-nav--secondary a.md-nav__link[href*="%E7%BA%A2%E9%98%9F"]'
    : '.md-sidebar--secondary .md-nav--secondary a.md-nav__link[href*="%E7%BA%A2%E9%98%9F"]')
  await page.waitForTimeout(2400)
  const result = await page.evaluate(() => ({
    hash: decodeURIComponent(location.hash),
    top: document.getElementById("红队测试").getBoundingClientRect().top,
    highlighted: [...document.querySelectorAll(".md-nav--secondary .md-nav__link")]
      .some(link => link.textContent.trim() === "红队测试" &&
                   link.classList.contains("md-nav__link--active"))
  }))
  if (result.hash !== "#红队测试" || result.top < 50 ||
      result.top > 110 || !result.highlighted) {
    throw new Error(`Anchor regression ${width}: ${JSON.stringify(result)}`)
  }
  console.log(`Tracking ${width}x${height}: ${JSON.stringify(result)}`)
}

if (checked === 0 || skipped !== 0) {
  throw new Error(`Invalid row coverage: checked=${checked} skipped=${skipped}`)
}
console.log(`TOTAL_ROWS_CHECKED=${checked} SKIPPED=${skipped}`)
await task.finish({ keep: [] })

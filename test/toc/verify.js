const task = await taskSpace("AIPM TOC viewport and anchor regression")
const page = task.page("p1")
let checked = 0

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
    return {
      rows,
      marker: list.style.getPropertyValue("--pm-toc-marker-height"),
      clip: list.style.getPropertyValue("--pm-toc-marker-clip"),
      track: list.style.getPropertyValue("--pm-toc-track-clip"),
      pseudo: getComputedStyle(list, "::after").content
    }
  })

  if (!result.rows.length) throw new Error("All TOC rows skipped")
  checked += result.rows.length
  const mismatch = result.rows.filter(row => row.expected !== row.actual)
  if (mismatch.length) throw new Error(JSON.stringify({ width, position, mismatch }))
  if (result.pseudo !== '""' || !result.clip.startsWith("polygon(") ||
      !result.track.includes("px") || !parseFloat(result.marker)) {
    throw new Error(`Indicator absent: ${JSON.stringify({ width, position, result })}`)
  }

  if (width === 1646) {
    const x = [...result.clip.matchAll(/(-?[\d.]+)px -?[\d.]+px/g)]
      .map(([, offset]) => Number(offset))
    if (new Set(x).size < 3) throw new Error("Nested indicator did not fold")
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
    await page.waitForTimeout(850)
    const open = await page.evaluate(() => {
      const list = document.querySelector(
        ".md-sidebar--primary .md-nav--secondary > .md-nav__list"
      )
      return {
        drawer: document.querySelector("#__drawer").checked,
        toc: document.querySelector("#__toc").checked,
        left: list.getBoundingClientRect().left,
        pseudo: getComputedStyle(list, "::after").content,
        clip: getComputedStyle(list, "::after").clipPath
      }
    })
    if (!open.drawer || !open.toc || open.left < 0 ||
        open.pseudo !== '""' || !open.clip.includes("8px")) {
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
  const markerTop = parseFloat(list.style.getPropertyValue("--pm-toc-marker-top"))
  const polygon = [...list.style.getPropertyValue("--pm-toc-marker-clip")
    .matchAll(/(-?[\d.]+)px (-?[\d.]+)px/g)]
    .map(([, x, y]) => [Number(x), Number(y)])
  if (polygon.length < 4) throw new Error("Indicator polygon absent")

  const contains = (x, y) => {
    let inside = false
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [ax, ay] = polygon[i]
      const [bx, by] = polygon[j]
      if ((ay > y) !== (by > y) &&
          x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside
    }
    return inside
  }

  return active.slice(1).flatMap((link, index) => {
    const previous = active[index].getBoundingClientRect()
    const next = link.getBoundingClientRect()
    if (previous.left === next.left) return []
    const x = (previous.left + next.left) / 2 - left + 1
    const y = next.top - list.getBoundingClientRect().top - markerTop
    return [{ from: active[index].textContent.trim(), to: link.textContent.trim(),
      direction: Math.sign(next.left - previous.left),
      above: contains(x, y - 0.5), below: contains(x, y + 0.5) }]
  })
})
if (corners.length < 2 || new Set(corners.map(corner => corner.direction)).size !== 2 ||
    corners.some(corner => !corner.above || !corner.below)) {
  throw new Error(`Disconnected TOC corners: ${JSON.stringify(corners)}`)
}
console.log(`CONNECTED_CORNERS=${corners.length}: ${JSON.stringify(corners)}`)

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

if (checked === 0) throw new Error("No validated TOC rows")
console.log(`TOTAL_ROWS_CHECKED=${checked} SKIPPED=0`)
await task.finish({ keep: [] })

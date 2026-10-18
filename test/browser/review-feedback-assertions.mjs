import assert from 'node:assert/strict';

export async function checkPassageOutline(page, id) {
  await page.click(`.aipm-anno__item[data-anno-id="${id}"] .aipm-anno__item-quote`);
  const result = await page.evaluate(id => {
    const marks = [...document.querySelectorAll('mark.aipm-anno-mark')].filter(mark => mark.dataset.annoId === id);
    const rects = marks.flatMap(mark => [...mark.getClientRects()]);
    const lines = [];
    for (const rect of rects) if (!lines.some(top => Math.abs(top - rect.top) < 2)) lines.push(rect.top);
    return {
      fragments: marks.length,
      linkFragments: marks.filter(mark => mark.closest('a')).length,
      lineCount: lines.length,
      separateOutlines: marks.filter(mark => getComputedStyle(mark).outlineStyle !== 'none')
        .reduce((count, mark) => count + mark.getClientRects().length, 0),
      groupedOutlines: document.querySelectorAll('.aipm-anno-flash-outline').length,
      protected: marks.every(mark => mark.classList.contains('rr-block')),
    };
  }, id);
  assert.ok(result.linkFragments > 0);
  assert.equal(result.separateOutlines, 0, 'link and text fragments must not draw separate outlines');
  assert.equal(result.groupedOutlines, result.lineCount, 'each selected line must have one outline');
  assert.equal(result.protected, true);
  return result;
}

export async function checkInputFocus(page, selector) {
  await page.focus(selector);
  const result = await page.evaluate(selector => {
    const input = document.querySelector(selector);
    const style = getComputedStyle(input);
    return { focused: document.activeElement === input, outlineStyle: style.outlineStyle,
      boxShadow: style.boxShadow, borderWidth: style.borderWidth };
  }, selector);
  assert.equal(result.focused, true);
  assert.equal(result.outlineStyle, 'none');
  assert.equal(result.boxShadow, 'none');
  assert.equal(result.borderWidth, '1px');
  return result;
}

export async function checkComposerConsumed(page, question) {
  const before = await page.evaluate(() => ({
    context: document.querySelectorAll('.aipm-chat__ctxbar .aipm-chat__ctx-chip').length,
    files: document.querySelectorAll('.aipm-chat__attach-chip').length,
  }));
  assert.ok(before.context > 0);
  await page.fill('.aipm-chat__input', question);
  await page.click('.aipm-chat__send');
  await page.waitForFunction(() => document.querySelector('.aipm-chat__send')?.getAttribute('aria-label') === '发送', undefined, { timeout: 55000 });
  const after = await page.evaluate(() => {
    const sent = [...document.querySelectorAll('.aipm-chat__msg--user')].at(-1);
    return {
      context: document.querySelectorAll('.aipm-chat__ctxbar .aipm-chat__ctx-chip').length,
      files: document.querySelectorAll('.aipm-chat__attach-chip').length,
      sentContext: sent.querySelectorAll('.aipm-chat__ctx-row').length,
      sentFiles: sent.querySelectorAll('.aipm-chat__file-chip').length,
      error: [...document.querySelectorAll('.aipm-chat__msg--ai')].at(-1).querySelector('.is-error') !== null,
    };
  });
  assert.equal(after.context, 0);
  assert.equal(after.files, 0);
  assert.equal(after.sentContext, before.context);
  assert.equal(after.sentFiles, before.files);
  assert.equal(after.error, false);
  return { before, after };
}

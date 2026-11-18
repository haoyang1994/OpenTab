// Native editing and modified pointer gestures follow the browser host OS,
// even when a test overrides navigator.platform to exercise application logic.
export const nativeModifier = process.platform === 'darwin' ? 'Meta' : 'Control';

// Functional selection is independent from OS popup keyboard automation. Keep
// the original keyboard path explicitly runnable; selectOption is not evidence
// that a native macOS popup accepted physical keyboard selection.
export async function nativeSelectIndex(page, selector, index) {
  const select = page.locator(selector);
  await select.focus();
  if (process.env.OPENTAB_NATIVE_SELECT_KEYBOARD === 'true') {
    await page.keyboard.press('Home');
    for (let step = 0; step < index; step++) await page.keyboard.press('ArrowDown');
  } else {
    await select.selectOption({ index });
  }
}

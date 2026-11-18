// Exercise actions through the same searchable command palette as a user.
export async function runDesktopAction(page, action, keyboard = false) {
  await page.locator('#add-shortcut-tile').focus();
  await page.keyboard.press('ControlOrMeta+k');
  const input = page.locator('#command-palette-input');
  await input.fill(action === 'preview-group' ? 'preview open group' : 'select sites');
  const option = page.locator(`#command-palette-results [data-entry-id="${action}"]`);
  await option.waitFor();
  if (keyboard) await input.press('Enter');
  else await option.click();
}

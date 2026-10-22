// Switch skins through the real sidebar menu and capture list, dialog, detail
// and settings for each. Pass skin labels as SKINS="Pixel,MS-DOS" to narrow it.
import fs from 'node:fs';
import path from 'node:path';

export default async ({ page, shot, sleep, go, pickMenu, project }) => {
  const labels = process.env.SKINS
    ? process.env.SKINS.split(',').map(s => s.trim())
    : await (async () => {
        await go('#/characters');
        await page.click('.theme-control');
        await sleep(300);
        const all = await page.evaluate(() =>
          [...document.querySelectorAll('.theme-menu-item')]
            .filter(b => b.querySelector('.skin-swatch'))
            .map(b => b.querySelector('.theme-menu-label').textContent.trim()));
        await page.keyboard.press('Escape');
        return all;
      })();

  for (const label of labels) {
    const slug = label.replace(/\W+/g, '-').toLowerCase();
    await pickMenu(label);
    const applied = await page.evaluate(() => document.documentElement.dataset.skin ?? 'classic');
    const saved = JSON.parse(fs.readFileSync(path.join(project, 'ensemble.json'), 'utf8')).settings.skin;
    console.log(`${label}: data-skin=${applied} saved=${saved}`);

    await shot(`${slug}-1-list`);

    // Confirm dialog from a card's delete button, then cancel it
    await page.evaluate(() => {
      const cards = document.querySelectorAll('.character-card');
      cards[cards.length - 1]?.querySelector('button[title*="elete" i], button[aria-label*="elete" i]')?.click();
    });
    await sleep(600);
    await shot(`${slug}-2-dialog`);
    const cancel = await page.$('.modal-dialog button:has-text("Cancel")');
    if (cancel) await cancel.click();
    await sleep(300);

    await page.click('.character-card');
    await sleep(900);
    await shot(`${slug}-3-detail`);

    await go('#/metadata');
    await shot(`${slug}-4-settings`);
  }

  await pickMenu('Classic');
};

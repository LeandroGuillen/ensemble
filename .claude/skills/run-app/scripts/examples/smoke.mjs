// Minimal check: the sandbox project opens and the main screens render.
export default async ({ page, shot, go }) => {
  await shot('smoke-start');
  console.log(await page.evaluate(() => document.body.innerText.slice(0, 300)));
  for (const route of ['#/characters', '#/locations', '#/casts', '#/metadata']) {
    await go(route);
    await shot('smoke-' + route.replace(/\W+/g, ''));
  }
};

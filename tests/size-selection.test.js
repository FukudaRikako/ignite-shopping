const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const script = new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
const storageKey = "ignite-shopping-20261118-v1";

function createStorage(saved) {
  const values = new Map(saved ? [[storageKey, JSON.stringify(saved)]] : []);
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); }
  };
}

function openSite(storage = createStorage()) {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, {
          value: "", innerHTML: "", textContent: "", listeners: {},
          addEventListener(type, listener) { this.listeners[type] = listener; }
        });
      }
      return elements.get(id);
    }
  };
  let printCalls = 0;
  const context = vm.createContext({
    document, localStorage: storage, window: {print() { printCalls++; }}
  });
  script.runInContext(context);
  const products = JSON.parse(vm.runInContext(
    "JSON.stringify(products.map(p => ({title:p.title,price:p.price,selected:p.selected})))",
    context
  ));
  return {elements, products, printCalls: () => printCalls};
}

function productIndex(site, title) {
  const index = site.products.findIndex(product => product.title === title);
  assert.notEqual(index, -1, `商品が見つかりません: ${title}`);
  return index;
}

function cardMarkup(site, index) {
  return site.elements.get("cards").innerHTML.split('<article class="card ').slice(1)[index];
}

function input(site, kind, index, value) {
  site.elements.get("cards").listeners.input({
    target: {
      dataset: {[kind]: String(index)}, value, checked: value,
      matches(selector) { return selector === `[data-${kind}]`; }
    }
  });
}

function printedItem(site, title) {
  const item = site.elements.get("printSummary").innerHTML.split(`<strong>${title}</strong>`)[1];
  assert.ok(item, `印刷対象が見つかりません: ${title}`);
  return item.split("</li>")[0];
}

test("衣類だけにサイズ選択欄を表示する", () => {
  const site = openSite();
  const clothing = /Tシャツ|パーカー|トップス|衣類|ジャケット|ハーフジップ|ウェア/i;
  let sizeControls = 0;
  site.products.forEach((product, index) => {
    const card = cardMarkup(site, index);
    const hasSize = card.includes(`data-size="${index}"`);
    assert.equal(hasSize, clothing.test(product.title), product.title);
    if (hasSize) {
      sizeControls++;
      assert.match(card, /<option value="">未選択<\/option>/);
    }
  });
  assert.ok(sizeControls > 0);
});

test("従来の選択内容を保ち、サイズを保存・復元して印刷する", () => {
  const catalog = openSite();
  const top = productIndex(catalog, "Microsoftロゴのダークカラーのトップス");
  const hoodie = productIndex(catalog, "Excel『Making Sheet Happen』パーカー");
  const unknownPrice = productIndex(catalog, "Ignite パーカー");
  const legacy = {
    rate: 150,
    products: catalog.products.map(product => ({
      selected: product.selected,
      price: product.price === null ? "" : String(product.price)
    }))
  };
  legacy.products[top] = {selected: true, price: "25"};
  legacy.products[hoodie].selected = true;
  legacy.products[unknownPrice].selected = true;

  const storage = createStorage(legacy);
  const site = openSite(storage);
  assert.equal(site.elements.get("total").textContent, "$102.00 ／ 約 ¥15,300");
  input(site, "size", top, "L");
  input(site, "size", hoodie, "M");
  input(site, "size", unknownPrice, "XS");

  const restored = openSite(storage);
  assert.match(cardMarkup(restored, top), /<option value="L" selected>/);
  assert.match(cardMarkup(restored, hoodie), /<option value="M" selected>/);
  assert.equal(restored.elements.get("total").textContent, "$102.00 ／ 約 ¥15,300");
  restored.elements.get("pdfButton").listeners.click();
  assert.equal(restored.printCalls(), 1);
  assert.match(printedItem(restored, "Microsoftロゴのダークカラーのトップス"), /\$25\.00.*サイズ：L/s);
  assert.match(printedItem(restored, "Excel『Making Sheet Happen』パーカー"), /サイズ：M/);
  assert.match(printedItem(restored, "Ignite パーカー"), /価格未確認.*サイズ：XS/s);
  assert.doesNotMatch(printedItem(restored, "黒のシンプルなバッグ"), /サイズ：/);

  input(restored, "size", top, "");
  const cleared = openSite(storage);
  cleared.elements.get("pdfButton").listeners.click();
  assert.match(printedItem(cleared, "Microsoftロゴのダークカラーのトップス"), /サイズ：未選択/);
});

test("商品追加前の保存内容からもサイズを引き継ぐ", () => {
  const catalog = openSite();
  const top = productIndex(catalog, "Microsoftロゴのダークカラーのトップス");
  const added = productIndex(catalog, "モスグリーンのMicrosoftロゴトップス");
  const goat = productIndex(catalog, "Minecraft ヤギのぬいぐるみ");
  const saved = {
    rate: 150,
    products: catalog.products.map(product => ({
      selected: product.selected,
      price: product.price === null ? "" : String(product.price),
      size: ""
    }))
  };
  saved.products[top].size = "XL";
  saved.products.splice(added, 1);

  const site = openSite(createStorage(saved));
  assert.match(cardMarkup(site, top), /<option value="XL" selected>/);
  assert.doesNotMatch(cardMarkup(site, added), /<option value="[^"]+" selected>/);
  assert.doesNotMatch(cardMarkup(site, added), new RegExp(`data-select="${added}" checked`));
  assert.match(cardMarkup(site, goat), new RegExp(`data-select="${goat}" checked`));
});

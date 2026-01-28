import { firebaseConfig } from "./firebase.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore, collection, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getStorage, ref as sRef, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

const pairsWrap = document.getElementById("pairsWrap");
const emptyState = document.getElementById("emptyState");
const catSelect = document.getElementById("catSelect");
const searchInput = document.getElementById("searchInput");

let allCards = [];
let categorySet = new Set();
let selectedCat = "__all__";
let qText = "";

catSelect.addEventListener("change", () => {
  selectedCat = catSelect.value;
  render();
});
searchInput.addEventListener("input", () => {
  qText = (searchInput.value || "").trim().toLowerCase();
  render();
});

const col = collection(db, "card_templates");
const q = query(col, orderBy("order", "asc"));

onSnapshot(q, (snap) => {
  allCards = [];
  categorySet = new Set();

  snap.forEach((doc) => {
    const d = doc.data();
    if (d?.deleted) return;

    const category = (d.category || "").trim();
    const side = (d.side || "").trim();
    const order = Number(d.order);

    if (!category || !side || !Number.isFinite(order)) return;

    allCards.push({
      id: doc.id,
      category,
      side,
      order,
      storagePath: d.storagePath || "",
    });

    categorySet.add(category);
  });

  rebuildCatOptions();
  render();
});

function rebuildCatOptions(){
  const cats = [...categorySet].sort((a,b)=>a.localeCompare(b));
  const cur = catSelect.value || "__all__";
  catSelect.innerHTML =
    `<option value="__all__">ทุกหมวด</option>` +
    cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
  catSelect.value = cats.includes(cur) ? cur : "__all__";
  selectedCat = catSelect.value;
}

function render(){
  const filtered = allCards.filter((c) => {
    if (selectedCat !== "__all__" && c.category !== selectedCat) return false;
    if (!qText) return true;
    const hay = `${c.category} ${c.side} ${c.order}`.toLowerCase();
    return hay.includes(qText);
  });

  const pairMap = new Map();
  for (const c of filtered){
    const key = `${c.category}__${c.order}`;
    if (!pairMap.has(key)){
      pairMap.set(key, { category: c.category, order: c.order, front: null, back: null });
    }
    const p = pairMap.get(key);
    if (c.side === "front") p.front = c;
    if (c.side === "back") p.back = c;
  }

  const pairs = [...pairMap.values()].sort((a,b)=>{
    const cc = a.category.localeCompare(b.category);
    if (cc !== 0) return cc;
    return a.order - b.order;
  });

  pairsWrap.innerHTML = "";
  emptyState.hidden = pairs.length !== 0;

  for (const p of pairs){
    pairsWrap.appendChild(renderPair(p));
  }
}

function renderPair(p){
  const row = document.createElement("div");
  row.className = "pairRow";

  row.innerHTML = `
    <div class="pairHead">
      <div class="pairMeta">
        <div class="badge"><span class="muted">Category</span> ${esc(p.category)}</div>
        <div class="badge"><span class="muted">Order</span> ${esc(String(p.order))}</div>
      </div>
    </div>

    <div class="cards2">
      ${renderCardSlot("Front", p.front)}
      ${renderCardSlot("Back", p.back)}
    </div>
  `;

  return row;
}

function renderCardSlot(label, card){
  if (!card?.storagePath){
    return `
      <div class="cardSlot">
        <div class="cardStage">
          <div class="placeholder">NO ${esc(label.toUpperCase())}</div>
        </div>
      </div>
    `;
  }

  const imgId = `img_${card.id}`;
  setTimeout(()=>hydrateImage(imgId, card.storagePath), 0);

  return `
    <div class="cardSlot">
      <div class="cardStage">
        <img id="${imgId}" alt="${esc(card.category)} ${esc(card.side)}" loading="lazy" />
      </div>
    </div>
  `;
}

const urlCache = new Map();
async function hydrateImage(imgId, storagePath){
  const img = document.getElementById(imgId);
  if (!img || !storagePath) return;
  try{
    let url = urlCache.get(storagePath);
    if (!url){
      url = await getDownloadURL(sRef(storage, storagePath));
      urlCache.set(storagePath, url);
    }
    img.src = url;
  } catch(e){}
}

function esc(s){
  return (s ?? "").toString()
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

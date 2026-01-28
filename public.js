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

let allCards = []; // {id, category, side, order, storagePath}
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

// Firestore collection name
const col = collection(db, "card_templates");
const q = query(col, orderBy("order", "asc"));

onSnapshot(q, (snap) => {
  allCards = [];
  categorySet = new Set();

  snap.forEach((doc) => {
    const d = doc.data();
    if (d?.deleted) return;

    const category = (d.category || "").trim();
    const side = (d.side || "").trim(); // front/back
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
  catSelect.innerHTML = `<option value="__all__">ทุกหมวด</option>` + cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
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

  // Pairing rule: same category + same order => one row with front/back
  const pairMap = new Map(); // key => {category, order, front?, back?}
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
        <div class="badge"><span class="muted">Category</span> ${escapeHtml(p.category)}</div>
        <div class="badge"><span class="muted">Order</span> ${escapeHtml(String(p.order))}</div>
      </div>
    </div>

    <div class="cards2">
      ${renderCardSlotHtml("Front", p.front)}
      ${renderCardSlotHtml("Back", p.back)}
    </div>
  `;

  // wire download buttons
  const buttons = row.querySelectorAll("[data-dl]");
  buttons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-dl");
      const card = [p.front, p.back].find(x => x?.id === id);
      if (!card) return;
      btn.disabled = true;
      const oldText = btn.textContent;
      btn.textContent = "Downloading...";
      try{
        await downloadPngFromStorage(card);
      } finally {
        btn.disabled = false;
        btn.textContent = oldText;
      }
    });
  });

  return row;
}

function renderCardSlotHtml(label, card){
  const has = !!card?.storagePath;
  const side = card?.side || "";
  const title = `${label}`;

  if (!has){
    return `
      <div class="cardSlot">
        <div class="cardStage">
          <div class="placeholder">NO ${escapeHtml(label.toUpperCase())}</div>
        </div>
        <div class="downloadRow">
          <div class="smallMuted">${escapeHtml(title)}</div>
          <button class="dlBtn" disabled>Download</button>
        </div>
      </div>
    `;
  }

  // Use Storage path -> getDownloadURL at click time (faster initial)
  // But we want preview now: we will embed a lazy preview by fetching URL once per render.
  const imgId = `img_${card.id}`;
  // placeholder img; we'll resolve later
  setTimeout(()=>hydrateImage(imgId, card.storagePath), 0);

  return `
    <div class="cardSlot">
      <div class="cardStage">
        <img id="${imgId}" alt="${escapeHtml(card.category)} ${escapeHtml(side)}" loading="lazy" />
      </div>
      <div class="downloadRow">
        <div class="smallMuted">${escapeHtml(title)}</div>
        <button class="dlBtn" data-dl="${escapeHtml(card.id)}">Download PNG</button>
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
  } catch(e){
    // ignore
  }
}

async function downloadPngFromStorage(card){
  const r = sRef(storage, card.storagePath);
  const url = await getDownloadURL(r);

  const safeCat = slug(card.category);
  const filename = `${safeCat}_order-${card.order}_${card.side}.png`;

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.target = "_blank"; // กัน browser บางตัวงอแง
  document.body.appendChild(a);
  a.click();
  a.remove();
}


function slug(s){
  return (s||"category").toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g,"-")
    .replace(/[^a-z0-9\-_.]/g,"")
    .slice(0,60) || "category";
}
function escapeHtml(s){
  return (s ?? "").toString()
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

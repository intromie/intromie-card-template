import { firebaseConfig } from "./firebase.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  getFirestore,
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  getStorage,
  ref as sRef,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const loginBox = document.getElementById("loginBox");
const adminBox = document.getElementById("adminBox");
const logoutBtn = document.getElementById("logoutBtn");

const emailInput = document.getElementById("emailInput");
const passInput = document.getElementById("passInput");
const loginBtn = document.getElementById("loginBtn");
const loginMsg = document.getElementById("loginMsg");

const catInput = document.getElementById("catInput");
const sideInput = document.getElementById("sideInput");
const orderInput = document.getElementById("orderInput");
const fileInput = document.getElementById("fileInput");
const addBtn = document.getElementById("addBtn");
const addMsg = document.getElementById("addMsg");

const listWrap = document.getElementById("listWrap");
const listEmpty = document.getElementById("listEmpty");
const filterInput = document.getElementById("filterInput");
const filterCat = document.getElementById("filterCat");

let all = [];
let catSet = new Set();
let fText = "";
let fCat = "__all__";

filterInput.addEventListener("input", () => {
  fText = (filterInput.value||"").trim().toLowerCase();
  renderList();
});
filterCat.addEventListener("change", () => {
  fCat = filterCat.value;
  renderList();
});

loginBtn.addEventListener("click", async () => {
  setMsg(loginMsg, "");
  const email = (emailInput.value||"").trim();
  const pass = (passInput.value||"").trim();
  if (!email || !pass){
    setMsg(loginMsg, "ใส่ email/password ก่อนนะ", "err");
    return;
  }
  loginBtn.disabled = true;
  try{
    await signInWithEmailAndPassword(auth, email, pass);
  } catch(e){
    setMsg(loginMsg, friendlyAuthError(e), "err");
  } finally {
    loginBtn.disabled = false;
  }
});

logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, (user) => {
  if (user){
    loginBox.hidden = true;
    adminBox.hidden = false;
    logoutBtn.hidden = false;
    startRealtime();
  } else {
    loginBox.hidden = false;
    adminBox.hidden = true;
    logoutBtn.hidden = true;
    stopRealtime();
  }
});

let unsubscribe = null;
function startRealtime(){
  if (unsubscribe) return;
  const q = query(collection(db, "card_templates"), orderBy("order","asc"));
  unsubscribe = onSnapshot(q, (snap) => {
    all = [];
    catSet = new Set();
    snap.forEach((d) => {
      const data = d.data();
      if (data?.deleted) return;
      all.push({ id: d.id, ...data });
      if (data?.category) catSet.add(data.category);
    });
    rebuildCatFilter();
    renderList();
  });
}
function stopRealtime(){
  if (unsubscribe){
    unsubscribe();
    unsubscribe = null;
  }
  all = [];
  catSet = new Set();
  listWrap.innerHTML = "";
}

addBtn.addEventListener("click", async () => {
  setMsg(addMsg, "");
  const category = (catInput.value||"").trim();
  const side = (sideInput.value||"").trim(); // front/back
  const order = Number(orderInput.value);
  const file = fileInput.files?.[0];

  if (!category){
    setMsg(addMsg, "กรอก Category ก่อนนะ", "err"); return;
  }
  if (!["front","back"].includes(side)){
    setMsg(addMsg, "Side ต้องเป็น front/back", "err"); return;
  }
  if (!Number.isFinite(order)){
    setMsg(addMsg, "Order ต้องเป็นตัวเลข", "err"); return;
  }
  if (!file){
    setMsg(addMsg, "เลือกไฟล์รูปก่อนนะ", "err"); return;
  }

  addBtn.disabled = true;
  addBtn.textContent = "Uploading...";

  try{
    // Convert any image to PNG
    const pngBlob = await imageFileToPngBlob(file);

    // Create Firestore doc first (to get id)
    const docRef = await addDoc(collection(db, "card_templates"), {
      category,
      side,
      order,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      storagePath: "", // fill later
    });

    const id = docRef.id;
    const path = `templates/${id}.png`;

    // upload to Storage
    await uploadBytes(sRef(storage, path), pngBlob, {
      contentType: "image/png",
      cacheControl: "public,max-age=31536000",
    });

    // update doc with storagePath
    await updateDoc(doc(db, "card_templates", id), {
      storagePath: path,
      updatedAt: serverTimestamp(),
    });

    setMsg(addMsg, "อัปโหลดสำเร็จ ✅", "ok");
    // reset input
    fileInput.value = "";
  } catch(e){
    setMsg(addMsg, e?.message || "อัปโหลดไม่สำเร็จ", "err");
  } finally {
    addBtn.disabled = false;
    addBtn.textContent = "Upload";
  }
});

function rebuildCatFilter(){
  const cats = [...catSet].sort((a,b)=>a.localeCompare(b));
  const cur = filterCat.value || "__all__";
  filterCat.innerHTML = `<option value="__all__">ทุกหมวด</option>` + cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  filterCat.value = cats.includes(cur) ? cur : "__all__";
  fCat = filterCat.value;
}

function renderList(){
  const filtered = all.filter((x) => {
    const cat = (x.category||"").trim();
    if (fCat !== "__all__" && cat !== fCat) return false;

    if (!fText) return true;
    const hay = `${cat} ${x.side} ${x.order}`.toLowerCase();
    return hay.includes(fText);
  });

  listWrap.innerHTML = "";
  listEmpty.hidden = filtered.length !== 0;

  filtered.sort((a,b)=>{
    const cc = (a.category||"").localeCompare(b.category||"");
    if (cc !== 0) return cc;
    return Number(a.order) - Number(b.order);
  });

  for (const item of filtered){
    listWrap.appendChild(renderItem(item));
  }
}

function renderItem(item){
  const row = document.createElement("div");
  row.className = "itemRow";

  const thumbUrlId = `thumb_${item.id}`;
  row.innerHTML = `
    <div class="thumb"><img id="${thumbUrlId}" alt="thumb" /></div>
    <div class="itemMeta">
      <div class="itemTop">
        <div class="itemTitle">${escapeHtml(item.category || "")} • <span style="color:var(--muted)">${escapeHtml(item.side||"")}</span></div>
        <div class="actions">
          <button class="btnMini" data-save="${escapeHtml(item.id)}">Save</button>
          <label class="btnMini" style="display:inline-flex;align-items:center;gap:8px;">
            Change image
            <input type="file" accept="image/*" data-file="${escapeHtml(item.id)}" style="display:none;">
          </label>
          <button class="btnMini danger" data-del="${escapeHtml(item.id)}">Delete</button>
        </div>
      </div>

      <div class="itemFields">
        <input class="mini" data-field="category" data-id="${escapeHtml(item.id)}" value="${escapeHtml(item.category||"")}" placeholder="Category" />
        <select class="mini" data-field="side" data-id="${escapeHtml(item.id)}">
          <option value="front" ${item.side==="front" ? "selected" : ""}>front</option>
          <option value="back" ${item.side==="back" ? "selected" : ""}>back</option>
        </select>
        <input class="mini" data-field="order" data-id="${escapeHtml(item.id)}" value="${escapeHtml(String(item.order ?? ""))}" type="number" step="1" placeholder="Order" />
      </div>

      <div class="msg" id="msg_${escapeHtml(item.id)}"></div>
    </div>
  `;

  // hydrate thumbnail
  hydrateThumb(thumbUrlId, item.storagePath);

  // Save button
  row.querySelector(`[data-save="${cssEsc(item.id)}"]`)?.addEventListener("click", async () => {
    const msgEl = row.querySelector(`#msg_${cssEsc(item.id)}`);
    setMsg(msgEl, "");
    const catEl = row.querySelector(`[data-field="category"][data-id="${cssEsc(item.id)}"]`);
    const sideEl = row.querySelector(`[data-field="side"][data-id="${cssEsc(item.id)}"]`);
    const orderEl = row.querySelector(`[data-field="order"][data-id="${cssEsc(item.id)}"]`);

    const category = (catEl?.value||"").trim();
    const side = (sideEl?.value||"").trim();
    const order = Number(orderEl?.value);

    if (!category){ setMsg(msgEl, "Category ห้ามว่าง", "err"); return; }
    if (!["front","back"].includes(side)){ setMsg(msgEl, "Side ต้อง front/back", "err"); return; }
    if (!Number.isFinite(order)){ setMsg(msgEl, "Order ต้องเป็นตัวเลข", "err"); return; }

    try{
      await updateDoc(doc(db, "card_templates", item.id), {
        category, side, order,
        updatedAt: serverTimestamp(),
      });
      setMsg(msgEl, "Saved ✅", "ok");
    } catch(e){
      setMsg(msgEl, e?.message || "Save ไม่สำเร็จ", "err");
    }
  });

  // Delete
  row.querySelector(`[data-del="${cssEsc(item.id)}"]`)?.addEventListener("click", async () => {
    const ok = confirm("ลบการ์ดใบนี้ทิ้งเลยนะ?");
    if (!ok) return;
    const msgEl = row.querySelector(`#msg_${cssEsc(item.id)}`);
    setMsg(msgEl, "Deleting...");

    try{
      // delete storage file
      const path = item.storagePath;
      if (path){
        await deleteObject(sRef(storage, path)).catch(()=>{});
      }
      // delete firestore doc
      await deleteDoc(doc(db, "card_templates", item.id));
      // (optional) success message not needed because row disappears on snapshot
    } catch(e){
      setMsg(msgEl, e?.message || "ลบไม่สำเร็จ", "err");
    }
  });

  // Change image
  const fileEl = row.querySelector(`input[type="file"][data-file="${cssEsc(item.id)}"]`);
  fileEl?.addEventListener("change", async () => {
    const f = fileEl.files?.[0];
    if (!f) return;
    const msgEl = row.querySelector(`#msg_${cssEsc(item.id)}`);
    setMsg(msgEl, "Uploading new image...");

    try{
      const pngBlob = await imageFileToPngBlob(f);
      const path = item.storagePath || `templates/${item.id}.png`;
      await uploadBytes(sRef(storage, path), pngBlob, {
        contentType: "image/png",
        cacheControl: "public,max-age=31536000",
      });
      await updateDoc(doc(db, "card_templates", item.id), {
        storagePath: path,
        updatedAt: serverTimestamp(),
      });
      setMsg(msgEl, "Updated image ✅", "ok");
      hydrateThumb(thumbUrlId, path, true);
    } catch(e){
      setMsg(msgEl, e?.message || "อัปเดตรูปไม่สำเร็จ", "err");
    } finally {
      fileEl.value = "";
    }
  });

  return row;
}

const thumbCache = new Map();
async function hydrateThumb(imgId, storagePath, bust=false){
  const img = document.getElementById(imgId);
  if (!img || !storagePath) return;
  try{
    let url = thumbCache.get(storagePath);
    if (!url || bust){
      url = await getDownloadURL(sRef(storage, storagePath));
      // cache-bust for aggressive browser cache
      if (bust) url = url + (url.includes("?") ? "&" : "?") + "t=" + Date.now();
      thumbCache.set(storagePath, url);
    }
    img.src = url;
  } catch(e){
    // ignore
  }
}

async function imageFileToPngBlob(file){
  // Load image
  const dataUrl = await fileToDataURL(file);
  const img = await dataUrlToImage(dataUrl);

  // Draw to canvas -> PNG
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 1.0));
  if (!blob) throw new Error("Convert to PNG failed");
  return blob;
}

function fileToDataURL(file){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
function dataUrlToImage(dataUrl){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function setMsg(el, text, type=""){
  if (!el) return;
  el.className = "msg" + (type ? ` ${type}` : "");
  el.textContent = text || "";
}

function friendlyAuthError(e){
  const code = e?.code || "";
  if (code.includes("auth/invalid-credential")) return "อีเมล/รหัสผ่านไม่ถูกนะ";
  if (code.includes("auth/user-not-found")) return "ไม่เจอผู้ใช้นี้";
  if (code.includes("auth/wrong-password")) return "รหัสผ่านไม่ถูก";
  if (code.includes("auth/too-many-requests")) return "ลองใหม่อีกทีนะ (ระบบกันยิงรัว)";
  return e?.message || "Login ไม่สำเร็จ";
}

function escapeHtml(s){
  return (s ?? "").toString()
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function cssEsc(s){
  return (s ?? "").toString().replaceAll('"','\\"');
}

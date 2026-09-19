import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getFirestore, enableIndexedDbPersistence, collection, addDoc, 
  onSnapshot, doc, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { 
  getAuth, signInWithEmailAndPassword, setPersistence, 
  inMemoryPersistence, onAuthStateChanged, signOut 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDUSmond8b9lMprdHjnvnuRygaRdC9kbxo",
  authDomain: "takeitdoit-app.firebaseapp.com",
  projectId: "takeitdoit-app",
  storageBucket: "takeitdoit-app.firebasestorage.app",
  messagingSenderId: "1057165971311",
  appId: "1:1057165971311:web:801032e04ea0fb7d27e29a",
  measurementId: "G-S8PC6K718R"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const ALLOWED_OFFICER_EMAIL = "officer@class.com";
let cachedTaskMap = new Map();
let isOfficerAuthenticated = false;

setPersistence(auth, inMemoryPersistence).catch(err => console.warn(err));
enableIndexedDbPersistence(db).catch(err => console.warn(err.code));

/* ==========================================
   1. DOM ELEMENTS
   ========================================== */
const taskGrid = document.getElementById("taskGrid");
const expandModal = document.getElementById("expandModal");
const adminModal = document.getElementById("adminModal");
const editModal = document.getElementById("editModal");
const adminAuthStep = document.getElementById("adminAuthStep");
const adminFormStep = document.getElementById("adminFormStep");
const passcodeError = document.getElementById("passcodeError");
const themeToggleBtn = document.getElementById("themeToggle");
const netStatusPill = document.getElementById("netStatusPill");
const saveBanner = document.getElementById("saveBanner");
const btnInstallPWA = document.getElementById("btnInstallPWA");
const archiveModal = document.getElementById("archiveModal");
const archiveList = document.getElementById("archiveList");
const taskSearchInput = document.getElementById("taskSearchInput");
const subjectFilterSelect = document.getElementById("subjectFilterSelect");
const sortFilterSelect = document.getElementById("sortFilterSelect");

/* ==========================================
   2. LOCAL STORAGE & DATA MANAGEMENT
   ========================================== */
function getPersonalTaskState(taskId) {
  const localData = JSON.parse(localStorage.getItem("user_task_progress")) || {};
  return !!localData[taskId];
}
function setPersonalTaskState(taskId, isCompleted) {
  const localData = JSON.parse(localStorage.getItem("user_task_progress")) || {};
  localData[taskId] = isCompleted;
  localStorage.setItem("user_task_progress", JSON.stringify(localData));
}

function getArchivedTasks() { return JSON.parse(localStorage.getItem("takeitdoit_archived")) || []; }
function getPinnedTasks() { return JSON.parse(localStorage.getItem("user_pinned_tasks")) || []; }

function togglePinTask(taskId) {
  let pinned = getPinnedTasks();
  if (pinned.includes(taskId)) {
    pinned = pinned.filter(id => id !== taskId);
  } else {
    pinned.push(taskId);
  }
  localStorage.setItem("user_pinned_tasks", JSON.stringify(pinned));
  renderActiveTasks();
}

function autoCleanArchives() {
  const archived = getArchivedTasks();
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const cleaned = archived.filter(item => (now - item.archivedAt) <= SEVEN_DAYS_MS);
  if (cleaned.length !== archived.length) localStorage.setItem("takeitdoit_archived", JSON.stringify(cleaned));
}
autoCleanArchives();

function archiveTask(taskId) {
  const archived = getArchivedTasks();
  if (!archived.some(item => item.id === taskId)) {
    archived.push({ id: taskId, archivedAt: Date.now() });
    localStorage.setItem("takeitdoit_archived", JSON.stringify(archived));
  }
  renderActiveTasks();
}

function unarchiveTask(taskId) {
  let archived = getArchivedTasks();
  archived = archived.filter(item => item.id !== taskId);
  localStorage.setItem("takeitdoit_archived", JSON.stringify(archived));
  renderArchiveList();
  renderActiveTasks();
}

/* ==========================================
   3. ARCHIVE MODAL RENDER
   ========================================== */
function renderArchiveList() {
  if (!archiveList) return;
  const archived = getArchivedTasks();
  if (archived.length === 0) {
    archiveList.innerHTML = `<div style="text-align: center; padding: 20px; opacity: 0.7;">No archived tasks.</div>`;
    return;
  }
  archiveList.innerHTML = "";
  archived.forEach((item) => {
    const taskData = cachedTaskMap.get(item.id) || { title: "Archived Task (" + item.id + ")" };
    const div = document.createElement("div");
    div.className = "archive-item";
    div.innerHTML = `
      <div>
        <div style="font-weight: 700; font-size: 0.9rem;">${taskData.title}</div>
        <div style="font-size: 0.75rem; opacity: 0.7;">Archived locally</div>
      </div>
      <button class="btn-unarchive" data-id="${item.id}">Restore</button>
    `;
    div.querySelector(".btn-unarchive").addEventListener("click", () => unarchiveTask(item.id));
    archiveList.appendChild(div);
  });
}
document.getElementById("btnOpenArchive")?.addEventListener("click", () => { renderArchiveList(); archiveModal?.classList.add("active"); });
document.getElementById("btnCloseArchive")?.addEventListener("click", () => archiveModal?.classList.remove("active"));

/* ==========================================
   4. DATE LOGIC & FILTERS
   ========================================== */
let currentTimeFilter = "all";
document.querySelectorAll(".btn-time-filter").forEach(btn => {
  if(btn.id.includes("SubTask")) return; // skip subtask buttons
  btn.addEventListener("click", (e) => {
    document.querySelectorAll(".btn-time-filter:not(#btnAddAdminSubTask):not(#btnAddEditSubTask)").forEach(b => b.classList.remove("active"));
    e.target.classList.add("active");
    currentTimeFilter = e.target.getAttribute("data-time");
    renderActiveTasks();
  });
});

function getDeadlineStatus(dateString) {
  if (!dateString || dateString.trim() === "") return "none";
  const dueDate = new Date(dateString);
  if (isNaN(dueDate.getTime())) return "unknown"; 
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate); due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));
  
  if (diffDays < -7) return "vault";
  if (diffDays < 0) return "overdue";
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  return "future";
}
taskSearchInput?.addEventListener("input", renderActiveTasks);
subjectFilterSelect?.addEventListener("change", renderActiveTasks);
sortFilterSelect?.addEventListener("change", renderActiveTasks);

/* ==========================================
   5. TASK CARD RENDER & SUB-TASKS ENGINE
   ========================================== */
function renderActiveTasks() {
  if (!taskGrid) return;
  taskGrid.innerHTML = "";

  const archivedList = getArchivedTasks();
  const archivedIds = archivedList.map(item => item.id);
  const pinnedIds = getPinnedTasks();
  
  const query = taskSearchInput ? taskSearchInput.value.trim().toLowerCase() : "";
  const selectedSubject = subjectFilterSelect ? subjectFilterSelect.value.toLowerCase() : "all";
  const sortBy = sortFilterSelect ? sortFilterSelect.value : "due-asc";

  let activeIds = Array.from(cachedTaskMap.keys()).filter((id) => {
    if (archivedIds.includes(id)) return false;
    const task = cachedTaskMap.get(id) || {};
    const title = (task.title || "").toLowerCase();
    const body = (task.body || "").toLowerCase();
    const subject = (task.subject || "").toLowerCase();
    const timeStatus = getDeadlineStatus(task.dueDate);

    if (selectedSubject !== "all" && subject !== selectedSubject) return false;
    if (query && !title.includes(query) && !body.includes(query)) return false;
    if (currentTimeFilter !== "vault" && timeStatus === "vault") return false;
    if (currentTimeFilter === "vault" && timeStatus !== "vault") return false;
    if (currentTimeFilter !== "all" && currentTimeFilter !== "vault" && timeStatus !== currentTimeFilter) return false;
    return true;
  });

  activeIds.sort((a, b) => {
    const isAPinned = pinnedIds.includes(a);
    const isBPinned = pinnedIds.includes(b);
    if (isAPinned && !isBPinned) return -1;
    if (!isAPinned && isBPinned) return 1;

    const taskA = cachedTaskMap.get(a) || {};
    const taskB = cachedTaskMap.get(b) || {};
    if (sortBy === "subject-asc") return (taskA.subject || "z").toLowerCase().localeCompare((taskB.subject || "z").toLowerCase());
    if (sortBy === "posted-desc") return new Date(taskB.createdAt || 0) - new Date(taskA.createdAt || 0);
    return (taskA.dueDate ? new Date(taskA.dueDate).getTime() : Infinity) - (taskB.dueDate ? new Date(taskB.dueDate).getTime() : Infinity);
  });

  if (activeIds.length === 0) {
    taskGrid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">No tasks match your current filters.</div>`;
    return;
  }
  activeIds.forEach((id) => renderTaskCard(id, cachedTaskMap.get(id)));
}

function renderTaskCard(id, data) {
  if (!taskGrid) return;
  const isCompleted = getPersonalTaskState(id);
  const isPinned = getPinnedTasks().includes(id);
  const subjectClass = data.subject ? `bg-${data.subject.toLowerCase().replace(/[^a-z0-9]/g, '')}` : 'bg-cmpe';
  
  const timeStatus = getDeadlineStatus(data.dueDate);
  let stateClass = "";
  if (!isCompleted && (timeStatus === "today" || timeStatus === "overdue")) stateClass = "urgent";
  else if (timeStatus === "vault") stateClass = "vault";
  if (isPinned) stateClass += " pinned";

  let displayDate = data.dueDate ? `Due: ${data.dueDate}` : "No Deadline";
  if (timeStatus === "overdue") displayDate = `⚠️ OVERDUE: ${data.dueDate}`;
  if (timeStatus === "today") displayDate = `🔥 DUE TODAY: ${data.dueDate}`;
  if (timeStatus === "vault") displayDate = `🗄️ DEEP VAULT: ${data.dueDate}`;

  // UPDATE 8.7: Calculate Progress Bar & Render Subtasks
  let progressHTML = "";
  let subTasksHTML = "";
  const subTasks = data.subTasks || [];
  
  if (subTasks.length > 0) {
    const localSubProgress = JSON.parse(localStorage.getItem("user_subtask_progress")) || {};
    const taskSubProgress = localSubProgress[id] || {};
    let completedCount = 0;

    subTasksHTML = `<div class="sub-task-list">`;
    subTasks.forEach((st, idx) => {
      const isDone = !!taskSubProgress[idx];
      if (isDone) completedCount++;
      subTasksHTML += `
        <label class="sub-task-item ${isDone ? 'done' : ''}" onclick="event.stopPropagation()">
          <input type="checkbox" class="subtask-checkbox" data-idx="${idx}" ${isDone ? 'checked' : ''} />
          <span>${st}</span>
        </label>
      `;
    });
    subTasksHTML += `</div>`;

    const percent = Math.round((completedCount / subTasks.length) * 100);
    progressHTML = `
      <div class="progress-wrapper" title="${percent}% Complete">
        <div class="progress-fill" style="width: ${percent}%;"></div>
      </div>
    `;
  }
  
  const card = document.createElement("div");
  card.className = `card ${subjectClass} ${isCompleted ? 'completed' : ''} ${stateClass}`;
  card.setAttribute("data-id", id);
  card.innerHTML = `
    <div>
      <div class="card-top">
        <div class="card-controls">
          <input type="checkbox" class="checkbox" ${isCompleted ? 'checked' : ''} title="Mark Entire Task Complete"/>
          <button class="btn-pin-icon" title="Pin to top">📌</button>
          <button class="btn-expand-icon" title="Expand task view">⤢</button>
          <button class="btn-archive-icon" title="Archive task">📦</button>
          <button class="btn-edit-icon admin-only" title="Edit task">✏️</button>
          <button class="btn-delete-icon admin-only" title="Delete task">🗑️</button>
        </div>
        <span class="badge">${(data.subject || 'GENERAL').toUpperCase()}</span>
      </div>
      <h3 class="card-title">${data.title || 'Untitled Task'}</h3>
      <div class="due-date">${displayDate}</div>
    </div>
    ${progressHTML}
    <div class="card-body">${data.body || ''}</div>
    ${subTasksHTML}
  `;

  // Main Task Completion
  const checkbox = card.querySelector(".checkbox");
  checkbox?.addEventListener("change", (e) => {
    e.stopPropagation();
    setPersonalTaskState(id, checkbox.checked);
    card.classList.toggle("completed", checkbox.checked);
    if (checkbox.checked) card.classList.remove("urgent");
    else if (timeStatus === "today" || timeStatus === "overdue") card.classList.add("urgent");
  });

  // Sub-Task Checkbox Logic (Update 8.7)
  card.querySelectorAll(".subtask-checkbox").forEach(chk => {
    chk.addEventListener("change", (e) => {
      e.stopPropagation();
      const idx = chk.getAttribute("data-idx");
      let localSub = JSON.parse(localStorage.getItem("user_subtask_progress")) || {};
      if (!localSub[id]) localSub[id] = {};
      localSub[id][idx] = chk.checked;
      localStorage.setItem("user_subtask_progress", JSON.stringify(localSub));
      renderActiveTasks(); // Re-render to update the visual progress bar immediately
    });
  });

  // Button Listeners
  card.querySelector(".btn-pin-icon")?.addEventListener("click", (e) => { e.stopPropagation(); togglePinTask(id); });
  card.querySelector(".btn-archive-icon")?.addEventListener("click", (e) => { e.stopPropagation(); archiveTask(id); });
  card.querySelector(".btn-edit-icon")?.addEventListener("click", (e) => { e.stopPropagation(); openEditModal(id, data); });
  card.querySelector(".btn-delete-icon")?.addEventListener("click", (e) => { e.stopPropagation(); deleteTask(id); });
  
  // === THIS IS THE UPDATED STEP 3 SECTION ===
  card.querySelector(".btn-expand-icon")?.addEventListener("click", (e) => {
    e.stopPropagation();
    document.getElementById("expBadge").textContent = (data.subject || 'GENERAL').toUpperCase();
    document.getElementById("expTitle").textContent = data.title || 'Untitled Task';
    document.getElementById("expDueDate").textContent = displayDate;
    document.getElementById("expBody").innerHTML = data.body || '';
    
    // Inject Sub-Tasks into the Expand Modal
    const expProgress = document.getElementById("expProgress");
    const expSubTasks = document.getElementById("expSubTasks");
    
    if (expProgress) expProgress.innerHTML = progressHTML;
    if (expSubTasks) {
      expSubTasks.innerHTML = subTasksHTML;
      
      // Make the checkboxes in the maximized view interactive
      expSubTasks.querySelectorAll(".subtask-checkbox").forEach(chk => {
        chk.addEventListener("change", (e) => {
          e.stopPropagation();
          const idx = chk.getAttribute("data-idx");
          let localSub = JSON.parse(localStorage.getItem("user_subtask_progress")) || {};
          if (!localSub[id]) localSub[id] = {};
          localSub[id][idx] = chk.checked;
          localStorage.setItem("user_subtask_progress", JSON.stringify(localSub));
          
          // Re-render the background board to keep everything in sync
          renderActiveTasks(); 
        });
      });
    }
    
    expandModal?.classList.add("active");
  });
  // === END UPDATED STEP 3 SECTION ===

  card.addEventListener("click", (e) => {
    if (e.target.tagName === "A" || e.target.tagName === "BUTTON" || e.target.classList.contains("checkbox") || e.target.classList.contains("subtask-checkbox")) return;
    checkbox.click(); 
  });
  taskGrid.appendChild(card);
}

/* ==========================================
   6. THEME, NETWORK, AND PWA
   ========================================== */
function applyTheme(theme) {
  if (!themeToggleBtn) return;
  if (theme === "dark") { document.body.classList.add("dark-mode"); themeToggleBtn.textContent = "☀️ Light Mode"; } 
  else { document.body.classList.remove("dark-mode"); themeToggleBtn.textContent = "🌙 Dark Mode"; }
}
const savedTheme = localStorage.getItem("app_theme") || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
applyTheme(savedTheme);
themeToggleBtn?.addEventListener("click", () => {
  const isDark = document.body.classList.toggle("dark-mode");
  const currentTheme = isDark ? "dark" : "light";
  localStorage.setItem("app_theme", currentTheme);
  applyTheme(currentTheme);
});

function updateNetworkStatus() {
  if (navigator.onLine) {
    if (netStatusPill) { netStatusPill.className = "btn-pill btn-light-green"; netStatusPill.textContent = "⚡ Syncing Live"; }
    if (saveBanner) { saveBanner.className = "status-banner btn-light-green"; saveBanner.textContent = "🟢 Live Cloud Connection Active"; }
  } else {
    if (netStatusPill) { netStatusPill.className = "btn-pill btn-offline"; netStatusPill.textContent = "📡 Offline Mode"; }
    if (saveBanner) { saveBanner.className = "status-banner btn-offline"; saveBanner.textContent = "🟠 Offline - Serving local cached tasks"; }
  }
}
window.addEventListener("online", updateNetworkStatus);
window.addEventListener("offline", updateNetworkStatus);
updateNetworkStatus();

let deferredPrompt;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); deferredPrompt = e;
  if (btnInstallPWA) btnInstallPWA.style.display = "inline-flex";
});
btnInstallPWA?.addEventListener("click", async () => {
  if (!deferredPrompt) return; deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === "accepted" && btnInstallPWA) btnInstallPWA.style.display = "none";
  deferredPrompt = null;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(err => console.warn(err)));
}

function sendLocalNotification(title, body, tag) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready.then((reg) => {
      reg.showNotification(title, { body: body, icon: "./icon-192.png", badge: "./badge.png", tag: tag, vibrate: [200, 100, 200] });
    }).catch(() => new Notification(title, { body, icon: "./icon-192.png", tag }));
  } else { new Notification(title, { body, icon: "./icon-192.png", tag }); }
}
document.getElementById("btnNotifPermission")?.addEventListener("click", async () => {
  if (!("Notification" in window)) return alert("Browser does not support notifications.");
  const permission = await Notification.requestPermission();
  if (permission === "granted") { alert("Notifications enabled!"); sendLocalNotification("Test", "Notifications active!", "test"); }
});

/* ==========================================
   7. FIRESTORE REAL-TIME LISTENER
   ========================================== */
onSnapshot(collection(db, "subjects"), (snapshot) => {
  const filterSelect = document.getElementById("subjectFilterSelect");
  const adminSelect = document.getElementById("adminTaskSubject");
  const editSelect = document.getElementById("editTaskSubject");
  
  // Extract and sort subjects alphabetically
  const subjects = snapshot.docs.map(doc => doc.data().name).sort();
  
  // Build the HTML strings
  let filterHTML = '<option value="all">📚 All Subjects</option>';
  let formHTML = '';
  
  subjects.forEach(sub => {
    filterHTML += `<option value="${sub.toLowerCase()}">${sub}</option>`;
    formHTML += `<option value="${sub.toLowerCase()}">${sub}</option>`;
  });
  
  // Inject into DOM
  if (filterSelect) filterSelect.innerHTML = filterHTML;
  if (adminSelect) adminSelect.innerHTML = formHTML;
  if (editSelect) editSelect.innerHTML = formHTML;
  
  renderActiveTasks(); // Re-render the board in case the active filter changed
}, (error) => console.error("Subject Firestore Error: ", error));
let isInitialLoad = true;
onSnapshot(collection(db, "tasks"), (snapshot) => {
  if (!taskGrid) return;
  snapshot.docChanges().forEach((change) => {
    if (change.type === "added" && !isInitialLoad) {
      const data = change.doc.data();
      sendLocalNotification(`📌 New Task [${(data.subject || "GEN").toUpperCase()}]`, data.title || "New Task Posted", change.doc.id);
    }
  });
  isInitialLoad = false;
  cachedTaskMap.clear();
  snapshot.docs.forEach(docSnap => cachedTaskMap.set(docSnap.id, docSnap.data()));
  renderActiveTasks();
}, (error) => console.error("Firestore Error: ", error));

/* ==========================================
   8. OFFICER AUTH & ADMIN ACTIONS
   ========================================== */
function switchAdminStep(showForm) {
  if (adminAuthStep) adminAuthStep.style.display = showForm ? "none" : "block";
  if (adminFormStep) adminFormStep.style.display = showForm ? "block" : "none";
}

document.getElementById("btnAdminAccess")?.addEventListener("click", () => adminModal?.classList.add("active"));
document.getElementById("btnCloseAdmin")?.addEventListener("click", () => {
  adminModal?.classList.remove("active");
  document.getElementById("adminSubTaskList").innerHTML = ""; // clear inputs
});
document.getElementById("btnLogoutOfficer")?.addEventListener("click", async () => { await signOut(auth); alert("Officer session closed."); });

onAuthStateChanged(auth, (user) => {
  if (user && user.email && user.email.toLowerCase() === ALLOWED_OFFICER_EMAIL.toLowerCase()) {
    isOfficerAuthenticated = true; document.body.classList.add("is-officer"); switchAdminStep(true);
  } else {
    isOfficerAuthenticated = false; document.body.classList.remove("is-officer"); switchAdminStep(false);
  }
});

document.getElementById("btnVerifyPasscode")?.addEventListener("click", async (e) => {
  e.preventDefault();
  const emailInput = document.getElementById("adminEmail")?.value.trim();
  const passwordInput = document.getElementById("adminPasscode")?.value;
  if (!emailInput || !passwordInput) { if (passcodeError) passcodeError.style.display = "block"; return; }
  try {
    await signInWithEmailAndPassword(auth, emailInput, passwordInput);
    if (passcodeError) passcodeError.style.display = "none";
    if (document.getElementById("adminPasscode")) document.getElementById("adminPasscode").value = "";
    switchAdminStep(true);
  } catch (error) { if (passcodeError) { passcodeError.textContent = "Access denied."; passcodeError.style.display = "block"; } }
});

// UPDATE 8.7: Dynamic Sub-Task Field Generator
function createSubTaskInput(value = "") {
  const div = document.createElement("div");
  div.className = "sub-task-input-group";
  const input = document.createElement("input");
  input.type = "text"; input.className = "admin-input sub-task-val"; input.placeholder = "Enter sub-task..."; input.value = value;
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "btn-remove-subtask"; btn.textContent = "X";
  btn.onclick = () => div.remove();
  div.appendChild(input); div.appendChild(btn);
  return div;
}

document.getElementById("btnAddAdminSubTask")?.addEventListener("click", () => {
  document.getElementById("adminSubTaskList")?.appendChild(createSubTaskInput());
});
document.getElementById("btnAddEditSubTask")?.addEventListener("click", () => {
  document.getElementById("editSubTaskList")?.appendChild(createSubTaskInput());
});

// Admin Submit 
document.getElementById("adminTaskForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const subTaskInputs = document.querySelectorAll("#adminSubTaskList .sub-task-val");
  const subTasks = Array.from(subTaskInputs).map(inp => inp.value.trim()).filter(val => val !== "");

  const newTask = {
    title: document.getElementById("adminTaskTitle")?.value || "",
    subject: document.getElementById("adminTaskSubject")?.value || "",
    dueDate: document.getElementById("adminTaskDueDate")?.value || "",
    body: document.getElementById("adminTaskBody")?.value || "",
    subTasks: subTasks, // Saves array to Firestore
    createdAt: new Date().toISOString()
  };
  try {
    await addDoc(collection(db, "tasks"), newTask);
    document.getElementById("adminTaskForm")?.reset();
    document.getElementById("adminSubTaskList").innerHTML = "";
    adminModal?.classList.remove("active");
    alert("Task successfully published!");
  } catch (err) { alert("Failed to publish: " + err.message); }
});

// Edit Task Handlers
function openEditModal(taskId, data) {
  if (document.getElementById("editTaskId")) document.getElementById("editTaskId").value = taskId;
  if (document.getElementById("editTaskTitle")) document.getElementById("editTaskTitle").value = data.title || "";
  if (document.getElementById("editTaskSubject")) document.getElementById("editTaskSubject").value = (data.subject || "chem").toLowerCase();
  if (document.getElementById("editTaskDueDate")) document.getElementById("editTaskDueDate").value = data.dueDate || "";
  if (document.getElementById("editTaskBody")) document.getElementById("editTaskBody").value = data.body || "";
  
  // Load existing sub-tasks into edit form
  const container = document.getElementById("editSubTaskList");
  if (container) {
    container.innerHTML = "";
    const subTasks = data.subTasks || [];
    subTasks.forEach(st => container.appendChild(createSubTaskInput(st)));
  }
  editModal?.classList.add("active");
}
document.getElementById("btnCloseEdit")?.addEventListener("click", () => editModal?.classList.remove("active"));
document.getElementById("editTaskForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const taskId = document.getElementById("editTaskId")?.value;
  const subTaskInputs = document.querySelectorAll("#editSubTaskList .sub-task-val");
  const subTasks = Array.from(subTaskInputs).map(inp => inp.value.trim()).filter(val => val !== "");

  const updatedFields = {
    title: document.getElementById("editTaskTitle")?.value || "",
    subject: document.getElementById("editTaskSubject")?.value || "",
    dueDate: document.getElementById("editTaskDueDate")?.value || "",
    body: document.getElementById("editTaskBody")?.value || "",
    subTasks: subTasks,
    updatedAt: new Date().toISOString()
  };
  try {
    await updateDoc(doc(db, "tasks", taskId), updatedFields);
    editModal?.classList.remove("active");
    alert("Task updated successfully!");
  } catch (err) { alert("Failed to update: " + err.message); }
});

/* Delete Task Handler */
async function deleteTask(taskId) {
  if (!confirm("Are you sure you want to permanently delete this task for all students?")) return;
  try { await deleteDoc(doc(db, "tasks", taskId)); alert("Task permanently deleted."); } 
  catch (err) { alert("Error deleting task: " + err.message); }
}

/* Expand Modal Controls */
const btnCloseExpand = document.getElementById("btnCloseExpand");
if (btnCloseExpand) btnCloseExpand.addEventListener("click", () => expandModal?.classList.remove("active"));
expandModal?.addEventListener("click", (e) => { if (e.target === expandModal) expandModal.classList.remove("active"); });

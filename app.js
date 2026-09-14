import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
  import { 
    getFirestore, 
    enableIndexedDbPersistence, 
    collection, 
    addDoc, 
    onSnapshot,
    doc,
    updateDoc,
    deleteDoc
  } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
  import { 
    getAuth, 
    signInWithEmailAndPassword, 
    setPersistence,
    inMemoryPersistence,
    onAuthStateChanged,
    signOut 
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

  setPersistence(auth, inMemoryPersistence).catch((err) => {
    console.warn("Auth persistence status:", err);
  });

  enableIndexedDbPersistence(db).catch((err) => {
    console.warn("Offline persistence status:", err.code);
  });

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
  const btnOpenArchive = document.getElementById("btnOpenArchive");
  const btnCloseArchive = document.getElementById("btnCloseArchive");
  const archiveList = document.getElementById("archiveList");
  const taskSearchInput = document.getElementById("taskSearchInput");
  const subjectFilterSelect = document.getElementById("subjectFilterSelect");

  /* ==========================================
     2. LOCAL STORAGE & ARCHIVE HELPERS
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

  function getArchivedTasks() {
    return JSON.parse(localStorage.getItem("takeitdoit_archived")) || [];
  }

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

      div.querySelector(".btn-unarchive").addEventListener("click", () => {
        unarchiveTask(item.id);
      });

      archiveList.appendChild(div);
    });
  }

  btnOpenArchive?.addEventListener("click", () => {
    renderArchiveList();
    archiveModal?.classList.add("active");
  });

  btnCloseArchive?.addEventListener("click", () => {
    archiveModal?.classList.remove("active");
  });

  /* ==========================================
     4. DATE LOGIC & TIME FILTERING (UPDATE 8.4)
     ========================================== */
  let currentTimeFilter = "all";

  document.querySelectorAll(".btn-time-filter").forEach(btn => {
    btn.addEventListener("click", (e) => {
      document.querySelectorAll(".btn-time-filter").forEach(b => b.classList.remove("active"));
      e.target.classList.add("active");
      currentTimeFilter = e.target.getAttribute("data-time");
      renderActiveTasks();
    });
  });

  function getDeadlineStatus(dateString) {
    if (!dateString || dateString.trim() === "") return "none";
    
    const dueDate = new Date(dateString);
    if (isNaN(dueDate.getTime())) return "unknown"; 
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    
    const diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) return "overdue";
    if (diffDays === 0) return "today";
    if (diffDays === 1) return "tomorrow";
    return "future";
  }

  taskSearchInput?.addEventListener("input", renderActiveTasks);
  subjectFilterSelect?.addEventListener("change", renderActiveTasks);

  /* ==========================================
     5. TASK CARD RENDER & ADMIN CONTROLS 
     ========================================== */
  function renderActiveTasks() {
    if (!taskGrid) return;
    taskGrid.innerHTML = "";

    const archivedList = getArchivedTasks();
    const archivedIds = archivedList.map(item => item.id);
    
    const query = taskSearchInput ? taskSearchInput.value.trim().toLowerCase() : "";
    const selectedSubject = subjectFilterSelect ? subjectFilterSelect.value.toLowerCase() : "all";

    const activeIds = Array.from(cachedTaskMap.keys()).filter((id) => {
      if (archivedIds.includes(id)) return false;

      const task = cachedTaskMap.get(id) || {};
      const title = (task.title || "").toLowerCase();
      const body = (task.body || "").toLowerCase();
      const subject = (task.subject || "").toLowerCase();
      const timeStatus = getDeadlineStatus(task.dueDate);

      if (selectedSubject !== "all" && subject !== selectedSubject) return false;
      if (query && !title.includes(query) && !body.includes(query)) return false;
      if (currentTimeFilter !== "all" && timeStatus !== currentTimeFilter) return false;

      return true;
    });

    if (activeIds.length === 0) {
      taskGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">
          No tasks match your current filters.
        </div>`;
      return;
    }

    activeIds.forEach((id) => {
      renderTaskCard(id, cachedTaskMap.get(id));
    });
  }

  function renderTaskCard(id, data) {
    if (!taskGrid) return;
    const isCompleted = getPersonalTaskState(id);
    const subjectClass = data.subject ? `bg-${data.subject.toLowerCase().replace(/[^a-z0-9]/g, '')}` : 'bg-cmpe';
    
    const timeStatus = getDeadlineStatus(data.dueDate);
    let urgentClass = "";
    if (!isCompleted && (timeStatus === "today" || timeStatus === "overdue")) {
      urgentClass = "urgent";
    }

    let displayDate = data.dueDate ? `Due: ${data.dueDate}` : "No Deadline";
    if (timeStatus === "overdue") displayDate = `⚠️ OVERDUE: ${data.dueDate}`;
    if (timeStatus === "today") displayDate = `🔥 DUE TODAY: ${data.dueDate}`;
    
    const card = document.createElement("div");
    card.className = `card ${subjectClass} ${isCompleted ? 'completed' : ''} ${urgentClass}`;
    card.setAttribute("data-id", id);

    card.innerHTML = `
      <div>
        <div class="card-top">
          <div class="card-controls">
            <input type="checkbox" class="checkbox" ${isCompleted ? 'checked' : ''} />
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
      <div class="card-body">${data.body || ''}</div>
    `;

    const checkbox = card.querySelector(".checkbox");
    checkbox?.addEventListener("change", (e) => {
      e.stopPropagation();
      setPersonalTaskState(id, checkbox.checked);
      card.classList.toggle("completed", checkbox.checked);
      
      if (checkbox.checked) {
        card.classList.remove("urgent");
      } else if (timeStatus === "today" || timeStatus === "overdue") {
        card.classList.add("urgent");
      }
    });

    card.querySelector(".btn-archive-icon")?.addEventListener("click", (e) => { e.stopPropagation(); archiveTask(id); });
    card.querySelector(".btn-edit-icon")?.addEventListener("click", (e) => { e.stopPropagation(); openEditModal(id, data); });
    card.querySelector(".btn-delete-icon")?.addEventListener("click", (e) => { e.stopPropagation(); deleteTask(id); });
    
    card.querySelector(".btn-expand-icon")?.addEventListener("click", (e) => {
      e.stopPropagation();
      document.getElementById("expBadge").textContent = (data.subject || 'GENERAL').toUpperCase();
      document.getElementById("expTitle").textContent = data.title || 'Untitled Task';
      document.getElementById("expDueDate").textContent = displayDate;
      document.getElementById("expBody").innerHTML = data.body || '';
      expandModal?.classList.add("active");
    });

    card.addEventListener("click", (e) => {
      if (e.target.tagName === "A" || e.target.tagName === "BUTTON" || e.target.classList.contains("checkbox")) return;
      checkbox.click(); 
    });

    taskGrid.appendChild(card);
  }

  /* ==========================================
     6. THEME & NETWORK
     ========================================== */
  function applyTheme(theme) {
    if (!themeToggleBtn) return;
    if (theme === "dark") {
      document.body.classList.add("dark-mode");
      themeToggleBtn.textContent = "☀️ Light Mode";
    } else {
      document.body.classList.remove("dark-mode");
      themeToggleBtn.textContent = "🌙 Dark Mode";
    }
  }

  const savedTheme = localStorage.getItem("app_theme") || 
    (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(savedTheme);

  themeToggleBtn?.addEventListener("click", () => {
    const isDark = document.body.classList.toggle("dark-mode");
    const currentTheme = isDark ? "dark" : "light";
    localStorage.setItem("app_theme", currentTheme);
    applyTheme(currentTheme);
  });

  function updateNetworkStatus() {
    if (navigator.onLine) {
      if (netStatusPill) {
        netStatusPill.className = "btn-pill btn-light-green";
        netStatusPill.textContent = "⚡ Syncing Live";
      }
      if (saveBanner) {
        saveBanner.className = "status-banner btn-light-green";
        saveBanner.textContent = "🟢 Live Cloud Connection Active";
      }
    } else {
      if (netStatusPill) {
        netStatusPill.className = "btn-pill btn-offline";
        netStatusPill.textContent = "📡 Offline Mode";
      }
      if (saveBanner) {
        saveBanner.className = "status-banner btn-offline";
        saveBanner.textContent = "🟠 Offline - Serving local cached tasks";
      }
    }
  }

  window.addEventListener("online", updateNetworkStatus);
  window.addEventListener("offline", updateNetworkStatus);
  updateNetworkStatus();

  /* PWA Prompt */
  let deferredPrompt;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (btnInstallPWA) btnInstallPWA.style.display = "inline-flex";
  });

  btnInstallPWA?.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted" && btnInstallPWA) {
      btnInstallPWA.style.display = "none";
    }
    deferredPrompt = null;
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch((err) => {
        console.warn("Service Worker registration failed:", err);
      });
    });
  }

  /* Notifications */
  function sendLocalNotification(title, body, tag) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready
        .then((registration) => {
          registration.showNotification(title, {
            body: body,
            icon: "./icon-192.png",
            badge: "./badge.png",
            tag: tag,
            vibrate: [200, 100, 200]
          });
        })
        .catch(() => {
          new Notification(title, { body, icon: "./icon-192.png", tag });
        });
    } else {
      new Notification(title, { body, icon: "./icon-192.png", tag });
    }
  }

  document.getElementById("btnNotifPermission")?.addEventListener("click", async () => {
    if (!("Notification" in window)) {
      alert("This browser does not support web notifications.");
      return;
    }
    
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      alert("Notifications enabled!");
      sendLocalNotification("Test Alert", "Notifications are active!", "test-id");
    } else if (permission === "denied") {
      alert("Notifications were blocked in your browser settings.");
    }
  });

  /* ==========================================
     7. FIRESTORE REAL-TIME LISTENER
     ========================================== */
  let isInitialLoad = true;

  onSnapshot(collection(db, "tasks"), (snapshot) => {
    if (!taskGrid) return;

    snapshot.docChanges().forEach((change) => {
      if (change.type === "added" && !isInitialLoad) {
        const taskData = change.doc.data();
        const subject = (taskData.subject || "GENERAL").toUpperCase();
        const title = taskData.title || "New Task Posted";
        sendLocalNotification(`📌 New Task [${subject}]`, title, change.doc.id);
      }
    });

    isInitialLoad = false;
    cachedTaskMap.clear();

    snapshot.docs.forEach((docSnap) => {
      cachedTaskMap.set(docSnap.id, docSnap.data());
    });

    renderActiveTasks();
  }, (error) => {
    console.error("Firestore Read Error: ", error);
  });

  /* ==========================================
     8. OFFICER AUTH & ADMIN ACTIONS
     ========================================== */
  function switchAdminStep(showForm) {
    if (adminAuthStep) adminAuthStep.style.display = showForm ? "none" : "block";
    if (adminFormStep) adminFormStep.style.display = showForm ? "block" : "none";
  }

  document.getElementById("btnAdminAccess")?.addEventListener("click", () => {
    adminModal?.classList.add("active");
  });

  document.getElementById("btnCloseAdmin")?.addEventListener("click", () => {
    adminModal?.classList.remove("active");
  });

  document.getElementById("btnLogoutOfficer")?.addEventListener("click", async () => {
    await signOut(auth);
    alert("Officer session closed.");
  });

  onAuthStateChanged(auth, (user) => {
    if (user && user.email && user.email.toLowerCase() === ALLOWED_OFFICER_EMAIL.toLowerCase()) {
      isOfficerAuthenticated = true;
      document.body.classList.add("is-officer");
      switchAdminStep(true);
    } else {
      isOfficerAuthenticated = false;
      document.body.classList.remove("is-officer");
      switchAdminStep(false);
    }
  });

  document.getElementById("btnVerifyPasscode")?.addEventListener("click", async (e) => {
    e.preventDefault();
    
    const emailInput = document.getElementById("adminEmail")?.value.trim();
    const passwordInput = document.getElementById("adminPasscode")?.value;

    if (!emailInput || !passwordInput) {
      if (passcodeError) passcodeError.style.display = "block";
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, emailInput, passwordInput);
      if (passcodeError) passcodeError.style.display = "none";
      if (document.getElementById("adminPasscode")) document.getElementById("adminPasscode").value = "";
      switchAdminStep(true);
    } catch (error) {
      if (passcodeError) {
        passcodeError.textContent = "Invalid email or password. Access denied.";
        passcodeError.style.display = "block";
      }
    }
  });

  document.getElementById("adminTaskForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const newTask = {
      title: document.getElementById("adminTaskTitle")?.value || "",
      subject: document.getElementById("adminTaskSubject")?.value || "",
      dueDate: document.getElementById("adminTaskDueDate")?.value || "",
      body: document.getElementById("adminTaskBody")?.value || "",
      createdAt: new Date().toISOString()
    };

    try {
      await addDoc(collection(db, "tasks"), newTask);
      document.getElementById("adminTaskForm")?.reset();
      adminModal?.classList.remove("active");
      alert("Task successfully published!");
    } catch (err) {
      alert("Failed to publish task: " + err.message);
    }
  });

  /* Edit Task Handlers */
  function openEditModal(taskId, data) {
    if (document.getElementById("editTaskId")) document.getElementById("editTaskId").value = taskId;
    if (document.getElementById("editTaskTitle")) document.getElementById("editTaskTitle").value = data.title || "";
    if (document.getElementById("editTaskSubject")) document.getElementById("editTaskSubject").value = (data.subject || "chem").toLowerCase();
    if (document.getElementById("editTaskDueDate")) document.getElementById("editTaskDueDate").value = data.dueDate || "";
    if (document.getElementById("editTaskBody")) document.getElementById("editTaskBody").value = data.body || "";
    editModal?.classList.add("active");
  }

  document.getElementById("btnCloseEdit")?.addEventListener("click", () => {
    editModal?.classList.remove("active");
  });

  document.getElementById("editTaskForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const taskId = document.getElementById("editTaskId")?.value;

    const updatedFields = {
      title: document.getElementById("editTaskTitle")?.value || "",
      subject: document.getElementById("editTaskSubject")?.value || "",
      dueDate: document.getElementById("editTaskDueDate")?.value || "",
      body: document.getElementById("editTaskBody")?.value || "",
      updatedAt: new Date().toISOString()
    };

    try {
      await updateDoc(doc(db, "tasks", taskId), updatedFields);
      editModal?.classList.remove("active");
      alert("Task updated successfully!");
    } catch (err) {
      alert("Failed to update task: " + err.message);
    }
  });

  /* Delete Task Handler */
  async function deleteTask(taskId) {
    if (!confirm("Are you sure you want to permanently delete this task for all students?")) return;
    try {
      await deleteDoc(doc(db, "tasks", taskId));
      alert("Task permanently deleted.");
    } catch (err) {
      alert("Error deleting task: " + err.message);
    }
  }

  /* Expand Modal Bug Fix Controls */
  const btnCloseExpand = document.getElementById("btnCloseExpand");
  if (btnCloseExpand) {
    btnCloseExpand.addEventListener("click", () => {
      expandModal?.classList.remove("active");
    });
  }
  
  expandModal?.addEventListener("click", (e) => {
    if (e.target === expandModal) {
      expandModal.classList.remove("active");
    }
  });

// Global memory cache for Firestore tasks
let cachedAllTasks = [];

// ==========================================
// 1. STATE & HELPER FUNCTIONS
// ==========================================
function getArchivedTasks() {
  return JSON.parse(localStorage.getItem('takeitdoit_archived')) || [];
}

function archiveTask(taskId) {
  const archived = getArchivedTasks();
  if (!archived.some(item => item.id === taskId)) {
    archived.push({ id: taskId, archivedAt: Date.now() });
    localStorage.setItem('takeitdoit_archived', JSON.stringify(archived));
  }
  renderTaskGrid();
}

function unarchiveTask(taskId) {
  let archived = getArchivedTasks();
  archived = archived.filter(item => item.id !== taskId);
  localStorage.setItem('takeitdoit_archived', JSON.stringify(archived));
  renderTaskGrid();
  renderArchivedModal();
}

// Expose functions globally for inline onclick handlers
window.archiveTask = archiveTask;
window.unarchiveTask = unarchiveTask;
window.renderArchivedModal = renderArchivedModal;

// ==========================================
// 2. FIRESTORE REAL-TIME LISTENER
// ==========================================
// Supports both Firebase v8 (db.collection) and Firebase v9/v10 Modular
if (typeof db !== "undefined") {
  if (typeof db.collection === "function") {
    // Firebase v8 / Compat SDK
    db.collection("tasks").onSnapshot((snapshot) => {
      cachedAllTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      renderTaskGrid();
    });
  } else {
    // Firebase v9+ Modular SDK (if collection and onSnapshot are imported)
    try {
      onSnapshot(collection(db, "tasks"), (snapshot) => {
        cachedAllTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderTaskGrid();
      });
    } catch (e) {
      console.warn("Firestore listener fallback: ensure collection/onSnapshot are imported.", e);
    }
  }
}

// ==========================================
// 3. RENDER FUNCTIONS
// ==========================================
function renderTaskGrid() {
  const taskGrid = document.getElementById("taskGrid");
  if (!taskGrid) return;

  const archivedList = getArchivedTasks();
  const archivedIds = archivedList.map(item => item.id);
  const activeTasks = cachedAllTasks.filter(task => !archivedIds.includes(task.id));

  if (activeTasks.length === 0) {
    taskGrid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted, #888);">
        No active tasks remaining.
      </div>`;
    return;
  }

  taskGrid.innerHTML = activeTasks.map(createCardHTML).join('');
}

function renderArchivedModal() {
  const archiveListEl = document.getElementById("archiveList");
  if (!archiveListEl) return;

  const archivedList = getArchivedTasks();
  const archivedIds = archivedList.map(item => item.id);
  
  // Match archived IDs against Firestore cached tasks
  const archivedTasks = cachedAllTasks.filter(task => archivedIds.includes(task.id));

  if (archivedTasks.length === 0) {
    archiveListEl.innerHTML = `
      <div style="text-align: center; padding: 20px; color: var(--text-muted, #888);">
        No archived tasks found.
      </div>`;
    return;
  }

  archiveListEl.innerHTML = archivedTasks.map(task => `
    <div class="archive-item">
      <div>
        <span class="badge" style="font-size: 0.75rem;">${(task.subject || 'GENERAL').toUpperCase()}</span>
        <strong style="display: block; margin-top: 4px;">${task.title || 'Untitled Task'}</strong>
      </div>
      <button onclick="unarchiveTask('${task.id}')" class="btn-unarchive">
        ↩️ Restore
      </button>
    </div>
  `).join('');
}

function createCardHTML(task) {
  return `
    <div class="task-card">
      <span class="badge">${(task.subject || 'GENERAL').toUpperCase()}</span>
      <h3>${task.title || 'Untitled Task'}</h3>
      <p>${task.dueDate || ''}</p>
      <button onclick="archiveTask('${task.id}')" class="btn-archive">
        📦 Archive
      </button>
    </div>
  `;
}

// ==========================================
// 4. SAFE EVENT LISTENER ATTACHMENT
// ==========================================
function initArchiveEventListeners() {
  const btnOpenArchive = document.getElementById("btnOpenArchive");
  const btnCloseArchive = document.getElementById("btnCloseArchive");
  const archiveModal = document.getElementById("archiveModal");

  if (btnOpenArchive) {
    btnOpenArchive.onclick = () => {
      renderArchivedModal();
      archiveModal?.classList.add("active");
    };
  } else {
    console.warn("Element #btnOpenArchive not found in DOM.");
  }

  if (btnCloseArchive) {
    btnCloseArchive.onclick = () => {
      archiveModal?.classList.remove("active");
    };
  }

  // Close modal when clicking dark backdrop
  if (archiveModal) {
    archiveModal.onclick = (e) => {
      if (e.target === archiveModal) {
        archiveModal.classList.remove("active");
      }
    };
  }
}

// Run listener attachment whether DOM is already loaded or pending
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initArchiveEventListeners);
} else {
  initArchiveEventListeners();
}

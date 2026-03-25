// ========== CONFIGURAÇÃO ==========
// 🔴 ALTERE ESTA URL PARA A DO SEU BACKEND NO RENDER (ex: "wss://chat-backend-pt9f.onrender.com")
const PROD_WS_URL = "wss://chat-backend-pt9f.onrender.com";

// ========== ELEMENTOS DOM ==========
const loginScreen = document.getElementById("loginScreen");
const chatScreen = document.getElementById("chatScreen");
const loginForm = document.getElementById("loginForm");
const loginNameInput = document.getElementById("loginName");
const loginPasswordInput = document.getElementById("loginPassword");
const avatarOptionsDiv = document.getElementById("avatarOptions");
const currentUserAvatar = document.getElementById("currentUserAvatar");
const currentUserName = document.getElementById("currentUserName");
const contactsList = document.getElementById("contactsList");
const pendingListDiv = document.getElementById("pendingList");
const chatMessages = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatHeaderAvatar = document.getElementById("chatHeaderAvatar");
const chatHeaderName = document.getElementById("chatHeaderName");
const chatHeaderStatus = document.getElementById("chatHeaderStatus");
const emojiButton = document.getElementById("emojiButton");
const emojiPicker = document.getElementById("emojiPicker");
const settingsButton = document.getElementById("settingsButton");
const settingsModal = document.getElementById("settingsModal");
const closeModalBtn = document.querySelector(".close-modal");
const chatMenuButton = document.getElementById("chatMenuButton");
const chatContextMenu = document.getElementById("chatContextMenu");
const searchContactsInput = document.getElementById("searchContacts");
const attachButton = document.getElementById("attachButton");
const fileInput = document.getElementById("fileInput");
const messageContextMenu = document.getElementById("messageContextMenu");
const reactionPicker = document.getElementById("reactionPicker");
const logoutBtn = document.getElementById("logoutBtn");
const globalSearchInput = document.getElementById("globalSearchInput");
const globalSearchButton = document.getElementById("globalSearchButton");
const globalSearchResults = document.getElementById("globalSearchResults");
const backButton = document.getElementById("backButton");

// ========== FUNÇÕES AUXILIARES ==========
const getWebSocketUrl = () => {
  const hostname = window.location.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "ws://localhost:8080";
  return PROD_WS_URL;
};
const isMobile = () => window.innerWidth <= 768;
const showConversationsView = () => { if (isMobile()) document.body.classList.remove("chat-active"); };
const showChatView = () => { if (isMobile()) document.body.classList.add("chat-active"); };

// ========== VARIÁVEIS GLOBAIS ==========
const AVATAR_LIST = ["😀", "😎", "🥳", "😍", "🐱", "🐶", "🦊", "🐼", "🍕", "⚽"];
let selectedAvatar = AVATAR_LIST[0];
let currentUser = null;
let websocket = null;
let activeContactId = null;
let allFriends = new Map();
let pendingRequests = [];
let messageHistory = [];
let currentTheme = "dark";
let notificationsEnabled = true;
let showTime = true;
let currentMessage = null;
let replyToMessage = null;
let lastReadId = null;
let typingTimeout;

// ========== FUNÇÕES BÁSICAS ==========
const formatTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const scrollToBottom = () => { chatMessages.scrollTop = chatMessages.scrollHeight; };
const escapeHtml = (text) => { const div = document.createElement("div"); div.textContent = text; return div.innerHTML; };

// ========== CONFIGURAÇÕES ==========
const saveSettings = () => localStorage.setItem("chatSettings", JSON.stringify({ theme: currentTheme, notifications: notificationsEnabled, showTime }));
const loadSettings = () => {
  const saved = localStorage.getItem("chatSettings");
  if (saved) {
    const s = JSON.parse(saved);
    currentTheme = s.theme;
    notificationsEnabled = s.notifications;
    showTime = s.showTime;
    applyTheme();
    document.getElementById("themeSelect").value = currentTheme;
    document.getElementById("notificationsToggle").checked = notificationsEnabled;
    document.getElementById("showTimeToggle").checked = showTime;
  }
};
const applyTheme = () => {
  if (currentTheme === "light") document.body.classList.add("light-theme");
  else document.body.classList.remove("light-theme");
};

// ========== SESSÃO ==========
const saveSession = (user, pwd) => localStorage.setItem("chatSession", JSON.stringify({ user, password: pwd }));
const clearSession = () => localStorage.removeItem("chatSession");
const getStoredSession = () => {
  const s = localStorage.getItem("chatSession");
  if (s) try { return JSON.parse(s); } catch(e) { return null; }
  return null;
};

// ========== LOGOUT ==========
const logout = () => {
  if (websocket) websocket.close();
  clearSession();
  currentUser = null;
  activeContactId = null;
  allFriends.clear();
  pendingRequests = [];
  messageHistory = [];
  chatMessages.innerHTML = "";
  contactsList.innerHTML = "";
  pendingListDiv.innerHTML = "";
  globalSearchResults.innerHTML = "";
  loginScreen.style.display = "flex";
  chatScreen.style.display = "none";
  loginNameInput.value = "";
  loginPasswordInput.value = "";
  settingsModal.style.display = "none";
  showConversationsView();
};

// ========== MENSAGENS ==========
const createMessageElement = (msg, isSelf) => {
  const div = document.createElement("div");
  div.classList.add("message", isSelf ? "message--self" : "message--other");
  div.dataset.messageId = msg.id;

  const avatarDiv = document.createElement("div");
  avatarDiv.classList.add("message__avatar");
  avatarDiv.textContent = msg.userAvatar || "?";
  if (msg.userAvatar && !msg.userAvatar.match(/[\u{1F600}-\u{1F64F}]/u)) {
    avatarDiv.style.backgroundImage = `url(${msg.userAvatar})`;
    avatarDiv.style.backgroundSize = "cover";
    avatarDiv.textContent = "";
  }

  const bubbleDiv = document.createElement("div");
  bubbleDiv.classList.add("message__bubble");

  if (msg.replyTo) {
    const reply = messageHistory.find(m => m.id === msg.replyTo);
    if (reply && !reply.deleted) {
      const preview = document.createElement("div");
      preview.classList.add("message__reply-preview");
      preview.innerHTML = `<strong>${escapeHtml(reply.userName)}</strong>: ${escapeHtml(reply.content.substring(0, 50))}${reply.content.length > 50 ? "..." : ""}`;
      bubbleDiv.appendChild(preview);
    }
  }

  if (!isSelf) {
    const senderSpan = document.createElement("span");
    senderSpan.classList.add("message__sender");
    senderSpan.textContent = msg.userName;
    bubbleDiv.appendChild(senderSpan);
  }

  if (msg.type === "file_message") {
    if (msg.fileType === "image") {
      const img = document.createElement("img");
      img.src = msg.fileData;
      img.classList.add("message__file-image");
      img.addEventListener("click", () => window.open(msg.fileData, "_blank"));
      bubbleDiv.appendChild(img);
    } else {
      const link = document.createElement("a");
      link.href = msg.fileData;
      link.download = msg.fileName;
      link.textContent = `📎 ${msg.fileName}`;
      bubbleDiv.appendChild(link);
    }
  } else {
    const textSpan = document.createElement("span");
    textSpan.classList.add("message__text");
    textSpan.innerHTML = msg.deleted ? "<em>Mensagem excluída</em>" : escapeHtml(msg.content);
    bubbleDiv.appendChild(textSpan);
  }

  const footer = document.createElement("div");
  footer.style.display = "flex";
  footer.style.alignItems = "center";
  footer.style.justifyContent = "flex-end";
  footer.style.gap = "4px";
  if (showTime) {
    const timeSpan = document.createElement("span");
    timeSpan.classList.add("message__time");
    timeSpan.textContent = formatTime(msg.timestamp);
    footer.appendChild(timeSpan);
  }
  if (msg.edited) {
    const editedSpan = document.createElement("span");
    editedSpan.classList.add("message__edited");
    editedSpan.textContent = "editado";
    footer.appendChild(editedSpan);
  }
  if (isSelf && !msg.deleted) {
    const statusSpan = document.createElement("span");
    statusSpan.classList.add("message__read-status");
    statusSpan.innerHTML = msg.readBy && msg.readBy.length > 1 ? '<span class="material-symbols-outlined">done_all</span>' : '<span class="material-symbols-outlined">done</span>';
    footer.appendChild(statusSpan);
  }
  bubbleDiv.appendChild(footer);

  if (msg.reactions && Object.keys(msg.reactions).length) {
    const reactionsDiv = document.createElement("div");
    reactionsDiv.classList.add("message__reactions");
    for (const [emoji, users] of Object.entries(msg.reactions)) {
      const reactionSpan = document.createElement("span");
      reactionSpan.classList.add("message__reaction");
      reactionSpan.textContent = `${emoji} ${users.length}`;
      reactionSpan.addEventListener("click", (e) => {
        e.stopPropagation();
        const already = users.includes(currentUser.id);
        sendReaction(msg.id, emoji, !already);
      });
      reactionsDiv.appendChild(reactionSpan);
    }
    bubbleDiv.appendChild(reactionsDiv);
  }

  div.appendChild(avatarDiv);
  div.appendChild(bubbleDiv);
  div.addEventListener("contextmenu", (e) => { e.preventDefault(); showMessageContextMenu(e, msg); });
  return div;
};

const addMessageToChat = (msg) => {
  const isSelf = msg.userId === currentUser.id;
  const el = createMessageElement(msg, isSelf);
  chatMessages.appendChild(el);
  scrollToBottom();
};

// ========== AMIGOS ==========
const renderFriends = (filter = "") => {
  contactsList.innerHTML = "";
  const list = Array.from(allFriends.values()).filter(f => f.name.toLowerCase().includes(filter.toLowerCase()));
  if (!list.length) {
    contactsList.innerHTML = "<div style='padding:16px;text-align:center;color:var(--text-secondary);'>Nenhum amigo encontrado</div>";
    return;
  }
  list.forEach(f => {
    const div = document.createElement("div");
    div.classList.add("contact-item");
    if (activeContactId === f.id) div.classList.add("active");
    div.dataset.friendId = f.id;
    div.dataset.friendName = f.name;
    div.dataset.friendAvatar = f.avatar;

    const avatarDiv = document.createElement("div");
    avatarDiv.classList.add("avatar");
    avatarDiv.textContent = f.avatar;

    const infoDiv = document.createElement("div");
    infoDiv.classList.add("contact-info");
    infoDiv.innerHTML = `<div class="contact-name">${escapeHtml(f.name)}</div><div class="contact-status">${f.isOnline ? "online" : "offline"}</div>`;

    div.appendChild(avatarDiv);
    div.appendChild(infoDiv);
    div.addEventListener("click", (e) => {
      const fid = e.currentTarget.dataset.friendId;
      if (!fid) return;
      activeContactId = fid;
      renderFriends(searchContactsInput.value);
      chatHeaderName.textContent = e.currentTarget.dataset.friendName;
      chatHeaderAvatar.textContent = e.currentTarget.dataset.friendAvatar;
      loadConversationMessages(fid);
      showChatView();
    });
    contactsList.appendChild(div);
  });
};

const loadConversationMessages = (fid) => {
  chatMessages.innerHTML = "";
  const conv = messageHistory.filter(m => (m.userId === currentUser.id && m.recipientId === fid) || (m.userId === fid && m.recipientId === currentUser.id));
  conv.forEach(m => addMessageToChat(m));
  observer.disconnect();
  observeNewMessages();
  sendReadReceipt();
};

// ========== PEDIDOS ==========
const renderPendingRequests = () => {
  pendingListDiv.innerHTML = "";
  if (!pendingRequests.length) {
    pendingListDiv.innerHTML = "<div style='font-size:0.8rem; color:var(--text-secondary);'>Nenhum pedido</div>";
    return;
  }
  pendingRequests.forEach(req => {
    const div = document.createElement("div");
    div.classList.add("pending-item");
    div.innerHTML = `
      <div class="pending-info">
        <div class="pending-avatar">${req.from.avatar}</div>
        <span class="pending-name">${escapeHtml(req.from.name)}</span>
      </div>
      <div class="pending-buttons">
        <button class="accept" data-from="${req.from.id}">✔️</button>
        <button class="reject" data-from="${req.from.id}">❌</button>
      </div>
    `;
    div.querySelector(".accept").addEventListener("click", () => respondToFriendRequest(req.from.id, true));
    div.querySelector(".reject").addEventListener("click", () => respondToFriendRequest(req.from.id, false));
    pendingListDiv.appendChild(div);
  });
};

const respondToFriendRequest = (from, accept) => {
  websocket.send(JSON.stringify({ type: "friend_request_response", fromUserId: from, accept }));
};

const sendFriendRequest = (uid) => {
  websocket.send(JSON.stringify({ type: "friend_request", targetUserId: uid }));
};

// ========== AÇÕES DE MENSAGEM ==========
const sendReaction = (mid, emoji, add) => {
  if (!websocket) return;
  websocket.send(JSON.stringify({ type: "reaction", messageId: mid, emoji, add }));
};

const sendReadReceipt = () => {
  if (!websocket || !activeContactId) return;
  const msgs = Array.from(chatMessages.children).reverse();
  for (let msg of msgs) {
    const id = msg.dataset.messageId;
    if (id && messageHistory.find(m => m.id === id)?.userId !== currentUser.id) {
      if (lastReadId !== id) {
        lastReadId = id;
        websocket.send(JSON.stringify({ type: "read_receipt", lastReadMessageId: id }));
      }
      break;
    }
  }
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => { if (entry.isIntersecting) sendReadReceipt(); });
}, { threshold: 0.5 });
const observeNewMessages = () => {
  document.querySelectorAll(".message").forEach(div => observer.observe(div));
};

const handleFileUpload = (file) => {
  if (!file) return;
  if (!activeContactId) { alert("Selecione um amigo para enviar arquivo."); return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    const data = e.target.result;
    const type = file.type.split("/")[0];
    const message = {
      type: "file_message",
      recipientId: activeContactId,
      fileType: type,
      fileName: file.name,
      fileData: data,
      thumbnail: type === "image" ? data : null,
      timestamp: Date.now(),
      replyTo: replyToMessage ? replyToMessage.id : null,
    };
    websocket.send(JSON.stringify(message));
    replyToMessage = null;
    const ind = document.getElementById("replyIndicator");
    if (ind) ind.remove();
  };
  reader.readAsDataURL(file);
};

const editMessage = (mid, newContent) => {
  if (!websocket) return;
  websocket.send(JSON.stringify({ type: "edit_message", messageId: mid, newContent }));
};
const deleteMessage = (mid) => {
  if (!websocket) return;
  websocket.send(JSON.stringify({ type: "delete_message", messageId: mid }));
};
const setReplyTo = (msg) => {
  replyToMessage = msg;
  let ind = document.getElementById("replyIndicator");
  if (ind) ind.remove();
  ind = document.createElement("div");
  ind.id = "replyIndicator";
  ind.className = "reply-indicator";
  ind.innerHTML = `Respondendo a ${escapeHtml(msg.userName)}: "${escapeHtml(msg.content.substring(0, 40))}..." <button id="cancelReply">✖</button>`;
  chatInput.parentNode.insertBefore(ind, chatInput);
  document.getElementById("cancelReply")?.addEventListener("click", () => {
    replyToMessage = null;
    ind.remove();
  });
  chatInput.focus();
};

// ========== BUSCA GLOBAL ==========
const performGlobalSearch = () => {
  const q = globalSearchInput.value.trim();
  if (!websocket) return;
  websocket.send(JSON.stringify({ type: "search_users", query: q }));
};
const displaySearchResults = (users) => {
  globalSearchResults.innerHTML = "";
  if (!users.length) {
    globalSearchResults.innerHTML = "<div style='padding:8px;color:var(--text-secondary);'>Nenhum usuário encontrado.</div>";
    return;
  }
  users.forEach(u => {
    const div = document.createElement("div");
    div.classList.add("search-result-item");
    div.innerHTML = `
      <div class="search-result-info">
        <div class="search-result-avatar">${u.avatar}</div>
        <span class="search-result-name">${escapeHtml(u.name)}</span>
      </div>
      <button class="add-friend-btn" data-id="${u.id}">➕</button>
    `;
    div.querySelector(".add-friend-btn").addEventListener("click", () => {
      sendFriendRequest(u.id);
      div.querySelector(".add-friend-btn").disabled = true;
      div.querySelector(".add-friend-btn").textContent = "✓ Enviado";
    });
    globalSearchResults.appendChild(div);
  });
};

// ========== PROCESSAR MENSAGENS DO SERVIDOR ==========
const processMessage = (data) => {
  switch (data.type) {
    case "login_success":
      currentUser = data.user;
      allFriends.clear();
      data.friends.forEach(f => allFriends.set(f.id, { name: f.name, avatar: f.avatar, isOnline: f.isOnline }));
      pendingRequests = data.pendingRequests;
      renderPendingRequests();
      renderFriends();
      loginScreen.style.display = "none";
      chatScreen.style.display = "flex";
      currentUserAvatar.textContent = currentUser.avatar;
      currentUserName.textContent = currentUser.name;
      if (!getStoredSession() || getStoredSession().user.id !== currentUser.id) saveSession(currentUser, loginPasswordInput.value);
      showConversationsView();
      break;
    case "friends_online":
      data.friends.forEach(f => { const ex = allFriends.get(f.id); if (ex) ex.isOnline = true; else allFriends.set(f.id, { ...f, isOnline: true }); });
      renderFriends();
      break;
    case "friend_status":
      const f = allFriends.get(data.userId);
      if (f) f.isOnline = data.isOnline;
      renderFriends();
      break;
    case "friend_request_received":
      pendingRequests.push({ from: data.from });
      renderPendingRequests();
      break;
    case "friend_added":
      allFriends.set(data.friend.id, { ...data.friend, isOnline: false });
      pendingRequests = pendingRequests.filter(r => r.from.id !== data.friend.id);
      renderPendingRequests();
      renderFriends();
      break;
    case "friend_request_rejected":
      alert(`Pedido de amizade rejeitado por ${data.by}`);
      pendingRequests = pendingRequests.filter(r => r.from.id !== data.by);
      renderPendingRequests();
      break;
    case "history":
      messageHistory = data.messages;
      if (activeContactId) loadConversationMessages(activeContactId);
      break;
    case "message":
    case "file_message":
      messageHistory.push(data);
      if ((data.userId === activeContactId && data.recipientId === currentUser.id) || (data.recipientId === activeContactId && data.userId === currentUser.id)) {
        addMessageToChat(data);
        observeNewMessages();
      } else if (data.userId === currentUser.id && data.recipientId === activeContactId) {
        addMessageToChat(data);
      }
      if (notificationsEnabled && data.userId !== currentUser.id && activeContactId === data.userId) {
        new Audio("https://www.soundjay.com/misc/sounds/bell-ringing-05.mp3").play().catch(e => console.log);
      }
      break;
    case "message_edited":
      const ed = document.querySelector(`.message[data-message-id="${data.messageId}"] .message__text`);
      if (ed) ed.innerHTML = escapeHtml(data.newContent);
      const idx = messageHistory.findIndex(m => m.id === data.messageId);
      if (idx !== -1) messageHistory[idx].content = data.newContent;
      break;
    case "message_deleted":
      const del = document.querySelector(`.message[data-message-id="${data.messageId}"] .message__text`);
      if (del) del.innerHTML = "<em>Mensagem excluída</em>";
      const dIdx = messageHistory.findIndex(m => m.id === data.messageId);
      if (dIdx !== -1) messageHistory[dIdx].deleted = true;
      break;
    case "reaction_update":
      const reactDiv = document.querySelector(`.message[data-message-id="${data.messageId}"] .message__reactions`);
      if (reactDiv) {
        const msg = messageHistory.find(m => m.id === data.messageId);
        if (msg) {
          msg.reactions = data.reactions;
          const bubble = reactDiv.parentNode;
          const newDiv = document.createElement("div");
          newDiv.classList.add("message__reactions");
          for (const [emoji, users] of Object.entries(data.reactions)) {
            const span = document.createElement("span");
            span.classList.add("message__reaction");
            span.textContent = `${emoji} ${users.length}`;
            span.addEventListener("click", (e) => {
              e.stopPropagation();
              const already = users.includes(currentUser.id);
              sendReaction(data.messageId, emoji, !already);
            });
            newDiv.appendChild(span);
          }
          bubble.replaceChild(newDiv, reactDiv);
        }
      }
      break;
    case "read_update":
      document.querySelectorAll(".message").forEach(div => {
        const id = div.dataset.messageId;
        const msg = messageHistory.find(m => m.id === id);
        if (msg && msg.userId === currentUser.id && !msg.deleted) {
          const st = div.querySelector(".message__read-status");
          if (st) st.innerHTML = msg.readBy && msg.readBy.length > 1 ? '<span class="material-symbols-outlined">done_all</span>' : '<span class="material-symbols-outlined">done</span>';
        }
      });
      break;
    case "search_results":
      displaySearchResults(data.users);
      break;
    case "typing":
      if (data.userId !== currentUser.id && activeContactId === data.userId) {
        if (data.isTyping) {
          chatHeaderStatus.textContent = `${data.userName} está digitando...`;
          setTimeout(() => { if (chatHeaderStatus.textContent.includes("digitando")) chatHeaderStatus.textContent = "online"; }, 2000);
        } else chatHeaderStatus.textContent = "online";
      }
      break;
  }
};

// ========== ENVIO DE MENSAGEM ==========
const sendMessage = (content) => {
  if (!content.trim()) return;
  if (!activeContactId) { alert("Selecione um amigo para conversar."); return; }
  const msg = {
    type: "message",
    recipientId: activeContactId,
    content: content.trim(),
    timestamp: Date.now(),
    replyTo: replyToMessage ? replyToMessage.id : null,
  };
  websocket.send(JSON.stringify(msg));
  replyToMessage = null;
  const ind = document.getElementById("replyIndicator");
  if (ind) ind.remove();
};

const sendTyping = (isTyping) => {
  if (!websocket || !activeContactId) return;
  websocket.send(JSON.stringify({ type: "typing", recipientId: activeContactId, isTyping }));
};

// ========== WEBSOCKET ==========
const initWebSocket = (name, pwd, avatar) => {
  const url = getWebSocketUrl();
  websocket = new WebSocket(url);
  websocket.onopen = () => {
    websocket.send(JSON.stringify({ type: "login", name, password: pwd, avatar }));
  };
  websocket.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === "login_failed") { alert(data.reason); clearSession(); return; }
    processMessage(data);
  };
  websocket.onclose = () => {
    if (currentUser) setTimeout(() => initWebSocket(name, pwd, avatar), 3000);
  };
  websocket.onerror = (err) => console.error("WebSocket error", err);
};

const handleLogin = (e) => {
  e.preventDefault();
  const name = loginNameInput.value.trim();
  const pwd = loginPasswordInput.value.trim();
  if (!name || !pwd) return;
  initWebSocket(name, pwd, selectedAvatar);
};

// ========== UI ==========
const renderAvatarOptions = () => {
  avatarOptionsDiv.innerHTML = "";
  AVATAR_LIST.forEach(emoji => {
    const opt = document.createElement("div");
    opt.classList.add("avatar-option");
    opt.textContent = emoji;
    if (emoji === selectedAvatar) opt.classList.add("selected");
    opt.addEventListener("click", () => {
      document.querySelectorAll(".avatar-option").forEach(o => o.classList.remove("selected"));
      opt.classList.add("selected");
      selectedAvatar = emoji;
    });
    avatarOptionsDiv.appendChild(opt);
  });
};

const showEmojiPicker = () => {
  emojiPicker.style.display = emojiPicker.style.display === "none" ? "grid" : "none";
  if (!emojiPicker.children.length) {
    const common = ["😀", "😂", "🥰", "😎", "😢", "👍", "🔥", "❤️", "🎉", "💯", "😡", "🥺"];
    common.forEach(e => {
      const span = document.createElement("span");
      span.textContent = e;
      span.addEventListener("click", () => {
        chatInput.value += e;
        emojiPicker.style.display = "none";
        chatInput.focus();
      });
      emojiPicker.appendChild(span);
    });
  }
};

// ========== MODAIS E MENUS ==========
const openSettingsModal = () => settingsModal.style.display = "flex";
const closeSettingsModal = () => settingsModal.style.display = "none";
const saveTheme = () => { currentTheme = document.getElementById("themeSelect").value; applyTheme(); saveSettings(); };
const saveNotifications = () => { notificationsEnabled = document.getElementById("notificationsToggle").checked; saveSettings(); };
const saveShowTime = () => { showTime = document.getElementById("showTimeToggle").checked; saveSettings(); if (activeContactId) loadConversationMessages(activeContactId); };
const clearAllHistory = () => {
  if (confirm("Limpar todo o histórico?")) {
    if (websocket) websocket.send(JSON.stringify({ type: "clear_history" }));
    chatMessages.innerHTML = "";
    messageHistory = [];
  }
};

const showContextMenu = (x, y) => { chatContextMenu.style.display = "block"; chatContextMenu.style.left = `${x}px`; chatContextMenu.style.top = `${y}px`; };
const hideContextMenu = () => { chatContextMenu.style.display = "none"; };
const clearConversation = () => {
  if (activeContactId && confirm("Limpar conversa?")) {
    if (websocket) websocket.send(JSON.stringify({ type: "clear_conversation", withUser: activeContactId }));
    chatMessages.innerHTML = "";
    messageHistory = messageHistory.filter(m => !(m.userId === currentUser.id && m.recipientId === activeContactId) && !(m.userId === activeContactId && m.recipientId === currentUser.id));
  }
};
const blockUser = () => { if (activeContactId) alert(`Usuário ${allFriends.get(activeContactId)?.name} bloqueado.`); };
const reportUser = () => { if (activeContactId) alert(`Usuário ${allFriends.get(activeContactId)?.name} reportado.`); };

const showMessageContextMenu = (e, msg) => {
  e.preventDefault();
  if (currentMessage) hideMessageContextMenu();
  currentMessage = msg;
  messageContextMenu.style.display = "block";
  messageContextMenu.style.left = `${e.pageX}px`;
  messageContextMenu.style.top = `${e.pageY}px`;
  const isOwner = msg.userId === currentUser.id;
  document.getElementById("editMsgBtn").style.display = isOwner ? "block" : "none";
  document.getElementById("deleteMsgBtn").style.display = isOwner ? "block" : "none";
};
const hideMessageContextMenu = () => { messageContextMenu.style.display = "none"; currentMessage = null; };
const handleReply = () => { if (currentMessage && !currentMessage.deleted) { setReplyTo(currentMessage); hideMessageContextMenu(); } };
const handleEdit = () => {
  if (currentMessage && currentMessage.userId === currentUser.id && !currentMessage.deleted) {
    const newC = prompt("Editar mensagem:", currentMessage.content);
    if (newC && newC.trim()) editMessage(currentMessage.id, newC.trim());
    hideMessageContextMenu();
  }
};
const handleDelete = () => {
  if (currentMessage && currentMessage.userId === currentUser.id && confirm("Excluir esta mensagem?")) {
    deleteMessage(currentMessage.id);
    hideMessageContextMenu();
  }
};
const handleReact = () => {
  if (currentMessage) {
    const rect = event.target.getBoundingClientRect();
    reactionPicker.style.display = "flex";
    reactionPicker.style.left = `${rect.left}px`;
    reactionPicker.style.top = `${rect.top - 40}px`;
    hideMessageContextMenu();
  }
};
const pickReaction = (emoji) => {
  if (currentMessage) {
    const already = currentMessage.reactions?.[emoji]?.includes(currentUser.id);
    sendReaction(currentMessage.id, emoji, !already);
    reactionPicker.style.display = "none";
  }
};

// ========== AUTO-LOGIN ==========
const attemptAutoLogin = () => {
  const session = getStoredSession();
  if (session && session.user && session.password) {
    loginNameInput.value = session.user.name;
    loginPasswordInput.value = session.password;
    initWebSocket(session.user.name, session.password, session.user.avatar);
  }
};

// ========== EVENT LISTENERS ==========
loginForm.addEventListener("submit", handleLogin);
chatForm.addEventListener("submit", (e) => { e.preventDefault(); sendMessage(chatInput.value); chatInput.value = ""; });
chatInput.addEventListener("input", () => { if (typingTimeout) clearTimeout(typingTimeout); sendTyping(true); typingTimeout = setTimeout(() => sendTyping(false), 1000); });
emojiButton.addEventListener("click", showEmojiPicker);
document.addEventListener("click", (e) => {
  if (!emojiButton.contains(e.target) && !emojiPicker.contains(e.target)) emojiPicker.style.display = "none";
  if (!chatMenuButton.contains(e.target) && !chatContextMenu.contains(e.target)) hideContextMenu();
  if (!messageContextMenu.contains(e.target)) hideMessageContextMenu();
  if (!reactionPicker.contains(e.target)) reactionPicker.style.display = "none";
});
settingsButton.addEventListener("click", openSettingsModal);
closeModalBtn.addEventListener("click", closeSettingsModal);
window.addEventListener("click", (e) => { if (e.target === settingsModal) closeSettingsModal(); });
document.getElementById("themeSelect").addEventListener("change", saveTheme);
document.getElementById("notificationsToggle").addEventListener("change", saveNotifications);
document.getElementById("showTimeToggle").addEventListener("change", saveShowTime);
document.getElementById("clearHistoryBtn").addEventListener("click", clearAllHistory);
logoutBtn.addEventListener("click", () => { if (confirm("Sair da conta?")) logout(); });
chatMenuButton.addEventListener("click", (e) => { e.stopPropagation(); const rect = chatMenuButton.getBoundingClientRect(); showContextMenu(rect.right - 180, rect.bottom + 5); });
document.getElementById("clearConversationBtn").addEventListener("click", () => { clearConversation(); hideContextMenu(); });
document.getElementById("blockUserBtn").addEventListener("click", () => { blockUser(); hideContextMenu(); });
document.getElementById("reportUserBtn").addEventListener("click", () => { reportUser(); hideContextMenu(); });
attachButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => { if (e.target.files.length) handleFileUpload(e.target.files[0]); fileInput.value = ""; });
document.getElementById("replyMsgBtn").addEventListener("click", handleReply);
document.getElementById("editMsgBtn").addEventListener("click", handleEdit);
document.getElementById("deleteMsgBtn").addEventListener("click", handleDelete);
document.getElementById("reactMsgBtn").addEventListener("click", handleReact);
reactionPicker.querySelectorAll("span").forEach(span => span.addEventListener("click", () => pickReaction(span.textContent)));
searchContactsInput.addEventListener("input", (e) => renderFriends(e.target.value));
globalSearchButton.addEventListener("click", performGlobalSearch);
globalSearchInput.addEventListener("keypress", (e) => { if (e.key === "Enter") performGlobalSearch(); });
globalSearchInput.addEventListener("focus", () => performGlobalSearch());
if (backButton) backButton.addEventListener("click", showConversationsView);
window.addEventListener("resize", () => { if (!isMobile()) document.body.classList.remove("chat-active"); });

// ========== INICIALIZAÇÃO ==========
renderAvatarOptions();
loadSettings();
attemptAutoLogin();
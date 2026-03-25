// ========== CONFIGURAÇÃO ==========
const PROD_WS_URL = "wss://SEU-APP-BACKEND.onrender.com"; // ⚠️ SUBSTITUA AQUI

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

// ========== AUXILIARES ==========
const getWsUrl = () => {
  const host = window.location.hostname;
  return (host === "localhost" || host === "127.0.0.1") ? "ws://localhost:8080" : PROD_WS_URL;
};
const isMobile = () => window.innerWidth <= 768;
const showConversations = () => { if (isMobile()) document.body.classList.remove("chat-active"); };
const showChat = () => { if (isMobile()) document.body.classList.add("chat-active"); };
const formatTime = ts => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const escapeHtml = text => { const d = document.createElement("div"); d.textContent = text; return d.innerHTML; };

// ========== ESTADO ==========
const AVATAR_LIST = ["😀","😎","🥳","😍","🐱","🐶","🦊","🐼","🍕","⚽"];
let selectedAvatar = AVATAR_LIST[0];
let currentUser = null;
let ws = null;
let activeContactId = null;
let allFriends = new Map(); // id -> { name, avatar, isOnline }
let pendingRequests = [];
let messageHistory = [];
let currentTheme = "dark";
let notifications = true;
let showTime = true;
let currentMsg = null, replyToMsg = null, lastReadId = null, typingTimeout;

// ========== CONFIGURAÇÕES ==========
const saveSettings = () => localStorage.setItem("chatSettings", JSON.stringify({ theme: currentTheme, notifications, showTime }));
const loadSettings = () => {
  const s = localStorage.getItem("chatSettings");
  if (s) {
    const { theme, notifications: n, showTime: t } = JSON.parse(s);
    currentTheme = theme; notifications = n; showTime = t;
    applyTheme();
    document.getElementById("themeSelect").value = theme;
    document.getElementById("notificationsToggle").checked = n;
    document.getElementById("showTimeToggle").checked = t;
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

const logout = () => {
  if (ws) ws.close();
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
  showConversations();
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

  const bubble = document.createElement("div");
  bubble.classList.add("message__bubble");

  if (msg.replyTo) {
    const reply = messageHistory.find(m => m.id === msg.replyTo);
    if (reply && !reply.deleted) {
      const preview = document.createElement("div");
      preview.classList.add("message__reply-preview");
      preview.innerHTML = `<strong>${escapeHtml(reply.userName)}</strong>: ${escapeHtml(reply.content.substring(0, 50))}${reply.content.length > 50 ? "..." : ""}`;
      bubble.appendChild(preview);
    }
  }

  if (!isSelf) {
    const sender = document.createElement("span");
    sender.classList.add("message__sender");
    sender.textContent = msg.userName;
    bubble.appendChild(sender);
  }

  if (msg.type === "file_message") {
    if (msg.fileType === "image") {
      const img = document.createElement("img");
      img.src = msg.fileData;
      img.classList.add("message__file-image");
      img.addEventListener("click", () => window.open(msg.fileData, "_blank"));
      bubble.appendChild(img);
    } else {
      const link = document.createElement("a");
      link.href = msg.fileData;
      link.download = msg.fileName;
      link.textContent = `📎 ${msg.fileName}`;
      bubble.appendChild(link);
    }
  } else {
    const text = document.createElement("span");
    text.classList.add("message__text");
    text.innerHTML = msg.deleted ? "<em>Mensagem excluída</em>" : escapeHtml(msg.content);
    bubble.appendChild(text);
  }

  const footer = document.createElement("div");
  footer.style.display = "flex";
  footer.style.alignItems = "center";
  footer.style.justifyContent = "flex-end";
  footer.style.gap = "4px";
  if (showTime) {
    const time = document.createElement("span");
    time.classList.add("message__time");
    time.textContent = formatTime(msg.timestamp);
    footer.appendChild(time);
  }
  if (msg.edited) {
    const ed = document.createElement("span");
    ed.classList.add("message__edited");
    ed.textContent = "editado";
    footer.appendChild(ed);
  }
  if (isSelf && !msg.deleted) {
    const status = document.createElement("span");
    status.classList.add("message__read-status");
    status.innerHTML = msg.readBy && msg.readBy.length > 1 ? '<span class="material-symbols-outlined">done_all</span>' : '<span class="material-symbols-outlined">done</span>';
    footer.appendChild(status);
  }
  bubble.appendChild(footer);

  if (msg.reactions && Object.keys(msg.reactions).length) {
    const reactionsDiv = document.createElement("div");
    reactionsDiv.classList.add("message__reactions");
    for (const [emoji, users] of Object.entries(msg.reactions)) {
      const r = document.createElement("span");
      r.classList.add("message__reaction");
      r.textContent = `${emoji} ${users.length}`;
      r.addEventListener("click", (e) => {
        e.stopPropagation();
        const already = users.includes(currentUser.id);
        sendReaction(msg.id, emoji, !already);
      });
      reactionsDiv.appendChild(r);
    }
    bubble.appendChild(reactionsDiv);
  }

  div.appendChild(avatarDiv);
  div.appendChild(bubble);
  div.addEventListener("contextmenu", (e) => { e.preventDefault(); showMessageMenu(e, msg); });
  return div;
};

const addMessageToChat = msg => {
  const isSelf = msg.userId === currentUser.id;
  chatMessages.appendChild(createMessageElement(msg, isSelf));
  scrollToBottom();
};

const scrollToBottom = () => { chatMessages.scrollTop = chatMessages.scrollHeight; };

// ========== AMIGOS ==========
const renderFriends = (filter = "") => {
  contactsList.innerHTML = "";
  const list = Array.from(allFriends.values()).filter(f => f.name.toLowerCase().includes(filter.toLowerCase()));
  if (!list.length) {
    contactsList.innerHTML = "<div style='padding:16px;text-align:center;color:var(--text-secondary);'>Nenhum amigo</div>";
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
    div.addEventListener("click", () => {
      activeContactId = f.id;
      renderFriends(searchContactsInput.value);
      chatHeaderName.textContent = f.name;
      chatHeaderAvatar.textContent = f.avatar;
      loadConversationMessages(f.id);
      showChat();
    });
    contactsList.appendChild(div);
  });
};

const loadConversationMessages = (friendId) => {
  chatMessages.innerHTML = "";
  const conv = messageHistory.filter(m => (m.userId === currentUser.id && m.recipientId === friendId) || (m.userId === friendId && m.recipientId === currentUser.id));
  conv.forEach(m => addMessageToChat(m));
  observer.disconnect();
  observeNewMessages();
  sendReadReceipt();
};

// ========== PEDIDOS ==========
const renderPending = () => {
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
    div.querySelector(".accept").addEventListener("click", () => respondToRequest(req.from.id, true));
    div.querySelector(".reject").addEventListener("click", () => respondToRequest(req.from.id, false));
    pendingListDiv.appendChild(div);
  });
};
const respondToRequest = (from, accept) => ws.send(JSON.stringify({ type: "friend_request_response", fromUserId: from, accept }));
const sendFriendRequest = uid => ws.send(JSON.stringify({ type: "friend_request", targetUserId: uid }));

// ========== AÇÕES ==========
const sendReaction = (mid, emoji, add) => ws?.send(JSON.stringify({ type: "reaction", messageId: mid, emoji, add }));
const sendReadReceipt = () => {
  if (!ws || !activeContactId) return;
  const msgs = Array.from(chatMessages.children).reverse();
  for (let m of msgs) {
    const id = m.dataset.messageId;
    if (id && messageHistory.find(msg => msg.id === id)?.userId !== currentUser.id) {
      if (lastReadId !== id) {
        lastReadId = id;
        ws.send(JSON.stringify({ type: "read_receipt", lastReadMessageId: id }));
      }
      break;
    }
  }
};
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => { if (entry.isIntersecting) sendReadReceipt(); });
}, { threshold: 0.5 });
const observeNewMessages = () => document.querySelectorAll(".message").forEach(div => observer.observe(div));

const handleFileUpload = file => {
  if (!file) return;
  if (!activeContactId) { alert("Selecione um amigo"); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const data = e.target.result;
    const type = file.type.split("/")[0];
    ws.send(JSON.stringify({
      type: "file_message",
      recipientId: activeContactId,
      fileType: type,
      fileName: file.name,
      fileData: data,
      thumbnail: type === "image" ? data : null,
      timestamp: Date.now(),
      replyTo: replyToMsg ? replyToMsg.id : null,
    }));
    replyToMsg = null;
    const ind = document.getElementById("replyIndicator");
    if (ind) ind.remove();
  };
  reader.readAsDataURL(file);
};

const editMessage = (mid, newContent) => ws?.send(JSON.stringify({ type: "edit_message", messageId: mid, newContent }));
const deleteMessage = mid => ws?.send(JSON.stringify({ type: "delete_message", messageId: mid }));
const setReplyTo = msg => {
  replyToMsg = msg;
  let ind = document.getElementById("replyIndicator");
  if (ind) ind.remove();
  ind = document.createElement("div");
  ind.id = "replyIndicator";
  ind.className = "reply-indicator";
  ind.innerHTML = `Respondendo a ${escapeHtml(msg.userName)}: "${escapeHtml(msg.content.substring(0, 40))}..." <button id="cancelReply">✖</button>`;
  chatInput.parentNode.insertBefore(ind, chatInput);
  document.getElementById("cancelReply")?.addEventListener("click", () => {
    replyToMsg = null;
    ind.remove();
  });
  chatInput.focus();
};

// ========== BUSCA GLOBAL ==========
const performGlobalSearch = () => {
  const q = globalSearchInput.value.trim();
  ws?.send(JSON.stringify({ type: "search_users", query: q }));
};
const displaySearchResults = users => {
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

// ========== PROCESSAR MENSAGENS SERVIDOR ==========
const processMessage = data => {
  switch (data.type) {
    case "login_success":
      currentUser = data.user;
      allFriends.clear();
      data.friends.forEach(f => allFriends.set(f.id, { name: f.name, avatar: f.avatar, isOnline: f.isOnline }));
      pendingRequests = data.pendingRequests;
      renderPending();
      renderFriends();
      loginScreen.style.display = "none";
      chatScreen.style.display = "flex";
      currentUserAvatar.textContent = currentUser.avatar;
      currentUserName.textContent = currentUser.name;
      if (!getStoredSession() || getStoredSession().user.id !== currentUser.id) saveSession(currentUser, loginPasswordInput.value);
      showConversations();
      break;
    case "friends_online":
      data.friends.forEach(f => { const ex = allFriends.get(f.id); if (ex) ex.isOnline = true; else allFriends.set(f.id, { ...f, isOnline: true }); });
      renderFriends();
      break;
    case "friend_status":
      const ff = allFriends.get(data.userId);
      if (ff) ff.isOnline = data.isOnline;
      renderFriends();
      break;
    case "friend_request_received":
      pendingRequests.push({ from: data.from });
      renderPending();
      break;
    case "friend_added":
      allFriends.set(data.friend.id, { ...data.friend, isOnline: false });
      pendingRequests = pendingRequests.filter(r => r.from.id !== data.friend.id);
      renderPending();
      renderFriends();
      break;
    case "friend_request_rejected":
      alert(`Pedido rejeitado por ${data.by}`);
      pendingRequests = pendingRequests.filter(r => r.from.id !== data.by);
      renderPending();
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
      if (notifications && data.userId !== currentUser.id && activeContactId === data.userId) {
        new Audio("https://www.soundjay.com/misc/sounds/bell-ringing-05.mp3").play().catch(() => {});
      }
      break;
    case "message_edited":
      document.querySelector(`.message[data-message-id="${data.messageId}"] .message__text`).innerHTML = escapeHtml(data.newContent);
      const idx = messageHistory.findIndex(m => m.id === data.messageId);
      if (idx !== -1) messageHistory[idx].content = data.newContent;
      break;
    case "message_deleted":
      document.querySelector(`.message[data-message-id="${data.messageId}"] .message__text`).innerHTML = "<em>Mensagem excluída</em>";
      const di = messageHistory.findIndex(m => m.id === data.messageId);
      if (di !== -1) messageHistory[di].deleted = true;
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
            span.addEventListener("click", e => {
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

// ========== ENVIO MENSAGEM ==========
const sendMessage = content => {
  if (!content.trim()) return;
  if (!activeContactId) { alert("Selecione um amigo"); return; }
  ws.send(JSON.stringify({
    type: "message",
    recipientId: activeContactId,
    content: content.trim(),
    timestamp: Date.now(),
    replyTo: replyToMsg ? replyToMsg.id : null,
  }));
  replyToMsg = null;
  const ind = document.getElementById("replyIndicator");
  if (ind) ind.remove();
};

const sendTyping = isTyping => {
  if (!ws || !activeContactId) return;
  ws.send(JSON.stringify({ type: "typing", recipientId: activeContactId, isTyping }));
};

// ========== WEBSOCKET ==========
const initWebSocket = (name, pwd, avatar) => {
  const url = getWsUrl();
  ws = new WebSocket(url);
  ws.onopen = () => ws.send(JSON.stringify({ type: "login", name, password: pwd, avatar }));
  ws.onmessage = e => {
    const data = JSON.parse(e.data);
    if (data.type === "login_failed") { alert(data.reason); clearSession(); return; }
    processMessage(data);
  };
  ws.onclose = () => { if (currentUser) setTimeout(() => initWebSocket(name, pwd, avatar), 3000); };
  ws.onerror = err => console.error("WebSocket error", err);
};

const handleLogin = e => {
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
    const common = ["😀","😂","🥰","😎","😢","👍","🔥","❤️","🎉","💯","😡","🥺"];
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

const openSettings = () => settingsModal.style.display = "flex";
const closeSettings = () => settingsModal.style.display = "none";
const saveTheme = () => { currentTheme = document.getElementById("themeSelect").value; applyTheme(); saveSettings(); };
const saveNotifications = () => { notifications = document.getElementById("notificationsToggle").checked; saveSettings(); };
const saveShowTime = () => { showTime = document.getElementById("showTimeToggle").checked; saveSettings(); if (activeContactId) loadConversationMessages(activeContactId); };
const clearAllHistory = () => {
  if (confirm("Limpar todo o histórico?")) {
    ws?.send(JSON.stringify({ type: "clear_history" }));
    chatMessages.innerHTML = "";
    messageHistory = [];
  }
};

// Menus
const showContextMenu = (x, y) => { chatContextMenu.style.display = "block"; chatContextMenu.style.left = `${x}px`; chatContextMenu.style.top = `${y}px`; };
const hideContextMenu = () => { chatContextMenu.style.display = "none"; };
const clearConversation = () => {
  if (activeContactId && confirm("Limpar conversa?")) {
    ws?.send(JSON.stringify({ type: "clear_conversation", withUser: activeContactId }));
    chatMessages.innerHTML = "";
    messageHistory = messageHistory.filter(m => !(m.userId === currentUser.id && m.recipientId === activeContactId) && !(m.userId === activeContactId && m.recipientId === currentUser.id));
  }
};
const blockUser = () => { if (activeContactId) alert(`Usuário ${allFriends.get(activeContactId)?.name} bloqueado.`); };
const reportUser = () => { if (activeContactId) alert(`Usuário ${allFriends.get(activeContactId)?.name} reportado.`); };

let currentMessage = null;
const showMessageMenu = (e, msg) => {
  e.preventDefault();
  if (currentMessage) hideMessageMenu();
  currentMessage = msg;
  messageContextMenu.style.display = "block";
  messageContextMenu.style.left = `${e.pageX}px`;
  messageContextMenu.style.top = `${e.pageY}px`;
  const isOwner = msg.userId === currentUser.id;
  document.getElementById("editMsgBtn").style.display = isOwner ? "block" : "none";
  document.getElementById("deleteMsgBtn").style.display = isOwner ? "block" : "none";
};
const hideMessageMenu = () => { messageContextMenu.style.display = "none"; currentMessage = null; };
const handleReply = () => { if (currentMessage && !currentMessage.deleted) { setReplyTo(currentMessage); hideMessageMenu(); } };
const handleEdit = () => {
  if (currentMessage && currentMessage.userId === currentUser.id && !currentMessage.deleted) {
    const newC = prompt("Editar mensagem:", currentMessage.content);
    if (newC && newC.trim()) editMessage(currentMessage.id, newC.trim());
    hideMessageMenu();
  }
};
const handleDelete = () => {
  if (currentMessage && currentMessage.userId === currentUser.id && confirm("Excluir?")) {
    deleteMessage(currentMessage.id);
    hideMessageMenu();
  }
};
const handleReact = () => {
  if (currentMessage) {
    const rect = event.target.getBoundingClientRect();
    reactionPicker.style.display = "flex";
    reactionPicker.style.left = `${rect.left}px`;
    reactionPicker.style.top = `${rect.top - 40}px`;
    hideMessageMenu();
  }
};
const pickReaction = emoji => {
  if (currentMessage) {
    const already = currentMessage.reactions?.[emoji]?.includes(currentUser.id);
    sendReaction(currentMessage.id, emoji, !already);
    reactionPicker.style.display = "none";
  }
};

// ========== AUTO-LOGIN ==========
const attemptAutoLogin = () => {
  const s = getStoredSession();
  if (s && s.user && s.password) {
    loginNameInput.value = s.user.name;
    loginPasswordInput.value = s.password;
    initWebSocket(s.user.name, s.password, s.user.avatar);
  }
};

// ========== EVENTOS ==========
loginForm.addEventListener("submit", handleLogin);
chatForm.addEventListener("submit", e => { e.preventDefault(); sendMessage(chatInput.value); chatInput.value = ""; });
chatInput.addEventListener("input", () => {
  if (typingTimeout) clearTimeout(typingTimeout);
  sendTyping(true);
  typingTimeout = setTimeout(() => sendTyping(false), 1000);
});
emojiButton.addEventListener("click", showEmojiPicker);
document.addEventListener("click", e => {
  if (!emojiButton.contains(e.target) && !emojiPicker.contains(e.target)) emojiPicker.style.display = "none";
  if (!chatMenuButton.contains(e.target) && !chatContextMenu.contains(e.target)) hideContextMenu();
  if (!messageContextMenu.contains(e.target)) hideMessageMenu();
  if (!reactionPicker.contains(e.target)) reactionPicker.style.display = "none";
});
settingsButton.addEventListener("click", openSettings);
closeModalBtn.addEventListener("click", closeSettings);
window.addEventListener("click", e => { if (e.target === settingsModal) closeSettings(); });
document.getElementById("themeSelect").addEventListener("change", saveTheme);
document.getElementById("notificationsToggle").addEventListener("change", saveNotifications);
document.getElementById("showTimeToggle").addEventListener("change", saveShowTime);
document.getElementById("clearHistoryBtn").addEventListener("click", clearAllHistory);
logoutBtn.addEventListener("click", () => { if (confirm("Sair da conta?")) logout(); });
chatMenuButton.addEventListener("click", e => { e.stopPropagation(); const rect = chatMenuButton.getBoundingClientRect(); showContextMenu(rect.right - 180, rect.bottom + 5); });
document.getElementById("clearConversationBtn").addEventListener("click", () => { clearConversation(); hideContextMenu(); });
document.getElementById("blockUserBtn").addEventListener("click", () => { blockUser(); hideContextMenu(); });
document.getElementById("reportUserBtn").addEventListener("click", () => { reportUser(); hideContextMenu(); });
attachButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", e => { if (e.target.files.length) handleFileUpload(e.target.files[0]); fileInput.value = ""; });
document.getElementById("replyMsgBtn").addEventListener("click", handleReply);
document.getElementById("editMsgBtn").addEventListener("click", handleEdit);
document.getElementById("deleteMsgBtn").addEventListener("click", handleDelete);
document.getElementById("reactMsgBtn").addEventListener("click", handleReact);
reactionPicker.querySelectorAll("span").forEach(span => span.addEventListener("click", () => pickReaction(span.textContent)));
searchContactsInput.addEventListener("input", e => renderFriends(e.target.value));
globalSearchButton.addEventListener("click", performGlobalSearch);
globalSearchInput.addEventListener("keypress", e => { if (e.key === "Enter") performGlobalSearch(); });
globalSearchInput.addEventListener("focus", performGlobalSearch);
if (backButton) backButton.addEventListener("click", showConversations);
window.addEventListener("resize", () => { if (!isMobile()) document.body.classList.remove("chat-active"); });

// ========== INICIALIZAÇÃO ==========
renderAvatarOptions();
loadSettings();
attemptAutoLogin();
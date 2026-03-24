// ========== Elementos do DOM ==========
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

// ========== Configuração do WebSocket ==========
// Substitua pela URL do seu backend no Render
const PROD_WS_URL = "wss://chat-backend-pt9f.onrender.com"; // ALTERE AQUI

const getWebSocketUrl = () => {
  const hostname = window.location.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "ws://localhost:8080";
  }
  return PROD_WS_URL;
};

// ========== Variáveis Globais ==========
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

// ========== Funções Auxiliares ==========
const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
const scrollToBottom = () => {
  chatMessages.scrollTop = chatMessages.scrollHeight;
};
const escapeHtml = (text) => {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
};

// ========== Salvar/Ler Configurações ==========
const saveSettings = () => {
  localStorage.setItem("chatSettings", JSON.stringify({
    theme: currentTheme,
    notifications: notificationsEnabled,
    showTime: showTime
  }));
};
const loadSettings = () => {
  const saved = localStorage.getItem("chatSettings");
  if (saved) {
    const settings = JSON.parse(saved);
    currentTheme = settings.theme;
    notificationsEnabled = settings.notifications;
    showTime = settings.showTime;
    applyTheme();
    document.getElementById("themeSelect").value = currentTheme;
    document.getElementById("notificationsToggle").checked = notificationsEnabled;
    document.getElementById("showTimeToggle").checked = showTime;
  }
};
const applyTheme = () => {
  if (currentTheme === "light") {
    document.body.classList.add("light-theme");
  } else {
    document.body.classList.remove("light-theme");
  }
};

// ========== Gerenciamento de Sessão ==========
const saveSession = (user, password) => {
  localStorage.setItem("chatSession", JSON.stringify({ user, password }));
};
const clearSession = () => {
  localStorage.removeItem("chatSession");
};
const getStoredSession = () => {
  const session = localStorage.getItem("chatSession");
  if (session) {
    try {
      return JSON.parse(session);
    } catch (e) {
      return null;
    }
  }
  return null;
};

// ========== Logout ==========
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
};

// ========== Criação de Elemento de Mensagem ==========
const createMessageElement = (message, isSelf) => {
  const div = document.createElement("div");
  div.classList.add("message");
  div.classList.add(isSelf ? "message--self" : "message--other");
  div.dataset.messageId = message.id;

  const avatarDiv = document.createElement("div");
  avatarDiv.classList.add("message__avatar");
  avatarDiv.textContent = message.userAvatar || "?";
  if (message.userAvatar && !message.userAvatar.match(/[\u{1F600}-\u{1F64F}]/u)) {
    avatarDiv.style.backgroundImage = `url(${message.userAvatar})`;
    avatarDiv.style.backgroundSize = "cover";
    avatarDiv.textContent = "";
  }

  const bubbleDiv = document.createElement("div");
  bubbleDiv.classList.add("message__bubble");

  if (message.replyTo) {
    const replyMsg = messageHistory.find(m => m.id === message.replyTo);
    if (replyMsg && !replyMsg.deleted) {
      const replyPreview = document.createElement("div");
      replyPreview.classList.add("message__reply-preview");
      replyPreview.innerHTML = `<strong>${escapeHtml(replyMsg.userName)}</strong>: ${escapeHtml(replyMsg.content.substring(0, 50))}${replyMsg.content.length > 50 ? '...' : ''}`;
      bubbleDiv.appendChild(replyPreview);
    }
  }

  if (!isSelf) {
    const senderSpan = document.createElement("span");
    senderSpan.classList.add("message__sender");
    senderSpan.textContent = message.userName;
    bubbleDiv.appendChild(senderSpan);
  }

  if (message.type === 'file_message') {
    if (message.fileType === 'image') {
      const img = document.createElement('img');
      img.src = message.fileData;
      img.classList.add('message__file-image');
      img.addEventListener('click', () => window.open(message.fileData, '_blank'));
      bubbleDiv.appendChild(img);
    } else {
      const fileLink = document.createElement('a');
      fileLink.href = message.fileData;
      fileLink.download = message.fileName;
      fileLink.textContent = `📎 ${message.fileName}`;
      bubbleDiv.appendChild(fileLink);
    }
  } else {
    const textSpan = document.createElement("span");
    textSpan.classList.add("message__text");
    textSpan.innerHTML = message.deleted ? "<em>Mensagem excluída</em>" : escapeHtml(message.content);
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
    timeSpan.textContent = formatTime(message.timestamp);
    footer.appendChild(timeSpan);
  }

  if (message.edited) {
    const editedSpan = document.createElement("span");
    editedSpan.classList.add("message__edited");
    editedSpan.textContent = "editado";
    footer.appendChild(editedSpan);
  }

  if (isSelf && !message.deleted) {
    const readStatus = document.createElement("span");
    readStatus.classList.add("message__read-status");
    if (message.readBy && message.readBy.length > 1) {
      readStatus.innerHTML = '<span class="material-symbols-outlined">done_all</span>';
    } else {
      readStatus.innerHTML = '<span class="material-symbols-outlined">done</span>';
    }
    footer.appendChild(readStatus);
  }

  bubbleDiv.appendChild(footer);

  if (message.reactions && Object.keys(message.reactions).length > 0) {
    const reactionsDiv = document.createElement("div");
    reactionsDiv.classList.add("message__reactions");
    for (const [emoji, users] of Object.entries(message.reactions)) {
      const reactionSpan = document.createElement("span");
      reactionSpan.classList.add("message__reaction");
      reactionSpan.textContent = `${emoji} ${users.length}`;
      reactionSpan.addEventListener("click", (e) => {
        e.stopPropagation();
        const alreadyReacted = users.includes(currentUser.id);
        sendReaction(message.id, emoji, !alreadyReacted);
      });
      reactionsDiv.appendChild(reactionSpan);
    }
    bubbleDiv.appendChild(reactionsDiv);
  }

  div.appendChild(avatarDiv);
  div.appendChild(bubbleDiv);

  div.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showMessageContextMenu(e, message);
  });

  return div;
};

const addMessageToChat = (message) => {
  const isSelf = message.userId === currentUser.id;
  const msgElement = createMessageElement(message, isSelf);
  chatMessages.appendChild(msgElement);
  scrollToBottom();
};

// ========== Renderizar lista de amigos ==========
const renderFriends = (filter = "") => {
  contactsList.innerHTML = "";
  const friendsList = Array.from(allFriends.values())
    .filter(friend => friend.name.toLowerCase().includes(filter.toLowerCase()));
  friendsList.forEach(friend => {
    const contactDiv = document.createElement("div");
    contactDiv.classList.add("contact-item");
    if (activeContactId === friend.id) contactDiv.classList.add("active");

    const avatarDiv = document.createElement("div");
    avatarDiv.classList.add("avatar");
    avatarDiv.textContent = friend.avatar;

    const infoDiv = document.createElement("div");
    infoDiv.classList.add("contact-info");
    infoDiv.innerHTML = `
      <div class="contact-name">${escapeHtml(friend.name)}</div>
      <div class="contact-status">${friend.isOnline ? "online" : "offline"}</div>
    `;

    contactDiv.appendChild(avatarDiv);
    contactDiv.appendChild(infoDiv);

    contactDiv.addEventListener("click", () => {
      activeContactId = friend.id;
      renderFriends(searchContactsInput.value);
      chatHeaderName.textContent = friend.name;
      chatHeaderAvatar.textContent = friend.avatar;
      loadConversationMessages(friend.id);
    });

    contactsList.appendChild(contactDiv);
  });
};

const loadConversationMessages = (friendId) => {
  chatMessages.innerHTML = "";
  const convMessages = messageHistory.filter(msg => 
    (msg.userId === currentUser.id && msg.recipientId === friendId) ||
    (msg.userId === friendId && msg.recipientId === currentUser.id)
  );
  convMessages.forEach(msg => addMessageToChat(msg));
  observer.disconnect();
  observeNewMessages();
  sendReadReceipt();
};

// ========== Renderizar pedidos pendentes ==========
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

const respondToFriendRequest = (fromUserId, accept) => {
  websocket.send(JSON.stringify({
    type: "friend_request_response",
    fromUserId,
    accept,
  }));
};

const sendFriendRequest = (userId) => {
  websocket.send(JSON.stringify({
    type: "friend_request",
    targetUserId: userId,
  }));
};

const sendReaction = (messageId, emoji, add) => {
  if (!websocket) return;
  websocket.send(JSON.stringify({
    type: "reaction",
    messageId,
    emoji,
    add,
  }));
};

const sendReadReceipt = () => {
  if (!websocket || !activeContactId) return;
  const messages = Array.from(chatMessages.children).reverse();
  for (let msgDiv of messages) {
    const msgId = msgDiv.dataset.messageId;
    if (msgId && messageHistory.find(m => m.id === msgId)?.userId !== currentUser.id) {
      if (lastReadId !== msgId) {
        lastReadId = msgId;
        websocket.send(JSON.stringify({
          type: "read_receipt",
          lastReadMessageId: msgId,
        }));
      }
      break;
    }
  }
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      sendReadReceipt();
    }
  });
}, { threshold: 0.5 });

const observeNewMessages = () => {
  const messageDivs = document.querySelectorAll('.message');
  messageDivs.forEach(div => observer.observe(div));
};

const handleFileUpload = (file) => {
  if (!file) return;
  if (!activeContactId) {
    alert("Selecione um amigo para enviar arquivo.");
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const fileData = e.target.result;
    const fileType = file.type.split('/')[0];
    const message = {
      type: "file_message",
      recipientId: activeContactId,
      fileType: fileType,
      fileName: file.name,
      fileData: fileData,
      thumbnail: fileType === 'image' ? fileData : null,
      timestamp: Date.now(),
      replyTo: replyToMessage ? replyToMessage.id : null,
    };
    websocket.send(JSON.stringify(message));
    replyToMessage = null;
    const replyIndicator = document.getElementById("replyIndicator");
    if (replyIndicator) replyIndicator.remove();
  };
  reader.readAsDataURL(file);
};

const editMessage = (messageId, newContent) => {
  if (!websocket) return;
  websocket.send(JSON.stringify({
    type: "edit_message",
    messageId,
    newContent,
  }));
};

const deleteMessage = (messageId) => {
  if (!websocket) return;
  websocket.send(JSON.stringify({
    type: "delete_message",
    messageId,
  }));
};

const setReplyTo = (message) => {
  replyToMessage = message;
  let indicator = document.getElementById("replyIndicator");
  if (indicator) indicator.remove();
  indicator = document.createElement("div");
  indicator.id = "replyIndicator";
  indicator.className = "reply-indicator";
  indicator.innerHTML = `Respondendo a ${escapeHtml(message.userName)}: "${escapeHtml(message.content.substring(0, 40))}..." <button id="cancelReply">✖</button>`;
  chatInput.parentNode.insertBefore(indicator, chatInput);
  document.getElementById("cancelReply")?.addEventListener("click", () => {
    replyToMessage = null;
    indicator.remove();
  });
  chatInput.focus();
};

// ========== Busca global ==========
const performGlobalSearch = () => {
  const query = globalSearchInput.value.trim();
  if (!websocket) return;
  websocket.send(JSON.stringify({
    type: "search_users",
    query: query
  }));
};

const displaySearchResults = (users) => {
  globalSearchResults.innerHTML = "";
  if (!users.length) {
    globalSearchResults.innerHTML = "<div style='padding: 8px; color: var(--text-secondary);'>Nenhum usuário encontrado.</div>";
    return;
  }
  users.forEach(user => {
    const div = document.createElement("div");
    div.classList.add("search-result-item");
    div.innerHTML = `
      <div class="search-result-info">
        <div class="search-result-avatar">${user.avatar}</div>
        <span class="search-result-name">${escapeHtml(user.name)}</span>
      </div>
      <button class="add-friend-btn" data-id="${user.id}">➕</button>
    `;
    div.querySelector(".add-friend-btn").addEventListener("click", () => {
      sendFriendRequest(user.id);
      div.querySelector(".add-friend-btn").disabled = true;
      div.querySelector(".add-friend-btn").textContent = "✓ Enviado";
    });
    globalSearchResults.appendChild(div);
  });
};

// ========== Processar mensagens do servidor ==========
const processMessage = (data) => {
  switch (data.type) {
    case "login_success":
      currentUser = data.user;
      allFriends.clear();
      data.friends.forEach(friend => {
        allFriends.set(friend.id, { name: friend.name, avatar: friend.avatar, isOnline: friend.isOnline });
      });
      pendingRequests = data.pendingRequests;
      renderPendingRequests();
      renderFriends();
      loginScreen.style.display = "none";
      chatScreen.style.display = "flex";
      currentUserAvatar.textContent = currentUser.avatar;
      currentUserName.textContent = currentUser.name;
      const storedSession = getStoredSession();
      if (!storedSession || storedSession.user.id !== currentUser.id) {
        saveSession(currentUser, loginPasswordInput.value);
      }
      break;

    case "friends_online":
      data.friends.forEach(friend => {
        const existing = allFriends.get(friend.id);
        if (existing) existing.isOnline = true;
        else allFriends.set(friend.id, { ...friend, isOnline: true });
      });
      renderFriends();
      break;

    case "friend_status":
      const friend = allFriends.get(data.userId);
      if (friend) friend.isOnline = data.isOnline;
      renderFriends();
      break;

    case "friend_request_received":
      pendingRequests.push({ from: data.from });
      renderPendingRequests();
      break;

    case "friend_added":
      allFriends.set(data.friend.id, { ...data.friend, isOnline: false });
      pendingRequests = pendingRequests.filter(req => req.from.id !== data.friend.id);
      renderPendingRequests();
      renderFriends();
      break;

    case "friend_request_rejected":
      alert(`Pedido de amizade rejeitado por ${data.by}`);
      pendingRequests = pendingRequests.filter(req => req.from.id !== data.by);
      renderPendingRequests();
      break;

    case "history":
      messageHistory = data.messages;
      if (activeContactId) loadConversationMessages(activeContactId);
      break;

    case "message":
    case "file_message":
      messageHistory.push(data);
      if ((data.userId === activeContactId && data.recipientId === currentUser.id) ||
          (data.recipientId === activeContactId && data.userId === currentUser.id)) {
        addMessageToChat(data);
        observeNewMessages();
      } else if (data.userId === currentUser.id && data.recipientId === activeContactId) {
        addMessageToChat(data);
      }
      if (notificationsEnabled && data.userId !== currentUser.id && activeContactId === data.userId) {
        const audio = new Audio("https://www.soundjay.com/misc/sounds/bell-ringing-05.mp3");
        audio.play().catch(e => console.log("Audio not allowed"));
      }
      break;

    case "message_edited":
      const editedMsgDiv = document.querySelector(`.message[data-message-id="${data.messageId}"] .message__text`);
      if (editedMsgDiv) editedMsgDiv.innerHTML = escapeHtml(data.newContent);
      const msgIdx = messageHistory.findIndex(m => m.id === data.messageId);
      if (msgIdx !== -1) messageHistory[msgIdx].content = data.newContent;
      break;

    case "message_deleted":
      const deletedMsgDiv = document.querySelector(`.message[data-message-id="${data.messageId}"] .message__text`);
      if (deletedMsgDiv) deletedMsgDiv.innerHTML = "<em>Mensagem excluída</em>";
      const delIdx = messageHistory.findIndex(m => m.id === data.messageId);
      if (delIdx !== -1) messageHistory[delIdx].deleted = true;
      break;

    case "reaction_update":
      const reactionMsgDiv = document.querySelector(`.message[data-message-id="${data.messageId}"] .message__reactions`);
      if (reactionMsgDiv) {
        const msg = messageHistory.find(m => m.id === data.messageId);
        if (msg) {
          msg.reactions = data.reactions;
          const bubble = reactionMsgDiv.parentNode;
          const newReactionsDiv = document.createElement("div");
          newReactionsDiv.classList.add("message__reactions");
          for (const [emoji, users] of Object.entries(data.reactions)) {
            const reactionSpan = document.createElement("span");
            reactionSpan.classList.add("message__reaction");
            reactionSpan.textContent = `${emoji} ${users.length}`;
            reactionSpan.addEventListener("click", (e) => {
              e.stopPropagation();
              const alreadyReacted = users.includes(currentUser.id);
              sendReaction(data.messageId, emoji, !alreadyReacted);
            });
            newReactionsDiv.appendChild(reactionSpan);
          }
          bubble.replaceChild(newReactionsDiv, reactionMsgDiv);
        }
      }
      break;

    case "read_update":
      const msgDivs = document.querySelectorAll('.message');
      for (let div of msgDivs) {
        const id = div.dataset.messageId;
        const msg = messageHistory.find(m => m.id === id);
        if (msg && msg.userId === currentUser.id && !msg.deleted) {
          const statusSpan = div.querySelector('.message__read-status');
          if (statusSpan) {
            if (msg.readBy && msg.readBy.length > 1) {
              statusSpan.innerHTML = '<span class="material-symbols-outlined">done_all</span>';
            } else {
              statusSpan.innerHTML = '<span class="material-symbols-outlined">done</span>';
            }
          }
        }
      }
      break;

    case "search_results":
      displaySearchResults(data.users);
      break;

    case "typing":
      if (data.userId !== currentUser.id && activeContactId === data.userId) {
        if (data.isTyping) {
          chatHeaderStatus.textContent = `${data.userName} está digitando...`;
          setTimeout(() => {
            if (chatHeaderStatus.textContent.includes("digitando")) {
              chatHeaderStatus.textContent = "online";
            }
          }, 2000);
        } else {
          chatHeaderStatus.textContent = "online";
        }
      }
      break;

    default:
      break;
  }
};

const sendMessage = (content) => {
  if (!content.trim()) return;
  if (!activeContactId) {
    alert("Selecione um amigo para conversar.");
    return;
  }
  const message = {
    type: "message",
    recipientId: activeContactId,
    content: content.trim(),
    timestamp: Date.now(),
    replyTo: replyToMessage ? replyToMessage.id : null,
  };
  websocket.send(JSON.stringify(message));
  replyToMessage = null;
  const replyIndicator = document.getElementById("replyIndicator");
  if (replyIndicator) replyIndicator.remove();
};

const sendTyping = (isTyping) => {
  if (!websocket || !activeContactId) return;
  websocket.send(JSON.stringify({
    type: "typing",
    recipientId: activeContactId,
    isTyping,
  }));
};

// ========== WebSocket ==========
const initWebSocket = (name, password, avatar) => {
  const wsUrl = getWebSocketUrl();
  console.log("Conectando ao WebSocket:", wsUrl);
  websocket = new WebSocket(wsUrl);
  websocket.onopen = () => {
    console.log("WebSocket conectado");
    websocket.send(JSON.stringify({
      type: "login",
      name,
      password,
      avatar,
    }));
  };
  websocket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "login_failed") {
      alert(data.reason);
      clearSession();
      return;
    }
    processMessage(data);
  };
  websocket.onclose = () => {
    console.log("Desconectado. Tentando reconectar...");
    if (currentUser) {
      setTimeout(() => initWebSocket(name, password, avatar), 3000);
    }
  };
  websocket.onerror = (error) => {
    console.error("Erro no WebSocket:", error);
  };
};

const handleLogin = (event) => {
  event.preventDefault();
  const name = loginNameInput.value.trim();
  const password = loginPasswordInput.value.trim();
  if (!name || !password) return;
  initWebSocket(name, password, selectedAvatar);
};

const renderAvatarOptions = () => {
  avatarOptionsDiv.innerHTML = "";
  AVATAR_LIST.forEach(emoji => {
    const option = document.createElement("div");
    option.classList.add("avatar-option");
    option.textContent = emoji;
    if (emoji === selectedAvatar) option.classList.add("selected");
    option.addEventListener("click", () => {
      document.querySelectorAll(".avatar-option").forEach(opt => opt.classList.remove("selected"));
      option.classList.add("selected");
      selectedAvatar = emoji;
    });
    avatarOptionsDiv.appendChild(option);
  });
};

const showEmojiPicker = () => {
  emojiPicker.style.display = emojiPicker.style.display === "none" ? "grid" : "none";
  if (emojiPicker.children.length === 0) {
    const commonEmojis = ["😀", "😂", "🥰", "😎", "😢", "👍", "🔥", "❤️", "🎉", "💯", "😡", "🥺"];
    commonEmojis.forEach(emoji => {
      const span = document.createElement("span");
      span.textContent = emoji;
      span.addEventListener("click", () => {
        chatInput.value += emoji;
        emojiPicker.style.display = "none";
        chatInput.focus();
      });
      emojiPicker.appendChild(span);
    });
  }
};

const openSettingsModal = () => settingsModal.style.display = "flex";
const closeSettingsModal = () => settingsModal.style.display = "none";
const saveTheme = () => {
  currentTheme = document.getElementById("themeSelect").value;
  applyTheme();
  saveSettings();
};
const saveNotifications = () => {
  notificationsEnabled = document.getElementById("notificationsToggle").checked;
  saveSettings();
};
const saveShowTime = () => {
  showTime = document.getElementById("showTimeToggle").checked;
  saveSettings();
  if (activeContactId) loadConversationMessages(activeContactId);
};
const clearAllHistory = () => {
  if (confirm("Limpar todo o histórico de mensagens? Isso não pode ser desfeito.")) {
    if (websocket) {
      websocket.send(JSON.stringify({ type: "clear_history" }));
      chatMessages.innerHTML = "";
      messageHistory = [];
    }
  }
};

// Menu de contexto da conversa
const showContextMenu = (x, y) => {
  chatContextMenu.style.display = "block";
  chatContextMenu.style.left = `${x}px`;
  chatContextMenu.style.top = `${y}px`;
};
const hideContextMenu = () => {
  chatContextMenu.style.display = "none";
};
const clearConversation = () => {
  if (activeContactId && confirm("Limpar conversa com este amigo?")) {
    if (websocket) {
      websocket.send(JSON.stringify({ type: "clear_conversation", withUser: activeContactId }));
      chatMessages.innerHTML = "";
      messageHistory = messageHistory.filter(m => 
        !(m.userId === currentUser.id && m.recipientId === activeContactId) &&
        !(m.userId === activeContactId && m.recipientId === currentUser.id)
      );
    }
  }
};
const blockUser = () => {
  if (activeContactId) {
    alert(`Usuário ${allFriends.get(activeContactId)?.name} bloqueado.`);
  }
};
const reportUser = () => {
  if (activeContactId) {
    alert(`Usuário ${allFriends.get(activeContactId)?.name} reportado.`);
  }
};

// Menu de contexto da mensagem
const showMessageContextMenu = (e, message) => {
  e.preventDefault();
  if (currentMessage) hideMessageContextMenu();
  currentMessage = message;
  messageContextMenu.style.display = "block";
  messageContextMenu.style.left = `${e.pageX}px`;
  messageContextMenu.style.top = `${e.pageY}px`;
  const isOwner = message.userId === currentUser.id;
  document.getElementById("editMsgBtn").style.display = isOwner ? "block" : "none";
  document.getElementById("deleteMsgBtn").style.display = isOwner ? "block" : "none";
};
const hideMessageContextMenu = () => {
  messageContextMenu.style.display = "none";
  currentMessage = null;
};
const handleReply = () => {
  if (currentMessage && !currentMessage.deleted) {
    setReplyTo(currentMessage);
    hideMessageContextMenu();
  }
};
const handleEdit = () => {
  if (currentMessage && currentMessage.userId === currentUser.id && !currentMessage.deleted) {
    const newContent = prompt("Editar mensagem:", currentMessage.content);
    if (newContent && newContent.trim()) {
      editMessage(currentMessage.id, newContent.trim());
    }
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
    const existingReaction = currentMessage.reactions?.[emoji]?.includes(currentUser.id);
    sendReaction(currentMessage.id, emoji, !existingReaction);
    reactionPicker.style.display = "none";
  }
};

// Auto-login
const attemptAutoLogin = () => {
  const session = getStoredSession();
  if (session && session.user && session.password) {
    loginNameInput.value = session.user.name;
    loginPasswordInput.value = session.password;
    initWebSocket(session.user.name, session.password, session.user.avatar);
  }
};

// ========== Event Listeners ==========
loginForm.addEventListener("submit", handleLogin);
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (activeContactId) {
    sendMessage(chatInput.value);
    chatInput.value = "";
  } else {
    alert("Selecione um amigo para conversar.");
  }
});
chatInput.addEventListener("input", () => {
  if (typingTimeout) clearTimeout(typingTimeout);
  sendTyping(true);
  typingTimeout = setTimeout(() => sendTyping(false), 1000);
});
emojiButton.addEventListener("click", showEmojiPicker);
document.addEventListener("click", (e) => {
  if (!emojiButton.contains(e.target) && !emojiPicker.contains(e.target)) emojiPicker.style.display = "none";
  if (!chatMenuButton.contains(e.target) && !chatContextMenu.contains(e.target)) hideContextMenu();
  if (!messageContextMenu.contains(e.target)) hideMessageContextMenu();
  if (!reactionPicker.contains(e.target)) reactionPicker.style.display = "none";
});

settingsButton.addEventListener("click", openSettingsModal);
closeModalBtn.addEventListener("click", closeSettingsModal);
window.addEventListener("click", (e) => {
  if (e.target === settingsModal) closeSettingsModal();
});
document.getElementById("themeSelect").addEventListener("change", saveTheme);
document.getElementById("notificationsToggle").addEventListener("change", saveNotifications);
document.getElementById("showTimeToggle").addEventListener("change", saveShowTime);
document.getElementById("clearHistoryBtn").addEventListener("click", clearAllHistory);
logoutBtn.addEventListener("click", () => {
  if (confirm("Deseja realmente sair da sua conta?")) logout();
});

chatMenuButton.addEventListener("click", (e) => {
  e.stopPropagation();
  const rect = chatMenuButton.getBoundingClientRect();
  showContextMenu(rect.right - 180, rect.bottom + 5);
});
document.getElementById("clearConversationBtn").addEventListener("click", () => {
  clearConversation();
  hideContextMenu();
});
document.getElementById("blockUserBtn").addEventListener("click", () => {
  blockUser();
  hideContextMenu();
});
document.getElementById("reportUserBtn").addEventListener("click", () => {
  reportUser();
  hideContextMenu();
});

attachButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => {
  if (e.target.files.length) handleFileUpload(e.target.files[0]);
  fileInput.value = "";
});

document.getElementById("replyMsgBtn").addEventListener("click", handleReply);
document.getElementById("editMsgBtn").addEventListener("click", handleEdit);
document.getElementById("deleteMsgBtn").addEventListener("click", handleDelete);
document.getElementById("reactMsgBtn").addEventListener("click", handleReact);

reactionPicker.querySelectorAll("span").forEach(span => {
  span.addEventListener("click", () => pickReaction(span.textContent));
});

searchContactsInput.addEventListener("input", (e) => renderFriends(e.target.value));

globalSearchButton.addEventListener("click", performGlobalSearch);
globalSearchInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") performGlobalSearch();
});
globalSearchInput.addEventListener("focus", () => {
  performGlobalSearch();
});

// ========== Inicialização ==========
renderAvatarOptions();
loadSettings();
attemptAutoLogin();
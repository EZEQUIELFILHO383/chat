const { WebSocketServer } = require("ws");
const dotenv = require("dotenv");
const db = require("./db");

dotenv.config();
const wss = new WebSocketServer({ port: process.env.PORT || 8080 });

const connectedUsers = new Map(); // userId -> ws
let messageHistory = [];
const MAX_HISTORY = 500;

const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

function sendToUser(userId, data) {
  const ws = connectedUsers.get(userId);
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
}

function broadcast(data, excludeWs = null) {
  const message = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client !== excludeWs && client.readyState === client.OPEN) client.send(message);
  });
}

function sendFriendsOnline(userId) {
  const user = db.getUserById(userId);
  if (!user) return;
  const onlineFriends = user.friends
    .filter(fid => connectedUsers.has(fid))
    .map(fid => {
      const f = db.getUserById(fid);
      return { id: f.id, name: f.name, avatar: f.avatar };
    });
  sendToUser(userId, { type: "friends_online", friends: onlineFriends });
}

function notifyFriendsStatus(userId, isOnline) {
  const user = db.getUserById(userId);
  if (!user) return;
  user.friends.forEach(fid => {
    sendToUser(fid, { type: "friend_status", userId, name: user.name, isOnline });
  });
}

wss.on("connection", (ws) => {
  ws.on("error", console.error);
  let userId = null;

  ws.on("message", (data) => {
    try {
      const parsed = JSON.parse(data);
      const sender = userId ? db.getUserById(userId) : null;

      switch (parsed.type) {
        case "login": {
          let user = db.getUserByUsername(parsed.name);
          if (!user) {
            const newId = generateId();
            user = db.createUser(newId, parsed.name, parsed.password, parsed.avatar || "😀");
            if (!user) {
              ws.send(JSON.stringify({ type: "login_failed", reason: "Nome de usuário já existe" }));
              return;
            }
          } else {
            if (user.password !== parsed.password) {
              ws.send(JSON.stringify({ type: "login_failed", reason: "Senha incorreta" }));
              return;
            }
          }
          userId = user.id;
          connectedUsers.set(userId, ws);
          notifyFriendsStatus(userId, true);
          sendFriendsOnline(userId);

          const friendsList = user.friends.map(fid => {
            const f = db.getUserById(fid);
            return { id: f.id, name: f.name, avatar: f.avatar, isOnline: connectedUsers.has(fid) };
          });

          const pendingWithDetails = user.pendingRequests.map(req => {
            const from = db.getUserById(req.from);
            return { from: { id: from.id, name: from.name, avatar: from.avatar } };
          });

          ws.send(JSON.stringify({
            type: "login_success",
            user: { id: user.id, name: user.name, avatar: user.avatar },
            friends: friendsList,
            pendingRequests: pendingWithDetails,
          }));

          const relevant = messageHistory.filter(msg =>
            (msg.userId === userId && user.friends.includes(msg.recipientId)) ||
            (msg.recipientId === userId && user.friends.includes(msg.userId))
          );
          ws.send(JSON.stringify({ type: "history", messages: relevant }));
          break;
        }

        case "search_users": {
          const { query } = parsed;
          const cur = db.getUserById(userId);
          if (!cur) return;
          const all = Object.values(db.getAllUsers());
          const results = all
            .filter(u => u.id !== userId && !cur.friends.includes(u.id) && u.name.toLowerCase().includes(query.toLowerCase()))
            .map(u => ({ id: u.id, name: u.name, avatar: u.avatar }));
          ws.send(JSON.stringify({ type: "search_results", query, users: results }));
          break;
        }

        case "friend_request": {
          const { targetUserId } = parsed;
          const target = db.getUserById(targetUserId);
          if (!target) return;
          if (sender.friends.includes(targetUserId)) {
            ws.send(JSON.stringify({ type: "error", message: "Já são amigos" }));
            return;
          }
          const already = sender.pendingRequests.some(r => r.from === targetUserId) ||
                          target.pendingRequests.some(r => r.from === userId);
          if (already) {
            ws.send(JSON.stringify({ type: "error", message: "Pedido já enviado" }));
            return;
          }
          target.pendingRequests.push({ from: userId, to: targetUserId, status: "pending" });
          db.updateUser(target);
          sendToUser(targetUserId, {
            type: "friend_request_received",
            from: { id: userId, name: sender.name, avatar: sender.avatar },
          });
          ws.send(JSON.stringify({ type: "friend_request_sent", to: targetUserId }));
          break;
        }

        case "friend_request_response": {
          const { fromUserId, accept } = parsed;
          const requester = db.getUserById(fromUserId);
          const cur = sender;
          if (!requester) return;
          const idx = cur.pendingRequests.findIndex(r => r.from === fromUserId && r.status === "pending");
          if (idx === -1) return;
          if (accept) {
            if (!cur.friends.includes(fromUserId)) cur.friends.push(fromUserId);
            if (!requester.friends.includes(userId)) requester.friends.push(userId);
            cur.pendingRequests.splice(idx, 1);
            db.updateUser(cur);
            db.updateUser(requester);
            sendToUser(userId, { type: "friend_added", friend: { id: requester.id, name: requester.name, avatar: requester.avatar } });
            sendToUser(fromUserId, { type: "friend_added", friend: { id: cur.id, name: cur.name, avatar: cur.avatar } });
            sendFriendsOnline(userId);
            sendFriendsOnline(fromUserId);
          } else {
            cur.pendingRequests.splice(idx, 1);
            db.updateUser(cur);
            sendToUser(fromUserId, { type: "friend_request_rejected", by: userId });
          }
          break;
        }

        case "message": {
          const { recipientId, content, replyTo } = parsed;
          if (!sender.friends.includes(recipientId)) {
            ws.send(JSON.stringify({ type: "error", message: "Não é amigo" }));
            return;
          }
          const message = {
            id: generateId(),
            type: "message",
            userId: sender.id,
            userName: sender.name,
            userAvatar: sender.avatar,
            recipientId,
            content,
            timestamp: Date.now(),
            readBy: [sender.id],
            edited: false,
            deleted: false,
            replyTo: replyTo || null,
            reactions: {},
          };
          messageHistory.push(message);
          if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
          sendToUser(sender.id, message);
          sendToUser(recipientId, message);
          break;
        }

        case "file_message": {
          const { recipientId, fileType, fileName, fileData, thumbnail, replyTo } = parsed;
          if (!sender.friends.includes(recipientId)) return;
          const message = {
            id: generateId(),
            type: "file_message",
            userId: sender.id,
            userName: sender.name,
            userAvatar: sender.avatar,
            recipientId,
            fileType,
            fileName,
            fileData,
            thumbnail,
            timestamp: Date.now(),
            readBy: [sender.id],
            edited: false,
            deleted: false,
            replyTo: replyTo || null,
            reactions: {},
          };
          messageHistory.push(message);
          if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
          sendToUser(sender.id, message);
          sendToUser(recipientId, message);
          break;
        }

        case "edit_message": {
          const idx = messageHistory.findIndex(m => m.id === parsed.messageId);
          if (idx !== -1 && messageHistory[idx].userId === userId) {
            messageHistory[idx].content = parsed.newContent;
            messageHistory[idx].edited = true;
            messageHistory[idx].editedAt = Date.now();
            const update = {
              type: "message_edited",
              messageId: parsed.messageId,
              newContent: parsed.newContent,
              editedAt: messageHistory[idx].editedAt,
            };
            sendToUser(messageHistory[idx].userId, update);
            sendToUser(messageHistory[idx].recipientId, update);
          }
          break;
        }

        case "delete_message": {
          const idx = messageHistory.findIndex(m => m.id === parsed.messageId);
          if (idx !== -1 && messageHistory[idx].userId === userId) {
            messageHistory[idx].deleted = true;
            messageHistory[idx].deletedAt = Date.now();
            const update = { type: "message_deleted", messageId: parsed.messageId };
            sendToUser(messageHistory[idx].userId, update);
            sendToUser(messageHistory[idx].recipientId, update);
          }
          break;
        }

        case "reaction": {
          const idx = messageHistory.findIndex(m => m.id === parsed.messageId);
          if (idx !== -1) {
            const msg = messageHistory[idx];
            const emoji = parsed.emoji;
            if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
            const arr = msg.reactions[emoji];
            const pos = arr.indexOf(userId);
            if (parsed.add) {
              if (pos === -1) arr.push(userId);
            } else {
              if (pos !== -1) arr.splice(pos, 1);
              if (arr.length === 0) delete msg.reactions[emoji];
            }
            const update = { type: "reaction_update", messageId: parsed.messageId, reactions: msg.reactions };
            sendToUser(msg.userId, update);
            sendToUser(msg.recipientId, update);
          }
          break;
        }

        case "read_receipt": {
          const { lastReadMessageId } = parsed;
          let updated = false;
          for (let msg of messageHistory) {
            if (msg.id === lastReadMessageId) break;
            if (msg.recipientId === userId && !msg.readBy.includes(userId)) {
              msg.readBy.push(userId);
              updated = true;
            }
          }
          if (updated) broadcast({ type: "read_update", userId, lastReadMessageId });
          break;
        }

        case "typing": {
          const { recipientId, isTyping } = parsed;
          sendToUser(recipientId, {
            type: "typing",
            userId: userId,
            userName: sender.name,
            isTyping,
          });
          break;
        }

        default: break;
      }
    } catch (err) {
      console.error("Erro:", err);
    }
  });

  ws.on("close", () => {
    if (userId) {
      connectedUsers.delete(userId);
      notifyFriendsStatus(userId, false);
    }
  });
});

console.log(`Servidor WebSocket rodando na porta ${process.env.PORT || 8080}`);
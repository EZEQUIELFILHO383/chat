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
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(data, excludeWs = null) {
  const message = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client !== excludeWs && client.readyState === client.OPEN) {
      client.send(message);
    }
  });
}

function sendFriendsOnline(userId) {
  const user = db.getUserById(userId);
  if (!user) return;
  const onlineFriends = user.friends
    .filter(friendId => connectedUsers.has(friendId))
    .map(friendId => {
      const friend = db.getUserById(friendId);
      return { id: friend.id, name: friend.name, avatar: friend.avatar };
    });
  sendToUser(userId, { type: "friends_online", friends: onlineFriends });
}

function notifyFriendsStatus(userId, isOnline) {
  const user = db.getUserById(userId);
  if (!user) return;
  user.friends.forEach(friendId => {
    sendToUser(friendId, {
      type: "friend_status",
      userId: userId,
      name: user.name,
      isOnline: isOnline,
    });
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
              ws.send(JSON.stringify({ type: "login_failed", reason: "Username já existe" }));
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

          const friendsList = user.friends.map(friendId => {
            const friend = db.getUserById(friendId);
            return {
              id: friend.id,
              name: friend.name,
              avatar: friend.avatar,
              isOnline: connectedUsers.has(friendId)
            };
          });

          const pendingWithDetails = user.pendingRequests.map(req => {
            const fromUser = db.getUserById(req.from);
            return {
              from: { id: fromUser.id, name: fromUser.name, avatar: fromUser.avatar }
            };
          });

          ws.send(JSON.stringify({
            type: "login_success",
            user: { id: user.id, name: user.name, avatar: user.avatar },
            friends: friendsList,
            pendingRequests: pendingWithDetails,
          }));

          const friendIds = user.friends;
          const relevantMessages = messageHistory.filter(msg =>
            (msg.userId === userId && friendIds.includes(msg.recipientId)) ||
            (msg.recipientId === userId && friendIds.includes(msg.userId))
          );
          ws.send(JSON.stringify({ type: "history", messages: relevantMessages }));
          break;
        }

        case "search_users": {
          const { query } = parsed;
          const currentUserObj = db.getUserById(userId);
          if (!currentUserObj) return;

          const allUsersList = Object.values(db.getAllUsers());
          const friendsIds = currentUserObj.friends;

          const results = allUsersList
            .filter(u => 
              u.id !== userId && 
              !friendsIds.includes(u.id) &&
              u.name.toLowerCase().includes(query.toLowerCase())
            )
            .map(u => ({
              id: u.id,
              name: u.name,
              avatar: u.avatar
            }));

          ws.send(JSON.stringify({
            type: "search_results",
            query,
            users: results
          }));
          break;
        }

        case "friend_request": {
          const { targetUserId } = parsed;
          const targetUser = db.getUserById(targetUserId);
          if (!targetUser) return;
          if (sender.friends.includes(targetUserId)) {
            ws.send(JSON.stringify({ type: "error", message: "Já são amigos" }));
            return;
          }
          const alreadyPending = sender.pendingRequests.some(req => req.from === targetUserId && req.status === 'pending') ||
                                 targetUser.pendingRequests.some(req => req.from === userId && req.status === 'pending');
          if (alreadyPending) {
            ws.send(JSON.stringify({ type: "error", message: "Pedido já enviado" }));
            return;
          }
          const request = { from: userId, to: targetUserId, status: "pending" };
          targetUser.pendingRequests.push(request);
          db.updateUser(targetUser);
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
          const currentUser = sender;
          if (!requester) return;

          const requestIndex = currentUser.pendingRequests.findIndex(req => req.from === fromUserId && req.status === "pending");
          if (requestIndex === -1) return;

          if (accept) {
            if (!currentUser.friends.includes(fromUserId)) currentUser.friends.push(fromUserId);
            if (!requester.friends.includes(userId)) requester.friends.push(userId);
            currentUser.pendingRequests.splice(requestIndex, 1);
            db.updateUser(currentUser);
            db.updateUser(requester);

            sendToUser(userId, { type: "friend_added", friend: { id: requester.id, name: requester.name, avatar: requester.avatar } });
            sendToUser(fromUserId, { type: "friend_added", friend: { id: currentUser.id, name: currentUser.name, avatar: currentUser.avatar } });
            sendFriendsOnline(userId);
            sendFriendsOnline(fromUserId);
          } else {
            currentUser.pendingRequests.splice(requestIndex, 1);
            db.updateUser(currentUser);
            sendToUser(fromUserId, { type: "friend_request_rejected", by: userId });
          }
          break;
        }

        case "message": {
          const { recipientId, content, replyTo } = parsed;
          const senderUser = sender;
          const recipient = db.getUserById(recipientId);
          if (!recipient || !senderUser.friends.includes(recipientId)) {
            ws.send(JSON.stringify({ type: "error", message: "Não é amigo deste usuário" }));
            return;
          }
          const message = {
            id: generateId(),
            type: "message",
            userId: senderUser.id,
            userName: senderUser.name,
            userAvatar: senderUser.avatar,
            recipientId: recipientId,
            content: content,
            timestamp: Date.now(),
            readBy: [senderUser.id],
            edited: false,
            deleted: false,
            replyTo: replyTo || null,
            reactions: {},
          };
          messageHistory.push(message);
          if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
          sendToUser(senderUser.id, message);
          sendToUser(recipientId, message);
          break;
        }

        case "file_message": {
          const { recipientId, fileType, fileName, fileData, thumbnail, replyTo } = parsed;
          const senderUser = sender;
          const recipient = db.getUserById(recipientId);
          if (!recipient || !senderUser.friends.includes(recipientId)) return;
          const message = {
            id: generateId(),
            type: "file_message",
            userId: senderUser.id,
            userName: senderUser.name,
            userAvatar: senderUser.avatar,
            recipientId: recipientId,
            fileType,
            fileName,
            fileData,
            thumbnail,
            timestamp: Date.now(),
            readBy: [senderUser.id],
            edited: false,
            deleted: false,
            replyTo: replyTo || null,
            reactions: {},
          };
          messageHistory.push(message);
          if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
          sendToUser(senderUser.id, message);
          sendToUser(recipientId, message);
          break;
        }

        case "edit_message": {
          const msgIndex = messageHistory.findIndex(m => m.id === parsed.messageId);
          if (msgIndex !== -1 && messageHistory[msgIndex].userId === userId) {
            messageHistory[msgIndex].content = parsed.newContent;
            messageHistory[msgIndex].edited = true;
            messageHistory[msgIndex].editedAt = Date.now();
            const update = {
              type: "message_edited",
              messageId: parsed.messageId,
              newContent: parsed.newContent,
              editedAt: messageHistory[msgIndex].editedAt,
            };
            sendToUser(messageHistory[msgIndex].userId, update);
            sendToUser(messageHistory[msgIndex].recipientId, update);
          }
          break;
        }

        case "delete_message": {
          const msgIndex = messageHistory.findIndex(m => m.id === parsed.messageId);
          if (msgIndex !== -1 && messageHistory[msgIndex].userId === userId) {
            messageHistory[msgIndex].deleted = true;
            messageHistory[msgIndex].deletedAt = Date.now();
            const update = { type: "message_deleted", messageId: parsed.messageId };
            sendToUser(messageHistory[msgIndex].userId, update);
            sendToUser(messageHistory[msgIndex].recipientId, update);
          }
          break;
        }

        case "reaction": {
          const msgIndex = messageHistory.findIndex(m => m.id === parsed.messageId);
          if (msgIndex !== -1) {
            const msg = messageHistory[msgIndex];
            const emoji = parsed.emoji;
            if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
            const reactionArray = msg.reactions[emoji];
            const idx = reactionArray.indexOf(userId);
            if (parsed.add) {
              if (idx === -1) reactionArray.push(userId);
            } else {
              if (idx !== -1) reactionArray.splice(idx, 1);
              if (reactionArray.length === 0) delete msg.reactions[emoji];
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
          if (updated) {
            broadcast({ type: "read_update", userId, lastReadMessageId });
          }
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

        default:
          break;
      }
    } catch (err) {
      console.error("Erro ao processar mensagem:", err);
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
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let users = {};
if (fs.existsSync(USERS_FILE)) {
  try {
    users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (err) {
    console.error('Erro ao ler users.json:', err);
  }
}

function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function getUserById(id) {
  return users[id];
}

function getUserByUsername(username) {
  return Object.values(users).find(u => u.name === username);
}

function createUser(id, name, password, avatar) {
  if (getUserByUsername(name)) return null;
  users[id] = {
    id,
    name,
    password,
    avatar,
    friends: [],
    pendingRequests: [],
  };
  saveUsers();
  return users[id];
}

function updateUser(user) {
  users[user.id] = user;
  saveUsers();
}

function getAllUsers() {
  return users;
}

module.exports = {
  getUserById,
  getUserByUsername,
  createUser,
  updateUser,
  getAllUsers,
};
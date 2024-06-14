const admin = require("firebase-admin"); // import firebase admin sdk for authentication
const serviceAccount = require("./personal-budget-tracker-cd477-firebase-adminsdk-jkmdk-b05cf2de74.json"); // import service account of thee project

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL:
    "https://personal-budget-tracker-cd477-default-rtdb.firebaseio.com",
});

const db = admin.firestore();

module.exports = { admin, db }; // export function

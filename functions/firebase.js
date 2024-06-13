const admin = require("firebase-admin");
const serviceAccount = require("./personal-budget-tracker-cd477-firebase-adminsdk-jkmdk-b05cf2de74.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL:
    "https://personal-budget-tracker-cd477-default-rtdb.firebaseio.com",
});

const db = admin.firestore();

module.exports = { admin, db };
